const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const crypto = require('crypto');
const { checkRating, summarize } = require('../lib/rating');

// Same storage account as the contact form, separate tables.
const RATINGS_TABLE = 'SiteRatings';        // one row per rating (stars, optional comment)
const SUMMARY_TABLE = 'SiteRatingSummary';  // one row with running totals s1..s5
const RATE_TABLE = 'RatingRateLimit';       // per-IP daily counter
const MAX_PER_DAY = 3;
const SUMMARY_KEY = { partitionKey: 'summary', rowKey: 'all' };

let clients;
async function getClients() {
  if (clients) return clients;
  const conn = process.env.CONTACT_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('CONTACT_STORAGE_CONNECTION_STRING is not set');
  const mk = name => TableClient.fromConnectionString(conn, name);
  const c = { ratings: mk(RATINGS_TABLE), summary: mk(SUMMARY_TABLE), rate: mk(RATE_TABLE) };
  await Promise.all(Object.values(c).map(t => t.createTable())); // no-op if they exist
  clients = c;
  return clients;
}

function clientIpHash(request) {
  const raw = request.headers.get('x-azure-clientip') || request.headers.get('x-forwarded-for') || '';
  const ip = raw.split(',')[0].trim().replace(/:\d+$/, '');
  return crypto.createHash('sha256').update(ip || 'unknown').digest('hex').slice(0, 32);
}

async function allowRequest(rate, ipHash) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const row = await rate.getEntity(ipHash, day);
    if (row.count >= MAX_PER_DAY) return false;
    await rate.updateEntity({ partitionKey: ipHash, rowKey: day, count: row.count + 1 }, 'Replace', { etag: row.etag });
  } catch (err) {
    if (err.statusCode !== 404) throw err;
    await rate.createEntity({ partitionKey: ipHash, rowKey: day, count: 1 });
  }
  return true;
}

async function readSummary(summary) {
  try {
    return await summary.getEntity(SUMMARY_KEY.partitionKey, SUMMARY_KEY.rowKey);
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

// Add one vote to the running totals. Uses the ETag so two votes at the same
// moment can't overwrite each other; retries a few times on conflict.
async function addToSummary(summary, stars) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await readSummary(summary);
    const next = { ...SUMMARY_KEY };
    for (let n = 1; n <= 5; n++) next[`s${n}`] = (Number(row?.[`s${n}`]) || 0) + (n === stars ? 1 : 0);
    try {
      if (row) await summary.updateEntity(next, 'Replace', { etag: row.etag });
      else await summary.createEntity(next);
      return next;
    } catch (err) {
      if (err.statusCode !== 412 && err.statusCode !== 409) throw err; // 412/409 = someone else wrote first
    }
  }
  throw new Error('Could not update rating summary after retries');
}

const json = (status, body, cache = 'no-store') => ({ status, jsonBody: body, headers: { 'Cache-Control': cache } });

app.http('ratings', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'ratings',
  handler: async (request, context) => {
    if (request.method === 'GET') {
      try {
        const { summary } = await getClients();
        return json(200, { ok: true, ...summarize(await readSummary(summary)) }, 'public, max-age=60');
      } catch (err) {
        context.error('Rating summary failed', err);
        return json(500, { ok: false, error: 'Ratings are unavailable right now.' });
      }
    }

    let body;
    try {
      if ((request.headers.get('content-length') | 0) > 5000) return json(413, { ok: false, error: 'Too large.' });
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: 'Invalid request.' });
    }

    const result = checkRating(body);
    if (result.spam) {
      context.log(`Dropped spam rating (${result.reason})`);
      return json(200, { ok: true });
    }
    if (result.errors) return json(400, { ok: false, errors: result.errors });

    try {
      const { ratings, summary, rate } = await getClients();
      const ipHash = clientIpHash(request);
      if (!(await allowRequest(rate, ipHash))) {
        return json(429, { ok: false, error: 'You have already rated the site today. Thanks!' });
      }

      const now = new Date();
      const rowKey = String(8640000000000000 - now.getTime()).padStart(16, '0') + '-' + crypto.randomUUID().slice(0, 8);
      await ratings.createEntity({
        partitionKey: now.toISOString().slice(0, 7),
        rowKey,
        stars: result.data.stars,
        comment: result.data.comment,
        page: String(body.page || '/').slice(0, 100),
        submittedAt: now.toISOString(),
        ipHash,
        userAgent: (request.headers.get('user-agent') || '').slice(0, 300),
        approved: false, // comments are private until reviewed
      });
      const totals = await addToSummary(summary, result.data.stars);
      context.log(`Rating stored: ${result.data.stars} stars (${rowKey})`);
      return json(200, { ok: true, ...summarize(totals) });
    } catch (err) {
      context.error('Rating failed', err);
      return json(500, { ok: false, error: 'Something went wrong saving your rating. Please try again later.' });
    }
  },
});

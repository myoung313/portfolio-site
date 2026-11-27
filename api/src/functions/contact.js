const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const crypto = require('crypto');
const { checkSubmission } = require('../lib/validate');

const SUBMISSIONS_TABLE = 'ContactSubmissions';
const RATE_TABLE = 'ContactRateLimit';
const MAX_PER_HOUR = 5;

let clients; // reused across warm invocations
async function getClients() {
  if (clients) return clients;
  const conn = process.env.CONTACT_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('CONTACT_STORAGE_CONNECTION_STRING is not set');
  const subs = TableClient.fromConnectionString(conn, SUBMISSIONS_TABLE);
  const rate = TableClient.fromConnectionString(conn, RATE_TABLE);
  await Promise.all([subs.createTable(), rate.createTable()]); // no-op if they exist
  clients = { subs, rate };
  return clients;
}

// Static Web Apps puts the visitor's IP in x-forwarded-for. Store only a hash.
function clientIpHash(request) {
  const raw = request.headers.get('x-azure-clientip') || request.headers.get('x-forwarded-for') || '';
  const ip = raw.split(',')[0].trim().replace(/:\d+$/, '');
  return crypto.createHash('sha256').update(ip || 'unknown').digest('hex').slice(0, 32);
}

// Fixed one-hour window per IP. Returns true if this request is allowed.
async function allowRequest(rate, ipHash) {
  const hour = new Date().toISOString().slice(0, 13); // e.g. 2026-11-27T01
  try {
    const row = await rate.getEntity(ipHash, hour);
    if (row.count >= MAX_PER_HOUR) return false;
    await rate.updateEntity({ partitionKey: ipHash, rowKey: hour, count: row.count + 1 }, 'Replace', { etag: row.etag });
  } catch (err) {
    if (err.statusCode !== 404) throw err;
    await rate.createEntity({ partitionKey: ipHash, rowKey: hour, count: 1 });
  }
  return true;
}

const json = (status, body) => ({ status, jsonBody: body, headers: { 'Cache-Control': 'no-store' } });

app.http('contact', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'contact',
  handler: async (request, context) => {
    let body;
    try {
      if ((request.headers.get('content-length') | 0) > 20000) return json(413, { ok: false, error: 'Message too large.' });
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: 'Invalid request.' });
    }

    const result = checkSubmission(body);
    if (result.spam) {
      context.log(`Dropped spam submission (${result.reason})`);
      return json(200, { ok: true }); // don't tell bots they were caught
    }
    if (result.errors) return json(400, { ok: false, errors: result.errors });

    try {
      const { subs, rate } = await getClients();
      const ipHash = clientIpHash(request);
      if (!(await allowRequest(rate, ipHash))) {
        return json(429, { ok: false, error: 'Too many messages from your network. Please try again later or email me directly.' });
      }

      const now = new Date();
      // Newest first when browsing in Storage Browser: reverse-ticks row key.
      const rowKey = String(8640000000000000 - now.getTime()).padStart(16, '0') + '-' + crypto.randomUUID().slice(0, 8);
      await subs.createEntity({
        partitionKey: now.toISOString().slice(0, 7), // YYYY-MM
        rowKey,
        ...result.data,
        submittedAt: now.toISOString(),
        ipHash,
        userAgent: (request.headers.get('user-agent') || '').slice(0, 300),
        status: 'new',
      });
      context.log(`Contact submission stored: ${rowKey}`);
      return json(200, { ok: true });
    } catch (err) {
      context.error('Contact form failed', err);
      return json(500, { ok: false, error: 'Something went wrong on my side. Please email me directly.' });
    }
  },
});

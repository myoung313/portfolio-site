const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const crypto = require('crypto');
const { isBot, nextTotal } = require('../lib/visits');

// Footer visit counter. Stores one number (the total) and nothing about the visitor.
// A short-lived per-IP limit (scrambled code, same as the other features) stops
// someone inflating the count with a script.
const COUNTER_TABLE = 'SiteVisits';
const RATE_TABLE = 'VisitRateLimit';
const MAX_PER_DAY = 20;
const KEY = { partitionKey: 'counter', rowKey: 'all' };

let clients;
async function getClients() {
  if (clients) return clients;
  const conn = process.env.CONTACT_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('CONTACT_STORAGE_CONNECTION_STRING is not set');
  const c = {
    counter: TableClient.fromConnectionString(conn, COUNTER_TABLE),
    rate: TableClient.fromConnectionString(conn, RATE_TABLE),
  };
  await Promise.all(Object.values(c).map(t => t.createTable())); // no-op if they exist
  clients = c;
  return clients;
}

function clientIpHash(request) {
  const raw = request.headers.get('x-azure-clientip') || request.headers.get('x-forwarded-for') || '';
  const ip = raw.split(',')[0].trim().replace(/:\d+$/, '');
  return crypto.createHash('sha256').update('visits:' + (ip || 'unknown')).digest('hex').slice(0, 32);
}

async function allowRequest(rate, ipHash) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const row = await rate.getEntity(ipHash, day);
    if (row.count >= MAX_PER_DAY) return false;
    await rate.updateEntity({ partitionKey: ipHash, rowKey: day, count: row.count + 1 }, 'Replace', { etag: row.etag });
  } catch (err) {
    if (err.statusCode === 412) return false; // raced with another request from the same IP
    if (err.statusCode !== 404) throw err;
    try { await rate.createEntity({ partitionKey: ipHash, rowKey: day, count: 1 }); }
    catch (e) { if (e.statusCode !== 409) throw e; return false; }
  }
  return true;
}

async function readCounter(counter) {
  try {
    return await counter.getEntity(KEY.partitionKey, KEY.rowKey);
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

// Add one, using the ETag so two visits at the same moment both count.
async function increment(counter) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await readCounter(counter);
    const next = { ...KEY, total: nextTotal(row) };
    try {
      if (row) await counter.updateEntity(next, 'Replace', { etag: row.etag });
      else await counter.createEntity(next);
      return next.total;
    } catch (err) {
      if (err.statusCode !== 412 && err.statusCode !== 409) throw err;
    }
  }
  throw new Error('Could not update visit counter after retries');
}

const json = (status, body, cache = 'no-store') => ({ status, jsonBody: body, headers: { 'Cache-Control': cache } });

app.http('visits', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'visits',
  handler: async (request, context) => {
    try {
      const { counter, rate } = await getClients();
      if (request.method === 'GET') {
        const row = await readCounter(counter);
        return json(200, { ok: true, total: Number(row?.total) || 0 }, 'public, max-age=60');
      }
      // POST = "count me". Bots and over-limit requests just get the current total back.
      if (isBot(request.headers.get('user-agent')) || !(await allowRequest(rate, clientIpHash(request)))) {
        const row = await readCounter(counter);
        return json(200, { ok: true, total: Number(row?.total) || 0, counted: false });
      }
      return json(200, { ok: true, total: await increment(counter), counted: true });
    } catch (err) {
      context.error('Visit counter failed', err);
      return json(500, { ok: false });
    }
  },
});

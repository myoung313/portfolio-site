const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { Resolver } = require('node:dns').promises;
const crypto = require('crypto');
const { normalizeDomain, runCheckup } = require('../lib/emailcheck');

// GET /api/checkup?domain=example.com -> email security grade (SPF, DKIM, DMARC, MX, MTA-STS, TLS-RPT, BIMI).
// Lookups are public DNS only. We log which domain was checked and its grade
// (no IP or personal data) so we can see which businesses use the tool.
const LOG_TABLE = 'DomainChecks';
const RATE_TABLE = 'CheckupRateLimit';
const MAX_PER_HOUR = 20;
const CACHE_MS = 5 * 60e3;
const MAX_POLICY_BYTES = 16 * 1024;

const dns = new Resolver({ timeout: 2500, tries: 2 });
const cache = new Map(); // domain -> { at, result }

let clients;
async function getClients() {
  if (clients) return clients;
  const conn = process.env.CONTACT_STORAGE_CONNECTION_STRING;
  if (!conn) return null; // still works without storage (for example when run locally)
  const c = { log: TableClient.fromConnectionString(conn, LOG_TABLE), rate: TableClient.fromConnectionString(conn, RATE_TABLE) };
  await Promise.all(Object.values(c).map(t => t.createTable()));
  clients = c;
  return clients;
}

function clientIpHash(request) {
  const raw = request.headers.get('x-azure-clientip') || request.headers.get('x-forwarded-for') || '';
  const ip = raw.split(',')[0].trim().replace(/:\d+$/, '');
  return crypto.createHash('sha256').update(ip || 'unknown').digest('hex').slice(0, 32);
}

async function allowRequest(rate, ipHash) {
  const hour = new Date().toISOString().slice(0, 13);
  try {
    const row = await rate.getEntity(ipHash, hour);
    if (row.count >= MAX_PER_HOUR) return false;
    await rate.updateEntity({ partitionKey: ipHash, rowKey: hour, count: row.count + 1 }, 'Replace', { etag: row.etag });
  } catch (err) {
    if (err.statusCode === 404) await rate.createEntity({ partitionKey: ipHash, rowKey: hour, count: 1 });
    else if (err.statusCode !== 412 && err.statusCode !== 409) throw err; // lost a race: let this one through
  }
  return true;
}

// Reads the MTA-STS policy file: HTTPS only, no redirects, 3 second timeout, 16 KB max.
async function fetchText(url) {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000), headers: { 'User-Agent': 'CloudShiftLabs-EmailCheckup/1.0' } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  let size = 0; const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_POLICY_BYTES) { reader.cancel(); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const json = (status, body, cache = 'no-store') => ({ status, jsonBody: body, headers: { 'Cache-Control': cache } });

app.http('checkup', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'checkup',
  handler: async (request, context) => {
    const { domain, error } = normalizeDomain(request.query.get('domain') || '');
    if (error) return json(400, { ok: false, error });

    let store = null;
    try {
      store = await getClients();
      if (store && !(await allowRequest(store.rate, clientIpHash(request)))) {
        return json(429, { ok: false, error: `That's ${MAX_PER_HOUR} checks this hour. Please try again a little later.` });
      }
    } catch (err) {
      context.error('Checkup rate limit unavailable', err); // fail open: the check is cheap
    }

    const hit = cache.get(domain);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(200, { ...hit.result, cached: true }, 'public, max-age=300');

    let result;
    try {
      result = await runCheckup(domain, { dns, fetchText });
    } catch (err) {
      context.error(`Checkup failed for ${domain}`, err);
      return json(500, { ok: false, error: 'Something went wrong running the checkup. Please try again.' });
    }
    if (!result.ok) return json(404, result);

    if (!result.partial) {
      cache.set(domain, { at: Date.now(), result });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
    }
    if (store) {
      const now = new Date();
      store.log.createEntity({
        partitionKey: now.toISOString().slice(0, 7),
        rowKey: String(8640000000000000 - now.getTime()).padStart(16, '0') + '-' + crypto.randomUUID().slice(0, 8),
        domain, grade: result.grade, score: result.score, provider: result.provider || '', checkedAt: now.toISOString(),
      }).catch(err => context.error('Could not log checkup', err));
    }
    context.log(`Checkup ${domain}: ${result.grade} (${result.score})`);
    return json(200, result, result.partial ? 'no-store' : 'public, max-age=300');
  },
});

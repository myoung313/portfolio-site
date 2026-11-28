const { app } = require('@azure/functions');
const { TableClient, odata } = require('@azure/data-tables');
const crypto = require('crypto');
const { checkScore, weekKey, nextReset, rowKeyFor, ROWKEY_RE } = require('../lib/leaderboard');
const { principal, isAdmin } = require('../lib/admin');

// Same storage account as the other features.
//   PhishScores: each score is stored twice with the same RowKey, once in the
//   week's partition ("2026-W48") and once in "all", so both boards are a
//   single sorted partition read. status = approved | pending | rejected.
const SCORES_TABLE = 'PhishScores';
const RATE_TABLE = 'LeaderboardRateLimit';
const ALL = 'all';
const TOP = 25;
const MAX_PER_DAY = 15;
const STATUSES = ['pending', 'approved', 'rejected'];

let clients;
async function getClients() {
  if (clients) return clients;
  const conn = process.env.CONTACT_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('CONTACT_STORAGE_CONNECTION_STRING is not set');
  const mk = name => TableClient.fromConnectionString(conn, name);
  const c = { scores: mk(SCORES_TABLE), rate: mk(RATE_TABLE) };
  await Promise.all(Object.values(c).map(t => t.createTable())); // no-op if they exist
  clients = c;
  return clients;
}

function clientIpHash(request) {
  const raw = request.headers.get('x-azure-clientip') || request.headers.get('x-forwarded-for') || '';
  const ip = raw.split(',')[0].trim().replace(/:\d+$/, '');
  return crypto.createHash('sha256').update('phish:' + (ip || 'unknown')).digest('hex').slice(0, 32);
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

const publicView = e => ({ id: e.rowKey, name: e.name, points: e.points, correct: e.correct, total: e.total, seconds: e.seconds, at: e.createdAt });
const adminView = e => ({ ...publicView(e), status: e.status, hold: JSON.parse(e.hold || '[]'), week: e.week, streak: e.streak });

async function top(scores, pk, limit = TOP) {
  const out = [];
  for await (const e of scores.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${pk} and status eq 'approved'` } })) {
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

// Rank = approved scores sorted ahead of this one + 1 (capped so a huge board stays cheap).
async function rankOf(scores, pk, rowKey) {
  let n = 0;
  for await (const _ of scores.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${pk} and RowKey lt ${rowKey} and status eq 'approved'`, select: ['RowKey'] } })) {
    if (++n >= 999) break;
  }
  return n + 1;
}

const json = (status, body, cache = 'no-store') => ({ status, jsonBody: body, headers: { 'Cache-Control': cache } });

app.http('leaderboard', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'leaderboard',
  handler: async (request, context) => {
    if (request.method === 'GET') {
      try {
        const { scores } = await getClients();
        const week = weekKey();
        const [w, a] = await Promise.all([top(scores, week), top(scores, ALL)]);
        return json(200, { ok: true, week, resetsAt: nextReset(), weekly: w.map(publicView), allTime: a.map(publicView) }, 'public, max-age=15');
      } catch (err) {
        context.error('Leaderboard read failed', err);
        return json(500, { ok: false, error: 'The leaderboard is unavailable right now.' });
      }
    }

    let body;
    try {
      if ((request.headers.get('content-length') | 0) > 2000) return json(413, { ok: false, error: 'Too large.' });
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: 'Invalid request.' });
    }

    const result = checkScore(body);
    if (result.spam) {
      context.log(`Dropped leaderboard spam (${result.spam})`);
      return json(200, { ok: true, status: 'pending', id: 'x' + Date.now() });
    }
    if (result.errors) return json(400, { ok: false, errors: result.errors });

    try {
      const { scores, rate } = await getClients();
      const ipHash = clientIpHash(request);
      if (!(await allowRequest(rate, ipHash))) return json(429, { ok: false, error: "You've saved a lot of scores today. Come back tomorrow!" });

      const d = result.data;
      const now = new Date();
      const week = weekKey(now);
      const status = d.hold.length ? 'pending' : 'approved';
      const rowKey = rowKeyFor(d.points, now.getTime(), crypto.randomUUID().slice(0, 8));
      const entity = {
        rowKey, status, name: d.name, points: d.points, correct: d.correct, total: d.total, seconds: d.seconds, streak: d.streak,
        week, createdAt: now.toISOString(), hold: JSON.stringify(d.hold), ipHash,
      };
      await scores.createEntity({ ...entity, partitionKey: week });
      await scores.createEntity({ ...entity, partitionKey: ALL });
      const [rank, allRank] = await Promise.all([rankOf(scores, week, rowKey), rankOf(scores, ALL, rowKey)]);
      context.log(`Leaderboard ${rowKey} ${status} ${d.points}pts${d.hold.length ? ' (' + d.hold.join(', ') + ')' : ''}`);
      return json(200, { ok: true, status, id: rowKey, points: d.points, rank, allRank });
    } catch (err) {
      context.error('Leaderboard save failed', err);
      return json(500, { ok: false, error: 'Something went wrong saving your score. Please try again later.' });
    }
  },
});

// Admin: review held nicknames and remove bad scores. staticwebapp.config.json requires
// sign-in for this route; ADMIN_EMAILS decides who gets in.
app.http('leaderboardAdmin', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'leaderboard/admin',
  handler: async (request, context) => {
    if (!principal(request)) return json(401, { ok: false, error: 'Please sign in.' });
    if (!isAdmin(request)) return json(403, { ok: false, notAdmin: true, error: 'This account is not on the admin list.' });
    try {
      const { scores } = await getClients();
      if (request.method === 'GET') {
        const want = STATUSES.includes(request.query.get('status')) ? request.query.get('status') : 'pending';
        const counts = { pending: 0, approved: 0, rejected: 0 };
        const rows = [];
        for await (const e of scores.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${ALL}` } })) {
          if (counts[e.status] !== undefined) counts[e.status]++;
          if (e.status === want && rows.length < 300) rows.push(e);
        }
        if (want === 'pending') rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first for the queue
        return json(200, { ok: true, scores: rows.map(adminView), counts });
      }

      let body;
      try { body = await request.json(); } catch { return json(400, { ok: false, error: 'Invalid request.' }); }
      const id = String(body?.id || '');
      if (!ROWKEY_RE.test(id)) return json(400, { ok: false, error: 'Unknown score.' });
      let row;
      try { row = await scores.getEntity(ALL, id); } catch (err) {
        if (err.statusCode === 404) return json(404, { ok: false, error: 'That score no longer exists.' });
        throw err;
      }
      const who = principal(request)?.userDetails || 'admin';
      const parts = [ALL, row.week];
      if (body.action === 'delete') {
        for (const pk of parts) await scores.deleteEntity(pk, id).catch(err => { if (err.statusCode !== 404) throw err; });
        context.log(`Leaderboard ${id} deleted by ${who}`);
        return json(200, { ok: true });
      }
      const status = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : null;
      if (!status) return json(400, { ok: false, error: 'Unknown action.' });
      const patch = { rowKey: id, status, reviewedBy: who, reviewedAt: new Date().toISOString() };
      for (const pk of parts) await scores.updateEntity({ ...patch, partitionKey: pk }, 'Merge').catch(err => { if (err.statusCode !== 404) throw err; });
      context.log(`Leaderboard ${id} ${body.action} by ${who}`);
      return json(200, { ok: true, status });
    } catch (err) {
      context.error('Leaderboard admin failed', err);
      return json(500, { ok: false, error: 'Something went wrong. Please try again.' });
    }
  },
});

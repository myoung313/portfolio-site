const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { Resolver } = require('node:dns').promises;
const crypto = require('crypto');
const R = require('../lib/readiness');
const { normalizeDomain, runCheckup } = require('../lib/emailcheck');

// Cyber insurance readiness.
//  POST /api/readiness/request      public "Request your assessment" form (no prices; Taz quotes by email)
//  GET  /api/readiness/assessment   questionnaire + saved answers + last report   (role: readiness)
//  POST /api/readiness/assessment   save answers; { submit: true } scores it      (role: readiness)
// The role is enforced by staticwebapp.config.json and checked again here.
const REQUESTS_TABLE = 'ReadinessRequests';
const ASSESS_TABLE = 'ReadinessAssessments';
const RATE_TABLE = 'ReadinessRateLimit';
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_SUBMITS_PER_HOUR = 10;
const ROLE = 'readiness';

const dns = new Resolver({ timeout: 2500, tries: 2 });

let clients;
async function getClients() {
  if (clients) return clients;
  const conn = process.env.CONTACT_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('CONTACT_STORAGE_CONNECTION_STRING is not set');
  const mk = name => TableClient.fromConnectionString(conn, name);
  const c = { requests: mk(REQUESTS_TABLE), assess: mk(ASSESS_TABLE), rate: mk(RATE_TABLE) };
  await Promise.all(Object.values(c).map(t => t.createTable()));
  clients = c;
  return clients;
}

const json = (status, body) => ({ status, jsonBody: body, headers: { 'Cache-Control': 'no-store' } });
const reverseKey = now => String(8640000000000000 - now.getTime()).padStart(16, '0') + '-' + crypto.randomUUID().slice(0, 8);

function clientIpHash(request) {
  const raw = request.headers.get('x-azure-clientip') || request.headers.get('x-forwarded-for') || '';
  const ip = raw.split(',')[0].trim().replace(/:\d+$/, '');
  return crypto.createHash('sha256').update(ip || 'unknown').digest('hex').slice(0, 32);
}

async function allow(rate, key, max) {
  const hour = new Date().toISOString().slice(0, 13);
  try {
    const row = await rate.getEntity(key, hour);
    if (row.count >= max) return false;
    await rate.updateEntity({ partitionKey: key, rowKey: hour, count: row.count + 1 }, 'Replace', { etag: row.etag });
  } catch (err) {
    if (err.statusCode === 404) await rate.createEntity({ partitionKey: key, rowKey: hour, count: 1 });
    else if (err.statusCode !== 412 && err.statusCode !== 409) throw err;
  }
  return true;
}

/** Static Web Apps passes the signed-in user to managed functions in x-ms-client-principal. */
function principal(request) {
  const raw = request.headers.get('x-ms-client-principal');
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return p && p.userId ? p : null;
  } catch { return null; }
}

async function readBody(request, limit) {
  if ((request.headers.get('content-length') | 0) > limit) return { tooBig: true };
  try { return { body: await request.json() }; } catch { return { bad: true }; }
}

const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

app.http('readinessRequest', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'readiness/request',
  handler: async (request, context) => {
    const { body, tooBig, bad } = await readBody(request, 10000);
    if (tooBig) return json(413, { ok: false, error: 'Request too large.' });
    if (bad) return json(400, { ok: false, error: 'Invalid request.' });
    const result = R.checkRequest(body);
    if (result.spam) { context.log(`Dropped readiness request (${result.reason})`); return json(200, { ok: true }); }
    if (result.errors) return json(400, { ok: false, errors: result.errors });
    try {
      const { requests, rate } = await getClients();
      const ipHash = clientIpHash(request);
      if (!(await allow(rate, 'req-' + ipHash, MAX_REQUESTS_PER_HOUR))) {
        return json(429, { ok: false, error: 'Too many requests from your network. Please try again later or email me directly.' });
      }
      const now = new Date();
      await requests.createEntity({
        partitionKey: now.toISOString().slice(0, 7), rowKey: reverseKey(now),
        ...result.data, submittedAt: now.toISOString(), ipHash, status: 'new',
      });
      context.log('Readiness request stored');
      return json(200, { ok: true });
    } catch (err) {
      context.error('Readiness request failed', err);
      return json(500, { ok: false, error: 'Something went wrong on my side. Please email me directly.' });
    }
  },
});

app.http('readinessAssessment', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'readiness/assessment',
  handler: async (request, context) => {
    const user = principal(request);
    if (!user) return json(401, { ok: false, error: 'Please sign in.' });
    if (!(user.userRoles || []).includes(ROLE)) return json(403, { ok: false, locked: true, error: 'Your readiness assessment is not unlocked yet.' });

    let store;
    try { store = await getClients(); } catch (err) {
      context.error('Readiness storage unavailable', err);
      return json(500, { ok: false, error: 'Something went wrong on my side. Please try again later.' });
    }
    const key = { partitionKey: user.userId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 100), rowKey: 'current' };
    let row = null;
    try { row = await store.assess.getEntity(key.partitionKey, key.rowKey); } catch (err) { if (err.statusCode !== 404) throw err; }

    if (request.method === 'GET') {
      return json(200, {
        ok: true, model: R.publicModel(),
        answers: parse(row?.answers) || {}, profile: parse(row?.profile) || {},
        report: parse(row?.report), status: row?.status || 'new', updatedAt: row?.updatedAt || null,
      });
    }

    const { body, tooBig, bad } = await readBody(request, 20000);
    if (tooBig) return json(413, { ok: false, error: 'Too large.' });
    if (bad || !body || typeof body !== 'object') return json(400, { ok: false, error: 'Invalid request.' });
    const answers = R.cleanAnswers(body.answers);
    const profile = R.cleanProfile(body.profile);
    const now = new Date();
    const entity = {
      ...key, userEmail: String(user.userDetails || '').slice(0, 254),
      company: profile.company, domain: profile.domain,
      answers: JSON.stringify(answers), profile: JSON.stringify(profile),
      status: row?.status === 'submitted' ? 'submitted' : 'in-progress', updatedAt: now.toISOString(),
      report: row?.report || '',
    };

    let report = null;
    if (body.submit) {
      const missing = R.missingAnswers(answers);
      const errors = {};
      if (!profile.company) errors.company = 'Please enter your business name.';
      const nd = normalizeDomain(profile.domain || '');
      if (nd.error) errors.domain = nd.error;
      if (missing.length) errors.answers = `Please answer every question (${missing.length} left).`;
      if (Object.keys(errors).length) return json(400, { ok: false, errors, missing });
      if (!(await allow(store.rate, 'sub-' + key.partitionKey, MAX_SUBMITS_PER_HOUR))) {
        return json(429, { ok: false, error: 'That is a lot of reports this hour. Please try again a little later.' });
      }
      let check = null;
      try {
        const fetchText = async url => {
          const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.text()).slice(0, 16384);
        };
        check = await runCheckup(nd.domain, { dns, fetchText });
      } catch (err) { context.error('Email checkup inside readiness failed', err); }
      report = R.scoreAssessment(answers, check, now);
      report.company = profile.company;
      entity.status = 'submitted';
      entity.submittedAt = now.toISOString();
      entity.score = report.score;
      entity.level = report.level;
      entity.report = JSON.stringify(report);
    }

    try {
      await store.assess.upsertEntity(entity, 'Replace');
    } catch (err) {
      context.error('Saving readiness assessment failed', err);
      return json(500, { ok: false, error: 'Could not save. Please try again.' });
    }
    if (report) context.log(`Readiness report: ${report.score} ${report.level}`);
    return json(200, { ok: true, saved: entity.updatedAt, report });
  },
});

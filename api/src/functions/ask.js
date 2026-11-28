const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const crypto = require('crypto');
const AnthropicModule = require('@anthropic-ai/sdk');
const { checkQuestion, search, buildRequest, formatAnswer, usageCost, CHUNKS } = require('../lib/ask');

const Anthropic = AnthropicModule.default || AnthropicModule;

// Ask Shift: the free AI security assistant at /ask.
//
// App settings (Static Web App > Settings > Environment variables):
//   ANTHROPIC_API_KEY     required. Without it the page shows "Shift is resting".
//   ASK_MODEL             optional, default claude-haiku-5-5 (switch to claude-opus-5-5 later)
//   ASK_PER_VISITOR       optional, questions per visitor per day, default 5
//   ASK_DAILY_CAP         optional, questions per day for the whole site, default 150
//   ASK_ENABLED           optional, set to "false" to switch Shift off instantly
//   AI_SEARCH_ENDPOINT / AI_SEARCH_QUERY_KEY / AI_SEARCH_INDEX   optional, see lib/ask.js.
//                         Without them Shift uses its built-in search over the same guides.
//
// Storage (same account as the other features):
//   AskUsage     PartitionKey = hashed IP or "site", RowKey = UTC day, count
//   AskFeedback  thumbs up/down with the guide sections used (no question text is stored)
const USAGE_TABLE = 'AskUsage';
const FEEDBACK_TABLE = 'AskFeedback';
const SITE = 'site';

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
const limits = () => ({ perVisitor: num(process.env.ASK_PER_VISITOR, 5), daily: num(process.env.ASK_DAILY_CAP, 150) });
const enabled = () => process.env.ASK_ENABLED !== 'false' && !!process.env.ANTHROPIC_API_KEY;
const today = () => new Date().toISOString().slice(0, 10);

let tables;
async function getTables() {
  if (tables) return tables;
  const conn = process.env.CONTACT_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('CONTACT_STORAGE_CONNECTION_STRING is not set');
  const t = { usage: TableClient.fromConnectionString(conn, USAGE_TABLE), feedback: TableClient.fromConnectionString(conn, FEEDBACK_TABLE) };
  await Promise.all(Object.values(t).map(x => x.createTable()));
  tables = t;
  return tables;
}

let client;
const getClient = () => (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 }));

function ipHash(request) {
  const raw = request.headers.get('x-azure-clientip') || request.headers.get('x-forwarded-for') || '';
  const ip = raw.split(',')[0].trim().replace(/:\d+$/, '');
  return crypto.createHash('sha256').update('ask:' + (ip || 'unknown')).digest('hex').slice(0, 32);
}

async function getCount(usage, pk, day) {
  try { const r = await usage.getEntity(pk, day); return { count: r.count || 0, etag: r.etag }; } catch (err) {
    if (err.statusCode === 404) return { count: 0, etag: null };
    throw err;
  }
}

// Adds one to a counter unless it's at the limit. Retries once if two requests race.
async function take(usage, pk, day, limit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { count, etag } = await getCount(usage, pk, day);
    if (count >= limit) return false;
    try {
      if (etag) await usage.updateEntity({ partitionKey: pk, rowKey: day, count: count + 1 }, 'Replace', { etag });
      else await usage.createEntity({ partitionKey: pk, rowKey: day, count: 1 });
      return true;
    } catch (err) {
      if (err.statusCode !== 409 && err.statusCode !== 412) throw err;
    }
  }
  return false;
}

const json = (status, body) => ({ status, jsonBody: body, headers: { 'Cache-Control': 'no-store' } });
const RESTING = "Shift is resting right now. Please try again later, or browse the guides.";

app.http('ask', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'ask',
  handler: async (request, context) => {
    const { perVisitor, daily } = limits();

    if (request.method === 'GET') {
      if (!enabled()) return json(200, { ok: true, enabled: false, perVisitor, remaining: 0, sections: CHUNKS.length });
      try {
        const { usage } = await getTables();
        const [mine, site] = await Promise.all([getCount(usage, ipHash(request), today()), getCount(usage, SITE, today())]);
        const remaining = Math.max(0, Math.min(perVisitor - mine.count, daily - site.count));
        return json(200, { ok: true, enabled: true, perVisitor, remaining, siteFull: site.count >= daily, sections: CHUNKS.length });
      } catch (err) {
        context.error('Ask status failed', err);
        return json(200, { ok: true, enabled: true, perVisitor, remaining: perVisitor, sections: CHUNKS.length });
      }
    }

    let body;
    try {
      if ((request.headers.get('content-length') | 0) > 4000) return json(413, { ok: false, error: 'Too large.' });
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: 'Invalid request.' });
    }

    const q = checkQuestion(body);
    if (q.spam) return json(200, { ok: true, kind: 'not_in_guides', text: "I couldn't find that in the CloudShift guides yet.", sources: [] });
    if (q.secret) { context.log(`Ask: blocked a question containing a ${q.secret}`); return json(400, { ok: false, secret: true, error: q.error }); }
    if (q.error) return json(400, { ok: false, error: q.error });
    // Off-limits topics get a fixed, free reply and don't use up a question.
    if (q.offLimits) { context.log(`Ask: off-limits (${q.offLimits})`); return json(200, { ok: true, kind: 'out_of_scope', text: q.reply, sources: [], remaining: null }); }
    if (!enabled()) return json(503, { ok: false, resting: true, error: RESTING });

    let usage;
    const day = today();
    const who = ipHash(request);
    try {
      ({ usage } = await getTables());
      const mine = await getCount(usage, who, day);
      if (mine.count >= perVisitor) return json(429, { ok: false, limit: 'visitor', remaining: 0, error: `You've used today's ${perVisitor} free questions.` });
      if (!(await take(usage, SITE, day, daily))) return json(429, { ok: false, limit: 'site', remaining: 0, error: 'Shift has answered all the questions it can for today.' });
      if (!(await take(usage, who, day, perVisitor))) return json(429, { ok: false, limit: 'visitor', remaining: 0, error: `You've used today's ${perVisitor} free questions.` });
    } catch (err) {
      // Without the counters we can't cap spend, so fail closed.
      context.error('Ask rate limit failed', err);
      return json(503, { ok: false, resting: true, error: RESTING });
    }

    const started = Date.now();
    const { hits, engine } = await search(q.question, process.env, m => context.warn(m));
    if (!hits.length) {
      return json(200, { ok: true, kind: 'not_in_guides', engine, text: "I couldn't find anything about that in the CloudShift guides yet. Try rephrasing, or browse the guides.", sources: [], remaining: await remainingFor(usage, who, day) });
    }

    try {
      const req = buildRequest(q.question, hits);
      const message = await getClient().messages.create(req);
      const out = formatAnswer(message, hits);
      const cost = usageCost(message.usage, req.model);
      context.log(`Ask: ${out.kind} via ${engine}, ${hits.length} hits, ${out.sources.length} cited, ${message.usage?.input_tokens}/${message.usage?.output_tokens} tokens, ~$${cost.toFixed(5)}, ${Date.now() - started} ms`);
      return json(200, { ok: true, ...out, engine, remaining: await remainingFor(usage, who, day) });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) context.warn('Ask: Anthropic rate limit');
      else if (err instanceof Anthropic.AuthenticationError) context.error('Ask: Anthropic key rejected, check ANTHROPIC_API_KEY');
      else if (err instanceof Anthropic.APIError) context.error(`Ask: Anthropic error ${err.status}: ${err.message}`);
      else context.error('Ask failed', err);
      return json(503, { ok: false, resting: true, error: "Shift couldn't answer just now. Please try again in a minute." });
    }
  },
});

async function remainingFor(usage, who, day) {
  try {
    const { perVisitor, daily } = limits();
    const [mine, site] = await Promise.all([getCount(usage, who, day), getCount(usage, SITE, day)]);
    return Math.max(0, Math.min(perVisitor - mine.count, daily - site.count));
  } catch { return null; }
}

const ID_RE = /^[a-z0-9-]{1,60}$/;
app.http('askFeedback', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ask/feedback',
  handler: async (request, context) => {
    let body;
    try {
      if ((request.headers.get('content-length') | 0) > 2000) return json(413, { ok: false });
      body = await request.json();
    } catch { return json(400, { ok: false }); }
    const vote = body?.vote === 'up' ? 'up' : body?.vote === 'down' ? 'down' : null;
    if (!vote) return json(400, { ok: false });
    const sources = Array.isArray(body.sources) ? body.sources.filter(s => typeof s === 'string' && ID_RE.test(s)).slice(0, 6) : [];
    const kind = ['answer', 'not_in_guides', 'out_of_scope'].includes(body.kind) ? body.kind : 'answer';
    try {
      const { feedback, usage } = await getTables();
      if (!(await take(usage, 'fb-' + ipHash(request), today(), 30))) return json(429, { ok: false });
      const now = new Date();
      await feedback.createEntity({
        partitionKey: now.toISOString().slice(0, 7), rowKey: `${now.getTime()}-${crypto.randomUUID().slice(0, 8)}`,
        vote, kind, sources: sources.join(','), at: now.toISOString(),
      });
      return json(200, { ok: true });
    } catch (err) {
      context.error('Ask feedback failed', err);
      return json(500, { ok: false });
    }
  },
});

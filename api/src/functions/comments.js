const { app } = require('@azure/functions');
const { TableClient, odata } = require('@azure/data-tables');
const crypto = require('crypto');
const { checkComment, ruleFlags, aiFlags, scoresFor, publicChecks, decide } = require('../lib/moderation');
const { analyze } = require('../lib/ai');

// Same storage account as the contact form and ratings, separate tables.
const COMMENTS_TABLE = 'SiteComments';      // one row per post; status = pending | approved | rejected
const RATE_TABLE = 'CommentRateLimit';      // per-IP daily counter
const PK = 'comment';
const MAX_PER_DAY = 5;
const PUBLIC_LIMIT = 200;
const STATUSES = ['pending', 'approved', 'rejected'];

let clients;
async function getClients() {
  if (clients) return clients;
  const conn = process.env.CONTACT_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('CONTACT_STORAGE_CONNECTION_STRING is not set');
  const mk = name => TableClient.fromConnectionString(conn, name);
  const c = { comments: mk(COMMENTS_TABLE), rate: mk(RATE_TABLE) };
  await Promise.all(Object.values(c).map(t => t.createTable())); // no-op if they exist
  clients = c;
  return clients;
}

function clientIpHash(request) {
  const raw = request.headers.get('x-azure-clientip') || request.headers.get('x-forwarded-for') || '';
  const ip = raw.split(',')[0].trim().replace(/:\d+$/, '');
  return crypto.createHash('sha256').update('comments:' + (ip || 'unknown')).digest('hex').slice(0, 32);
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

/** Signed-in user from Static Web Apps auth, or null. */
function principal(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return null;
  try { return JSON.parse(Buffer.from(header, 'base64').toString('utf8')); } catch { return null; }
}
const isAdmin = request => (principal(request)?.userRoles || []).includes('admin');

const parseJson = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

function publicView(e) {
  return {
    id: e.rowKey, name: e.name || '', stars: e.stars ?? null, kind: e.kind, text: e.text, createdAt: e.createdAt,
    reply: e.replyText ? { text: e.replyText, at: e.replyAt } : null,
  };
}
const adminView = e => ({ ...publicView(e), status: e.status, flags: parseJson(e.flags) || [], scores: parseJson(e.scores) });

async function list(table, filter, limit) {
  const out = [];
  for await (const e of table.listEntities({ queryOptions: { filter } })) {
    out.push(e);
    if (out.length >= limit) break;
  }
  return out; // RowKeys are reverse-time, so this is newest first
}

const json = (status, body, cache = 'no-store') => ({ status, jsonBody: body, headers: { 'Cache-Control': cache } });

// Public thread: read approved posts, submit new ones.
app.http('comments', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'comments',
  handler: async (request, context) => {
    if (request.method === 'GET') {
      try {
        const { comments } = await getClients();
        const rows = await list(comments, odata`PartitionKey eq ${PK} and status eq 'approved'`, PUBLIC_LIMIT);
        const rated = rows.filter(r => r.stars);
        const average = rated.length ? Math.round((rated.reduce((a, r) => a + r.stars, 0) / rated.length) * 10) / 10 : null;
        return json(200, { ok: true, comments: rows.map(publicView), stats: { count: rows.length, average } }, 'public, max-age=20');
      } catch (err) {
        context.error('Comment list failed', err);
        return json(500, { ok: false, error: 'Comments are unavailable right now.' });
      }
    }

    let body;
    try {
      if ((request.headers.get('content-length') | 0) > 8000) return json(413, { ok: false, error: 'Too large.' });
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: 'Invalid request.' });
    }

    const result = checkComment(body);
    if (result.spam) {
      context.log(`Dropped spam comment (${result.spam})`);
      // Look like a normal held post so bots learn nothing.
      return json(200, { ok: true, status: 'pending', flags: ['links'], comment: { id: 'x' + Date.now(), createdAt: new Date().toISOString(), name: String(body.name || '').slice(0, 40), kind: 'comment', text: String(body.text || '').slice(0, 800), stars: null, reply: null } });
    }
    if (result.errors) return json(400, { ok: false, errors: result.errors });

    try {
      const { comments, rate } = await getClients();
      const ipHash = clientIpHash(request);
      if (!(await allowRequest(rate, ipHash))) {
        return json(429, { ok: false, error: "You've posted a lot today. Please come back tomorrow!" });
      }

      const data = result.data;
      const ai = await analyze(data.name ? `${data.name}: ${data.text}` : data.text, msg => context.warn(msg));
      const flags = [...ruleFlags(data), ...aiFlags(ai)];
      const status = decide(flags);

      const now = new Date();
      const rowKey = String(8640000000000000 - now.getTime()).padStart(16, '0') + '-' + crypto.randomUUID().slice(0, 8);
      const entity = {
        partitionKey: PK, rowKey, status,
        name: data.name, kind: data.kind, text: data.text,
        createdAt: now.toISOString(), flags: JSON.stringify(flags), scores: JSON.stringify(scoresFor(ai)),
        ipHash, userAgent: (request.headers.get('user-agent') || '').slice(0, 300),
      };
      if (data.stars) entity.stars = data.stars;
      await comments.createEntity(entity);
      context.log(`Comment ${rowKey} ${status}${flags.length ? ' (' + flags.join(', ') + ')' : ''}`);
      return json(200, { ok: true, status, flags: publicChecks(flags), comment: publicView(entity) });
    } catch (err) {
      context.error('Comment failed', err);
      return json(500, { ok: false, error: 'Something went wrong saving your post. Please try again later.' });
    }
  },
});

// Admin review queue. staticwebapp.config.json also limits this route to the admin role.
app.http('commentsAdmin', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'comments/admin',
  handler: async (request, context) => {
    if (!isAdmin(request)) return json(403, { ok: false, error: 'Admins only.' });
    try {
      const { comments } = await getClients();

      if (request.method === 'GET') {
        const want = STATUSES.includes(request.query.get('status')) ? request.query.get('status') : 'pending';
        const counts = { pending: 0, approved: 0, rejected: 0 };
        const rows = [];
        for await (const e of comments.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${PK}` } })) {
          if (counts[e.status] !== undefined) counts[e.status]++;
          if (e.status === want && rows.length < 300) rows.push(e);
        }
        return json(200, { ok: true, comments: rows.map(adminView), counts });
      }

      let body;
      try { body = await request.json(); } catch { return json(400, { ok: false, error: 'Invalid request.' }); }
      const id = String(body?.id || '');
      if (!/^\d{16}-[0-9a-f]{8}$/.test(id)) return json(400, { ok: false, error: 'Unknown post.' });

      let row;
      try { row = await comments.getEntity(PK, id); } catch (err) {
        if (err.statusCode === 404) return json(404, { ok: false, error: 'That post no longer exists.' });
        throw err;
      }
      const who = principal(request)?.userDetails || 'admin';
      const now = new Date().toISOString();
      const patch = { partitionKey: PK, rowKey: id, reviewedBy: who, reviewedAt: now };

      switch (body.action) {
        case 'approve': patch.status = 'approved'; break;
        case 'reject': patch.status = 'rejected'; break;
        case 'reply': {
          const text = typeof body.reply === 'string' ? body.reply.trim().slice(0, 800) : '';
          patch.replyText = text;
          patch.replyAt = text ? now : '';
          if (row.status === 'pending' && text) patch.status = 'approved';
          break;
        }
        case 'delete':
          await comments.deleteEntity(PK, id);
          context.log(`Comment ${id} deleted by ${who}`);
          return json(200, { ok: true });
        default:
          return json(400, { ok: false, error: 'Unknown action.' });
      }
      await comments.updateEntity(patch, 'Merge', { etag: row.etag });
      context.log(`Comment ${id} ${body.action} by ${who}`);
      return json(200, { ok: true, status: patch.status || row.status });
    } catch (err) {
      context.error('Comment admin failed', err);
      return json(500, { ok: false, error: 'Something went wrong. Please try again.' });
    }
  },
});

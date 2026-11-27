const { app } = require('@azure/functions');
const { parsePrincipal, parseAllowList, checkAccess, emailOf } = require('../lib/portal');
const { getTable, getMember } = require('../lib/access-store');
const { hashCode, looksLikeCode, redeemCheck, inviteState, maskEmail, mergeAccess, memberKey } = require('../lib/invites');

const json = (status, body) => ({ status, jsonBody: body, headers: { 'Cache-Control': 'no-store' } });

// GET /api/portal/me: tells the portal page whether this signed-in user is a client.
// Any client data added to the portal later must come through a check like this one.
app.http('portal-me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'portal/me',
  handler: async (request, context) => {
    const principal = parsePrincipal(request.headers.get('x-ms-client-principal'));
    const member = principal ? await getMember(emailOf(principal), m => context.log(m)) : null;
    const result = checkAccess(principal, parseAllowList(process.env.CLIENT_EMAILS), process.env, member);
    if (result.status !== 200) context.log(`Portal access ${result.status} for ${result.email || 'anonymous'}`);
    return json(result.status, result.status === 200
      ? { client: true, email: result.email, readiness: result.readiness }
      : { client: false });
  },
});

// Invite links from the admin portal.
//   GET  /api/portal/join?code=...   anyone with the link: is it valid, and who is it for (masked)?
//   POST /api/portal/join {code}     signed in: if the email matches, add them as a member.
app.http('portal-join', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'portal/join',
  handler: async (request, context) => {
    let code = request.query.get('code');
    if (request.method === 'POST') {
      try { code = (await request.json())?.code; } catch { code = null; }
    }
    if (!looksLikeCode(code)) return json(404, { ok: false, reason: 'invalid', error: "This invite link isn't valid. Ask Taz for a new one." });

    let table, row = null;
    try {
      table = await getTable();
      row = await table.getEntity('invite', hashCode(code));
    } catch (err) {
      if (err.statusCode !== 404) {
        context.error('Invite lookup failed', err);
        return json(500, { ok: false, error: 'Something went wrong on my side. Please try again in a minute.' });
      }
    }

    if (request.method === 'GET') {
      const state = inviteState(row);
      if (state === 'missing') return json(404, { ok: false, reason: 'invalid', error: "This invite link isn't valid. Ask Taz for a new one." });
      return json(200, { ok: true, state, email: maskEmail(row.email), portal: !!row.portal, readiness: !!row.readiness, expiresAt: row.expiresAt });
    }

    const principal = parsePrincipal(request.headers.get('x-ms-client-principal'));
    if (!principal) return json(401, { ok: false, reason: 'signin', error: 'Please sign in first.' });
    const email = emailOf(principal);
    const check = redeemCheck(row, email);
    if (!check.ok) {
      context.log(`Invite redeem refused (${check.reason}) for ${email}`);
      return json(check.reason === 'wrong_account' ? 403 : 410, { ok: false, reason: check.reason, error: check.error });
    }
    if (check.already) return json(200, { ok: true, already: true });

    try {
      const now = new Date().toISOString();
      // Mark the invite used first (etag stops two tabs redeeming it twice), then add the member.
      await table.updateEntity({ partitionKey: 'invite', rowKey: row.rowKey, usedAt: now, usedBy: email }, 'Merge', { etag: row.etag });
      const existing = await getMember(email);
      const access = mergeAccess(existing, row);
      await table.upsertEntity({ partitionKey: 'member', rowKey: memberKey(email), email, ...access, addedAt: existing?.addedAt || now, via: 'invite' }, 'Replace');
      context.log(`Invite redeemed by ${email} (portal=${access.portal}, readiness=${access.readiness})`);
      return json(200, { ok: true, ...access });
    } catch (err) {
      if (err.statusCode === 412) return json(409, { ok: false, reason: 'used', error: 'This invite link has already been used.' });
      context.error('Invite redeem failed', err);
      return json(500, { ok: false, error: 'Something went wrong on my side. Please try again in a minute.' });
    }
  },
});

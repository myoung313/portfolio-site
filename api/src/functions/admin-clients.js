const { app } = require('@azure/functions');
const { odata } = require('@azure/data-tables');
const { isAdmin } = require('./comments');
const { parsePrincipal, parseAllowList } = require('../lib/portal');
const { getTable } = require('../lib/access-store');
const { validateInvite, newCode, hashCode, inviteState, memberKey, normEmail } = require('../lib/invites');

// Admin portal: client invites and who has access.
//   GET  /api/admin/clients                                    members, invites, and the emails from Azure settings
//   POST /api/admin/clients {action:"invite", email, portal, readiness, days}  -> { path }
//   POST /api/admin/clients {action:"cancel", id}              cancel a pending invite
//   POST /api/admin/clients {action:"remove", email}           remove a member added by invite
// staticwebapp.config.json requires sign-in; ADMIN_EMAILS (or the "admin" role) decides who gets in.
const json = (status, body) => ({ status, jsonBody: body, headers: { 'Cache-Control': 'no-store' } });
app.http('admin-clients', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'admin/clients',
  handler: async (request, context) => {
    const me = parsePrincipal(request.headers.get('x-ms-client-principal'));
    if (!me) return json(401, { ok: false, error: 'Please sign in.' });
    if (!isAdmin(request)) return json(403, { ok: false, notAdmin: true, error: 'This account is not on the admin list.' });

    try {
      const table = await getTable();

      if (request.method === 'GET') {
        const members = [], invites = [];
        for await (const e of table.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${'member'}` } })) {
          members.push({ email: e.email, portal: !!e.portal, readiness: !!e.readiness, addedAt: e.addedAt });
        }
        const now = new Date();
        for await (const e of table.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${'invite'}` } })) {
          invites.push({ id: e.rowKey, email: e.email, portal: !!e.portal, readiness: !!e.readiness, createdAt: e.createdAt, expiresAt: e.expiresAt, state: inviteState(e, now) });
        }
        invites.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        const settings = {
          client: [...parseAllowList(process.env.CLIENT_EMAILS)],
          readiness: [...parseAllowList(process.env.READINESS_EMAILS)],
          admin: [...parseAllowList(process.env.ADMIN_EMAILS)],
        };
        return json(200, { ok: true, members, invites: invites.slice(0, 200), settings });
      }

      let body;
      try { body = await request.json(); } catch { return json(400, { ok: false, error: 'Invalid request.' }); }
      const who = normEmail(me.userDetails);

      if (body?.action === 'invite') {
        const v = validateInvite(body);
        if (v.error) return json(400, { ok: false, error: v.error });
        const code = newCode();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + v.days * 86400000).toISOString();
        await table.createEntity({
          partitionKey: 'invite', rowKey: hashCode(code), email: v.email, portal: v.portal, readiness: v.readiness,
          createdAt: now.toISOString(), expiresAt, createdBy: who,
        });
        context.log(`Invite created for ${v.email} by ${who} (portal=${v.portal}, readiness=${v.readiness}, ${v.days}d)`);
        // The page builds the full link from its own address, so it works on preview sites too.
        return json(200, { ok: true, path: `/portal/join/?code=${code}`, email: v.email, expiresAt });
      }

      if (body?.action === 'cancel') {
        const id = String(body.id || '');
        if (!/^[0-9a-f]{64}$/.test(id)) return json(400, { ok: false, error: 'Unknown invite.' });
        try {
          await table.updateEntity({ partitionKey: 'invite', rowKey: id, cancelledAt: new Date().toISOString(), cancelledBy: who }, 'Merge');
        } catch (err) {
          if (err.statusCode === 404) return json(404, { ok: false, error: 'That invite no longer exists.' });
          throw err;
        }
        context.log(`Invite ${id.slice(0, 8)} cancelled by ${who}`);
        return json(200, { ok: true });
      }

      if (body?.action === 'remove') {
        const email = normEmail(body.email);
        try { await table.deleteEntity('member', memberKey(email)); } catch (err) { if (err.statusCode !== 404) throw err; }
        context.log(`Member ${email} removed by ${who}`);
        return json(200, { ok: true });
      }

      return json(400, { ok: false, error: 'Unknown action.' });
    } catch (err) {
      context.error('Admin clients failed', err);
      return json(500, { ok: false, error: 'Something went wrong. Please try again.' });
    }
  },
});

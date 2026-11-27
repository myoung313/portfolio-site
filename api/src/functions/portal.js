const { app } = require('@azure/functions');
const { parsePrincipal, parseAllowList, checkAccess } = require('../lib/portal');

// GET /api/portal/me: tells the portal page whether this signed-in user is a client.
// Any client data added to the portal later must come through a check like this one.
app.http('portal-me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'portal/me',
  handler: async (request, context) => {
    const principal = parsePrincipal(request.headers.get('x-ms-client-principal'));
    const result = checkAccess(principal, parseAllowList(process.env.CLIENT_EMAILS));
    if (result.status !== 200) context.log(`Portal access ${result.status} for ${result.email || 'anonymous'}`);
    return {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
      jsonBody: result.status === 200 ? { client: true, email: result.email, readiness: result.readiness } : { client: false },
    };
  },
});

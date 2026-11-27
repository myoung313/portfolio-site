// Who may open the client portal.
//
// Static Web Apps signs people in with Microsoft Entra ID and passes the
// signed-in user to the API in the x-ms-client-principal header (base64 JSON).
// Access is granted if the user's email is on the CLIENT_EMAILS app setting
// (comma or semicolon separated) or they hold the "client" role from an invite.

function parsePrincipal(header) {
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    return p && p.userDetails ? p : null;
  } catch {
    return null;
  }
}

function parseAllowList(value) {
  return new Set(String(value || '')
    .split(/[,;\s]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean));
}

function checkAccess(principal, allowList) {
  if (!principal) return { status: 401 };
  const email = String(principal.userDetails).trim().toLowerCase();
  const roles = Array.isArray(principal.userRoles) ? principal.userRoles : [];
  const ok = roles.includes('client') || allowList.has(email);
  return ok ? { status: 200, email } : { status: 403, email };
}

module.exports = { parsePrincipal, parseAllowList, checkAccess };

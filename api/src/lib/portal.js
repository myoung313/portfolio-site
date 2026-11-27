// Who may open the client portal.
//
// Static Web Apps signs people in with Microsoft Entra ID and passes the
// signed-in user to the API in the x-ms-client-principal header (base64 JSON).
// Access is granted if the user's email is on an app setting allow list
// (CLIENT_EMAILS for the portal, READINESS_EMAILS for the readiness assessment;
// comma or semicolon separated) or they hold the matching role from an invite.

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

function emailOf(principal) {
  return principal && principal.userDetails ? String(principal.userDetails).trim().toLowerCase() : '';
}

/** True if the user holds `role` or their email is on `allowList`. */
function hasAccess(principal, role, allowList) {
  if (!principal) return false;
  const roles = Array.isArray(principal.userRoles) ? principal.userRoles : [];
  return roles.includes(role) || allowList.has(emailOf(principal));
}

/** Readiness access: "readiness" role or READINESS_EMAILS. */
function hasReadiness(principal, env = process.env) {
  return hasAccess(principal, 'readiness', parseAllowList(env.READINESS_EMAILS));
}

/** Portal access. People unlocked for the readiness assessment can enter the portal too. */
function checkAccess(principal, allowList, env = process.env) {
  if (!principal) return { status: 401 };
  const email = emailOf(principal);
  const readiness = hasReadiness(principal, env);
  const ok = readiness || hasAccess(principal, 'client', allowList);
  return ok ? { status: 200, email, readiness } : { status: 403, email };
}

module.exports = { parsePrincipal, parseAllowList, hasAccess, hasReadiness, checkAccess };

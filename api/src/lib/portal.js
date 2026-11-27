// Who may open the client portal.
//
// Static Web Apps signs people in with Microsoft Entra ID and passes the
// signed-in user to the API in the x-ms-client-principal header (base64 JSON).
// Access is granted if the user's email is on an app setting allow list
// (CLIENT_EMAILS for the portal, READINESS_EMAILS for the readiness assessment;
// comma or semicolon separated), a member row created by an invite link from the
// admin portal (see access-store.js), or the matching Azure invite role.

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

/** Readiness access: "readiness" role, READINESS_EMAILS, or a stored member with readiness (invite link). */
function hasReadiness(principal, env = process.env, member = null) {
  if (!principal) return false;
  if (member && member.readiness && member.email === emailOf(principal)) return true;
  return hasAccess(principal, 'readiness', parseAllowList(env.READINESS_EMAILS));
}

/**
 * Portal access: "client" role, CLIENT_EMAILS, a stored member (invite link), or readiness access.
 * People unlocked for the readiness assessment can enter the portal too.
 */
function checkAccess(principal, allowList, env = process.env, member = null) {
  if (!principal) return { status: 401 };
  const email = emailOf(principal);
  const mine = member && member.email === email ? member : null;
  const readiness = hasReadiness(principal, env, mine);
  const ok = readiness || !!(mine && mine.portal) || hasAccess(principal, 'client', allowList);
  return ok ? { status: 200, email, readiness } : { status: 403, email };
}

module.exports = { parsePrincipal, parseAllowList, emailOf, hasAccess, hasReadiness, checkAccess };

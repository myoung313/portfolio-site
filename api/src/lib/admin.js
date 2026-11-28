// Who is signed in (Static Web Apps auth) and whether they're an admin.
// Admins are listed by email in the ADMIN_EMAILS app setting (comma separated).

function principal(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return null;
  try { return JSON.parse(Buffer.from(header, 'base64').toString('utf8')); } catch { return null; }
}

function isAdmin(request, env = process.env) {
  const p = principal(request);
  if (!p) return false;
  if ((p.userRoles || []).includes('admin')) return true;
  const email = String(p.userDetails || '').trim().toLowerCase();
  const allowed = String(env.ADMIN_EMAILS || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email);
}

module.exports = { principal, isAdmin };

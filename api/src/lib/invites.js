// Client invite links: pure helpers (no storage), so they're easy to test.
//
// An invite is bound to one email address. The link carries a random code; only a
// SHA-256 hash of that code is stored, so a leaked table row can't be turned into a link.
// Opening the link while signed in with the invited email adds that email as a member.
const crypto = require('crypto');

const MAX_DAYS = 30;
const DAY_OPTIONS = [1, 3, 7, 14, 30];
const EMAIL_RE = /^[^\s@,;<>"'\\/#?]+@[^\s@,;<>"'\\/#?]+\.[a-z]{2,}$/i;

const normEmail = e => String(e || '').trim().toLowerCase();
const isEmail = e => normEmail(e).length <= 254 && EMAIL_RE.test(normEmail(e));

/** 128 bits of randomness, URL-safe (22 characters). */
const newCode = () => crypto.randomBytes(16).toString('base64url');
const hashCode = code => crypto.createHash('sha256').update('invite:' + String(code || '')).digest('hex');
const looksLikeCode = code => /^[A-Za-z0-9_-]{22}$/.test(String(code || ''));

/** Table Storage keys can't contain / \ # ?, so member rows are keyed by the URI-encoded email. */
const memberKey = email => encodeURIComponent(normEmail(email));

/** Validates the admin's "create invite" form. */
function validateInvite(body) {
  const email = normEmail(body && body.email);
  if (!isEmail(email)) return { error: 'Enter a valid email address.' };
  const portal = body.portal !== false;
  const readiness = body.readiness === true;
  if (!portal && !readiness) return { error: 'Pick at least one kind of access.' };
  const days = DAY_OPTIONS.includes(Number(body.days)) ? Number(body.days) : 7;
  return { email, portal, readiness, days };
}

/** pending | used | expired | cancelled */
function inviteState(row, now = new Date()) {
  if (!row) return 'missing';
  if (row.usedAt) return 'used';
  if (row.cancelledAt) return 'cancelled';
  if (new Date(row.expiresAt) <= now) return 'expired';
  return 'pending';
}

/** Can this signed-in email redeem this invite right now? */
function redeemCheck(row, signedInEmail, now = new Date()) {
  const state = inviteState(row, now);
  if (state === 'missing') return { ok: false, reason: 'invalid', error: "This invite link isn't valid. Ask Taz for a new one." };
  if (state === 'used') {
    // Opening your own link again is fine: you're already in.
    if (normEmail(row.email) === normEmail(signedInEmail)) return { ok: true, already: true };
    return { ok: false, reason: 'used', error: 'This invite link has already been used.' };
  }
  if (state === 'cancelled') return { ok: false, reason: 'cancelled', error: 'This invite was cancelled. Ask Taz for a new one.' };
  if (state === 'expired') return { ok: false, reason: 'expired', error: 'This invite link has expired. Ask Taz for a new one.' };
  if (normEmail(row.email) !== normEmail(signedInEmail)) {
    return { ok: false, reason: 'wrong_account', error: `This invite is for ${maskEmail(row.email)}. Sign in with that account instead.` };
  }
  return { ok: true };
}

/** owner@brightdental.com -> o****@brightdental.com (shown before sign-in, in case a link leaks). */
function maskEmail(email) {
  const [user, domain] = normEmail(email).split('@');
  if (!domain) return '';
  return user.slice(0, 1) + '*'.repeat(Math.max(2, Math.min(user.length - 1, 6))) + '@' + domain;
}

/** Merge two access grants (a re-invite can add readiness to an existing portal member). */
const mergeAccess = (a, b) => ({ portal: !!(a?.portal || b?.portal), readiness: !!(a?.readiness || b?.readiness) });

module.exports = {
  MAX_DAYS, DAY_OPTIONS, normEmail, isEmail, newCode, hashCode, looksLikeCode, memberKey,
  validateInvite, inviteState, redeemCheck, maskEmail, mergeAccess,
};

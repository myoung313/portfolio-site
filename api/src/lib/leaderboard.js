// Rules for the Phish or Legit? leaderboard. Kept free of Azure dependencies so
// it can be unit tested with `npm test`.
//
// Points: 100 per correct answer, plus up to 50 for speed (scaled by accuracy,
// so racing through with random guesses earns nothing extra).
// Nicknames: clearly offensive names and contact info are refused, borderline
// names are held for review in the admin portal, everything else shows right away.

const ROUND = 8;                 // emails per game (matches site/phish)
const SECONDS_PER_EMAIL = 15;
const MAX_SECONDS = ROUND * SECONDS_PER_EMAIL + 30; // some slack for the "Next" clicks
const MIN_SECONDS_PER_EMAIL = 1; // nobody reads and answers an email faster than this
const MAX_GAME_MS = 2 * 60 * 60e3;
const NAME_MIN = 2, NAME_MAX = 16;

const clean = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim() : '');

const LEET = { '@': 'a', '4': 'a', '8': 'b', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't' };
// Compare against a version with leetspeak undone and separators removed, so "F_u.c-k" and "sh1t" are caught.
const squash = s => s.toLowerCase().replace(/[@483105!$7]/g, c => LEET[c] || c).replace(/[^a-z]/g, '');

// Refused outright (substring match: nobody needs these inside a nickname).
const BLOCK = ['fuck', 'fuk', 'shit', 'cunt', 'nigg', 'nigga', 'fag', 'bitch', 'whore', 'slut', 'retard', 'rape', 'nazi', 'hitler', 'kkk', 'pedo', 'molest', 'porn', 'penis', 'vagina', 'dildo', 'jizz', 'cock', 'pussy', 'twat', 'wank', 'kys'];
// Held for a human to look at: these show up inside innocent words too ("Classic", "Hancock", "Scunthorpe").
const HOLD = ['ass', 'dick', 'cum', 'sex', 'piss', 'tit', 'damn', 'crap', 'hell', 'kill', 'die', 'hate', 'weed', 'nude', 'boob', 'butt', 'poop', 'suck', 'stfu', 'wtf', 'gay', 'drug'];
// Could be mistaken for the site owner or a real company.
const IMPERSONATE = ['admin', 'cloudshift', 'taz', 'moderator', 'mod', 'microsoft', 'official', 'support', 'staff', 'owner'];

const LINK_RE = /https?:|www\.|\.(com|net|org|io|co|us|xyz|ru|me|app|link)\b/i;
const EMAIL_RE = /@\S+\.\S+/;
const PHONE_RE = /(?:\d[\s().-]*){7,}/;

/** { error } when the name can't be used, otherwise { name, hold: [reasons] }. */
function checkName(raw) {
  const name = clean(raw).replace(/\s+/g, ' ');
  if (name.length < NAME_MIN) return { error: `Pick a nickname with at least ${NAME_MIN} characters.` };
  if (name.length > NAME_MAX) return { error: `Keep your nickname to ${NAME_MAX} characters or fewer.` };
  if (!/^[A-Za-z0-9 _.'-]+$/.test(name)) return { error: 'Use letters, numbers, spaces, dots, dashes or underscores only.' };
  if (LINK_RE.test(name) || EMAIL_RE.test(name) || PHONE_RE.test(name)) return { error: 'No links, emails or phone numbers, please. Just a nickname.' };
  const s = squash(name), plain = name.toLowerCase().replace(/[^a-z]/g, '');
  if (BLOCK.some(w => s.includes(w) || plain.includes(w))) return { error: "That nickname isn't allowed. Please pick another one." };
  const hold = [];
  if (HOLD.some(w => s.includes(w) || plain.includes(w))) hold.push('words');
  if (IMPERSONATE.some(w => s.includes(w) || plain.includes(w))) hold.push('impersonation');
  if (/(.)\1{4,}/.test(name)) hold.push('repeat');
  return { name, hold };
}

function points(correct, total, seconds) {
  if (!correct) return 0;
  const speed = Math.max(0, 1 - seconds / (total * SECONDS_PER_EMAIL));
  return correct * 100 + Math.round(50 * speed * (correct / total));
}

/**
 * Validates a score submission. Returns { spam: reason } for bots (caller pretends success),
 * { errors: {field: msg} } for bad input, or { data }.
 */
function checkScore(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return { errors: { form: 'Invalid request.' } };
  if (clean(body.website)) return { spam: 'honeypot' };

  const started = Number(body.startedAt);
  const correct = Number(body.correct), total = Number(body.total), seconds = Number(body.seconds), streak = Number(body.streak ?? 0);
  if (!Number.isFinite(started) || now - started > MAX_GAME_MS || started > now + 60e3) return { spam: 'timing' };
  if (total !== ROUND || !Number.isInteger(correct) || correct < 0 || correct > total) return { errors: { form: "That score doesn't look right." } };
  if (!Number.isFinite(seconds) || seconds < total * MIN_SECONDS_PER_EMAIL || seconds > MAX_SECONDS) return { errors: { form: "That game time doesn't look right." } };
  if (now - started < seconds * 1000 - 5000) return { spam: 'clock' }; // claimed more play time than the game lasted
  if (!Number.isInteger(streak) || streak < 0 || streak > correct) return { errors: { form: "That streak doesn't look right." } };

  const n = checkName(body.name);
  if (n.error) return { errors: { name: n.error } };
  const secs = Math.round(seconds * 10) / 10;
  return { data: { name: n.name, hold: n.hold, correct, total, seconds: secs, streak, points: points(correct, total, secs) } };
}

/** ISO-8601 week, e.g. "2026-W48". Weeks start Monday (UTC). */
function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Next Monday 00:00 UTC, when the weekly board resets. */
function nextReset(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 8 - day);
  return d.toISOString();
}

// Table Storage sorts by RowKey, so this puts the best score first, earlier submissions winning ties.
function rowKeyFor(pts, when, rand) {
  return String(9999 - pts).padStart(4, '0') + '-' + String(when).padStart(13, '0') + '-' + rand;
}
const ROWKEY_RE = /^\d{4}-\d{13}-[0-9a-f]{8}$/;

module.exports = { checkName, checkScore, points, weekKey, nextReset, rowKeyFor, ROWKEY_RE, ROUND, NAME_MAX };

// Validation and moderation rules for the public comments thread. Kept free of
// Azure dependencies so it can be unit tested with `npm test`.
//
// A post is published automatically only when it raises no flags at all.
// Anything flagged waits in the admin review queue. Obvious bots are dropped.

const MAX_TEXT = 800;
const MAX_NAME = 40;
const MIN_FILL_MS = 2000;
const MAX_FILL_MS = 24 * 60 * 60e3;
const KINDS = ['suggestion', 'comment', 'question'];

const clean = v => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤]/g, '').trim() : '');

// Short, deliberately conservative list. Matches whole words, plus common
// letter swaps (@ for a, 1 for i, 0 for o, $ for s, 3 for e).
const PROFANITY = [
  'fuck', 'fucking', 'fucker', 'fucked', 'motherfucker', 'shit', 'shitty', 'bullshit', 'bitch', 'bitches', 'bastard', 'asshole', 'dick', 'dickhead',
  'cunt', 'cock', 'pussy', 'whore', 'slut', 'retard', 'retarded', 'fag', 'faggot', 'nigger', 'nigga', 'damn', 'crap', 'piss', 'wanker', 'twat', 'stfu', 'wtf',
];
const LEET = { '@': 'a', '4': 'a', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '3': 'e', '7': 't' };
const normalize = s => s.toLowerCase().replace(/[@4105!$37]/g, c => LEET[c] || c);
const PROFANE_RE = new RegExp(`\\b(${PROFANITY.join('|')})\\b`, 'i');

const LINK_RE = /https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|biz|info|io|co|us|xyz|ru|cn|top|click|shop|site|online|store|app|link|live|me|tk)\b/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?\d[\s().-]*){10,}/;
const MASKED_RE = /[*#]{3,}/; // "f***" style swearing

/**
 * Returns { spam: reason } for bot-looking posts (caller pretends success),
 * { errors: {field: msg} } for invalid input, or { data }.
 */
function checkComment(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return { errors: { form: 'Invalid request.' } };
  if (clean(body.website)) return { spam: 'honeypot' };

  const started = Number(body.startedAt);
  if (!Number.isFinite(started) || now - started < MIN_FILL_MS || now - started > MAX_FILL_MS) return { spam: 'timing' };

  const text = clean(body.text).replace(/\n{3,}/g, '\n\n');
  const name = clean(body.name).replace(/\s+/g, ' ');
  const kind = KINDS.includes(body.kind) ? body.kind : 'comment';
  const stars = body.stars == null || body.stars === '' ? null : Number(body.stars);

  if ((text.match(/https?:\/\/|www\./gi) || []).length > 2) return { spam: 'links' };

  const errors = {};
  if (text.length < 3) errors.text = 'Please write a few words first.';
  if (text.length > MAX_TEXT) errors.text = `Please keep it under ${MAX_TEXT} characters.`;
  if (name.length > MAX_NAME) errors.name = `Please keep your name under ${MAX_NAME} characters.`;
  if (stars !== null && (!Number.isInteger(stars) || stars < 1 || stars > 5)) errors.stars = 'Stars must be 1 to 5.';
  if (Object.keys(errors).length) return { errors };

  return { data: { text, name, kind, stars } };
}

/** Rule-based flags. Each flag sends the post to the review queue. */
function ruleFlags({ text, name, stars }) {
  const flags = new Set();
  const both = `${name}\n${text}`;
  if (LINK_RE.test(both)) flags.add('link');
  if (EMAIL_RE.test(both) || PHONE_RE.test(text)) flags.add('contact');
  if (PROFANE_RE.test(both) || PROFANE_RE.test(normalize(both)) || MASKED_RE.test(text)) flags.add('profanity');
  const letters = text.replace(/[^a-z]/gi, '');
  if (letters.length >= 12 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) flags.add('shouting');
  if (/(.)\1{6,}/.test(text) || /\b(\w+)\b(?:\W+\1\b){3,}/i.test(text)) flags.add('repeat');
  if (stars !== null && stars <= 2) flags.add('lowstars');
  return [...flags];
}

/**
 * Flags from the Azure AI results. `ai` is { safety, sentiment } where either
 * may be null (not configured or the call failed); in that case we can't vouch
 * for the tone, so the post is held.
 */
function aiFlags(ai) {
  const flags = [];
  if (!ai || !ai.safety || !ai.sentiment) flags.push('noai');
  if (ai?.safety && Object.values(ai.safety).some(sev => sev >= 2)) flags.push('harm');
  if (ai?.sentiment && ai.sentiment.label === 'negative' && ai.sentiment.negative >= 0.6) flags.push('negative');
  return flags;
}

/** Scores kept for the admin view (0-1 sentiment, 0-6 severities). */
function scoresFor(ai) {
  if (!ai) return null;
  const s = {};
  if (ai.sentiment) { s.positive = ai.sentiment.positive; s.negative = ai.sentiment.negative; }
  if (ai.safety) Object.assign(s, ai.safety);
  return Object.keys(s).length ? s : null;
}

/** Turns internal flags into the three checks the public page animates. */
function publicChecks(flags) {
  const out = [];
  if (flags.some(f => f === 'link' || f === 'contact')) out.push('links');
  if (flags.some(f => !['link', 'contact'].includes(f))) out.push('tone');
  return out;
}

function decide(flags) {
  return flags.length ? 'pending' : 'approved';
}

module.exports = { checkComment, ruleFlags, aiFlags, scoresFor, publicChecks, decide, KINDS, MAX_TEXT, MIN_FILL_MS };

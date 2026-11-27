// Validation and spam checks for the "Rate this site" widget. Kept free of
// Azure dependencies so it can be unit tested with `npm test`.

const MAX_COMMENT = 500;
const MIN_FILL_MS = 1500;            // a real click takes longer than 1.5s after page load
const MAX_FILL_MS = 24 * 60 * 60e3;  // stale or forged timestamp

const clean = v => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '');

/**
 * Returns { spam: true } for bot-looking submissions (caller should pretend success),
 * { errors: {field: msg} } for invalid input, or { data: { stars, comment } }.
 */
function checkRating(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return { errors: { form: 'Invalid request.' } };

  if (clean(body.website)) return { spam: true, reason: 'honeypot' };

  const started = Number(body.startedAt);
  if (!Number.isFinite(started) || now - started < MIN_FILL_MS || now - started > MAX_FILL_MS) {
    return { spam: true, reason: 'timing' };
  }

  const stars = Number(body.stars);
  const comment = clean(body.comment);
  const errors = {};
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) errors.stars = 'Please pick 1 to 5 stars.';
  if (comment.length > MAX_COMMENT) errors.comment = `Please keep this under ${MAX_COMMENT} characters.`;

  if ((comment.match(/https?:\/\/|www\./gi) || []).length > 1) return { spam: true, reason: 'links' };

  if (Object.keys(errors).length) return { errors };
  return { data: { stars, comment } };
}

/** Turns the stored running totals into what the site shows. */
function summarize(row) {
  const dist = [1, 2, 3, 4, 5].map(n => Number(row?.[`s${n}`]) || 0);
  const count = dist.reduce((a, b) => a + b, 0);
  const total = dist.reduce((a, c, i) => a + c * (i + 1), 0);
  return { count, average: count ? Math.round((total / count) * 10) / 10 : null, distribution: dist };
}

module.exports = { checkRating, summarize, MAX_COMMENT, MIN_FILL_MS };

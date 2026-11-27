// Validation and spam checks for the contact form. Kept free of Azure
// dependencies so it can be unit tested with `npm test`.

const LIMITS = { name: 100, email: 254, company: 120, message: 4000 };
const MIN_MESSAGE = 10;
const MIN_FILL_MS = 3000;            // humans take longer than 3s to fill a form
const MAX_FILL_MS = 24 * 60 * 60e3;  // stale or forged timestamp
const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[A-Za-z]{2,}$/;

const clean = v => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '');

/**
 * Returns { spam: true } for bot-looking submissions (caller should pretend success),
 * { errors: {field: msg} } for invalid input, or { data } when it is good to store.
 */
function checkSubmission(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return { errors: { form: 'Invalid request.' } };

  // Honeypot: hidden "website" field that only bots fill in.
  if (clean(body.website)) return { spam: true, reason: 'honeypot' };

  // Timing: form records when it was rendered.
  const started = Number(body.startedAt);
  if (!Number.isFinite(started) || now - started < MIN_FILL_MS || now - started > MAX_FILL_MS) {
    return { spam: true, reason: 'timing' };
  }

  const data = {
    name: clean(body.name),
    email: clean(body.email).toLowerCase(),
    company: clean(body.company),
    message: clean(body.message),
  };

  const errors = {};
  if (!data.name) errors.name = 'Please enter your name.';
  if (!data.email) errors.email = 'Please enter your email.';
  else if (!EMAIL_RE.test(data.email)) errors.email = 'That email address doesn\'t look right.';
  if (data.message.length < MIN_MESSAGE) errors.message = `Please write at least ${MIN_MESSAGE} characters.`;
  for (const [k, max] of Object.entries(LIMITS)) {
    if (data[k].length > max) errors[k] = `Please keep this under ${max} characters.`;
  }

  // Link-stuffed messages are almost always spam.
  const links = (data.message.match(/https?:\/\//gi) || []).length;
  if (links > 3) return { spam: true, reason: 'links' };

  if (Object.keys(errors).length) return { errors };
  return { data };
}

module.exports = { checkSubmission, LIMITS, MIN_FILL_MS };

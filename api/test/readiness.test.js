const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/lib/readiness');

// Best possible answer for every question.
const best = Object.fromEntries(R.QUESTIONS.filter(q => !q.auto).map(q => [q.id, q.options.reduce((b, o) => ((o[2] ?? -1) > (b[2] ?? -1) ? o : b))[0]]));
const worst = Object.fromEntries(R.QUESTIONS.filter(q => !q.auto).map(q => [q.id, 'unsure' in Object.fromEntries(q.options) ? 'unsure' : q.options.at(-1)[0]]));
const emailA = { ok: true, domain: 'acme.com', grade: 'A', score: 92, headline: 'x' };

test('question ids are unique and every question has a fix', () => {
  const ids = R.QUESTIONS.map(q => q.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const q of R.QUESTIONS) assert.ok(q.fix && q.effort && q.service, q.id);
});

test('public model hides point values', () => {
  const m = JSON.stringify(R.publicModel());
  assert.ok(!m.includes('"weight"'));
  assert.ok(!m.includes('"fix"'));
});

test('perfect answers score 100 and are ready', () => {
  const r = R.scoreAssessment(best, emailA);
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.level, 'ready');
  assert.strictEqual(r.fixes.length, 0);
});

test('all unsure scores low, is high risk, and flags every critical gap', () => {
  const r = R.scoreAssessment(worst, null);
  assert.ok(r.score < 10, String(r.score));
  assert.strictEqual(r.level, 'risk');
  assert.ok(r.criticalGaps.includes('mfa_email'));
  assert.ok(r.criticalGaps.includes('bk_offline'));
  assert.ok(r.fixes[0].critical);
  assert.strictEqual(r.email, null);
});

test('one missing must-have caps an otherwise strong score at "needs work"', () => {
  const r = R.scoreAssessment({ ...best, edr: 'av' }, emailA);
  assert.ok(r.score >= 85, String(r.score));
  assert.strictEqual(r.level, 'work');
  assert.deepStrictEqual(r.criticalGaps, ['edr']);
  assert.strictEqual(r.fixes[0].id, 'edr');
  assert.strictEqual(r.fixes[0].phase, 'now');
});

test('not applicable answers are left out of the score', () => {
  const r = R.scoreAssessment({ ...best, mfa_remote: 'none', vd_access: 'na' }, emailA);
  assert.strictEqual(r.score, 100);
});

test('email grade feeds the email section', () => {
  const r = R.scoreAssessment(best, { ...emailA, grade: 'F', score: 20 });
  assert.ok(r.sections.find(s => s.id === 'email').score < 100);
  assert.ok(r.fixes.some(f => f.id === 'em_auth'));
});

test('cleanAnswers drops unknown ids and values', () => {
  assert.deepStrictEqual(R.cleanAnswers({ mfa_email: 'all', mfa_admin: 'bogus', hack: 'yes', em_auth: 'yes' }), { mfa_email: 'all' });
});

test('cleanProfile keeps only valid values', () => {
  const p = R.cleanProfile({ company: ' Acme ', domain: 'acme.com', employees: '11-25', renewal: '2027-13', extra: 'x' });
  assert.deepStrictEqual(p, { company: 'Acme', domain: 'acme.com', employees: '11-25', industry: '', renewal: '', carrier: '' });
});

test('missingAnswers lists unanswered questions', () => {
  assert.strictEqual(R.missingAnswers(best).length, 0);
  assert.ok(R.missingAnswers({}).includes('mfa_email'));
});

const now = 1_800_000_000_000;
const req = { name: 'Jo', email: 'Jo@Acme.com', company: 'Acme', domain: 'https://www.acme.com/', employees: '11-25', renewal: '2027-03', package: 'review', notes: '', website: '', startedAt: now - 20000 };

test('request form: accepts and normalises', () => {
  const r = R.checkRequest(req, now);
  assert.strictEqual(r.data.email, 'jo@acme.com');
  assert.strictEqual(r.data.domain, 'acme.com');
  assert.strictEqual(r.data.package, 'review');
});
test('request form: honeypot and timing are spam', () => {
  assert.ok(R.checkRequest({ ...req, website: 'x' }, now).spam);
  assert.ok(R.checkRequest({ ...req, startedAt: now - 100 }, now).spam);
});
test('request form: required fields', () => {
  const r = R.checkRequest({ ...req, name: '', company: '', email: 'bad' }, now);
  assert.ok(r.errors.name && r.errors.company && r.errors.email);
});
test('request form: unknown package becomes unsure', () => {
  assert.strictEqual(R.checkRequest({ ...req, package: '$$$' }, now).data.package, 'unsure');
});

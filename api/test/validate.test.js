const test = require('node:test');
const assert = require('node:assert');
const { checkSubmission } = require('../src/lib/validate');

const now = 1_800_000_000_000;
const good = { name: 'Jo Smith', email: 'Jo@Example.com', company: 'Acme', message: 'We need help with MFA.', website: '', startedAt: now - 20000 };

test('accepts a normal submission and normalises email', () => {
  const r = checkSubmission(good, now);
  assert.deepStrictEqual(r.data, { name: 'Jo Smith', email: 'jo@example.com', company: 'Acme', message: 'We need help with MFA.' });
});
test('honeypot filled is spam', () => assert.ok(checkSubmission({ ...good, website: 'http://x' }, now).spam));
test('too fast is spam', () => assert.ok(checkSubmission({ ...good, startedAt: now - 500 }, now).spam));
test('missing timestamp is spam', () => assert.ok(checkSubmission({ ...good, startedAt: undefined }, now).spam));
test('link stuffing is spam', () => assert.ok(checkSubmission({ ...good, message: 'http://a http://b http://c http://d' }, now).spam));
test('bad email rejected', () => assert.ok(checkSubmission({ ...good, email: 'nope' }, now).errors.email));
test('short message rejected', () => assert.ok(checkSubmission({ ...good, message: 'hi' }, now).errors.message));
test('missing name rejected', () => assert.ok(checkSubmission({ ...good, name: '  ' }, now).errors.name));
test('overlong field rejected', () => assert.ok(checkSubmission({ ...good, company: 'x'.repeat(200) }, now).errors.company));
test('non-object rejected', () => assert.ok(checkSubmission(null, now).errors));

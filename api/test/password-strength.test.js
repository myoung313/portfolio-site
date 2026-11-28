// The password strength estimator runs in the browser (site/password/strength.js); test it here too.
const test = require('node:test');
const assert = require('node:assert');
const { estimate, humanTime } = require('../../site/password/strength.js');

test('common passwords are very weak', () => {
  for (const p of ['password', 'P@ssw0rd', 'qwerty123', 'Summer2024!', 'letmein', 'aaaaaaaa', '123456789']) assert.strictEqual(estimate(p).score, 0, p);
});
test('long random passwords are very strong', () => assert.strictEqual(estimate('x7#Lq9!vR2$m').score, 4));
test('passphrases are very strong', () => assert.strictEqual(estimate('correct horse battery staple').score, 4));
test('more length never lowers the score', () => {
  let prev = -1;
  for (const p of ['kd', 'kdj', 'kdjf', 'kdjfhsieur', 'kdjfhsieurtw', 'kdjfhsieurtwbnx']) { const s = estimate(p).bits; assert.ok(s >= prev, p); prev = s; }
});
test('flags years and common words', () => {
  const r = estimate('CloudShift2025');
  assert.ok(r.found.includes('word') && r.found.includes('year'));
  assert.strictEqual(r.checks.find(c => c.label === 'No years').state, 'bad');
});
test('flags keyboard runs', () => assert.ok(estimate('zxcvbnm').found.includes('seq')));
test('empty password is handled', () => assert.strictEqual(estimate('').score, 0));
test('humanTime', () => {
  assert.strictEqual(humanTime(0.2), 'less than a second');
  assert.strictEqual(humanTime(7200), 'about 2 hours');
  assert.strictEqual(humanTime(4e9), 'centuries');
});

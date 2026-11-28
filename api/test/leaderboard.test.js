const test = require('node:test');
const assert = require('node:assert');
const { checkName, checkScore, points, weekKey, nextReset, rowKeyFor, ROWKEY_RE } = require('../src/lib/leaderboard');

const now = 1_800_000_000_000;
const good = { name: 'InboxNinja', correct: 7, total: 8, seconds: 52, streak: 5, startedAt: now - 70_000, website: '' };

test('accepts a normal score', () => {
  const r = checkScore(good, now);
  assert.deepStrictEqual(r.data, { name: 'InboxNinja', hold: [], correct: 7, total: 8, seconds: 52, streak: 5, points: 700 + Math.round(50 * (1 - 52 / 120) * 7 / 8) });
});
test('points: zero correct is zero', () => assert.strictEqual(points(0, 8, 9), 0));
test('points: perfect and instant is 850', () => assert.strictEqual(points(8, 8, 0), 850));
test('points: perfect at full time is 800', () => assert.strictEqual(points(8, 8, 120), 800));
test('points: faster beats slower', () => assert.ok(points(6, 8, 40) > points(6, 8, 80)));
test('points: accuracy beats speed', () => assert.ok(points(7, 8, 119) > points(6, 8, 8)));
test('honeypot is spam', () => assert.ok(checkScore({ ...good, website: 'x' }, now).spam));
test('missing start time is spam', () => assert.ok(checkScore({ ...good, startedAt: undefined }, now).spam));
test('claiming longer play than elapsed is spam', () => assert.ok(checkScore({ ...good, startedAt: now - 10_000 }, now).spam));
test('more correct than total rejected', () => assert.ok(checkScore({ ...good, correct: 9 }, now).errors));
test('wrong round size rejected', () => assert.ok(checkScore({ ...good, total: 10 }, now).errors));
test('impossibly fast rejected', () => assert.ok(checkScore({ ...good, seconds: 3 }, now).errors));
test('too slow rejected', () => assert.ok(checkScore({ ...good, seconds: 500, startedAt: now - 600_000 }, now).errors));
test('streak above correct rejected', () => assert.ok(checkScore({ ...good, streak: 8 }, now).errors));
test('fractional correct rejected', () => assert.ok(checkScore({ ...good, correct: 6.5 }, now).errors));

test('name too short', () => assert.ok(checkName('a').error));
test('name too long', () => assert.ok(checkName('x'.repeat(17)).error));
test('name trims and collapses spaces', () => assert.strictEqual(checkName('  Phish   Hunter ').name, 'Phish Hunter'));
test('name rejects odd characters', () => assert.ok(checkName('<script>').error));
test('name rejects unicode lookalikes', () => assert.ok(checkName('Pаypal').error)); // Cyrillic a
test('name rejects links', () => assert.ok(checkName('spam.com').error));
test('name rejects phone numbers', () => assert.ok(checkName('317-555-1234').error));
test('name rejects profanity', () => assert.ok(checkName('fuckface').error));
test('name rejects leet profanity', () => assert.ok(checkName('Sh1tHead').error));
test('name rejects split profanity', () => assert.ok(checkName('f_u_c_k').error));
test('name rejects slurs inside words', () => assert.ok(checkName('BigFag99').error));
test('borderline word is held', () => assert.deepStrictEqual(checkName('Classic Player').hold, ['words']));
test('impersonation is held', () => assert.deepStrictEqual(checkName('CloudShift_Taz').hold, ['impersonation']));
test('clean names pass with no hold', () => {
  for (const n of ['PhishSlayer', 'MFA_Mike', 'HeaderHawk', 'DomainDetective', 'Jen K.', "O'Brien"]) assert.deepStrictEqual(checkName(n).hold, [], n);
});

test('weekKey mid-week', () => assert.strictEqual(weekKey(new Date('2026-11-28T12:00:00Z')), '2026-W48'));
test('weekKey Monday starts new week', () => assert.strictEqual(weekKey(new Date('2026-11-30T00:00:00Z')), '2026-W49'));
test('weekKey year boundary', () => assert.strictEqual(weekKey(new Date('2027-01-01T00:00:00Z')), '2026-W53'));
test('nextReset is the following Monday', () => assert.strictEqual(nextReset(new Date('2026-11-28T12:00:00Z')), '2026-11-30T00:00:00.000Z'));
test('nextReset on a Monday is next week', () => assert.strictEqual(nextReset(new Date('2026-11-30T05:00:00Z')), '2026-12-07T00:00:00.000Z'));

test('rowKeys sort best score first, then earliest', () => {
  const a = rowKeyFor(800, 2000, 'aaaaaaaa'), b = rowKeyFor(700, 1000, 'bbbbbbbb'), c = rowKeyFor(800, 3000, 'cccccccc');
  assert.deepStrictEqual([b, c, a].sort(), [a, c, b]);
  assert.ok(ROWKEY_RE.test(a));
});

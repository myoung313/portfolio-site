const test = require('node:test');
const assert = require('node:assert');
const { checkRating, summarize } = require('../src/lib/rating');

const now = 1_800_000_000_000;
const good = { stars: 5, comment: 'Great site!', website: '', startedAt: now - 10000 };

test('accepts a normal rating', () => assert.deepStrictEqual(checkRating(good, now).data, { stars: 5, comment: 'Great site!' }));
test('comment is optional', () => assert.deepStrictEqual(checkRating({ ...good, comment: undefined }, now).data, { stars: 5, comment: '' }));
test('stars as string number ok', () => assert.strictEqual(checkRating({ ...good, stars: '3' }, now).data.stars, 3));
test('zero stars rejected', () => assert.ok(checkRating({ ...good, stars: 0 }, now).errors.stars));
test('six stars rejected', () => assert.ok(checkRating({ ...good, stars: 6 }, now).errors.stars));
test('fractional stars rejected', () => assert.ok(checkRating({ ...good, stars: 4.5 }, now).errors.stars));
test('long comment rejected', () => assert.ok(checkRating({ ...good, comment: 'x'.repeat(501) }, now).errors.comment));
test('honeypot is spam', () => assert.ok(checkRating({ ...good, website: 'x' }, now).spam));
test('too fast is spam', () => assert.ok(checkRating({ ...good, startedAt: now - 200 }, now).spam));
test('links in comment are spam', () => assert.ok(checkRating({ ...good, comment: 'http://a www.b' }, now).spam));
test('summary of nothing', () => assert.deepStrictEqual(summarize(null), { count: 0, average: null, distribution: [0, 0, 0, 0, 0] }));
test('summary average', () => assert.deepStrictEqual(summarize({ s1: 0, s2: 0, s3: 1, s4: 1, s5: 2 }), { count: 4, average: 4.3, distribution: [0, 0, 1, 1, 2] }));

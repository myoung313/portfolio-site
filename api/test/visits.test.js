const test = require('node:test');
const assert = require('node:assert');
const { isBot, nextTotal } = require('../src/lib/visits');

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

test('phone browser counts', () => assert.strictEqual(isBot(iphone), false));
test('desktop browser counts', () => assert.strictEqual(isBot(chrome), false));
test('googlebot skipped', () => assert.ok(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')));
test('headless chrome skipped', () => assert.ok(isBot('Mozilla/5.0 HeadlessChrome/131.0')));
test('curl skipped', () => assert.ok(isBot('curl/8.5.0')));
test('missing user agent skipped', () => assert.ok(isBot('')));
test('first visit is 1', () => assert.strictEqual(nextTotal(null), 1));
test('adds one', () => assert.strictEqual(nextTotal({ total: 41 }), 42));

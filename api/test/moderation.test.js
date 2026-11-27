const test = require('node:test');
const assert = require('node:assert');
const { checkComment, ruleFlags, aiFlags, publicChecks, decide } = require('../src/lib/moderation');
const { analyze } = require('../src/lib/ai');

const now = 1_800_000_000_000;
const base = { kind: 'suggestion', stars: 5, name: 'Renee', text: 'Love the email checkup, please add MTA-STS!', website: '', startedAt: now - 20000 };
const data = over => checkComment({ ...base, ...over }, now).data;
const flags = over => ruleFlags(data(over));
const cleanAi = { safety: { hate: 0, selfHarm: 0, sexual: 0, violence: 0 }, sentiment: { label: 'positive', positive: 0.95, neutral: 0.04, negative: 0.01 } };

// Validation and bot guards
test('accepts a normal post', () => assert.deepStrictEqual(data({}), { text: base.text, name: 'Renee', kind: 'suggestion', stars: 5 }));
test('stars and name are optional', () => assert.deepStrictEqual(data({ stars: null, name: '' }), { text: base.text, name: '', kind: 'suggestion', stars: null }));
test('unknown kind becomes comment', () => assert.strictEqual(data({ kind: 'ad' }).kind, 'comment'));
test('honeypot is spam', () => assert.strictEqual(checkComment({ ...base, website: 'x' }, now).spam, 'honeypot'));
test('too fast is spam', () => assert.strictEqual(checkComment({ ...base, startedAt: now - 500 }, now).spam, 'timing'));
test('missing timestamp is spam', () => assert.strictEqual(checkComment({ ...base, startedAt: undefined }, now).spam, 'timing'));
test('many links are spam', () => assert.strictEqual(checkComment({ ...base, text: 'http://a http://b www.c' }, now).spam, 'links'));
test('empty text rejected', () => assert.ok(checkComment({ ...base, text: ' ' }, now).errors.text));
test('long text rejected', () => assert.ok(checkComment({ ...base, text: 'x'.repeat(801) }, now).errors.text));
test('bad stars rejected', () => assert.ok(checkComment({ ...base, stars: 7 }, now).errors.stars));
test('control characters stripped', () => assert.strictEqual(data({ text: 'hi\u0000 there​' }).text, 'hi there'));

// Rules
test('friendly post has no flags', () => assert.deepStrictEqual(flags({}), []));
test('3 stars is fine', () => assert.deepStrictEqual(flags({ stars: 3 }), []));
test('low stars flagged', () => assert.deepStrictEqual(flags({ stars: 2 }), ['lowstars']));
test('link flagged', () => assert.ok(flags({ text: 'see www.example.com' }).includes('link')));
test('bare domain flagged', () => assert.ok(flags({ text: 'visit cheap-deals.biz today' }).includes('link')));
test('link in name flagged', () => assert.ok(flags({ name: 'best-seo.net' }).includes('link')));
test('email flagged', () => assert.ok(flags({ text: 'email me at bob@example.org' }).includes('contact')));
test('phone flagged', () => assert.ok(flags({ text: 'call 317-555-0123 now' }).includes('contact')));
test('profanity flagged', () => assert.ok(flags({ text: 'this is shit' }).includes('profanity')));
test('leetspeak profanity flagged', () => assert.ok(flags({ text: 'what a sh1t site' }).includes('profanity')));
test('masked swearing flagged', () => assert.ok(flags({ text: 'this is f*** awful' }).includes('profanity')));
test('no false positive on Scunthorpe-style words', () => assert.deepStrictEqual(flags({ text: 'Great class on the cockpit and Dickens assessment' }), []));
test('all caps flagged', () => assert.ok(flags({ text: 'THIS SITE IS GREAT BUT LOUD' }).includes('shouting')));
test('short caps not flagged', () => assert.deepStrictEqual(flags({ text: 'Great MFA tips!' }), []));
test('repeated characters flagged', () => assert.ok(flags({ text: 'cooooooool' }).includes('repeat')));
test('repeated words flagged', () => assert.ok(flags({ text: 'buy buy buy buy now' }).includes('repeat')));

// AI results
test('clean AI result adds nothing', () => assert.deepStrictEqual(aiFlags(cleanAi), []));
test('missing AI holds the post', () => assert.deepStrictEqual(aiFlags({ safety: null, sentiment: null }), ['noai']));
test('one AI service down holds the post', () => assert.deepStrictEqual(aiFlags({ ...cleanAi, sentiment: null }), ['noai']));
test('harm severity 2 flagged', () => assert.ok(aiFlags({ ...cleanAi, safety: { ...cleanAi.safety, hate: 2 } }).includes('harm')));
test('confident negative flagged', () => assert.ok(aiFlags({ ...cleanAi, sentiment: { label: 'negative', positive: 0.1, neutral: 0.1, negative: 0.8 } }).includes('negative')));
test('mild negative not flagged', () => assert.deepStrictEqual(aiFlags({ ...cleanAi, sentiment: { label: 'negative', positive: 0.3, neutral: 0.2, negative: 0.5 } }), []));
test('neutral suggestion not flagged', () => assert.deepStrictEqual(aiFlags({ ...cleanAi, sentiment: { label: 'neutral', positive: 0.2, neutral: 0.7, negative: 0.1 } }), []));

// Decision
test('no flags publishes', () => assert.strictEqual(decide([]), 'approved'));
test('any flag holds', () => assert.strictEqual(decide(['link']), 'pending'));
test('public checks map', () => assert.deepStrictEqual(publicChecks(['contact', 'negative']), ['links', 'tone']));

// AI client without settings never calls out
test('analyze without settings returns nulls', async () => {
  assert.deepStrictEqual(await analyze('hi', () => {}, {}), { safety: null, sentiment: null });
});
test('analyze survives a failing service', async () => {
  const realFetch = global.fetch;
  global.fetch = async url => (String(url).includes('contentsafety')
    ? { ok: true, json: async () => ({ categoriesAnalysis: [{ category: 'Hate', severity: 0 }] }) }
    : { ok: false, status: 500 });
  try {
    const logs = [];
    const out = await analyze('hi', m => logs.push(m), { CONTENT_SAFETY_ENDPOINT: 'https://a.example/', CONTENT_SAFETY_KEY: 'k', LANGUAGE_ENDPOINT: 'https://b.example', LANGUAGE_KEY: 'k' });
    assert.deepStrictEqual(out.safety, { hate: 0, selfHarm: 0, sexual: 0, violence: 0 });
    assert.strictEqual(out.sentiment, null);
    assert.strictEqual(logs.length, 1);
  } finally { global.fetch = realFetch; }
});

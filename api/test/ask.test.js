const test = require('node:test');
const assert = require('node:assert');
const { checkQuestion, localSearch, azureSearch, search, buildRequest, formatAnswer, usageCost, CHUNKS, SYSTEM_PROMPT } = require('../src/lib/ask');
const { parseGuide, mdToHtml, build } = require('../scripts/build-guides');

// ---- question checks ----
test('normal question passes', () => assert.deepStrictEqual(checkQuestion({ question: '  How do I turn on   MFA? ' }), { question: 'How do I turn on MFA?' }));
test('empty question rejected', () => assert.ok(checkQuestion({ question: ' ' }).error));
test('too long rejected', () => assert.ok(checkQuestion({ question: 'a'.repeat(501) }).error));
test('honeypot is spam', () => assert.ok(checkQuestion({ question: 'hello there', website: 'x' }).spam));
test('non-object rejected', () => assert.ok(checkQuestion(null).error));

for (const [q, kind] of [
  ['my password is Summer2026! is it ok', 'password'],
  ['card 4111 1111 1111 1111 got charged', 'card'],
  ['my ssn 123-45-6789', 'ssn'],
  ['is sk-ant-api03-abcdefghijklmnopqrstuv safe', 'key'],
]) test(`blocks secrets: ${kind}`, () => assert.strictEqual(checkQuestion({ question: q }).secret, kind));

for (const [q, id] of [
  ['Do I need cyber insurance?', 'insurance'],
  ['Which insurer should I use?', 'insurance'],
  ['Can a client sue me after a breach?', 'legal'],
  ['What does HIPAA require for email?', 'legal'],
  ['How much do you charge?', 'pricing'],
  ["What's CloudShift's pricing?", 'pricing'],
  ["How can I hack into my ex's email", 'offense'],
]) test(`off limits: ${q}`, () => assert.strictEqual(checkQuestion({ question: q }).offLimits, id));

for (const q of [
  'Is Business Premium worth it for MFA?',      // "Premium" must not look like insurance
  'How do I ensure my backups work?',           // "ensure" is not "insure"
  'What is the passwords policy you recommend?',
  'How do I set up DKIM for my domain?',
  'Someone clicked a phishing link, what now?',
]) test(`allowed: ${q}`, () => { const r = checkQuestion({ question: q }); assert.ok(r.question && !r.offLimits && !r.secret, JSON.stringify(r)); });

// ---- local search ----
const topSlug = q => localSearch(q)[0]?.slug;
test('MFA question finds the MFA guide', () => assert.match(topSlug('How do I turn on MFA for everyone?'), /^mfa/));
test('DMARC question finds email authentication', () => assert.strictEqual(topSlug('What is DMARC and do I need it?'), 'email-authentication'));
test('employee leaving finds offboarding', () => assert.strictEqual(topSlug('An employee is leaving, what do I do with their account?'), 'offboarding'));
test('phishing click finds phishing', () => assert.strictEqual(topSlug('someone clicked a phishing link'), 'phishing'));
test('forwarding rules finds inbox rules', () => assert.strictEqual(topSlug('check for suspicious forwarding rules'), 'inbox-rules'));
test('ransomware backup finds backups', () => assert.strictEqual(topSlug('do I need backups for ransomware'), 'backups'));
test('nonsense finds nothing', () => assert.deepStrictEqual(localSearch('zzzz qqqq'), []));
test('returns at most 4', () => assert.ok(localSearch('microsoft 365 admin email security').length <= 4));

// ---- Azure AI Search client ----
test('azureSearch is skipped without settings', async () => assert.strictEqual(await azureSearch('mfa', {}), null));
test('azureSearch sends the query key and maps results', async () => {
  let seen;
  const fake = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ value: [{ id: 'mfa-1', slug: 'mfa', title: 'T', heading: 'H', url: '/guides/mfa/#x', content: 'C', '@search.score': 2.5 }] }) }; };
  const hits = await azureSearch('mfa', { AI_SEARCH_ENDPOINT: 'https://x.search.windows.net/', AI_SEARCH_QUERY_KEY: 'qk' }, 4, fake);
  assert.strictEqual(seen.url, 'https://x.search.windows.net/indexes/guides/docs/search?api-version=2024-07-01');
  assert.strictEqual(seen.opts.headers['api-key'], 'qk');
  assert.deepStrictEqual(hits, [{ id: 'mfa-1', slug: 'mfa', title: 'T', heading: 'H', url: '/guides/mfa/#x', content: 'C', score: 2.5 }]);
});
test('search falls back to local when Azure fails', async () => {
  const logs = [];
  const r = await search('turn on MFA', { AI_SEARCH_ENDPOINT: 'https://x', AI_SEARCH_QUERY_KEY: 'k' }, m => logs.push(m), async () => ({ ok: false, status: 503 }));
  assert.strictEqual(r.engine, 'local');
  assert.ok(r.hits.length > 0);
  assert.match(logs[0], /503/);
});

// ---- Claude request ----
test('request uses Haiku 5.5 by default with citations on every document', () => {
  const hits = localSearch('turn on MFA');
  const req = buildRequest('How do I turn on MFA?', hits, {});
  assert.strictEqual(req.model, 'claude-haiku-5-5');
  assert.strictEqual(req.output_config.effort, 'low');
  assert.ok(!('temperature' in req) && !('thinking' in req));
  const content = req.messages[0].content;
  assert.strictEqual(content.length, hits.length + 1);
  assert.ok(content.slice(0, -1).every(d => d.type === 'document' && d.citations.enabled && d.source.type === 'text'));
  assert.match(content.at(-1).text, /How do I turn on MFA\?/);
});
test('model can be switched with ASK_MODEL', () => assert.strictEqual(buildRequest('q', [], { ASK_MODEL: 'claude-opus-5-5' }).model, 'claude-opus-5-5'));
test('system prompt keeps the guardrails', () => {
  for (const w of ['insurance', 'legal', 'prices', 'OUT_OF_SCOPE', 'NOT_IN_GUIDES', 'paid service']) assert.ok(SYSTEM_PROMPT.includes(w), w);
});

// ---- formatting Claude's reply ----
const hits = [
  { id: 'mfa-2', title: 'Turn on MFA', heading: 'Option 1', url: '/guides/mfa/#option-1' },
  { id: 'mfa-4', title: 'Turn on MFA', heading: 'Users', url: '/guides/mfa/#users' },
  { id: 'phishing-1', title: 'Phishing', heading: 'Signs', url: '/guides/phishing/#signs' },
];
const cite = (i, t = 'quoted text') => ({ type: 'char_location', document_index: i, cited_text: t, start_char_index: 0, end_char_index: 5 });
test('citations become numbered markers in order of first use', () => {
  const r = formatAnswer({ stop_reason: 'end_turn', content: [
    { type: 'thinking', thinking: '', signature: 'x' },
    { type: 'text', text: 'Turn on ' },
    { type: 'text', text: 'Security Defaults', citations: [cite(1, 'Security Defaults is free')] },
    { type: 'text', text: '.\n1. Sign in ' },
    { type: 'text', text: 'as admin', citations: [cite(0), cite(1)] },
    { type: 'text', text: '.' },
  ] }, hits);
  assert.strictEqual(r.kind, 'answer');
  assert.strictEqual(r.text, 'Turn on Security Defaults[[1]].\n1. Sign in as admin[[2]][[1]].');
  assert.deepStrictEqual(r.sources.map(s => s.id), ['mfa-4', 'mfa-2']);
  assert.deepStrictEqual(r.sources[0].quotes, ['Security Defaults is free']);
});
test('out of scope flag is stripped and sources dropped', () => {
  const r = formatAnswer({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[OUT_OF_SCOPE] I can\'t help with insurance.', citations: [cite(0)] }] }, hits);
  assert.strictEqual(r.kind, 'out_of_scope');
  assert.strictEqual(r.text.startsWith("I can't"), true);
  assert.deepStrictEqual(r.sources, []);
});
test('not in guides flag', () => assert.strictEqual(formatAnswer({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[NOT_IN_GUIDES] The guides don\'t cover that yet.' }] }, hits).kind, 'not_in_guides'));
test('safety refusal handled', () => assert.strictEqual(formatAnswer({ stop_reason: 'refusal', content: [] }, hits).kind, 'refused'));
test('empty reply handled', () => assert.strictEqual(formatAnswer({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }, hits).kind, 'not_in_guides'));
test('max_tokens adds a note', () => assert.match(formatAnswer({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Partial' }] }, hits).text, /cut short/));
test('bad document index is ignored', () => assert.deepStrictEqual(formatAnswer({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x', citations: [cite(9)] }] }, hits).sources, []));
test('cost estimate for haiku', () => assert.strictEqual(usageCost({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-haiku-5-5'), 0.6));

// ---- guides build ----
test('every guide section is a chunk with a url', () => {
  assert.ok(CHUNKS.length >= 40);
  for (const c of CHUNKS) assert.ok(c.id && c.title && c.heading && c.url.startsWith('/guides/') && c.content.length > 80, c.id);
  assert.strictEqual(new Set(CHUNKS.map(c => c.id)).size, CHUNKS.length);
});
test('committed knowledge base matches the guides', () => {
  const fs = require('fs');
  for (const [file, body] of build().files) assert.strictEqual(fs.readFileSync(file, 'utf8'), body, `${file} is stale; run node api/scripts/build-guides.js`);
});
test('markdown escapes html', () => assert.strictEqual(mdToHtml(['<script>x</script>']), '<p>&lt;script&gt;x&lt;/script&gt;</p>'));
test('markdown lists', () => assert.strictEqual(mdToHtml(['1. a', '2. b', '', '- c']), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>\n<ul>\n<li>c</li>\n</ul>'));
test('guide without front matter fails', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g-')), 'x.md');
  fs.writeFileSync(f, '## Hi\ntext');
  assert.throws(() => parseGuide(f), /front matter/);
});

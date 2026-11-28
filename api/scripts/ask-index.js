// Creates (or updates) the "guides" index in Azure AI Search and uploads every guide section.
// Safe to run again: it replaces documents with the same id and deletes ones that no longer exist.
//
//   AI_SEARCH_ENDPOINT=https://<name>.search.windows.net AI_SEARCH_ADMIN_KEY=<admin key> node scripts/ask-index.js
//
// The admin key can change the index, so it lives only in GitHub Actions secrets (or your
// Cloud Shell session). The website itself only gets the read-only query key.
const CHUNKS = require('../src/data/guide-chunks.json');

const API = '2024-07-01';
const endpoint = (process.env.AI_SEARCH_ENDPOINT || '').replace(/\/+$/, '');
const key = process.env.AI_SEARCH_ADMIN_KEY;
const indexName = process.env.AI_SEARCH_INDEX || 'guides';

const INDEX = {
  name: indexName,
  fields: [
    { name: 'id', type: 'Edm.String', key: true, filterable: true },
    { name: 'slug', type: 'Edm.String', filterable: true, facetable: true },
    { name: 'title', type: 'Edm.String', searchable: true, analyzer: 'en.microsoft' },
    { name: 'heading', type: 'Edm.String', searchable: true, analyzer: 'en.microsoft' },
    { name: 'url', type: 'Edm.String' },
    { name: 'content', type: 'Edm.String', searchable: true, analyzer: 'en.microsoft' },
  ],
  // Matches in a section heading or guide title count more than matches in body text.
  scoringProfiles: [{ name: 'headings', text: { weights: { heading: 3, title: 2, content: 1 } } }],
  defaultScoringProfile: 'headings',
};

async function call(method, path, body) {
  const res = await fetch(`${endpoint}${path}${path.includes('?') ? '&' : '?'}api-version=${API}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'api-key': key },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

(async () => {
  if (!endpoint || !key) {
    console.log('AI_SEARCH_ENDPOINT / AI_SEARCH_ADMIN_KEY not set, skipping (the site falls back to its built-in search).');
    return;
  }
  await call('PUT', `/indexes/${indexName}`, INDEX);
  console.log(`Index "${indexName}" is ready`);

  const existing = new Set();
  let skip = 0;
  for (;;) {
    const page = await call('POST', `/indexes/${indexName}/docs/search`, { search: '*', select: 'id', top: 1000, skip });
    page.value.forEach(d => existing.add(d.id));
    if (page.value.length < 1000) break;
    skip += 1000;
  }
  const keep = new Set(CHUNKS.map(c => c.id));
  const actions = [
    ...CHUNKS.map(c => ({ '@search.action': 'mergeOrUpload', ...c })),
    ...[...existing].filter(id => !keep.has(id)).map(id => ({ '@search.action': 'delete', id })),
  ];
  const out = await call('POST', `/indexes/${indexName}/docs/index`, { value: actions });
  const failed = out.value.filter(r => !r.status);
  if (failed.length) throw new Error(`${failed.length} documents failed: ${JSON.stringify(failed.slice(0, 3))}`);
  console.log(`Uploaded ${CHUNKS.length} sections, removed ${actions.length - CHUNKS.length} old ones`);

  // Quick check that search works.
  const test = await call('POST', `/indexes/${indexName}/docs/search`, { search: 'turn on MFA security defaults', top: 1, select: 'id' });
  console.log(`Test search "turn on MFA security defaults" -> ${test.value[0]?.id || 'no results'}`);
})().catch(err => { console.error(err.message); process.exit(1); });

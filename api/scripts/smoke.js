// Live smoke test: runs the real checkup (real DNS) against a few domains.
// Usage: node scripts/smoke.js microsoft.com cloudshiftlabs.net
const { Resolver } = require('node:dns').promises;
const { normalizeDomain, runCheckup } = require('../src/lib/emailcheck');

const dns = new Resolver({ timeout: 2500, tries: 2 });
const fetchText = async url => {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).slice(0, 16384);
};

(async () => {
  let failed = 0;
  for (const input of process.argv.slice(2)) {
    const { domain, error } = normalizeDomain(input);
    if (error) { console.log(`${input}: ${error}`); failed++; continue; }
    const t = Date.now();
    const r = await runCheckup(domain, { dns, fetchText });
    if (!r.ok) { console.log(`${domain}: ${r.error}`); continue; }
    console.log(`\n=== ${domain}: ${r.grade} (${r.score}/100), provider ${r.provider}, ${Date.now() - t} ms${r.partial ? ', PARTIAL' : ''}`);
    for (const c of r.checks) {
      console.log(`  [${c.status}] ${c.id} ${c.points}/${c.max}: ${c.summary}`);
      for (const rec of c.records || []) console.log(`      record: ${rec}`);
      for (const n of c.notes || []) console.log(`      note: ${n}`);
      for (const i of c.items || []) console.log(`      ${i.name}: ${i.status}`);
      if (c.fix?.record) console.log(`      fix: ${c.fix.record}`);
    }
    if (r.partial) failed++;
  }
  process.exitCode = failed ? 1 : 0;
})();

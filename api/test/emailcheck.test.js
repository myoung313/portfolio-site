const test = require('node:test');
const assert = require('node:assert');
const ec = require('../src/lib/emailcheck');

// A fake DNS resolver built from a simple zone map. Missing names act like ENOTFOUND.
function fakeDns(zone) {
  const err = code => Object.assign(new Error(code), { code });
  const get = type => async name => {
    const v = zone[`${name}|${type}`];
    if (v === undefined) throw err(zone[`${name}|*`] || (type === 'NS' && name.split('.').length > 2 ? 'ENODATA' : 'ENOTFOUND'));
    if (typeof v === 'string' && v.startsWith('E')) throw err(v);
    return v;
  };
  return { resolveMx: get('MX'), resolveTxt: get('TXT'), resolveCname: get('CNAME'), resolveNs: get('NS') };
}
const t = s => [[s]];

// A well-configured Microsoft 365 tenant.
const KEY2048 = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA' + 'A'.repeat(348) + 'IDAQAB';
const KEY1024 = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ' + 'A'.repeat(170) + 'IDAQAB';
const good = {
  'contoso.com|NS': ['ns1.azure-dns.com'],
  'contoso.com|MX': [{ exchange: 'contoso-com.mail.protection.outlook.com', priority: 0 }],
  'contoso.com|TXT': [['MS=ms123'], ['v=spf1 include:spf.protection.outlook.com -all']],
  'spf.protection.outlook.com|TXT': t('v=spf1 ip4:40.92.0.0/15 include:spfd.protection.outlook.com -all'),
  'spfd.protection.outlook.com|TXT': t('v=spf1 ip4:51.4.72.0/24 -all'),
  'selector1._domainkey.contoso.com|TXT': [['v=DKIM1; k=rsa; p=', KEY2048]],
  'selector1._domainkey.contoso.com|CNAME': ['selector1-contoso-com._domainkey.contoso.onmicrosoft.com'],
  '_dmarc.contoso.com|TXT': t('v=DMARC1; p=reject; rua=mailto:dmarc@contoso.com'),
};

test('normalizes messy input', () => {
  assert.strictEqual(ec.normalizeDomain('https://www.Contoso.com/about?x=1').domain, 'contoso.com');
  assert.strictEqual(ec.normalizeDomain('  taz@CloudShiftLabs.net ').domain, 'cloudshiftlabs.net');
  assert.strictEqual(ec.normalizeDomain('mail.contoso.co.uk.').domain, 'mail.contoso.co.uk');
  assert.strictEqual(ec.normalizeDomain('bücher.de').domain, 'xn--bcher-kva.de');
});
test('rejects bad input', () => {
  for (const bad of ['', 'localhost', '10.0.0.1', 'exa mple', 'a..com', '-bad.com', 'x'.repeat(70) + '.com', '[::1]', 'contoso.123', null]) {
    assert.ok(ec.normalizeDomain(bad).error, `should reject ${bad}`);
  }
});

test('a fully configured M365 domain gets an A', async () => {
  const r = await ec.runCheckup('contoso.com', { dns: fakeDns(good) });
  assert.strictEqual(r.provider, 'Microsoft 365');
  assert.strictEqual(r.score, 90);
  assert.strictEqual(r.grade, 'A');
  assert.deepStrictEqual(r.checks.map(c => c.status), ['pass', 'pass', 'pass', 'pass', 'info']);
  assert.strictEqual(r.checks[2].selectors[0].bits, 2048);
});

test('bonus protections lift it to A+', async () => {
  const zone = { ...good,
    '_mta-sts.contoso.com|TXT': t('v=STSv1; id=2026'),
    '_smtp._tls.contoso.com|TXT': t('v=TLSRPTv1; rua=mailto:tls@contoso.com'),
    'default._bimi.contoso.com|TXT': t('v=BIMI1; l=https://contoso.com/logo.svg'),
  };
  const r = await ec.runCheckup('contoso.com', { dns: fakeDns(zone), fetchText: async () => 'version: STSv1\nmode: enforce\nmx: *.mail.protection.outlook.com\nmax_age: 604800' });
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.grade, 'A+');
});

test('nothing configured is an F with fixes', async () => {
  const zone = { 'bare.com|NS': ['ns1.x.com'], 'bare.com|MX': [{ exchange: 'bare-com.mail.protection.outlook.com', priority: 0 }] };
  const r = await ec.runCheckup('bare.com', { dns: fakeDns(zone) });
  assert.strictEqual(r.grade, 'F');
  const spf = r.checks.find(c => c.id === 'spf');
  assert.match(spf.fix.record, /include:spf\.protection\.outlook\.com -all/);
  assert.match(r.checks.find(c => c.id === 'dmarc').fix.record, /^_dmarc\.bare\.com\..*p=none/);
  assert.match(r.checks.find(c => c.id === 'dkim').fix.text, /security\.microsoft\.com/);
});

test('unknown domain is reported as not found', async () => {
  const r = await ec.runCheckup('nope-not-real.com', { dns: fakeDns({}) });
  assert.strictEqual(r.ok, false);
  assert.ok(r.notFound);
});

test('SPF qualifiers score as expected', async () => {
  const score = async rec => (await ec.checkSpf(fakeDns({ 'x.com|TXT': t(rec) }), 'x.com', null));
  assert.strictEqual((await score('v=spf1 ip4:1.2.3.4 -all')).points, 25);
  assert.strictEqual((await score('v=spf1 ip4:1.2.3.4 ~all')).points, 20);
  assert.strictEqual((await score('v=spf1 ip4:1.2.3.4 ?all')).status, 'warn');
  const open = await score('v=spf1 +all');
  assert.strictEqual(open.points, 0);
  assert.match(open.fix.record, /"v=spf1 -all"/);
  assert.strictEqual((await score('v=spf1 include:allmail.example ip4:1.2.3.4')).status, 'warn'); // no all term
});

test('two SPF records are an error', async () => {
  const r = await ec.checkSpf(fakeDns({ 'x.com|TXT': [['v=spf1 -all'], ['v=spf1 ~all']] }), 'x.com', null);
  assert.strictEqual(r.status, 'fail');
  assert.strictEqual(r.points, 5);
});

test('SPF over 10 lookups fails', async () => {
  const zone = { 'x.com|TXT': t('v=spf1 ' + Array.from({ length: 11 }, (_, i) => `include:s${i}.example`).join(' ') + ' -all') };
  const r = await ec.checkSpf(fakeDns(zone), 'x.com', null);
  assert.strictEqual(r.lookups, 11);
  assert.strictEqual(r.status, 'fail');
});

test('SPF lookup count follows nested includes and survives loops', async () => {
  const zone = {
    'a.example|TXT': t('v=spf1 include:b.example mx a -all'),
    'b.example|TXT': t('v=spf1 include:a.example ip4:1.1.1.1 -all'),
  };
  assert.strictEqual(await ec.countSpfLookups(fakeDns(zone), 'v=spf1 include:a.example -all'), 5);
});

test('M365 mail without the M365 SPF include is flagged', async () => {
  const r = await ec.checkSpf(fakeDns({ 'x.com|TXT': t('v=spf1 ip4:1.2.3.4 -all') }), 'x.com', 'Microsoft 365');
  assert.strictEqual(r.status, 'warn');
  assert.match(r.fix.record, /include:spf\.protection\.outlook\.com ip4/);
});

test('DMARC policies', async () => {
  const run = rec => ec.checkDmarc(fakeDns({ '_dmarc.x.com|TXT': t(rec) }), 'x.com');
  assert.strictEqual((await run('v=DMARC1; p=reject; rua=mailto:d@x.com')).points, 35);
  const q = await run('v=DMARC1; p=quarantine; rua=mailto:d@x.com');
  assert.strictEqual(q.points, 28);
  assert.match(q.fix.record, /p=reject/);
  const none = await run('v=DMARC1; p=none');
  assert.strictEqual(none.status, 'warn');
  assert.strictEqual(none.points, 9); // 12 minus 3 for no reports
  assert.match(none.fix.record, /v=DMARC1; p=quarantine/);
  const pct = await run('v=DMARC1; p=reject; pct=25; rua=mailto:d@x.com');
  assert.strictEqual(pct.status, 'warn');
  assert.strictEqual(pct.points, 29);
  assert.strictEqual((await run('v=DMARC1; sp=none')).status, 'fail');
});

test('subdomain inherits the parent DMARC policy', async () => {
  const r = await ec.checkDmarc(fakeDns({ '_dmarc.x.com|TXT': t('v=DMARC1; p=reject; rua=mailto:d@x.com') }), 'mail.x.com');
  assert.strictEqual(r.policy, 'reject');
  assert.ok(r.notes.some(n => /Inherited from x\.com/.test(n)));
});

test('M365 DKIM CNAME without a key means signing is off', async () => {
  const zone = { 'selector1._domainkey.x.com|CNAME': ['selector1-x-com._domainkey.x.onmicrosoft.com'] };
  const r = await ec.checkDkim(fakeDns(zone), 'x.com', 'Microsoft 365');
  assert.strictEqual(r.status, 'fail');
  assert.match(r.summary, /not turned on/);
});

test('1024-bit DKIM is a warning', async () => {
  const r = await ec.checkDkim(fakeDns({ 'google._domainkey.x.com|TXT': t('v=DKIM1; k=rsa; p=' + KEY1024) }), 'x.com', 'Google Workspace');
  assert.strictEqual(r.status, 'warn');
  assert.strictEqual(r.selectors[0].bits, 1024);
});

test('DNS timeouts show as errors, not failures', async () => {
  const zone = { 'x.com|NS': ['ns'], 'x.com|MX': [{ exchange: 'mx.x.com', priority: 10 }], 'x.com|TXT': 'ETIMEOUT', '_dmarc.x.com|TXT': 'ESERVFAIL' };
  const r = await ec.runCheckup('x.com', { dns: fakeDns(zone) });
  assert.ok(r.partial);
  assert.strictEqual(r.checks.find(c => c.id === 'spf').status, 'error');
  assert.strictEqual(r.checks.find(c => c.id === 'dmarc').status, 'error');
});

test('null MX is recognised', async () => {
  const r = await ec.checkMx(fakeDns({ 'x.com|MX': [{ exchange: '', priority: 0 }] }), 'x.com');
  assert.ok(r.nullMx);
});

test('+all caps the grade at D', () => {
  const checks = [{ id: 'spf', records: ['v=spf1 +all'] }, { id: 'dmarc', records: ['v=DMARC1; p=reject'] }];
  assert.strictEqual(ec.gradeFor(80, checks), 'D');
});

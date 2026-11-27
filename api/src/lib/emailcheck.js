// Email security checkup: looks up a domain's MX, SPF, DKIM, DMARC, MTA-STS,
// TLS-RPT and BIMI records and turns them into a score, a letter grade and
// plain-English fixes. Kept free of Azure dependencies so it can be unit
// tested with `npm test`. DNS and HTTP are passed in, so tests use fakes.

const { domainToASCII } = require('node:url');

// Common DKIM selectors. Selectors can be any name, so "not found" here does
// not prove DKIM is off; the wording in the results says so.
const DKIM_SELECTORS = [
  'selector1', 'selector2',          // Microsoft 365
  'google',                          // Google Workspace
  'default', 'dkim', 'mail', 'smtp', // common generic names
  'k1', 'k2',                        // Mailchimp / Mandrill
  's1', 's2',                        // SendGrid and others
  'zmail',                           // Zoho
  'fm1',                             // Fastmail
  'protonmail',                      // Proton
];

const POINTS = { mx: 10, spf: 25, dkim: 20, dmarc: 35, extras: 10 }; // = 100
const SPF_LOOKUP_LIMIT = 10;
const MAX_SPF_QUERIES = 25; // our own safety cap while following includes

// ---------- input ----------

/** Turns "https://www.Example.com/path", "me@example.com" etc. into "example.com" style hostnames. */
function normalizeDomain(input) {
  if (typeof input !== 'string') return { error: 'Please enter a domain, like yourcompany.com.' };
  let d = input.trim().toLowerCase();
  if (!d) return { error: 'Please enter a domain, like yourcompany.com.' };
  if (d.length > 300) return { error: 'That domain is too long.' };
  if (d.includes('@')) d = d.slice(d.lastIndexOf('@') + 1);
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');  // scheme
  d = d.split(/[/?#\s]/)[0];                       // path, query, spaces
  d = d.replace(/:\d+$/, '').replace(/\.$/, '');   // port, trailing dot
  if (d.startsWith('www.')) d = d.slice(4);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d) || d.includes(':')) return { error: 'Please enter a domain name, not an IP address.' };
  const ascii = domainToASCII(d);
  if (!ascii) return { error: "That doesn't look like a valid domain." };
  const labels = ascii.split('.');
  const labelOk = l => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l);
  if (ascii.length > 253 || labels.length < 2 || !labels.every(labelOk) || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels.at(-1))) {
    return { error: "That doesn't look like a valid domain. Try something like yourcompany.com." };
  }
  return { domain: ascii };
}

// ---------- DNS helpers ----------

const NONE_CODES = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'ENONAME']);

/** Wraps a lookup: { records } on success, { none: true } when nothing exists, { error } otherwise. */
async function look(fn, name) {
  try {
    return { records: await fn(name) };
  } catch (err) {
    if (NONE_CODES.has(err.code)) return { none: true, nxdomain: err.code === 'ENOTFOUND' || err.code === 'NXDOMAIN' };
    return { error: err.code || 'ERROR' };
  }
}

const joinTxt = rec => (Array.isArray(rec) ? rec.join('') : String(rec));
async function txt(dns, name) {
  const r = await look(n => dns.resolveTxt(n), name);
  return r.records ? { records: r.records.map(joinTxt) } : r;
}

function parseTags(record) {
  const tags = {};
  for (const part of record.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    if (k && !(k in tags)) tags[k] = part.slice(i + 1).trim();
  }
  return tags;
}

// ---------- MX ----------

const PROVIDERS = [
  [/\.mail\.protection\.outlook\.com$|\.mx\.microsoft$/, 'Microsoft 365'],
  [/(^|\.)google(mail)?\.com$|\.smtp\.goog$/, 'Google Workspace'],
  [/pphosted\.com$|ppe-hosted\.com$/, 'Proofpoint'],
  [/mimecast\.com$/, 'Mimecast'],
  [/barracudanetworks\.com$/, 'Barracuda'],
  [/zoho\.(com|eu|in)$/, 'Zoho Mail'],
  [/secureserver\.net$/, 'GoDaddy'],
  [/messagingengine\.com$/, 'Fastmail'],
  [/protonmail\.ch$/, 'Proton Mail'],
  [/amazonaws\.com$|amazonses\.com$/, 'Amazon SES'],
  [/mailgun\.org$/, 'Mailgun'],
];

function detectProvider(hosts) {
  for (const h of hosts) for (const [re, name] of PROVIDERS) if (re.test(h)) return name;
  return hosts.length ? 'Other' : null;
}

async function checkMx(dns, domain) {
  const r = await look(n => dns.resolveMx(n), domain);
  const base = { id: 'mx', title: 'Mail servers (MX)', max: POINTS.mx };
  if (r.error) return { ...base, status: 'error', points: 0, summary: "We couldn't look up your mail servers right now. Try again in a minute." };
  const mx = (r.records || []).map(m => ({ host: String(m.exchange).toLowerCase().replace(/\.$/, ''), priority: m.priority })).sort((a, b) => a.priority - b.priority);
  if (mx.length === 1 && (mx[0].host === '' || mx[0].host === '.')) {
    return { ...base, status: 'info', points: POINTS.mx, provider: null, nullMx: true, records: [], summary: 'This domain says it never receives email (a "null MX"). Good for parked domains.' };
  }
  if (!mx.length) {
    return {
      ...base, status: 'fail', points: 0, provider: null, records: [],
      summary: "No mail servers found, so this domain can't receive email.",
      fix: { text: 'If this domain should get email, add the MX record your email provider gives you. For Microsoft 365, it looks like the one below (find your exact value in the Microsoft 365 admin center under Settings, Domains).', record: `${domain}.  MX  0  ${domain.replace(/\./g, '-')}.mail.protection.outlook.com` },
    };
  }
  const provider = detectProvider(mx.map(m => m.host));
  return {
    ...base, status: 'pass', points: POINTS.mx, provider, records: mx.map(m => `${m.priority} ${m.host}`),
    summary: provider && provider !== 'Other' ? `Email is handled by ${provider}.` : `Email is handled by ${mx[0].host}.`,
  };
}

// ---------- SPF ----------

/** Counts DNS-querying SPF terms, following include: and redirect= (the RFC 7208 limit is 10). */
async function countSpfLookups(dns, record, budget = { queries: 0 }, seen = new Set()) {
  let count = 0;
  const terms = record.split(/\s+/).slice(1);
  for (const raw of terms) {
    const t = raw.replace(/^[+\-~?]/, '').toLowerCase();
    const isInclude = t.startsWith('include:');
    const isRedirect = t.startsWith('redirect=');
    if (isInclude || isRedirect) {
      count++;
      const target = t.slice(isInclude ? 8 : 9);
      if (budget.includes) budget.includes.add(target);
      if (seen.has(target) || budget.queries >= MAX_SPF_QUERIES || target.includes('%')) continue;
      seen.add(target);
      budget.queries++;
      const r = await txt(dns, target);
      const sub = (r.records || []).find(x => /^v=spf1(\s|$)/i.test(x));
      if (sub) count += await countSpfLookups(dns, sub, budget, seen);
    } else if (/^(a|mx|ptr|exists)([:/]|$)/.test(t)) {
      count++;
    }
  }
  return count;
}

async function checkSpf(dns, domain, provider) {
  const base = { id: 'spf', title: 'SPF (who can send as you)', max: POINTS.spf };
  const r = await txt(dns, domain);
  if (r.error) return { ...base, status: 'error', points: 0, summary: "We couldn't look up SPF right now. Try again in a minute." };
  const spf = (r.records || []).filter(x => /^v=spf1(\s|$)/i.test(x.trim()));
  const suggested = provider === 'Microsoft 365' ? 'v=spf1 include:spf.protection.outlook.com -all'
    : provider === 'Google Workspace' ? 'v=spf1 include:_spf.google.com -all'
    : 'v=spf1 include:<your-email-provider> -all';
  const fixRecord = `${domain}.  TXT  "${suggested}"`;

  if (!spf.length) {
    return { ...base, status: 'fail', points: 0, summary: 'No SPF record. Anyone can claim to send email from your domain, and your real email is more likely to land in spam.', fix: { text: 'Add one TXT record at the root of your domain that lists who sends your email:', record: fixRecord } };
  }
  if (spf.length > 1) {
    return { ...base, status: 'fail', points: 5, records: spf, summary: `You have ${spf.length} SPF records. Only one is allowed, so receivers treat SPF as broken.`, fix: { text: 'Merge them into a single TXT record. For example:', record: fixRecord } };
  }

  const record = spf[0].trim();
  const allTerm = (record.match(/(?:^|\s)([+\-~?]?)all(?:\s|$)/i) || [])[1];
  const hasRedirect = /\sredirect=/i.test(record);
  const budget = { queries: 0, includes: new Set() };
  const lookups = await countSpfLookups(dns, record, budget);
  const notes = [];
  let points; let status; let summary; let fix;

  if (allTerm === '-') { points = 25; status = 'pass'; summary = 'SPF is set to hard fail (-all). Only the senders you listed can send as you.'; }
  else if (allTerm === '~') { points = 20; status = 'pass'; summary = 'SPF is set to soft fail (~all). That is a common setup and works well once DMARC is enforced.'; }
  else if (allTerm === '?') { points = 8; status = 'warn'; summary = 'SPF ends in ?all (neutral), which tells receivers nothing. It protects almost nothing.'; fix = { text: 'Change the ending to ~all or -all:', record: `${domain}.  TXT  "${record.replace(/(^|\s)\?all(?=\s|$)/i, '$1-all')}"` }; }
  else if (allTerm === '' || allTerm === '+') { points = 0; status = 'fail'; summary = 'SPF ends in +all, which lets every server on the internet send as you. This is worse than having no SPF.'; fix = { text: 'Replace +all with -all right away:', record: `${domain}.  TXT  "${record.replace(/(^|\s)\+?all(?=\s|$)/i, '$1-all')}"` }; }
  else if (hasRedirect) { points = 22; status = 'pass'; summary = 'SPF hands off to another record (redirect=), which is a valid setup.'; }
  else { points = 10; status = 'warn'; summary = 'SPF has no "all" at the end, so mail from unlisted servers is treated as neutral.'; fix = { text: 'Add -all (or ~all) to the end:', record: `${domain}.  TXT  "${record} -all"` }; }

  if (lookups > SPF_LOOKUP_LIMIT) {
    points = Math.min(points, 8); status = 'fail';
    notes.push(`SPF needs ${lookups} DNS lookups, over the limit of 10, so receivers treat it as broken (permerror).`);
    fix = { text: 'Remove services you no longer use, or replace include: entries with ip4:/ip6: ranges, to get under 10 lookups.' };
  } else {
    notes.push(`${lookups} of 10 allowed DNS lookups used.`);
  }
  if (provider === 'Microsoft 365' && !budget.includes.has('spf.protection.outlook.com') && !hasRedirect && budget.queries < MAX_SPF_QUERIES) {
    notes.push("Your mail runs on Microsoft 365, but SPF doesn't include spf.protection.outlook.com. Email you send may fail SPF.");
    if (status === 'pass') status = 'warn';
    points = Math.max(0, points - 8);
    fix = fix || { text: 'Add Microsoft 365 to your SPF record:', record: `${domain}.  TXT  "${record.replace(/^v=spf1/i, 'v=spf1 include:spf.protection.outlook.com')}"` };
  }
  return { ...base, status, points, records: [record], lookups, notes, summary, fix };
}

// ---------- DKIM ----------

function dkimKeyInfo(record) {
  const tags = parseTags(record);
  const p = (tags.p ?? '').replace(/\s+/g, '');
  if (!('p' in tags)) return null;
  if (!p) return { revoked: true };
  const type = (tags.k || 'rsa').toLowerCase();
  const bytes = Math.floor(p.replace(/=+$/, '').length * 3 / 4);
  // An RSA public key (SubjectPublicKeyInfo) is about 162 bytes at 1024 bits and 294 at 2048.
  const bits = type === 'rsa' ? (bytes < 200 ? 1024 : bytes < 400 ? 2048 : 4096) : 256;
  return { type, bits };
}

async function checkDkim(dns, domain, provider, noMail = false) {
  const base = { id: 'dkim', title: 'DKIM (tamper-proof signature)', max: POINTS.dkim };
  const results = await Promise.all(DKIM_SELECTORS.map(async sel => {
    const name = `${sel}._domainkey.${domain}`;
    const [t, c] = await Promise.all([
      txt(dns, name),
      sel.startsWith('selector') && dns.resolveCname ? look(n => dns.resolveCname(n), name) : Promise.resolve({ none: true }),
    ]);
    const rec = (t.records || []).find(x => /(^|;)\s*(v=DKIM1|k=|p=)/i.test(x));
    return { sel, rec, cname: c.records?.[0], error: t.error };
  }));

  const found = results.filter(r => r.rec).map(r => ({ selector: r.sel, ...dkimKeyInfo(r.rec) })).filter(r => r.type || r.revoked);
  const active = found.filter(f => !f.revoked);
  const danglingM365 = results.filter(r => r.cname && !r.rec);
  const m365Fix = {
    text: 'Turn on DKIM in Microsoft Defender: go to security.microsoft.com, then Email & collaboration, Policies & rules, Threat policies, Email authentication settings, DKIM. Pick your domain, publish the two CNAME records it shows you, then switch "Sign messages for this domain with DKIM signatures" on.',
  };

  if (active.length) {
    const weak = active.filter(a => a.type === 'rsa' && a.bits < 2048);
    if (weak.length) {
      return { ...base, status: 'warn', points: 15, selectors: active, summary: `DKIM signing is on, but ${weak.length > 1 ? `${weak.length} keys are` : 'one key is'} only 1024-bit. Microsoft and Google recommend 2048-bit.`, fix: { text: provider === 'Microsoft 365' ? 'In Defender, open your domain under DKIM and choose "Rotate DKIM keys" to move to 2048-bit keys.' : 'Ask your email provider to rotate to a 2048-bit DKIM key.' } };
    }
    return { ...base, status: 'pass', points: POINTS.dkim, selectors: active, summary: `DKIM signing is set up with ${active.length === 1 ? 'a strong key' : `${active.length} strong keys`}. Receivers can tell your email really came from you and wasn't changed.` };
  }
  if (danglingM365.length) {
    return { ...base, status: 'fail', points: 4, summary: 'The Microsoft 365 DKIM records are in DNS, but signing is not turned on, so your email goes out unsigned.', fix: m365Fix };
  }
  if (noMail) {
    return { ...base, status: 'pass', points: POINTS.dkim, summary: "This domain is set up to never send or receive email, so it doesn't need DKIM." };
  }
  if (results.every(r => r.error)) {
    return { ...base, status: 'error', points: 0, summary: "We couldn't look up DKIM right now. Try again in a minute." };
  }
  return {
    ...base, status: 'fail', points: 0,
    summary: "We didn't find a DKIM key at any common selector. Your provider may use a custom name, but most small business setups use one we check.",
    fix: provider === 'Microsoft 365' ? m365Fix
      : provider === 'Google Workspace' ? { text: 'In the Google Admin console go to Apps, Google Workspace, Gmail, Authenticate email. Generate a 2048-bit key, add the TXT record it shows, then click Start authentication.' }
      : { text: 'Turn on DKIM signing in your email provider and publish the TXT or CNAME records they give you.' },
  };
}

// ---------- DMARC ----------

async function checkDmarc(dns, domain) {
  const base = { id: 'dmarc', title: 'DMARC (what to do with fakes)', max: POINTS.dmarc };
  let where = domain;
  let r = await txt(dns, `_dmarc.${domain}`);
  let inherited = false;
  const labels = domain.split('.');
  if (!r.error && !(r.records || []).some(x => /^v=DMARC1/i.test(x)) && labels.length > 2) {
    where = labels.slice(-2).join('.');
    const parent = await txt(dns, `_dmarc.${where}`);
    if ((parent.records || []).some(x => /^v=DMARC1/i.test(x))) { r = parent; inherited = true; }
    else where = domain;
  }
  if (r.error) return { ...base, status: 'error', points: 0, summary: "We couldn't look up DMARC right now. Try again in a minute." };

  const startRecord = `_dmarc.${domain}.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}"`;
  const dmarc = (r.records || []).filter(x => /^v=DMARC1/i.test(x.trim()));
  if (!dmarc.length) {
    return { ...base, status: 'fail', points: 0, summary: "No DMARC record. Receivers have no instructions for email that fakes your domain, so spoofed email often gets delivered.", fix: { text: 'Start in monitor mode with this TXT record, read the reports for 2 to 4 weeks, then move to p=quarantine and finally p=reject:', record: startRecord } };
  }
  if (dmarc.length > 1) {
    return { ...base, status: 'fail', points: 5, records: dmarc, summary: `You have ${dmarc.length} DMARC records. Only one is allowed, so receivers ignore DMARC.`, fix: { text: 'Delete the extras and keep a single TXT record at _dmarc.', record: startRecord } };
  }

  const record = dmarc[0].trim();
  const tags = parseTags(record);
  const p = (tags.p || '').toLowerCase();
  const sp = (tags.sp || '').toLowerCase();
  const pct = tags.pct === undefined ? 100 : Number(tags.pct);
  const notes = [];
  if (inherited) notes.push(`Inherited from ${where}.`);
  let points; let status; let summary; let fix;
  const addRua = rec => (tags.rua ? rec : `${rec.replace(/;\s*$/, '')}; rua=mailto:dmarc-reports@${where}`);
  const withPolicy = pol => `_dmarc.${where}.  TXT  "${addRua(record.replace(/(;\s*|^)p\s*=\s*\w+/i, `$1p=${pol}`))}"`;

  if (p === 'reject') { points = 35; status = 'pass'; summary = 'DMARC is set to reject. Email that fakes your domain gets blocked. This is the gold standard.'; }
  else if (p === 'quarantine') { points = 28; status = 'pass'; summary = 'DMARC is set to quarantine. Fakes go to spam. One step from the strongest setting.'; fix = { text: 'When your reports look clean, move to p=reject:', record: withPolicy('reject') }; }
  else if (p === 'none') { points = 12; status = 'warn'; summary = 'DMARC is in monitor-only mode (p=none). You get reports, but fake email using your domain is still delivered.'; fix = { text: 'Once your real senders pass, move to p=quarantine, then p=reject:', record: withPolicy('quarantine') }; }
  else { points = 5; status = 'fail'; summary = 'DMARC record is missing a valid p= policy, so receivers ignore it.'; fix = { text: 'Fix the record so it has a policy:', record: startRecord }; }

  if (p === 'reject' || p === 'quarantine') {
    if (Number.isFinite(pct) && pct < 100) {
      points -= 6; status = 'warn';
      notes.push(`pct=${pct} means the policy only applies to ${pct}% of failing email.`);
      fix = fix || { text: 'Raise pct to 100 (or remove it):', record: `_dmarc.${where}.  TXT  "${record.replace(/;\s*pct\s*=\s*\d+/i, '')}"` };
    }
    if (sp === 'none') { points -= 4; notes.push('sp=none leaves your subdomains unprotected.'); }
  }
  if (!tags.rua) {
    points = Math.max(0, points - 3);
    notes.push('No rua= address, so you get no reports showing who sends as you.');
  } else {
    notes.push(`Reports go to ${tags.rua.replace(/mailto:/gi, '')}.`);
  }
  return { ...base, status, points: Math.max(0, points), records: [record], policy: p || null, notes, summary, fix };
}

// ---------- extras: MTA-STS, TLS-RPT, BIMI ----------

async function checkExtras(dns, domain, fetchText) {
  const [sts, rpt, bimi] = await Promise.all([
    txt(dns, `_mta-sts.${domain}`),
    txt(dns, `_smtp._tls.${domain}`),
    txt(dns, `default._bimi.${domain}`),
  ]);
  const items = [];
  let points = 0;

  const stsRec = (sts.records || []).find(x => /^v=STSv1/i.test(x));
  let mode = null;
  if (stsRec && fetchText) {
    const body = await fetchText(`https://mta-sts.${domain}/.well-known/mta-sts.txt`).catch(() => null);
    mode = body ? ((body.match(/^\s*mode\s*:\s*(\w+)/im) || [])[1] || '').toLowerCase() || null : null;
  }
  if (stsRec && mode === 'enforce') { points += 5; items.push({ name: 'MTA-STS', status: 'pass', text: 'Enforced. Mail to you must use encrypted, verified connections.' }); }
  else if (stsRec && mode === 'testing') { points += 3; items.push({ name: 'MTA-STS', status: 'warn', text: 'In testing mode. Switch the policy to mode: enforce when your TLS reports look clean.' }); }
  else if (stsRec) { points += 1; items.push({ name: 'MTA-STS', status: 'warn', text: "DNS record found, but we couldn't read an active policy file at mta-sts." + domain + '.' }); }
  else items.push({ name: 'MTA-STS', status: 'info', text: 'Not set up. MTA-STS stops attackers from downgrading mail to you to unencrypted connections.' });

  if ((rpt.records || []).some(x => /^v=TLSRPTv1/i.test(x))) { points += 2; items.push({ name: 'TLS-RPT', status: 'pass', text: 'On. You get reports when mail to you has encryption problems.' }); }
  else items.push({ name: 'TLS-RPT', status: 'info', text: 'Not set up. A one-line TXT record gets you reports about mail encryption problems.' });

  if ((bimi.records || []).some(x => /^v=BIMI1/i.test(x))) { points += 3; items.push({ name: 'BIMI', status: 'pass', text: 'Set up. Supporting inboxes can show your logo next to your email.' }); }
  else items.push({ name: 'BIMI', status: 'info', text: 'Not set up. BIMI shows your logo in Gmail, Yahoo and Apple Mail, but needs DMARC at quarantine or reject first.' });

  points = Math.min(points, POINTS.extras);
  return {
    id: 'extras', title: 'Bonus protections', max: POINTS.extras, points, items,
    status: points >= 7 ? 'pass' : 'info',
    summary: points >= 7 ? 'Advanced protections are in place. Nice work.' : 'Extra credit. These are nice to have once SPF, DKIM and DMARC are solid.',
  };
}

// ---------- grade ----------

function gradeFor(score, checks) {
  let g = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  const spf = checks.find(c => c.id === 'spf');
  const dmarc = checks.find(c => c.id === 'dmarc');
  // Wide-open SPF or no DMARC at all caps the grade, whatever else is in place.
  if (spf?.records?.[0] && /(^|\s)\+?all(\s|$)/i.test(spf.records[0]) && !/[-~?]all/i.test(spf.records[0])) g = g < 'D' ? 'D' : g;
  if (dmarc && !dmarc.records && dmarc.status === 'fail' && g < 'C') g = 'C';
  if (score >= 97 && g === 'A') g = 'A+';
  return g;
}

const HEADLINES = {
  'A+': 'Locked down. Your domain is a hard target for spoofers.',
  A: 'Excellent. Your email is well protected.',
  B: 'Good, with a few gaps worth closing.',
  C: 'Some protection, but spoofers still have room to work.',
  D: 'Weak. Your domain is easy to impersonate.',
  F: 'Wide open. Anyone can send email as you.',
};

/** Runs the whole checkup. `dns` is node:dns/promises-like; `fetchText(url)` returns a string or throws. */
async function runCheckup(domain, { dns, fetchText } = {}) {
  const exists = await look(n => dns.resolveNs(n), domain);
  const mx = await checkMx(dns, domain);
  if (exists.nxdomain && !mx.records?.length) {
    // NS lookups on a subdomain return ENODATA, not ENOTFOUND, so only a true NXDOMAIN ends here.
    return { ok: false, notFound: true, domain, error: `We couldn't find ${domain}. Check the spelling and try again.` };
  }
  const [spf, dkim, dmarc, extras] = await Promise.all([
    checkSpf(dns, domain, mx.provider),
    checkDkim(dns, domain, mx.provider, mx.nullMx),
    checkDmarc(dns, domain),
    checkExtras(dns, domain, fetchText),
  ]);
  const checks = [mx, spf, dkim, dmarc, extras];
  const score = Math.round(checks.reduce((s, c) => s + (c.points || 0), 0));
  const grade = gradeFor(score, checks);
  const anyError = checks.some(c => c.status === 'error');
  return {
    ok: true, domain, provider: mx.provider || null, score, grade, headline: HEADLINES[grade],
    partial: anyError, checkedAt: new Date().toISOString(), checks,
  };
}

module.exports = { normalizeDomain, runCheckup, checkSpf, checkDmarc, checkDkim, checkMx, checkExtras, countSpfLookups, dkimKeyInfo, gradeFor, DKIM_SELECTORS, POINTS };

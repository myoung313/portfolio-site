// Builds the public /guides pages and the Ask Shift knowledge base from content/guides/*.md.
//   node scripts/build-guides.js          (writes the files)
//   node scripts/build-guides.js --check  (fails if the committed output is out of date; used in CI)
//
// Each guide is Markdown with a small front matter block (title, summary). Every "## " section
// becomes one searchable chunk, so keep sections focused on one idea.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'content', 'guides');
const SITE = path.join(ROOT, 'site', 'guides');
const CHUNKS = path.join(ROOT, 'api', 'src', 'data', 'guide-chunks.json');

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function parseGuide(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map(l => {
    const i = l.indexOf(':');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
  if (!meta.title || !meta.summary) throw new Error(`${file}: title and summary are required`);
  const slug = path.basename(file, '.md');
  const sections = [];
  let cur = null;
  for (const line of m[2].split('\n')) {
    const h = line.match(/^## (.+)/);
    if (h) { cur = { heading: h[1].trim(), anchor: slugify(h[1]), lines: [] }; sections.push(cur); continue; }
    if (!cur) { if (line.trim()) throw new Error(`${file}: text before the first ## heading`); continue; }
    cur.lines.push(line);
  }
  if (!sections.length) throw new Error(`${file}: no ## sections`);
  return { slug, ...meta, sections };
}

// Tiny Markdown subset: paragraphs, "- " bullets, "1. " numbered lists.
function mdToHtml(lines) {
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) out.push(`<p>${esc(para.join(' '))}</p>`); para = []; };
  const closeList = () => { if (list) out.push(`</${list}>`); list = null; };
  for (const line of lines) {
    const ul = line.match(/^- (.+)/), ol = line.match(/^\d+\. (.+)/);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${esc((ul || ol)[1])}</li>`);
    } else if (!line.trim()) { flushPara(); closeList(); }
    else { closeList(); para.push(line.trim()); }
  }
  flushPara(); closeList();
  return out.join('\n');
}

const plain = lines => lines.join('\n').replace(/\n{2,}/g, '\n').trim();

const STYLE = `
    :root { --navy:#141C33; --navy2:#1B2440; --card:#232E52; --line:#2F3B63; --gold:#F5B700; --text:#E8ECF5; --muted:#A9B2C8; }
    * { box-sizing:border-box; margin:0; padding:0; }
    html { background:var(--navy); }
    body { font-family:"Segoe UI", system-ui, -apple-system, sans-serif; background:var(--navy) radial-gradient(ellipse 1200px 800px at top, #24305a 0%, var(--navy) 70%) no-repeat; color:var(--text); min-height:100vh; line-height:1.65; }
    a { color:var(--gold); text-decoration:none; }
    nav { display:flex; justify-content:space-between; align-items:center; gap:12px; max-width:960px; margin:0 auto; padding:18px 20px; }
    .logo { font-weight:700; letter-spacing:.04em; color:var(--text); white-space:nowrap; }
    .logo span { color:var(--gold); }
    nav .links { display:flex; gap:18px; font-size:.92rem; }
    nav .links a { color:var(--muted); white-space:nowrap; }
    @media (max-width:560px) { nav .links a.hide-sm { display:none; } }
    main { max-width:760px; margin:0 auto; padding:20px 20px 70px; }
    .eyebrow { color:var(--gold); font-weight:600; letter-spacing:.14em; text-transform:uppercase; font-size:.8rem; }
    h1 { font-size:clamp(1.8rem, 5vw, 2.6rem); line-height:1.15; margin:10px 0 10px; }
    .lead { color:var(--muted); font-size:1.08rem; margin-bottom:22px; }
    h2 { font-size:1.3rem; margin:30px 0 8px; scroll-margin-top:20px; }
    p, li { color:#D5DBEA; }
    p { margin:0 0 12px; }
    ul, ol { margin:0 0 14px 22px; }
    li { margin:4px 0; }
    .note { background:rgba(245,183,0,.08); border:1px solid rgba(245,183,0,.35); color:#F3DFA2; border-radius:12px; padding:10px 14px; font-size:.86rem; margin:28px 0 0; }
    .ask { display:flex; gap:14px; align-items:center; justify-content:space-between; flex-wrap:wrap; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 18px; margin-top:22px; }
    .btn { display:inline-block; font-weight:600; background:var(--gold); color:var(--navy); padding:10px 18px; border-radius:10px; }
    .cards { display:grid; gap:12px; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); margin-top:10px; }
    .cards a { display:block; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; color:var(--text); transition:border-color .15s, transform .15s; }
    .cards a:hover { border-color:var(--gold); transform:translateY(-2px); }
    .cards b { display:block; margin-bottom:4px; }
    .cards span { color:var(--muted); font-size:.9rem; }
    footer { text-align:center; color:var(--muted); font-size:.8rem; padding:20px; }`;

const page = ({ title, description, canonical, body }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} | CloudShift Labs</title>
  <link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/assets/brand/favicon-32.png" sizes="32x32" type="image/png" />
  <link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png" />
  <link rel="canonical" href="https://cloudshiftlabs.net${canonical}" />
  <meta name="theme-color" content="#141C33" />
  <meta name="description" content="${esc(description)}" />
  <meta property="og:site_name" content="CloudShift Labs" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="https://cloudshiftlabs.net/assets/brand/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>${STYLE}
  </style>
</head>
<body>
  <!-- Generated by api/scripts/build-guides.js from content/guides. Edit the Markdown, not this file. -->
  <nav>
    <a href="/" class="logo">CLOUDSHIFT <span>LABS</span></a>
    <div class="links">
      <a href="/guides/" class="hide-sm">📚 Guides</a>
      <a href="/ask/">💡 Ask Shift</a>
      <a href="/#contact">Contact</a>
    </div>
  </nav>
  <main>
${body}
  </main>
  <footer>© CloudShift Labs · <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a></footer>
</body>
</html>
`;

const NOTE = '<div class="note">⚠️ General security education for small businesses, not legal, insurance or compliance advice. Microsoft changes menus and features often, so check Microsoft\'s documentation if a step looks different.</div>';

function guidePage(g) {
  const sections = g.sections.map(s => `    <h2 id="${s.anchor}">${esc(s.heading)}</h2>\n${mdToHtml(s.lines)}`).join('\n');
  return page({
    title: g.title, description: g.summary, canonical: `/guides/${g.slug}/`,
    body: `    <div class="eyebrow"><a href="/guides/">Security guides</a></div>
    <h1>${esc(g.title)}</h1>
    <p class="lead">${esc(g.summary)}</p>
${sections}
    <div class="ask"><span>Still stuck? Ask Shift, the free AI assistant that answers from these guides.</span><a class="btn" href="/ask/">💡 Ask Shift</a></div>
    ${NOTE}`,
  });
}

function indexPage(guides) {
  const cards = guides.map(g => `      <a href="/guides/${g.slug}/"><b>${esc(g.title)}</b><span>${esc(g.summary)}</span></a>`).join('\n');
  return page({
    title: 'Security guides for small businesses', canonical: '/guides/',
    description: 'Short, plain-English Microsoft 365 and cloud security guides for small businesses.',
    body: `    <div class="eyebrow">Free security guides</div>
    <h1>Security guides for small businesses</h1>
    <p class="lead">Short, plain-English how-tos for Microsoft 365 and cloud security. They also power <a href="/ask/">Ask Shift</a>, the free AI assistant.</p>
    <div class="cards">
${cards}
    </div>
    ${NOTE}`,
  });
}

function build() {
  const guides = fs.readdirSync(SRC).filter(f => f.endsWith('.md')).sort().map(f => parseGuide(path.join(SRC, f)));
  const files = new Map();
  files.set(path.join(SITE, 'index.html'), indexPage(guides));
  const chunks = [];
  for (const g of guides) {
    files.set(path.join(SITE, g.slug, 'index.html'), guidePage(g));
    g.sections.forEach((s, i) => chunks.push({
      id: `${g.slug}-${i + 1}`, slug: g.slug, title: g.title, heading: s.heading,
      url: `/guides/${g.slug}/#${s.anchor}`, content: plain(s.lines),
    }));
  }
  files.set(CHUNKS, JSON.stringify(chunks, null, 1) + '\n');
  return { guides, chunks, files };
}

if (require.main === module) {
  const { guides, chunks, files } = build();
  if (process.argv.includes('--check')) {
    const stale = [...files].filter(([f, body]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== body).map(([f]) => path.relative(ROOT, f));
    if (stale.length) { console.error('Out of date, run: node api/scripts/build-guides.js\n  ' + stale.join('\n  ')); process.exit(1); }
    console.log(`Guides up to date (${guides.length} guides, ${chunks.length} sections)`);
  } else {
    for (const [f, body] of files) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); }
    console.log(`Built ${guides.length} guides, ${chunks.length} sections`);
  }
}

module.exports = { build, parseGuide, mdToHtml };

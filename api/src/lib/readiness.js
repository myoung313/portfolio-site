// Cyber insurance readiness: the questionnaire, scoring and fix list.
// Kept free of Azure dependencies so it can be unit tested with `npm test`.
// The portal page loads QUESTIONS from the API, so this file is the single
// source of truth for wording, weights and fixes.

// Option shorthand: [value, label, points 0..1]. Points null = not applicable
// (left out of the score). "unsure" scores 0 and is flagged "find out".
const yesNo = (yes = 'Yes', no = 'No') => [['yes', yes, 1], ['no', no, 0], ['unsure', "I'm not sure", 0]];

// effort: quick (days), medium (weeks), project (a month or more)
// service: which CloudShift Labs service fixes it (matches the site's service cards)
const SECTIONS = [
  {
    id: 'mfa', title: 'Multi-factor authentication', icon: '🔐', weight: 20,
    intro: 'The first thing almost every insurer asks. Missing MFA is the most common reason for a declined application.',
    questions: [
      { id: 'mfa_email', critical: true, weight: 3, effort: 'quick', service: 'Zero Trust Identity',
        q: 'Is MFA required for everyone who signs in to email?',
        help: 'Microsoft 365 or Google Workspace, including on phones.',
        options: [['all', 'Yes, every user', 1], ['most', 'Most users, a few exceptions', 0.4], ['admins', 'Only admins', 0.15], ['no', 'No', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Require MFA for every user with Conditional Access (or Security Defaults on smaller plans). Remove exceptions or document why each one exists.' },
      { id: 'mfa_remote', critical: true, weight: 3, effort: 'quick', service: 'Zero Trust Identity',
        q: 'Is MFA required for remote access to your network or computers?',
        help: 'VPN, Remote Desktop, remote support tools and cloud admin portals.',
        options: [['yes', 'Yes, on all remote access', 1], ['some', 'On some of it', 0.3], ['none', "We don't allow remote access", null], ['no', 'No', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Put MFA in front of every remote entry point. Close Remote Desktop to the internet and use a VPN or Azure Virtual Desktop with MFA instead.' },
      { id: 'mfa_admin', critical: true, weight: 3, effort: 'quick', service: 'Zero Trust Identity',
        q: 'Is MFA required on every admin and privileged account?',
        help: 'Microsoft 365 admins, domain admins, firewall, backup and banking portals.',
        options: yesNo('Yes, all of them'),
        fix: 'Enforce MFA on every admin role, and use phishing-resistant methods (passkeys or security keys) for global admins.' },
      { id: 'mfa_type', weight: 1, effort: 'medium', service: 'Zero Trust Identity',
        q: 'What kind of MFA do most people use?',
        options: [['phr', 'Passkeys, security keys or Windows Hello', 1], ['app', 'Authenticator app with number matching', 0.8], ['sms', 'Text message or phone call', 0.3], ['unsure', "I'm not sure", 0]],
        fix: 'Move people off text-message codes to the Microsoft Authenticator app with number matching, then to passkeys for admins.' },
    ],
  },
  {
    id: 'backup', title: 'Backups and recovery', icon: '💾', weight: 18,
    intro: 'Insurers want proof you can recover from ransomware without paying. That means a copy attackers cannot reach.',
    questions: [
      { id: 'bk_freq', weight: 2, effort: 'medium', service: 'M365 Security Assessment',
        q: 'How often is your critical business data backed up?',
        options: [['daily', 'Daily or more often', 1], ['weekly', 'Weekly', 0.5], ['rare', 'Less often than weekly', 0.2], ['no', "We don't back up", 0], ['unsure', "I'm not sure", 0]],
        fix: 'Back up critical systems at least daily, and set up alerts when a backup fails.' },
      { id: 'bk_offline', critical: true, weight: 3, effort: 'medium', service: 'M365 Security Assessment',
        q: 'Is at least one backup copy offline, immutable, or protected by separate sign-in details?',
        help: 'If ransomware got your admin password, could it delete the backups too?',
        options: [['yes', 'Yes, immutable or offline', 1], ['separate', 'Separate account, but not immutable', 0.6], ['no', 'No, same network and sign-in', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Keep one copy immutable or offline, with its own MFA-protected sign-in that is not tied to your main admin accounts (the 3-2-1-1 rule).' },
      { id: 'bk_cloud', weight: 1.5, effort: 'quick', service: 'M365 Security Assessment',
        q: 'Is your Microsoft 365 or Google Workspace data (mail, OneDrive, SharePoint) backed up separately?',
        help: 'Microsoft and Google keep the service running, but recovering deleted or encrypted data is your job.',
        options: [['yes', 'Yes, with a backup product', 1], ['retention', 'Only retention policies or the recycle bin', 0.3], ['no', 'No', 0], ['na', "We don't use either", null], ['unsure', "I'm not sure", 0]],
        fix: 'Add a third-party or Microsoft 365 Backup service for Exchange, OneDrive, SharePoint and Teams.' },
      { id: 'bk_test', weight: 1.5, effort: 'quick', service: 'M365 Security Assessment',
        q: 'Have you tested restoring from backup in the last 12 months?',
        options: [['yes', 'Yes, and we wrote down the result', 1], ['informal', 'Yes, informally', 0.6], ['no', 'No', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Run a test restore of one key system, time how long it takes, and save the result as evidence for your insurer.' },
    ],
  },
  {
    id: 'endpoint', title: 'Endpoint protection (EDR)', icon: '💻', weight: 15,
    intro: 'Basic antivirus is no longer enough for most carriers. They ask for EDR: protection that detects and stops attacks in progress.',
    questions: [
      { id: 'edr', critical: true, weight: 3, effort: 'medium', service: 'Device Management (Intune)',
        q: 'What protects your computers and servers?',
        help: 'Examples of EDR: Microsoft Defender for Business or Endpoint, CrowdStrike, SentinelOne, Sophos Intercept X.',
        options: [['edr', 'EDR on every computer and server', 1], ['partial', 'EDR on some devices', 0.4], ['av', 'Regular antivirus only', 0.15], ['none', 'Nothing', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Deploy EDR to every device. Defender for Business is included in Microsoft 365 Business Premium, so many small businesses already pay for it.' },
      { id: 'mdr', weight: 1.5, effort: 'medium', service: 'Device Management (Intune)',
        q: 'Does someone watch and respond to security alerts around the clock?',
        options: [['mdr', 'Yes, an MDR or SOC service, 24/7', 1], ['business', 'During business hours only', 0.5], ['no', 'No one is watching', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Add a managed detection and response (MDR) service, or at least route EDR alerts to someone who will act on them.' },
      { id: 'dev_managed', weight: 1.5, effort: 'medium', service: 'Device Management (Intune)',
        q: 'Are company laptops and phones managed and encrypted?',
        help: 'For example with Intune, with BitLocker or FileVault turned on.',
        options: [['yes', 'Yes, all managed and encrypted', 1], ['some', 'Some of them', 0.4], ['no', 'No', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Enroll devices in Intune, require encryption and a screen lock, and block access from devices that are not compliant.' },
    ],
  },
  {
    id: 'email', title: 'Email security', icon: '✉️', weight: 12,
    intro: 'Most claims start with an email. Insurers ask about filtering, and many check your domain records themselves.',
    questions: [
      { id: 'em_filter', weight: 2, effort: 'quick', service: 'Email Security & DMARC',
        q: 'Do you use advanced email filtering?',
        help: 'For example Defender for Office 365, Mimecast, Proofpoint or Avanan, with link and attachment scanning.',
        options: [['yes', 'Yes', 1], ['basic', 'Only the built-in basic filter', 0.4], ['no', 'No', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Turn on Safe Links and Safe Attachments (Defender for Office 365 Plan 1, included in Business Premium), and tag external senders.' },
      { id: 'em_auth', auto: true, weight: 2, effort: 'quick', service: 'Email Security & DMARC',
        q: 'Domain email protection (SPF, DKIM and DMARC)',
        help: 'Checked automatically with the CloudShift email checkup when you submit.',
        fix: 'Fix the SPF, DKIM and DMARC gaps from your email checkup, then move DMARC to quarantine or reject.' },
      { id: 'em_macros', weight: 1, effort: 'quick', service: 'Device Management (Intune)',
        q: 'Are Office macros from the internet blocked?',
        options: yesNo('Yes, blocked by policy'),
        fix: 'Block macros in files from the internet with an Intune or Group Policy setting.' },
    ],
  },
  {
    id: 'patching', title: 'Patching and old systems', icon: '🩹', weight: 10,
    intro: 'Carriers ask how fast you patch and whether anything runs past end of support.',
    questions: [
      { id: 'patch_speed', weight: 2, effort: 'medium', service: 'Device Management (Intune)',
        q: 'How quickly are critical security updates installed?',
        options: [['14', 'Within 14 days', 1], ['30', 'Within 30 days', 0.7], ['slow', 'Longer than 30 days', 0.2], ['none', 'There is no process', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Use Windows Update for Business (Intune update rings) so critical patches install within 14 days, and track exceptions.' },
      { id: 'patch_eol', weight: 2, effort: 'project', service: 'M365 Security Assessment',
        q: 'Do you run any systems that no longer get security updates?',
        help: 'For example Windows 10 after October 2025, Windows Server 2012, or old firewalls.',
        options: [['none', 'No, everything is supported', 1], ['isolated', 'A few, but they are isolated from the network', 0.5], ['yes', 'Yes', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Upgrade or replace unsupported systems. Until then, isolate them from the internet and the rest of the network.' },
      { id: 'vuln_scan', weight: 1, effort: 'medium', service: 'M365 Security Assessment',
        q: 'Do you scan for vulnerabilities at least every quarter?',
        options: yesNo('Yes'),
        fix: 'Turn on Defender Vulnerability Management or a scanner, and review the top findings monthly.' },
    ],
  },
  {
    id: 'privileged', title: 'Admin and privileged access', icon: '🗝️', weight: 10,
    intro: 'Attackers go after admin accounts first. Insurers want admin rights kept separate and few.',
    questions: [
      { id: 'pa_separate', weight: 2, effort: 'quick', service: 'Zero Trust Identity',
        q: 'Do admins use a separate account for admin work (not their everyday email account)?',
        options: yesNo('Yes'),
        fix: 'Create separate cloud-only admin accounts with no mailbox, and remove admin roles from everyday accounts.' },
      { id: 'pa_local', weight: 1.5, effort: 'medium', service: 'Device Management (Intune)',
        q: 'Are regular users kept out of the local administrator group on their computers?',
        options: yesNo('Yes, users are not local admins'),
        fix: 'Remove local admin rights and use Windows LAPS for the built-in admin password.' },
      { id: 'pa_count', weight: 1, effort: 'quick', service: 'Zero Trust Identity',
        q: 'How many people have global or domain admin rights?',
        options: [['2-4', '2 to 4', 1], ['1', 'Just 1 (no backup admin)', 0.6], ['5+', '5 or more', 0.3], ['unsure', "I'm not sure", 0]],
        fix: 'Keep 2 to 4 global admins, plus one break-glass account stored safely. Use least-privilege roles (or PIM) for everyone else.' },
    ],
  },
  {
    id: 'ir', title: 'Incident response', icon: '🚨', weight: 6,
    intro: 'When something goes wrong, the first hours matter. Insurers ask whether you have a plan.',
    questions: [
      { id: 'ir_plan', weight: 2, effort: 'medium', service: 'M365 Security Assessment',
        q: 'Do you have a written incident response plan?',
        options: [['tested', 'Yes, and we practiced it this year', 1], ['written', 'Yes, but we have not practiced it', 0.6], ['no', 'No', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Write a short plan: who decides, who to call (insurer hotline first), how to isolate devices. Then run a one-hour tabletop exercise.' },
      { id: 'ir_logs', weight: 1, effort: 'quick', service: 'M365 Security Assessment',
        q: 'Are sign-in and audit logs kept for at least 90 days?',
        options: yesNo('Yes'),
        fix: 'Confirm Microsoft 365 audit logging is on, and send sign-in logs to a Log Analytics workspace or your SIEM for longer retention.' },
    ],
  },
  {
    id: 'training', title: 'People and payments', icon: '🎓', weight: 6,
    intro: 'Phishing and fake invoices cause many claims. Insurers ask about training and how you verify payment changes.',
    questions: [
      { id: 'tr_training', weight: 1.5, effort: 'quick', service: 'M365 Security Assessment',
        q: 'Does everyone get security awareness training at least once a year?',
        options: [['yes', 'Yes, with phishing simulations', 1], ['training', 'Training, but no simulations', 0.6], ['no', 'No', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Run yearly training plus monthly phishing simulations (Defender Attack Simulation Training is in many M365 plans).' },
      { id: 'tr_wire', weight: 2, effort: 'quick', service: 'M365 Security Assessment',
        q: 'Before paying a new bank account or a changed one, do you call to verify on a known number?',
        help: 'Insurers often limit "social engineering" fraud cover unless you do this.',
        options: [['yes', 'Yes, always, and it is written down', 1], ['informal', 'Usually, but it is not a written rule', 0.5], ['no', 'No', 0], ['unsure', "I'm not sure", 0]],
        fix: 'Write a one-paragraph payment verification rule: any new or changed bank details get a call-back on a number you already had.' },
    ],
  },
  {
    id: 'vendors', title: 'Vendors and third parties', icon: '🤝', weight: 3,
    intro: 'IT providers and software vendors with access to your systems are a common way in.',
    questions: [
      { id: 'vd_access', weight: 1.5, effort: 'quick', service: 'Zero Trust Identity',
        q: 'Do vendors who access your systems (like an IT provider) use MFA, and do you review their access?',
        options: [['yes', 'Yes, both', 1], ['mfa', 'They use MFA, but we do not review access', 0.6], ['no', 'No', 0], ['na', 'No vendors have access', null], ['unsure', "I'm not sure", 0]],
        fix: 'Require MFA for every vendor account, give them only the access they need, and review the list every quarter.' },
      { id: 'vd_list', weight: 1, effort: 'quick', service: 'M365 Security Assessment',
        q: 'Do you keep a list of vendors that hold your data or connect to your systems?',
        options: yesNo('Yes'),
        fix: 'List every vendor with access to your data or systems, what they can reach, and who to contact in an incident.' },
    ],
  },
];

const QUESTIONS = SECTIONS.flatMap(s => s.questions.map(q => ({ ...q, section: s.id })));
const BY_ID = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));

// Business basics collected at the start (not scored).
const PROFILE_FIELDS = {
  company: { max: 120, required: true },
  domain: { max: 253, required: true },
  employees: { options: ['1-10', '11-25', '26-50', '51-100', '101-250', '250+'] },
  industry: { max: 80 },
  renewal: { max: 7 }, // YYYY-MM
  carrier: { max: 80 },
};

const EMAIL_GRADE_POINTS = { 'A+': 1, A: 1, B: 0.75, C: 0.5, D: 0.25, F: 0 };

/** The questionnaire as the browser sees it (no point values, so answers aren't gamed). */
function publicModel() {
  return {
    sections: SECTIONS.map(s => ({
      id: s.id, title: s.title, icon: s.icon, intro: s.intro,
      questions: s.questions.map(q => ({
        id: q.id, q: q.q, help: q.help || '', critical: !!q.critical, auto: !!q.auto,
        options: (q.options || []).map(([value, label]) => ({ value, label })),
      })),
    })),
    profile: { employees: PROFILE_FIELDS.employees.options },
  };
}

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : '');

/** Keeps only known question ids with known option values. */
function cleanAnswers(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const q of QUESTIONS) {
    if (q.auto) continue;
    const v = raw[q.id];
    if (typeof v === 'string' && q.options.some(o => o[0] === v)) out[q.id] = v;
  }
  return out;
}

function cleanProfile(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, def] of Object.entries(PROFILE_FIELDS)) {
    if (def.options) out[k] = def.options.includes(p[k]) ? p[k] : '';
    else out[k] = clean(p[k], def.max);
  }
  if (out.renewal && !/^\d{4}-(0[1-9]|1[0-2])$/.test(out.renewal)) out.renewal = '';
  return out;
}

function missingAnswers(answers) {
  return QUESTIONS.filter(q => !q.auto && !(q.id in answers)).map(q => q.id);
}

function levelFor(score, criticalGaps) {
  const order = ['ready', 'nearly', 'work', 'risk'];
  let lvl = score >= 85 ? 'ready' : score >= 70 ? 'nearly' : score >= 50 ? 'work' : 'risk';
  // A missing must-have caps the level, whatever the score: carriers decline on these alone.
  const cap = criticalGaps >= 3 ? 'risk' : criticalGaps >= 1 ? 'work' : 'ready';
  if (order.indexOf(cap) > order.indexOf(lvl)) lvl = cap;
  return lvl;
}

const LEVELS = {
  ready: { label: 'Ready to apply', headline: "You'd answer an insurer's questionnaire with confidence.", color: 'pass' },
  nearly: { label: 'Nearly there', headline: 'A few gaps could raise your premium or add exclusions.', color: 'good' },
  work: { label: 'Needs work', headline: 'Some answers would likely lead to a higher price, exclusions or a decline.', color: 'warn' },
  risk: { label: 'High risk of decline', headline: 'Several must-have controls are missing. Fix these before you apply or renew.', color: 'fail' },
};
const EFFORT_RANK = { quick: 0, medium: 1, project: 2 };
const EFFORT_LABEL = { quick: 'Quick win (days)', medium: 'A few weeks', project: 'Bigger project' };

/**
 * Scores answers. `emailCheck` is the /checkup result for their domain (or null).
 * Returns the full report the portal renders and stores.
 */
function scoreAssessment(answers, emailCheck = null, now = new Date()) {
  const a = cleanAnswers(answers);
  const pointsFor = q => {
    if (q.auto) {
      if (!emailCheck || !emailCheck.ok) return { pts: null };
      return { pts: EMAIL_GRADE_POINTS[emailCheck.grade] ?? 0, label: `Grade ${emailCheck.grade} (${emailCheck.score}/100)` };
    }
    const opt = q.options.find(o => o[0] === a[q.id]);
    if (!opt) return { pts: 0, label: 'Not answered', unanswered: true };
    return { pts: opt[2], label: opt[1], unsure: opt[0] === 'unsure' };
  };

  const fixes = [];
  const sections = SECTIONS.map(s => {
    let got = 0, max = 0;
    for (const q of s.questions) {
      const r = pointsFor(q);
      if (r.pts === null) continue; // not applicable
      got += r.pts * q.weight; max += q.weight;
      if (r.pts < 1) {
        const gap = 1 - r.pts;
        fixes.push({
          id: q.id, section: s.id, sectionTitle: s.title, question: q.q, answer: r.label,
          critical: !!q.critical, unsure: !!r.unsure || !!r.unanswered, fix: q.fix,
          effort: q.effort, effortLabel: EFFORT_LABEL[q.effort], service: q.service,
          impact: Math.round(gap * q.weight * s.weight * (q.critical ? 2 : 1) * 10) / 10,
        });
      }
    }
    const pct = max ? got / max : 1;
    return { id: s.id, title: s.title, icon: s.icon, weight: s.weight, score: Math.round(pct * 100) };
  });

  const totalW = sections.reduce((t, s) => t + s.weight, 0);
  const score = Math.round(sections.reduce((t, s) => t + s.score * s.weight, 0) / totalW);
  const criticalGaps = fixes.filter(f => f.critical && f.impact > 0 && pointsFor(BY_ID[f.id]).pts < 0.5);
  const level = levelFor(score, criticalGaps.length);

  // Must-haves first, then biggest impact, then the easiest.
  fixes.sort((x, y) => (y.critical - x.critical) || (y.impact - x.impact) || (EFFORT_RANK[x.effort] - EFFORT_RANK[y.effort]));
  // Spread the plan over three phases: must-haves and early quick wins now,
  // the next handful this month, the rest (and big projects) this quarter.
  let month = 0;
  fixes.forEach((f, i) => {
    f.priority = i + 1;
    if (f.critical || (i < 6 && f.effort === 'quick')) f.phase = 'now';
    else if (f.effort !== 'project' && month < 7) { f.phase = 'month'; month++; }
    else f.phase = 'quarter';
  });

  return {
    version: 1,
    generatedAt: now.toISOString(),
    score, level, levelLabel: LEVELS[level].label, headline: LEVELS[level].headline,
    criticalGaps: criticalGaps.map(f => f.id),
    sections, fixes,
    unsure: fixes.filter(f => f.unsure).length,
    email: emailCheck && emailCheck.ok
      ? { domain: emailCheck.domain, grade: emailCheck.grade, score: emailCheck.score, headline: emailCheck.headline, provider: emailCheck.provider || null }
      : null,
  };
}

// ---------- public "request your assessment" form ----------

const PACKAGES = ['score', 'review', 'sprint', 'unsure'];
const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[A-Za-z]{2,}$/;
const MIN_FILL_MS = 3000;

function checkRequest(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return { errors: { form: 'Invalid request.' } };
  if (clean(body.website, 200)) return { spam: true, reason: 'honeypot' };
  const started = Number(body.startedAt);
  if (!Number.isFinite(started) || now - started < MIN_FILL_MS || now - started > 864e5) return { spam: true, reason: 'timing' };

  const data = {
    name: clean(body.name, 101),
    email: clean(body.email, 255).toLowerCase(),
    company: clean(body.company, 121),
    domain: clean(body.domain, 254).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
    employees: PROFILE_FIELDS.employees.options.includes(body.employees) ? body.employees : '',
    renewal: /^\d{4}-(0[1-9]|1[0-2])$/.test(body.renewal || '') ? body.renewal : '',
    package: PACKAGES.includes(body.package) ? body.package : 'unsure',
    notes: clean(body.notes, 1501),
  };
  const errors = {};
  if (!data.name) errors.name = 'Please enter your name.';
  else if (data.name.length > 100) errors.name = 'Please keep this under 100 characters.';
  if (!data.email) errors.email = 'Please enter your email.';
  else if (!EMAIL_RE.test(data.email) || data.email.length > 254) errors.email = "That email address doesn't look right.";
  if (!data.company) errors.company = 'Please enter your business name.';
  else if (data.company.length > 120) errors.company = 'Please keep this under 120 characters.';
  if (data.domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(data.domain)) errors.domain = 'Enter just the domain, like yourcompany.com.';
  if (data.notes.length > 1500) errors.notes = 'Please keep this under 1,500 characters.';
  if ((data.notes.match(/https?:\/\//gi) || []).length > 3) return { spam: true, reason: 'links' };
  if (Object.keys(errors).length) return { errors };
  return { data };
}

module.exports = {
  SECTIONS, QUESTIONS, LEVELS, PACKAGES, publicModel, cleanAnswers, cleanProfile, missingAnswers,
  scoreAssessment, levelFor, checkRequest,
};

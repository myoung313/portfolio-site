// Lightweight password strength estimate (a few KB instead of a 800 KB library).
// Splits the password into guessable pieces (common words, years, keyboard runs,
// repeats) and random characters, adds up the bits, and turns that into a guess time
// for an attacker trying 10 billion guesses a second (a fast offline attack).
// Runs in the browser as window.CSStrength and in Node for unit tests.
(function (root) {
  const WORDS = ('password passw0rd pass qwerty letmein welcome admin administrator iloveyou love monkey dragon football baseball basketball soccer hockey ' +
    'sunshine princess shadow master hello freedom whatever trustno trustno1 starwars login abc summer winter spring autumn fall ' +
    'january february march april may june july august september october november december monday friday weekend ' +
    'microsoft office windows outlook google apple company business changeme change secret god jesus money tiger ranger buster ' +
    'pepper cheese computer internet superman batman michael jennifer jordan hunter charlie thomas ashley daniel andrew joshua ' +
    'matthew robert jessica david james john william taylor maggie ginger family friends happy lucky angel baby blessed ' +
    'america indiana chicago texas florida california london test testing temp guest user default access secure security ' +
    'cloud cloudshift labs office365 teams network server wifi coffee cookie chocolate orange purple yellow banana flower ' +
    'killer cowboys eagles yankees lakers diamond silver golden phoenix mustang thunder rainbow' ).split(/\s+/).filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const LEET = { '@': 'a', '4': 'a', '8': 'b', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't', '+': 't' };
  const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdefghijklmnopqrstuvwxyz', '01234567890', '1qaz2wsx3edc', '!@#$%^&*()'];
  const RATE = 1e10; // guesses per second

  const classPool = ch => /[a-z]/.test(ch) ? 26 : /[A-Z]/.test(ch) ? 26 : /[0-9]/.test(ch) ? 10 : 33;
  const log2 = Math.log2;

  function dictAt(pw, i) {
    const rest = pw.slice(i).toLowerCase();
    const deleet = rest.replace(/[@4831!05$7+]/g, c => LEET[c]);
    for (const w of WORDS) {
      if (w.length < 3) continue;
      const plain = rest.startsWith(w), leet = !plain && deleet.startsWith(w);
      if (plain || leet) {
        const seg = pw.slice(i, i + w.length);
        let bits = log2(WORDS.length * 4);              // which common word
        if (/[A-Z]/.test(seg)) bits += /^[A-Z][^A-Z]*$/.test(seg) ? 1 : 2; // capitalized or mixed
        if (leet) bits += 1;
        return { len: w.length, bits, kind: 'word' };
      }
    }
    return null;
  }

  function yearAt(pw, i) {
    const m = pw.slice(i).match(/^(19[3-9]\d|20[0-4]\d)/);
    return m ? { len: 4, bits: log2(120), kind: 'year' } : null;
  }

  function seqAt(pw, i) {
    const s = pw.slice(i).toLowerCase();
    let best = null;
    for (const row of ROWS) {
      for (const r of [row, [...row].reverse().join('')]) {
        let n = 0;
        while (n < s.length && r.indexOf(s.slice(0, n + 1)) !== -1) n++;
        if (n >= 3 && (!best || n > best.len)) best = { len: n, bits: log2(ROWS.length * 2 * 10) + log2(n), kind: 'seq' };
      }
    }
    return best;
  }

  function repeatAt(pw, i) {
    const m = pw.slice(i).match(/^(.)\1{2,}/) || pw.slice(i).match(/^(.{2,4})\1{1,}/);
    if (!m) return null;
    const unit = m[1];
    return { len: m[0].length, bits: [...unit].reduce((a, c) => a + log2(classPool(c)), 0) + log2(m[0].length / unit.length), kind: 'repeat' };
  }

  function estimate(pw) {
    pw = String(pw || '');
    // An attacker brute-forcing random characters has to try every character type the password uses.
    const pool = (/[a-z]/.test(pw) ? 26 : 0) + (/[A-Z]/.test(pw) ? 26 : 0) + (/[0-9]/.test(pw) ? 10 : 0) + (/[^a-zA-Z0-9]/.test(pw) ? 33 : 0) || 1;
    let bits = 0, i = 0;
    const found = new Set();
    while (i < pw.length) {
      const cands = [dictAt(pw, i), yearAt(pw, i), seqAt(pw, i), repeatAt(pw, i)].filter(Boolean);
      // Prefer the piece that explains the most characters for the fewest bits.
      cands.sort((a, b) => (b.len - a.len) || (a.bits - b.bits));
      const m = cands[0];
      if (m) {
        const brute = m.len * log2(pool);
        if (m.bits < brute) { bits += m.bits + 1; found.add(m.kind); i += m.len; continue; }
      }
      bits += log2(pool);
      i++;
    }
    const guesses = Math.pow(2, bits);
    const seconds = guesses / RATE;
    const score = seconds < 86400 ? 0 : seconds < 3.15e7 ? 1 : seconds < 3.15e9 ? 2 : seconds < 3.15e13 ? 3 : 4;

    const len = [...pw].length;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(r => r.test(pw)).length;
    const checks = [
      { label: len >= 12 ? `${len} characters` : `12+ characters (${len} now)`, state: len >= 12 ? 'ok' : len < 8 ? 'bad' : '' },
      { label: 'Letters, numbers & symbols', state: classes >= 3 ? 'ok' : '' },
      { label: 'No common words', state: found.has('word') ? 'bad' : 'ok' },
      { label: 'No years', state: found.has('year') ? 'bad' : 'ok' },
      { label: 'No patterns like 1234 or qwerty', state: found.has('seq') || found.has('repeat') ? 'bad' : 'ok' },
    ];
    return { score, bits: Math.round(bits), seconds, crackTime: humanTime(seconds), checks, found: [...found] };
  }

  function humanTime(s) {
    if (s < 1) return 'less than a second';
    const units = [['year', 3.15e7], ['month', 2.6e6], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
    if (s >= 3.15e9) return 'centuries';
    for (const [name, size] of units) {
      if (s >= size) { const n = Math.round(s / size); return `about ${n} ${name}${n === 1 ? '' : 's'}`; }
    }
    return 'less than a second';
  }

  const api = { estimate, humanTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CSStrength = api;
})(typeof window !== 'undefined' ? window : globalThis);

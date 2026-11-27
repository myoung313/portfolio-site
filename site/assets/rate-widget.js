// "Rate this site" widget for cloudshiftlabs.net.
// Floating button -> panel with animated stars + optional suggestion box.
// On send, the note folds into a paper plane and flies off.
// Talks to /api/ratings (Azure Function, Table Storage). Include with:
//   <script src="/assets/rate-widget.js" defer></script>
(() => {
  if (window.__csRateWidget) return;
  window.__csRateWidget = true;

  const API = '/api/ratings';
  const DONE_KEY = 'cs-rated-v1';
  const LABELS = ['', 'Needs work', 'Could be better', 'Pretty good', 'Really good', 'Love it!'];
  const startedAt = Date.now();
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  const css = `
  .csr-fab{position:fixed;right:20px;bottom:20px;z-index:50;display:flex;align-items:center;gap:8px;background:#F5B700;color:#141C33;border:0;border-radius:999px;padding:12px 18px;font:600 .95rem "Segoe UI",system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:transform .2s}
  .csr-fab:hover{transform:translateY(-3px) scale(1.03)}
  .csr-fab .csr-fs{display:inline-block;animation:csr-twinkle 2.4s ease-in-out infinite}
  .csr-fab[hidden]{display:none}
  @keyframes csr-twinkle{0%,100%{transform:rotate(0) scale(1)}50%{transform:rotate(72deg) scale(1.25)}}
  .csr-panel{position:fixed;right:20px;bottom:20px;z-index:51;width:min(360px,calc(100vw - 32px));background:linear-gradient(160deg,#2A3558,#1B2440);color:#E8ECF5;border:1px solid #2F3B63;border-radius:20px;padding:22px 22px 18px;box-shadow:0 24px 60px rgba(0,0,0,.5);font-family:"Segoe UI",system-ui,sans-serif;transform-origin:bottom right;animation:csr-pop .35s cubic-bezier(.2,1.4,.4,1)}
  .csr-panel[hidden]{display:none}
  @keyframes csr-pop{from{opacity:0;transform:scale(.6) translateY(20px)}to{opacity:1;transform:none}}
  .csr-x{position:absolute;top:10px;right:12px;background:none;border:0;color:#A9B2C8;font-size:1.4rem;cursor:pointer;line-height:1}
  .csr-x:hover{color:#fff}
  .csr-eyebrow{color:#F5B700;font-weight:600;letter-spacing:.14em;text-transform:uppercase;font-size:.72rem}
  .csr-panel h3{font-size:1.2rem;margin:4px 0 2px}
  .csr-avg{color:#A9B2C8;font-size:.85rem;min-height:1.3em}
  .csr-stars{display:flex;gap:6px;margin:14px 0 4px}
  .csr-star{position:relative;background:none;border:0;padding:2px;cursor:pointer;font-size:2.1rem;line-height:1;color:#3A4672;transition:transform .15s,color .15s}
  .csr-star:hover,.csr-star:focus-visible{transform:scale(1.18) rotate(-8deg);outline:none}
  .csr-star.on{color:#F5B700;text-shadow:0 0 14px rgba(245,183,0,.55)}
  .csr-star.pulse{animation:csr-bounce .45s cubic-bezier(.3,1.8,.5,1)}
  @keyframes csr-bounce{0%{transform:scale(.6)}60%{transform:scale(1.35) rotate(12deg)}100%{transform:scale(1)}}
  .csr-spark{position:absolute;left:50%;top:50%;width:6px;height:6px;border-radius:50%;background:#F5B700;pointer-events:none;animation:csr-spark .6s ease-out forwards}
  @keyframes csr-spark{from{opacity:1;transform:translate(-50%,-50%)}to{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(.3)}}
  .csr-label{font-size:.9rem;color:#F5B700;min-height:1.4em;font-weight:600}
  .csr-panel label{display:block;font-size:.82rem;color:#A9B2C8;margin:12px 0 6px}
  .csr-panel textarea{width:100%;box-sizing:border-box;min-height:84px;resize:vertical;background:#141C33;color:#E8ECF5;border:1px solid #2F3B63;border-radius:12px;padding:10px 12px;font:inherit;font-size:.92rem}
  .csr-panel textarea:focus{outline:none;border-color:#F5B700;box-shadow:0 0 0 3px rgba(245,183,0,.18)}
  .csr-count{text-align:right;font-size:.72rem;color:#A9B2C8;margin-top:2px}
  .csr-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  .csr-send{margin-top:10px;width:100%;border:0;border-radius:12px;padding:12px;background:#F5B700;color:#141C33;font:600 .95rem inherit;font-family:inherit;cursor:pointer;transition:transform .15s,opacity .15s}
  .csr-send:disabled{opacity:.45;cursor:not-allowed}
  .csr-send:not(:disabled):hover{transform:translateY(-2px)}
  .csr-msg{font-size:.85rem;min-height:1.2em;margin-top:8px;color:#FF8A80}
  .csr-form.fold{animation:csr-fold .45s ease-in forwards}
  @keyframes csr-fold{to{opacity:0;transform:scale(.2) rotate(-20deg);filter:blur(2px)}}
  .csr-plane{position:fixed;z-index:60;width:46px;height:46px;pointer-events:none;color:#F5B700;filter:drop-shadow(0 4px 10px rgba(245,183,0,.5))}
  .csr-trail{position:fixed;z-index:59;width:5px;height:5px;border-radius:50%;background:#F5B700;pointer-events:none;animation:csr-fade 1s ease-out forwards}
  @keyframes csr-fade{from{opacity:.8}to{opacity:0;transform:scale(.2)}}
  .csr-thanks{text-align:center;padding:10px 0 6px;animation:csr-pop .4s cubic-bezier(.2,1.4,.4,1)}
  .csr-thanks .big{font-size:2.4rem;color:#F5B700;text-shadow:0 0 18px rgba(245,183,0,.5);letter-spacing:4px}
  .csr-thanks p{color:#A9B2C8;font-size:.9rem;margin-top:6px}
  .csr-bars{margin-top:14px;display:grid;gap:5px}
  .csr-bar{display:grid;grid-template-columns:22px 1fr 26px;align-items:center;gap:8px;font-size:.75rem;color:#A9B2C8}
  .csr-bar i{display:block;height:7px;border-radius:9px;background:#141C33;overflow:hidden}
  .csr-bar i b{display:block;height:100%;width:0;background:linear-gradient(90deg,#F5B700,#FFD866);border-radius:9px;transition:width 1s cubic-bezier(.2,1,.3,1)}
  .csr-confetti{position:fixed;z-index:61;top:-12px;width:9px;height:14px;pointer-events:none;animation:csr-fall linear forwards}
  @keyframes csr-fall{to{transform:translate(var(--dx),105vh) rotate(var(--r))}}
  @media (prefers-reduced-motion:reduce){.csr-panel,.csr-thanks,.csr-star.pulse,.csr-fab .csr-fs,.csr-form.fold{animation:none!important}}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.createElement('div');
  root.innerHTML = `
    <button class="csr-fab" type="button" aria-haspopup="dialog"><span class="csr-fs">★</span> Rate this site</button>
    <div class="csr-panel" role="dialog" aria-label="Rate this site" hidden>
      <button class="csr-x" type="button" aria-label="Close">×</button>
      <div class="csr-body">
        <form class="csr-form" novalidate>
          <div class="csr-eyebrow">Feedback</div>
          <h3>How's the site?</h3>
          <div class="csr-avg" aria-live="polite"></div>
          <div class="csr-stars" role="radiogroup" aria-label="Your rating">
            ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="csr-star" role="radio" aria-checked="false" aria-label="${n} star${n > 1 ? 's' : ''}" data-n="${n}">★</button>`).join('')}
          </div>
          <div class="csr-label" aria-live="polite"></div>
          <label for="csr-comment">Suggestions or recommendations (optional)</label>
          <textarea id="csr-comment" maxlength="500" placeholder="What should I add, fix or build next?"></textarea>
          <div class="csr-count">0 / 500</div>
          <div class="csr-hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off" /></div>
          <button class="csr-send" type="submit" disabled>Send it ✈</button>
          <div class="csr-msg" role="status" aria-live="polite"></div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(root);

  const $ = s => root.querySelector(s);
  const fab = $('.csr-fab'), panel = $('.csr-panel'), body = $('.csr-body');
  const form = $('.csr-form'), stars = [...root.querySelectorAll('.csr-star')];
  const label = $('.csr-label'), avg = $('.csr-avg'), send = $('.csr-send'), msg = $('.csr-msg');
  const comment = $('#csr-comment'), count = $('.csr-count');
  let picked = 0, summary = null;

  const paint = n => stars.forEach((s, i) => s.classList.toggle('on', i < n));
  const showAvg = s => {
    if (!s || !s.count) { avg.textContent = 'Be the first to rate it.'; return; }
    avg.textContent = `★ ${s.average.toFixed(1)} average from ${s.count} rating${s.count === 1 ? '' : 's'}`;
  };
  const bars = s => `<div class="csr-bars">${[5, 4, 3, 2, 1].map(n => {
    const c = s.distribution[n - 1], pct = s.count ? Math.round((c / s.count) * 100) : 0;
    return `<div class="csr-bar"><span>${n}★</span><i><b data-w="${pct}"></b></i><span>${c}</span></div>`;
  }).join('')}</div>`;

  fetch(API).then(r => r.ok ? r.json() : null).then(s => { summary = s; showAvg(s); }).catch(() => showAvg(null));

  const open = () => { panel.hidden = false; fab.hidden = true; (picked ? comment : stars[0]).focus(); };
  const close = () => { panel.hidden = true; fab.hidden = false; fab.focus(); };
  fab.addEventListener('click', open);
  $('.csr-x').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });

  const sparkle = el => {
    if (reduced) return;
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('span');
      p.className = 'csr-spark';
      const a = (Math.PI * 2 * i) / 8, d = 22 + Math.random() * 10;
      p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      p.style.setProperty('--dy', `${Math.sin(a) * d}px`);
      el.appendChild(p);
      setTimeout(() => p.remove(), 650);
    }
  };

  stars.forEach((s, i) => {
    s.addEventListener('mouseenter', () => paint(i + 1));
    s.addEventListener('mouseleave', () => paint(picked));
    s.addEventListener('click', () => {
      picked = i + 1;
      paint(picked);
      stars.forEach((t, j) => {
        t.setAttribute('aria-checked', String(j === i));
        t.classList.remove('pulse');
        if (j <= i) setTimeout(() => { t.classList.add('pulse'); }, j * 60);
      });
      sparkle(s);
      label.textContent = LABELS[picked];
      send.disabled = false;
      msg.textContent = '';
    });
    s.addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const n = Math.min(5, Math.max(1, (picked || i + 1) + (picked ? d : 0)));
      stars[n - 1].focus(); stars[n - 1].click();
    });
  });

  comment.addEventListener('input', () => { count.textContent = `${comment.value.length} / 500`; });

  // Paper plane flies from the send button off the top-right of the screen.
  const flyPlane = from => new Promise(resolve => {
    if (reduced) return resolve();
    const r = from.getBoundingClientRect();
    const plane = document.createElement('div');
    plane.className = 'csr-plane';
    plane.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 11.5 21.5 3 15 21l-3.6-7.4L2 11.5Zm9.6 1.6 2.3 4.8 4.4-12.4-6.7 7.6Z"/></svg>';
    document.body.appendChild(plane);
    const x0 = r.left + r.width / 2 - 23, y0 = r.top - 10;
    const x1 = x0 - 160, y1 = y0 - 120;            // swoop left and up
    const x2 = window.innerWidth + 80, y2 = -120;  // then off to the top right
    const t0 = performance.now(), dur = 1400;
    let lastTrail = 0;
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), u = 1 - k;
      const x = u * u * x0 + 2 * u * k * x1 + k * k * x2;
      const y = u * u * y0 + 2 * u * k * y1 + k * k * y2;
      const dx = 2 * u * (x1 - x0) + 2 * k * (x2 - x1), dy = 2 * u * (y1 - y0) + 2 * k * (y2 - y1);
      plane.style.transform = `translate(${x}px,${y}px) rotate(${Math.atan2(dy, dx) * 180 / Math.PI + 25}deg) scale(${1 + k * .4})`;
      if (t - lastTrail > 40) {
        lastTrail = t;
        const dot = document.createElement('span');
        dot.className = 'csr-trail';
        dot.style.left = `${x + 20}px`; dot.style.top = `${y + 24}px`;
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 1000);
      }
      if (k < 1) requestAnimationFrame(step); else { plane.remove(); resolve(); }
    };
    requestAnimationFrame(step);
  });

  const confetti = () => {
    if (reduced) return;
    const colors = ['#F5B700', '#FFD866', '#7CE0A3', '#8AB4FF', '#FF8A80'];
    for (let i = 0; i < 40; i++) {
      const c = document.createElement('span');
      c.className = 'csr-confetti';
      c.style.left = `${Math.random() * 100}vw`;
      c.style.background = colors[i % colors.length];
      c.style.borderRadius = i % 3 ? '2px' : '50%';
      c.style.setProperty('--dx', `${(Math.random() - .5) * 200}px`);
      c.style.setProperty('--r', `${Math.random() * 720}deg`);
      c.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
      c.style.animationDelay = `${Math.random() * .4}s`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 4000);
    }
  };

  const thanks = (s, hadComment) => {
    body.innerHTML = `<div class="csr-thanks">
      <div class="big">${'★'.repeat(picked)}</div>
      <h3>Thank you!</h3>
      <p>${hadComment ? 'Your suggestion is in. I read every one.' : 'Your rating is in.'}</p>
      ${s && s.count ? `<p style="margin-top:12px;color:#E8ECF5">★ ${s.average.toFixed(1)} from ${s.count} rating${s.count === 1 ? '' : 's'}</p>${bars(s)}` : ''}
    </div>`;
    requestAnimationFrame(() => requestAnimationFrame(() =>
      body.querySelectorAll('.csr-bar b').forEach(b => { b.style.width = b.dataset.w + '%'; })));
  };

  if (store.get(DONE_KEY)) {
    fab.innerHTML = '<span class="csr-fs">★</span> Thanks for rating';
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!picked) { msg.textContent = 'Tap a star first.'; return; }
    send.disabled = true; msg.textContent = '';
    const text = comment.value.trim();
    let res, out = {};
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars: picked, comment: text, website: form.elements.website.value, startedAt, page: location.pathname }),
      });
      out = await res.json().catch(() => ({}));
    } catch { /* network error handled below */ }

    if (res && res.ok && out.ok) {
      store.set(DONE_KEY, String(picked));
      form.classList.add('fold');
      await Promise.all([flyPlane(send), new Promise(r => setTimeout(r, reduced ? 0 : 450))]);
      thanks(out.count ? out : summary, !!text);
      confetti();
      fab.innerHTML = '<span class="csr-fs">★</span> Thanks for rating';
    } else {
      msg.textContent = (out.errors && Object.values(out.errors)[0]) || out.error || 'Could not send right now. Please try again later.';
      send.disabled = false;
    }
  });
})();

/*
 * CloudShift Labs "light switch" for the client portal.
 *
 * Put <span data-portal-switch data-href="/portal/" data-label="Client portal"></span>
 * anywhere on a page. Add data-on to show the switch already flipped on (used
 * inside the portal, where flipping it off takes you back to the public site).
 * The default look is a wall light switch; add data-style="toggle" for a sliding bulb toggle.
 *
 * Load it in <head> (no defer) so arriving pages start dark with no flash.
 *
 * Flipping the switch turns the lights out on the current page, then the next
 * page turns its lights on. Visitors who prefer reduced motion skip the show.
 */
(() => {
  const KEY = 'cs-lights';
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = `
  .cs-switch { display:inline-flex; align-items:center; gap:10px; background:none; border:0; padding:4px 2px; cursor:pointer; font:inherit; color:inherit; -webkit-tap-highlight-color:transparent; }
  .cs-switch .plate { position:relative; width:30px; height:44px; border-radius:7px; background:linear-gradient(160deg,#F4F1EA,#D9D4C7); box-shadow:inset 0 0 0 1px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.35); flex:none; }
  .cs-switch .plate::before, .cs-switch .plate::after { content:""; position:absolute; left:50%; width:3px; height:3px; margin-left:-1.5px; border-radius:50%; background:#A59E8D; }
  .cs-switch .plate::before { top:4px; } .cs-switch .plate::after { bottom:4px; }
  .cs-switch .rocker { position:absolute; left:8px; right:8px; top:10px; bottom:10px; border-radius:4px; background:#C9C3B4; box-shadow:inset 0 0 0 1px rgba(0,0,0,.2); overflow:hidden; }
  .cs-switch .rocker i { position:absolute; left:0; right:0; height:55%; bottom:0; border-radius:3px; background:linear-gradient(#FFFDF8,#E6E0D2); box-shadow:0 -2px 3px rgba(0,0,0,.25); transition:transform .16s cubic-bezier(.5,1.8,.6,1), box-shadow .16s; }
  .cs-switch[aria-checked="true"] .rocker i { transform:translateY(-82%); box-shadow:0 2px 3px rgba(0,0,0,.25); }
  .cs-switch .lbl { display:flex; flex-direction:column; line-height:1.15; text-align:left; }
  .cs-switch .lbl b { font-size:.9rem; font-weight:600; }
  .cs-switch .lbl small { font-size:.72rem; opacity:.7; letter-spacing:.06em; text-transform:uppercase; }
  .cs-switch .bulb { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; background:#5B6380; vertical-align:middle; transition:background .2s, box-shadow .2s; }
  .cs-switch[aria-checked="true"] .bulb { background:#F5B700; box-shadow:0 0 8px 2px rgba(245,183,0,.7); }
  .cs-switch:focus-visible { outline:2px solid #F5B700; outline-offset:4px; border-radius:8px; }
  .cs-switch:hover .plate { box-shadow:inset 0 0 0 1px rgba(0,0,0,.18), 0 0 0 3px rgba(245,183,0,.25), 0 2px 6px rgba(0,0,0,.35); }

  /* Toggle style (data-style="toggle"): a sliding pill with a bulb on the knob */
  .cs-switch .track { display:none; position:relative; width:56px; height:30px; border-radius:99px; background:#2F3B63; box-shadow:inset 0 1px 3px rgba(0,0,0,.45); transition:background .25s; flex:none; }
  .cs-switch .knob { position:absolute; top:3px; left:3px; width:24px; height:24px; border-radius:50%; background:#C9CEDC; display:grid; place-items:center; font-size:13px; line-height:1;
    box-shadow:0 2px 4px rgba(0,0,0,.35); transition:transform .25s cubic-bezier(.4,1.6,.6,1), background .25s, box-shadow .25s; }
  .cs-switch .knob::before { content:"💡"; filter:grayscale(1) brightness(.75); transition:filter .25s; }
  .cs-switch.toggle .plate { display:none; }
  .cs-switch.toggle .track { display:block; }
  .cs-switch.toggle[aria-checked="true"] .track { background:#F5B700; }
  .cs-switch.toggle[aria-checked="true"] .knob { transform:translateX(26px); background:#FFFDF5; box-shadow:0 0 12px 3px rgba(255,214,90,.8); }
  .cs-switch.toggle[aria-checked="true"] .knob::before { filter:none; }
  .cs-switch.toggle:hover .track { box-shadow:inset 0 1px 3px rgba(0,0,0,.45), 0 0 0 3px rgba(245,183,0,.25); }

  .cs-dark { position:fixed; inset:0; z-index:9999; pointer-events:none; background:#05070D; opacity:0; }
  .cs-dark.out { animation:cs-out .62s steps(1,end) forwards, cs-fade .62s ease-in forwards; }
  .cs-dark.in { opacity:1; animation:cs-in .9s ease-out forwards; }
  .cs-dark .glow { position:absolute; width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%; background:#F5B700; box-shadow:0 0 30px 12px rgba(245,183,0,.55); opacity:0; }
  .cs-dark.out .glow { animation:cs-glow .62s ease-out forwards; }
  @keyframes cs-fade { 0% { opacity:0; } 18% { opacity:.85; } 26% { opacity:.25; } 40% { opacity:.95; } 48% { opacity:.6; } 62%,100% { opacity:1; } }
  @keyframes cs-out { to { opacity:1; } }
  @keyframes cs-glow { 0%,55% { opacity:0; transform:scale(.3); } 75% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:scale(.2); } }
  @keyframes cs-in { 0% { opacity:1; } 22% { opacity:.35; } 30% { opacity:.9; } 42% { opacity:.15; } 50% { opacity:.55; } 100% { opacity:0; } }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function store(v) { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch (_) {} }
  function read() { try { return sessionStorage.getItem(KEY); } catch (_) { return null; } }

  // Lights on: if we arrived here by flipping a switch, fade the darkness away.
  if (read() === '1') {
    store(null);
    if (!reduced) {
      const d = document.createElement('div');
      d.className = 'cs-dark in';
      document.documentElement.appendChild(d);
      d.addEventListener('animationend', () => d.remove());
      setTimeout(() => d.remove(), 1500);
    }
  }

  function flip(btn) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    btn.setAttribute('aria-checked', btn.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    const href = btn.dataset.href;
    if (reduced) { location.href = href; return; }
    store('1');
    const r = btn.querySelector(btn.classList.contains('toggle') ? '.knob' : '.plate').getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'cs-dark';
    d.innerHTML = '<span class="glow"></span>';
    const g = d.firstChild;
    g.style.left = (r.left + r.width / 2) + 'px';
    g.style.top = (r.top + r.height / 2) + 'px';
    setTimeout(() => { d.classList.add('out'); document.documentElement.appendChild(d); }, 140);
    setTimeout(() => { location.href = href; }, 820);
  }

  // If the visitor comes back with the browser's Back button, reset the switch.
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    document.querySelectorAll('.cs-dark').forEach(n => n.remove());
    document.querySelectorAll('.cs-switch').forEach(b => {
      delete b.dataset.busy;
      b.setAttribute('aria-checked', b.dataset.initial);
    });
  });

  function render() {
  document.querySelectorAll('[data-portal-switch]').forEach(slot => {
    const on = slot.hasAttribute('data-on');
    const btn = document.createElement('button');
    btn.type = 'button';
    // Default look is the wall light switch. data-style="toggle" gives a sliding bulb toggle.
    const look = slot.dataset.style || window.CS_SWITCH_STYLE || 'switch';
    btn.className = 'cs-switch' + (look === 'toggle' ? ' toggle' : '');
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(on));
    btn.dataset.initial = String(on);
    btn.dataset.href = slot.dataset.href || '/portal/';
    btn.title = slot.dataset.title || (on ? 'Flip to go back to the public site' : 'Flip to open the client portal');
    btn.innerHTML =
      '<span class="plate" aria-hidden="true"><span class="rocker"><i></i></span></span>' +
      '<span class="track" aria-hidden="true"><span class="knob"></span></span>' +
      '<span class="lbl"><b></b><small><span class="bulb"></span><span class="st"></span></small></span>';
    btn.querySelector('b').textContent = slot.dataset.label || 'Client portal';
    btn.querySelector('.st').textContent = slot.dataset.state || (on ? 'Lights on' : 'Flip to sign in');
    btn.addEventListener('click', () => flip(btn));
    slot.replaceWith(btn);
  });
  }
  // Pages that add a switch later (like the invite page) call this to render it.
  window.CSPortalSwitchRender = render;
  // Loaded in <head> so the "lights on" darkness covers the page before it paints.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();

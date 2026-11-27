// Tiny footer visit counter. No cookies and nothing personal is stored:
// sessionStorage just remembers "already counted" until this tab closes,
// so reloads and clicking around don't count twice.
(() => {
  const el = document.getElementById('visit-count');
  if (!el) return;
  let counted = false;
  try { counted = sessionStorage.getItem('cs-visit-counted') === '1'; } catch {}
  const req = counted
    ? fetch('/api/visits')
    : fetch('/api/visits', { method: 'POST' });
  req.then(r => r.ok ? r.json() : Promise.reject())
    .then(d => {
      if (!counted) { try { sessionStorage.setItem('cs-visit-counted', '1'); } catch {} }
      if (!d.total) return;
      el.querySelector('b').textContent = Number(d.total).toLocaleString();
      el.title = 'Visits since November 2026';
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add('on'));
    })
    .catch(() => {}); // stay hidden if the API is down
})();

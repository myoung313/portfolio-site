// Helpers for the footer visit counter. No cookies, no personal data:
// the browser only asks to be counted once per tab session (sessionStorage).

const BOT_RE = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|pingdom|uptime|curl|wget|python|node-fetch|axios|go-http|java\/|facebookexternalhit|embedly|whatsapp|discord|telegram|skype/i;

function isBot(userAgent) {
  const ua = String(userAgent || '');
  return ua.length < 10 || BOT_RE.test(ua);
}

// Next total from the stored row (null = no row yet).
function nextTotal(row) {
  return (Number(row?.total) || 0) + 1;
}

module.exports = { isBot, nextTotal };

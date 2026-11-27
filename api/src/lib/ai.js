// Optional Azure AI checks for comments. Both services have a free F0 tier
// (5,000 text records a month each). If the settings are missing or a call
// fails, the result is null and the comment is held for review instead.
//
// App settings (Static Web App > Settings > Environment variables):
//   CONTENT_SAFETY_ENDPOINT  e.g. https://cloudshift-safety.cognitiveservices.azure.com/
//   CONTENT_SAFETY_KEY
//   LANGUAGE_ENDPOINT        e.g. https://cloudshift-language.cognitiveservices.azure.com/
//   LANGUAGE_KEY

const TIMEOUT_MS = 4000;
const base = url => String(url || '').replace(/\/+$/, '');

async function post(url, key, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).pathname} returned ${res.status}`);
  return res.json();
}

/** Content Safety: severity 0 (safe), 2 (low), 4 (medium), 6 (high) per category. */
async function contentSafety(text, env = process.env) {
  if (!env.CONTENT_SAFETY_ENDPOINT || !env.CONTENT_SAFETY_KEY) return null;
  const out = await post(`${base(env.CONTENT_SAFETY_ENDPOINT)}/contentsafety/text:analyze?api-version=2024-09-01`, env.CONTENT_SAFETY_KEY, {
    text, categories: ['Hate', 'SelfHarm', 'Sexual', 'Violence'], outputType: 'FourSeverityLevels',
  });
  const key = { Hate: 'hate', SelfHarm: 'selfHarm', Sexual: 'sexual', Violence: 'violence' };
  const result = { hate: 0, selfHarm: 0, sexual: 0, violence: 0 };
  for (const c of out.categoriesAnalysis || []) if (key[c.category]) result[key[c.category]] = Number(c.severity) || 0;
  return result;
}

/** Language: sentiment label plus 0-1 confidence for positive/neutral/negative. */
async function sentiment(text, env = process.env) {
  if (!env.LANGUAGE_ENDPOINT || !env.LANGUAGE_KEY) return null;
  const out = await post(`${base(env.LANGUAGE_ENDPOINT)}/language/:analyze-text?api-version=2023-04-01`, env.LANGUAGE_KEY, {
    kind: 'SentimentAnalysis',
    analysisInput: { documents: [{ id: '1', language: 'en', text }] },
  });
  const doc = out.results?.documents?.[0];
  if (!doc) throw new Error('Sentiment returned no document');
  const s = doc.confidenceScores || {};
  return { label: doc.sentiment, positive: Number(s.positive) || 0, neutral: Number(s.neutral) || 0, negative: Number(s.negative) || 0 };
}

/** Runs both checks in parallel; a failure in one doesn't stop the other. */
async function analyze(text, log = () => {}, env = process.env) {
  const [safety, senti] = await Promise.allSettled([contentSafety(text, env), sentiment(text, env)]);
  if (safety.status === 'rejected') log(`Content Safety failed: ${safety.reason?.message}`);
  if (senti.status === 'rejected') log(`Sentiment failed: ${senti.reason?.message}`);
  return {
    safety: safety.status === 'fulfilled' ? safety.value : null,
    sentiment: senti.status === 'fulfilled' ? senti.value : null,
  };
}

module.exports = { analyze, contentSafety, sentiment };

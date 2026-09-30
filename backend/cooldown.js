// Remembers which models just answered 429 / 503 and skips them for a short while, so every customer message
// does not first wait on models that are known to be rate limited. Per server process, not per customer.
const DEFAULT_SECONDS = 60;
const MAX_SECONDS = 300; // also the cap for a Retry-After value
const until = new Map(); // model -> time (ms) when it may be tried again

// GEMINI_COOLDOWN_SECONDS: whole seconds, 0 turns the cooldown off; anything invalid uses the default.
function cooldownSeconds() {
  const raw = process.env.GEMINI_COOLDOWN_SECONDS;
  if (raw === undefined || raw.trim() === '' || !/^\d+$/.test(raw.trim())) return DEFAULT_SECONDS;
  return Math.min(Number(raw.trim()), MAX_SECONDS);
}

// Retry-After in whole seconds from a provider error (headers may be a plain object or a Headers object). null if absent.
function retryAfterSeconds(err) {
  const holders = [err && err.headers, err && err.response && err.response.headers];
  for (const h of holders) {
    if (!h) continue;
    const value = typeof h.get === 'function' ? h.get('retry-after') : (h['retry-after'] ?? h['Retry-After']);
    if (value !== undefined && value !== null && /^\d+$/.test(String(value).trim())) return Math.min(Number(String(value).trim()), MAX_SECONDS);
  }
  return null;
}

function markCooling(model, status, retryAfter, now = Date.now()) {
  if (status !== 429 && status !== 503) return;
  const seconds = retryAfter !== null && retryAfter !== undefined ? Math.min(retryAfter, MAX_SECONDS) : cooldownSeconds();
  if (seconds > 0) until.set(model, now + seconds * 1000);
}

// Seconds left (rounded up) or 0.
function secondsLeft(model, now = Date.now()) {
  const t = until.get(model);
  if (!t || t <= now) { until.delete(model); return 0; }
  return Math.ceil((t - now) / 1000);
}

// If every model in the chain is cooling, the one whose cooldown ends first (so there is always at least one real attempt). Otherwise null.
function earliestIfAllCooling(chain, now = Date.now()) {
  if (!chain.length || chain.some((m) => secondsLeft(m, now) === 0)) return null;
  return chain.reduce((best, m) => (until.get(m) < until.get(best) ? m : best), chain[0]);
}

module.exports = { markCooling, secondsLeft, earliestIfAllCooling, retryAfterSeconds, cooldownSeconds, _reset: () => until.clear() };

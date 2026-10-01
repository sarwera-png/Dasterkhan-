// Remembers which models just answered 429 / 503 and skips them for a while, so every customer message does not first wait on
// models that are known to be rate limited. Per server process, not per customer.
// Escalation: the first hit uses GEMINI_COOLDOWN_SECONDS (default 60). If the SAME model is rate limited again within 10 minutes after its
// cooldown ended, the next level applies: 5 min, then 15 min, then 30 min (cap). A successful answer from the model resets its level.
const DEFAULT_SECONDS = 60;
const MAX_ENV_SECONDS = 300; // cap for GEMINI_COOLDOWN_SECONDS itself
const MAX_SECONDS = 1800; // cap for escalated cooldowns and for Retry-After (30 min)
const LADDER = [null, 300, 900, 1800]; // seconds for level 2, 3, 4+ (level 1 = the configured base)
const RENEWAL_WINDOW_MS = 10 * 60 * 1000;
const state = new Map(); // model -> { until, level }

// GEMINI_COOLDOWN_SECONDS: whole seconds, 0 turns the cooldown off; anything invalid uses the default.
function cooldownSeconds() {
  const raw = process.env.GEMINI_COOLDOWN_SECONDS;
  if (raw === undefined || raw.trim() === '' || !/^\d+$/.test(raw.trim())) return DEFAULT_SECONDS;
  return Math.min(Number(raw.trim()), MAX_ENV_SECONDS);
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

// The level this hit has, given the model's previous hit (if any).
function nextLevel(prev, now) {
  return prev && now <= prev.until + RENEWAL_WINDOW_MS ? prev.level + 1 : 1;
}

function markCooling(model, status, retryAfter, now = Date.now()) {
  if (status !== 429 && status !== 503) return;
  const base = cooldownSeconds();
  if (base === 0) return; // cooldown switched off
  const level = nextLevel(state.get(model), now);
  const ladder = level === 1 ? base : Math.max(base, LADDER[Math.min(level - 1, LADDER.length - 1)]);
  const seconds = Math.min(Math.max(ladder, retryAfter || 0), MAX_SECONDS);
  state.set(model, { until: now + seconds * 1000, level });
}

// A model that just answered is available again and its level starts over (also keeps later tool rounds of the same message working).
function markOk(model) { state.delete(model); }

// Seconds left (rounded up) or 0. A finished cooldown stays remembered (for the level) until its renewal window has passed.
function secondsLeft(model, now = Date.now()) {
  const e = state.get(model);
  if (!e) return 0;
  if (e.until <= now) { if (now > e.until + RENEWAL_WINDOW_MS) state.delete(model); return 0; }
  return Math.ceil((e.until - now) / 1000);
}

const levelOf = (model) => (state.get(model) || { level: 0 }).level;

// If every model in the chain is cooling, the one whose cooldown ends first (so there is always at least one real attempt). Otherwise null.
function earliestIfAllCooling(chain, now = Date.now()) {
  if (!chain.length || chain.some((m) => secondsLeft(m, now) === 0)) return null;
  return chain.reduce((best, m) => (state.get(m).until < state.get(best).until ? m : best), chain[0]);
}

module.exports = { markCooling, markOk, secondsLeft, levelOf, earliestIfAllCooling, retryAfterSeconds, cooldownSeconds, _reset: () => state.clear() };

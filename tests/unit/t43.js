const ROOT = require('path').join(__dirname, '..', '..');
// Step AA: skip rate-limited models during a cooldown (same fallback order, always at least one real attempt)
const assert = require('assert'); const L = require('./lib.js'); const { base } = L.boot(3093);
const cooldown = require(ROOT + '/backend/cooldown');
const [M1, M2, M3] = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest']; // default chain, unchanged
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let behave = {}; const tried = [];
global.__STUB = async ({ model }) => { tried.push(model); const b = behave[model]; if (b && b.error) throw b.error(); return L.text('ok from ' + model); };
const logs = []; const ol = console.log; console.log = (...a) => { logs.push(a.join(' ')); ol(...a); };
const ask = async () => { tried.length = 0; logs.length = 0; const r = await L.post(base, { message: 'hello' }); return { r, tried: [...tried], skips: logs.filter(l => l.startsWith('Gemini skip:')) }; };
const with429 = (headers) => () => { const e = L.err(429); if (headers) e.headers = headers; return e; };
(async () => { await sleep(400);
  // 1) 429 on model 1 -> skipped inside the window, retried after it
  process.env.GEMINI_COOLDOWN_SECONDS = '1'; cooldown._reset(); behave = { [M1]: { error: with429() } };
  let a = await ask(); assert.deepStrictEqual(a.tried, [M1, M2]); assert.strictEqual(a.r.json.reply, 'ok from ' + M2); assert.deepStrictEqual(a.skips, []);
  a = await ask(); assert.deepStrictEqual(a.tried, [M2]); assert.deepStrictEqual(a.skips, [`Gemini skip: model=${M1} (cooldown 1s, level 1)`]); assert.strictEqual(a.r.json.reply, 'ok from ' + M2);
  await sleep(1150); a = await ask(); assert.deepStrictEqual(a.tried, [M1, M2]); assert.deepStrictEqual(a.skips, []);
  cooldown._reset(); /* the repeated 429 above escalated the level; start over for the recovery check */ behave = {}; a = await ask(); assert.deepStrictEqual(a.tried, [M1]); assert.strictEqual(a.r.json.reply, 'ok from ' + M1);
  console.log('1) 429 on the first model: the next request skips it (one log line "Gemini skip: model=... (cooldown 1s)"), after the window it is tried again first, and once it works again it answers: PASS');
  // 2) 503 cools too; 500 / timeout / other statuses do not; order of the rest unchanged
  cooldown._reset(); behave = { [M1]: { error: () => L.err(503) } }; await ask(); a = await ask(); assert.deepStrictEqual(a.tried, [M2]);
  cooldown._reset(); behave = { [M1]: { error: () => L.err(500) } }; await ask(); a = await ask(); assert.deepStrictEqual(a.tried, [M1, M2], '500 does not start a cooldown'); assert.deepStrictEqual(a.skips, []);
  cooldown._reset(); behave = { [M2]: { error: with429() }, [M1]: { error: () => L.err(500) } }; await ask(); a = await ask(); assert.deepStrictEqual(a.tried, [M1, M3], 'M2 skipped, the rest keep their order'); assert.deepStrictEqual(a.skips, [`Gemini skip: model=${M2} (cooldown 1s, level 1)`]); assert.strictEqual(a.r.json.reply, 'ok from ' + M3);
  console.log('2) 503 also starts a cooldown, 500 does not; with only the middle model cooling the order of the others is unchanged (model 1, then model 3): PASS');
  // 3) all cooling -> exactly one real attempt, on the one whose cooldown ends first
  process.env.GEMINI_COOLDOWN_SECONDS = '30'; cooldown._reset(); behave = { [M1]: { error: with429() }, [M2]: { error: with429() }, [M3]: { error: () => L.err(503) } };
  a = await ask(); assert.deepStrictEqual(a.tried, [M1, M2, M3]); assert.strictEqual(a.r.status, 503);
  await sleep(20); behave = {}; a = await ask(); assert.deepStrictEqual(a.tried, [M1], 'all cooling: exactly one attempt, on the earliest-ending cooldown'); assert.strictEqual(a.r.json.reply, 'ok from ' + M1); assert.deepStrictEqual(a.skips, []);
  cooldown._reset(); behave = { [M1]: { error: with429() }, [M2]: { error: with429() }, [M3]: { error: with429() } }; await ask(); a = await ask(); assert.deepStrictEqual(a.tried, [M1]); assert.strictEqual(a.r.status, 503); assert(a.r.json.reply);
  console.log('3) every model cooling: still exactly one real attempt (the one whose cooldown ends first); if it fails the customer gets the normal busy reply (503), never a blind failure: PASS');
  // 3b) the forced attempt may answer with tool calls: the next round of the same message must still use that model
  process.env.GEMINI_COOLDOWN_SECONDS = '30'; cooldown._reset(); behave = { [M1]: { error: with429() }, [M2]: { error: with429() }, [M3]: { error: () => L.err(503) } }; await ask(); behave = {}; const orig = global.__STUB; let round = 0;
  global.__STUB = async (req) => { tried.push(req.model); round += 1; return L.lastToolResults(req.contents) ? L.text('all done') : L.calls([{ name: 'viewCart' }], null); };
  a = await ask(); assert.deepStrictEqual(a.tried, [M1, M1], 'tool round 2 uses the same model although it was cooling before'); assert.strictEqual(a.r.json.reply, 'all done'); assert.strictEqual(cooldown.secondsLeft(M1), 0, 'a model that answered is no longer cooling'); global.__STUB = orig;
  console.log('3b) a cooling model picked as the forced attempt can answer a tool call and the next round of the same message still uses it; answering clears its cooldown: PASS');
  // 4) Retry-After wins, capped at 5 minutes
  process.env.GEMINI_COOLDOWN_SECONDS = '1'; cooldown._reset(); behave = { [M1]: { error: with429({ 'retry-after': '2' }) } }; await ask(); await sleep(1150); a = await ask(); assert.deepStrictEqual(a.tried, [M2], 'Retry-After 2 s is longer than the 1 s default'); await sleep(1100); a = await ask(); assert.deepStrictEqual(a.tried, [M1, M2]);
  cooldown._reset(); cooldown.markCooling(M1, 429, cooldown.retryAfterSeconds({ headers: { 'retry-after': '99999' } })); assert(cooldown.secondsLeft(M1) >= 1799 && cooldown.secondsLeft(M1) <= 1800); cooldown._reset();
  cooldown.markCooling(M1, 429, cooldown.retryAfterSeconds({ response: { headers: new Headers({ 'Retry-After': '7' }) } })); assert(cooldown.secondsLeft(M1) >= 6 && cooldown.secondsLeft(M1) <= 7);
  assert.strictEqual(cooldown.retryAfterSeconds({ headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } }), null); assert.strictEqual(cooldown.retryAfterSeconds(new Error('x')), null);
  console.log('4) a numeric Retry-After is used (2 s beat the 1 s default), capped at 30 min; dates or missing headers fall back to the default: PASS');
  // 5) env var: default 60, 0 = off, invalid -> 60, capped at 300
  for (const [v, want] of [[undefined, 60], ['', 60], ['abc', 60], ['-5', 60], ['1.5', 60], ['0', 0], ['90', 90], ['9999', 300]]) { if (v === undefined) delete process.env.GEMINI_COOLDOWN_SECONDS; else process.env.GEMINI_COOLDOWN_SECONDS = v; assert.strictEqual(cooldown.cooldownSeconds(), want, String(v)); }
  process.env.GEMINI_COOLDOWN_SECONDS = '0'; cooldown._reset(); behave = { [M1]: { error: with429() } }; await ask(); a = await ask(); assert.deepStrictEqual(a.tried, [M1, M2], 'cooldown off'); 
  console.log('5) GEMINI_COOLDOWN_SECONDS: default 60, 0 = off, invalid values use 60, max 300: PASS');
  // 6) fallback order, model names and timeouts untouched
  const src = require('fs').readFileSync(ROOT + '/backend/server.js', 'utf8'); assert(src.includes("DEFAULT_MODEL = 'gemini-3.8-flash'") && src.includes("'gemini-3.7-flash,gemini-flash-latest'") && src.includes('REQUEST_TIMEOUT_MS = 20000') && src.includes('TOTAL_DEADLINE_MS = 80000'));
  console.log = ol; console.log('6) default model names, fallback order and the 20 s / 80 s timeouts are unchanged: PASS'); console.log('ALL STEP-AA TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 8).join('\n')); process.exit(1); });

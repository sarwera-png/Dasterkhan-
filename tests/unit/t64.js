const ROOT = require('path').join(__dirname, '..', '..');
// Step AX: escalating cooldown for repeated rate limits (levels 60 s -> 5 min -> 15 min -> 30 min), reset by a success
const assert = require('assert'); const L = require('./lib.js'); const { base } = L.boot(3106);
const cd = require(ROOT + '/backend/cooldown'); delete process.env.GEMINI_COOLDOWN_SECONDS;
const M = 'gemini-3.8-flash'; const T0 = 1_000_000_000_000; const S = 1000;
const left = (m, now) => cd.secondsLeft(m, now);
// 1) the ladder: each repeat within 10 minutes after the cooldown ended goes up one level
cd._reset(); let now = T0; const seen = [];
for (let hit = 1; hit <= 6; hit += 1) { cd.markCooling(M, 429, null, now); seen.push([cd.levelOf(M), left(M, now)]); now += left(M, now) * S + 5 * S; /* tried again 5 s after the cooldown ended and hit 429 again */ }
assert.deepStrictEqual(seen, [[1, 60], [2, 300], [3, 900], [4, 1800], [5, 1800], [6, 1800]].map(([l, s]) => [Math.min(l, 4) === l ? l : l, s]), JSON.stringify(seen));
assert.deepStrictEqual(seen.map(x => x[1]), [60, 300, 900, 1800, 1800, 1800], 'capped at 30 minutes');
// 2) quiet for more than 10 minutes after the cooldown ended -> back to level 1; a success resets too
cd._reset(); cd.markCooling(M, 429, null, T0); cd.markCooling(M, 429, null, T0 + 65 * S); assert.strictEqual(cd.levelOf(M), 2); const end = T0 + 65 * S + 300 * S; cd.markCooling(M, 503, null, end + 11 * 60 * S); assert.strictEqual(cd.levelOf(M), 1); assert.strictEqual(left(M, end + 11 * 60 * S), 60);
cd._reset(); cd.markCooling(M, 429, null, T0); cd.markCooling(M, 429, null, T0 + 65 * S); cd.markCooling(M, 429, null, T0 + 400 * S); assert.strictEqual(cd.levelOf(M), 3); cd.markOk(M); assert.strictEqual(cd.levelOf(M), 0); cd.markCooling(M, 429, null, T0 + 401 * S); assert.strictEqual(cd.levelOf(M), 1); assert.strictEqual(left(M, T0 + 401 * S), 60);
// 3) Retry-After: the larger value wins, capped at 30 minutes
cd._reset(); cd.markCooling(M, 429, 120, T0); assert.strictEqual(left(M, T0), 120); cd.markCooling(M, 429, 100, T0 + 125 * S); assert.strictEqual(left(M, T0 + 125 * S), 300); cd.markCooling(M, 429, 5000, T0 + 440 * S); assert.strictEqual(left(M, T0 + 440 * S), 1800); cd._reset(); cd.markCooling(M, 429, 999999, T0); assert.strictEqual(left(M, T0), 1800);
// 4) 503 counts like 429, other statuses never start a cooldown, extra models use the same ladder, models are independent
cd._reset(); cd.markCooling(M, 503, null, T0); cd.markCooling(M, 503, null, T0 + 61 * S); assert.strictEqual(cd.levelOf(M), 2); for (const st of [500, 400, 401, 403, 404, 'timeout', 'error', 'bad_tool_args']) { cd.markCooling('other', st, null, T0); assert.strictEqual(left('other', T0), 0, String(st)); }
cd.markCooling('extra:model-a', 429, null, T0); cd.markCooling('extra:model-a', 429, null, T0 + 65 * S); assert.strictEqual(cd.levelOf('extra:model-a'), 2); assert.strictEqual(left('extra:model-a', T0 + 65 * S), 300); assert.strictEqual(cd.levelOf('gemini-3.7-flash'), 0);
// 5) configured base: level 1 uses it, higher levels never go below it; 0 = off (no cooldown, no levels)
process.env.GEMINI_COOLDOWN_SECONDS = '10'; cd._reset(); cd.markCooling(M, 429, null, T0); assert.strictEqual(left(M, T0), 10); cd.markCooling(M, 429, null, T0 + 12 * S); assert.strictEqual(left(M, T0 + 12 * S), 300);
process.env.GEMINI_COOLDOWN_SECONDS = '0'; cd._reset(); cd.markCooling(M, 429, null, T0); assert.strictEqual(left(M, T0), 0); assert.strictEqual(cd.levelOf(M), 0); delete process.env.GEMINI_COOLDOWN_SECONDS;
// 6) all cooling -> still the model whose cooldown ends first; one that is not cooling anymore -> null
cd._reset(); const chain = ['a', 'b', 'c']; cd.markCooling('a', 429, null, T0); cd.markCooling('a', 429, null, T0 + 61 * S); cd.markCooling('b', 429, null, T0 + 61 * S); cd.markCooling('c', 429, 900, T0 + 61 * S); assert.strictEqual(cd.earliestIfAllCooling(chain, T0 + 62 * S), 'b', 'b ends first (60 s) vs a (300 s) vs c (900 s)'); assert.strictEqual(cd.earliestIfAllCooling(chain, T0 + 130 * S), null, 'b is free again'); cd.markOk('b'); assert.strictEqual(cd.earliestIfAllCooling(chain, T0 + 62 * S), null);
console.log('1-6) escalating cooldown: 60 s -> 5 min -> 15 min -> 30 min (cap) when the same model is rate limited again within 10 minutes after its cooldown ended; a quiet period or one success starts over; Retry-After wins when larger (cap 30 min); 503 counts, other statuses never; extra models and Gemini share the ladder, models are independent; GEMINI_COOLDOWN_SECONDS is the level-1 base (0 = off); "all cooling" still picks the model whose cooldown ends first: PASS');
// 7) server flow: the skip line names the level; the fallback order of the other models is unchanged
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const logs = []; const ol = console.log; console.log = (...a) => { logs.push(a.join(' ')); ol(...a); };
const tried = []; global.__STUB = async ({ model }) => { tried.push(model); if (model === M) throw L.err(429); return L.text('ok from ' + model); };
(async () => { await sleep(400); cd._reset(); cd.markCooling(M, 429, null, Date.now() - 61 * S); // a previous 429 whose 60 s ended a second ago
  tried.length = 0; let r = await L.post(base, { message: 'one' }); assert.deepStrictEqual(tried, [M, 'gemini-3.7-flash'], 'tried again, 429 again, next model'); assert.strictEqual(cd.levelOf(M), 2);
  tried.length = 0; logs.length = 0; r = await L.post(base, { message: 'two' }); assert.deepStrictEqual(tried, ['gemini-3.7-flash']); assert(logs.some(l => /^Gemini skip: model=gemini-3\.8-flash \(cooldown (299|300)s, level 2\)$/.test(l)), logs.join('\n')); assert.strictEqual(r.json.reply, 'ok from gemini-3.7-flash');
  console.log = ol; console.log('7) real request flow: a repeated 429 moves the model to level 2 (5 min); the next messages skip it with "Gemini skip: model=... (cooldown 300s, level 2)" and the other models keep their order: PASS'); console.log('ALL STEP-AX TESTS PASSED'); process.exit(0); })().catch(e => { console.log = ol; console.error('TEST FAILED:', e.stack.split('\n').slice(0, 8).join('\n')); process.exit(1); });

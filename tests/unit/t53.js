const ROOT = require('path').join(__dirname, '..', '..');
// Step AM: a failed model attempt leaves NO side effects (state, conversation, text), Gemini path and extra-provider path
const assert = require('assert'); const fs = require('fs'); const http = require('http');
const L = require('./lib.js'); const { sessions, base } = L.boot(3099); const { executeTool } = require(ROOT + '/backend/tools');
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (st, n, a) => executeTool(n, a, { state: st });
const [G1, G2, G3] = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest'];
const logs = []; const ol = console.log, oe = console.error; console.log = (...a) => { logs.push(a.join(' ')); ol(...a); }; console.error = (...a) => { logs.push(a.join(' ')); oe(...a); };
// fake OpenAI-compatible server (extra provider path)
const reqs = []; let fakeBehave = () => ({ status: 200, body: { choices: [{ message: { content: 'x' } }] } });
const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { const j = JSON.parse(b || '{}'); reqs.push(j); const r = fakeBehave(j, reqs.length); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.body || {})); }); });
const oaiCalls = (calls, content = null) => ({ status: 200, body: { choices: [{ message: { role: 'assistant', content, tool_calls: calls.map((c, i) => ({ id: 'call_' + (i + 1), type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args || {}) } })) } }] } });
const oaiText = (t) => ({ status: 200, body: { choices: [{ message: { role: 'assistant', content: t } }] } });
const lastIsTool = (j) => j.messages[j.messages.length - 1].role === 'tool'; const toolCount = (j) => j.messages.filter(m => m.role === 'tool').length;
const ADD = { name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 1 } };
const ready = async () => { const keep = global.__STUB; global.__STUB = async () => L.text('ok'); const a = await L.post(base, { message: 'hi' }); global.__STUB = keep; const st = sessions.getOrCreateSession(a.json.sessionId).state; run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }] }); run(st, 'setOrderType', { orderType: 'pickup' }); run(st, 'setCustomerDetails', { name: 'Ali' }); return { sid: a.json.sessionId, st }; };
const reviewShown = async (sid) => { const keep = global.__STUB; global.__STUB = async ({ contents }) => (L.lastToolResults(contents) ? L.text('review shown') : L.calls([{ name: 'getOrderReview' }], null)); const r = await L.post(base, { message: 'review', sessionId: sid }); global.__STUB = keep; assert.match(r.json.reviewVersion, /^[0-9a-f]{16}$/); return r.json.reviewVersion; };
const ask = async (message, sid) => { logs.length = 0; return L.post(base, { message, sessionId: sid }); };
const snap = (st) => JSON.stringify(st);
(async () => { await sleep(400); await new Promise(r => fake.listen(0, '127.0.0.1', r)); process.env.GEMINI_COOLDOWN_SECONDS = '0';
  // ---------- Gemini path ----------
  // 1) model 1: tool round OK, then 429 on round 2 -> model 2 calls the same tool and answers: cart quantity exactly 1, only model 2's text, review untouched
  let { sid, st } = await ready(); const V = await reviewShown(sid); const cartBefore = JSON.stringify(st.items); assert.strictEqual(st.reviewShownVersion, V);
  let seen = []; global.__STUB = async ({ model, contents }) => { seen.push({ model, len: contents.length }); const res = L.lastToolResults(contents);
    if (model === G1) { if (!res) return L.calls([{ name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 1 } }], null); throw L.err(429); }
    if (model === G2) return res ? L.text('Final answer from model 2 only.') : L.calls([{ name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 1 } }], null); return L.text('unused'); };
  let r = await ask('add a naan', sid); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.reply, 'Final answer from model 2 only.');
  const naan = st.items.filter(l => l.id === 'NAN01'); assert.strictEqual(naan.length, 1); assert.strictEqual(naan[0].quantity, 1, 'exactly one naan, not two');
  assert.deepStrictEqual(seen.map(x => x.model), [G1, G1, G2, G2]); assert.strictEqual(seen[2].len, seen[0].len, 'model 2 starts from the same conversation as model 1 did');
  assert(logs.includes('Rollback: attempt 2 failed after 1 tool call(s), state restored'), logs.join('\n')); assert(!logs.some(l => /add a naan|Ali/.test(l)), 'no message text or name in the log');
  // review: the failed attempt itself changed nothing; model 2's own (successful) add legitimately changes the cart and so ends the old review
  st.items = JSON.parse(cartBefore); // reset for the next, review-focused check
  global.__STUB = async ({ model, contents }) => { const res = L.lastToolResults(contents); if (model === G1) { if (!res) return L.calls([{ name: 'getOrderReview' }, ADD], null); throw L.err(503); } return L.text('plain answer from model 2'); };
  const before = snap(st); r = await ask('anything', sid); assert.strictEqual(r.json.reply, 'plain answer from model 2'); assert.strictEqual(snap(st), before, 'state identical to the snapshot'); assert.strictEqual(st.reviewShownVersion, V); assert.strictEqual(r.json.reviewVersion, V, 'the review the customer saw is still valid after a failed attempt');
  console.log('1) Gemini: model 1 runs addItemToCart, then 429 on round 2 -> rolled back; model 2 adds -> exactly ONE naan, reply is model 2\'s text only, model 2 started from the same conversation, one "Rollback" log line without any message text; a failed attempt that ran getOrderReview + addItemToCart leaves state byte-identical and reviewVersion unchanged: PASS');
  // 2) text produced by a failed attempt is dropped
  global.__STUB = async ({ model, contents }) => { const res = L.lastToolResults(contents); if (model === G1) { if (!res) return L.calls([ADD], null); throw L.err(429); } return L.text('FINAL'); };
  ({ sid, st } = await ready()); r = await ask('x', sid); assert.strictEqual(r.json.reply, 'FINAL'); assert.strictEqual(r.json.reply.includes('Added'), false); assert.strictEqual(st.items.filter(l => l.id === 'NAN01').length, 0, 'nothing from the failed attempt remains');
  // 3) multi-round success inside ONE attempt keeps its effects
  global.__STUB = async ({ contents }) => { const n = contents.filter(c => c.parts.some(p => p.functionResponse)).length; return n === 0 ? L.calls([ADD], null) : n === 1 ? L.calls([{ name: 'viewCart' }], null) : L.text('two rounds done'); };
  ({ sid, st } = await ready()); r = await ask('x', sid); assert.strictEqual(r.json.reply, 'two rounds done'); assert.strictEqual(st.items.find(l => l.id === 'NAN01').quantity, 1); assert(!logs.some(l => l.startsWith('Rollback')));
  console.log('2) text from a failed attempt is dropped (reply = final successful attempt only); 3) a multi-round tool loop inside one successful attempt keeps its effects and logs no rollback: PASS');
  // 4) three failures after tool calls, then a success (mixed chain: 3 Gemini models fail, the extra model succeeds)
  process.env.EXTRA_AI_BASE_URL = `http://127.0.0.1:${fake.address().port}/v1`; process.env.EXTRA_AI_API_KEY = 'fake'; process.env.EXTRA_AI_MODELS = 'model-a,model-b';
  ({ sid, st } = await ready()); const snap4 = snap(st); const order = [];
  global.__STUB = async ({ model, contents }) => { order.push(model); const res = L.lastToolResults(contents); if (!res) return L.calls([ADD, { name: 'setOrderType', args: { orderType: 'delivery' } }], null); throw L.err(model === G1 ? 429 : model === G2 ? 503 : 500); };
  fakeBehave = (j) => (lastIsTool(j) ? oaiText('From the extra provider only.') : oaiCalls([ADD])); reqs.length = 0;
  r = await ask('add a naan', sid); assert.strictEqual(r.json.reply, 'From the extra provider only.'); assert.strictEqual(st.items.filter(l => l.id === 'NAN01').length, 1); assert.strictEqual(st.items.find(l => l.id === 'NAN01').quantity, 1); assert.strictEqual(st.orderType, 'pickup', 'the failed attempts\' setOrderType(delivery) was undone');
  assert.strictEqual(logs.filter(l => l.startsWith('Rollback')).length, 3, logs.join('\n')); assert(logs.some(l => /^Rollback: attempt 2 failed after 2 tool call\(s\)/.test(l))); assert.strictEqual(reqs.length, 2, 'extra: tool request + final request'); assert.strictEqual(reqs[0].messages.filter(m => m.role === 'tool').length, 0, 'the extra model starts without any tool results of the failed attempts');
  console.log('4) three Gemini models each run tools then fail (429, 503, 500) -> three rollbacks; the extra provider then starts clean and the cart has exactly one naan, order type unchanged: PASS');
  // 5) all fail -> state equals the snapshot, safe busy reply
  ({ sid, st } = await ready()); const snap5 = snap(st); global.__STUB = async ({ contents }) => { if (!L.lastToolResults(contents)) return L.calls([ADD, { name: 'setOrderType', args: { orderType: 'delivery' } }], null); throw L.err(429); };
  fakeBehave = (j) => (lastIsTool(j) ? { status: 429, body: {} } : oaiCalls([ADD])); r = await ask('x', sid); assert.strictEqual(r.status, 503); assert(/busy/i.test(r.json.reply)); assert.strictEqual(snap(st), snap5, 'state equals the snapshot'); assert(logs.some(l => l === 'AI: all models failed')); assert.strictEqual(logs.filter(l => l.startsWith('Rollback')).length, 5);
  console.log('5) every attempt (3 Gemini + 2 extra) runs tools and fails: 5 rollbacks, the busy reply (503) is returned and the state equals the snapshot byte for byte: PASS');
  // 6) failures without tool calls (and a thrown exception) log no rollback; Gemini 403 after tools is rolled back before the 502 / the extra jump
  ({ sid, st } = await ready()); global.__STUB = async ({ model }) => { if (model === G1) throw new Error('boom'); return L.text('ok ' + model); }; process.env.EXTRA_AI_MODELS = ''; r = await ask('x', sid); assert.strictEqual(r.json.reply, 'ok ' + G2); assert(!logs.some(l => l.startsWith('Rollback')), 'nothing to undo');
  const s6 = snap(st); global.__STUB = async ({ contents }) => { if (!L.lastToolResults(contents)) return L.calls([ADD], null); throw L.err(403); }; r = await ask('x', sid); assert.strictEqual(r.status, 502); assert.strictEqual(snap(st), s6); assert(logs.some(l => /^Rollback: attempt 2 failed after 1 tool call/.test(l)));
  console.log('6) an exception without tools needs no rollback line; a Gemini 403 after a tool call is rolled back first (502 answer, state unchanged): PASS');
  // ---------- extra-provider path (Gemini down) ----------
  process.env.EXTRA_AI_MODELS = 'model-a,model-b'; global.__STUB = async () => { throw L.err(429); };
  // 7) model-a: valid tool call, then malformed args on round 2 -> rollback -> model-b adds once and answers
  ({ sid, st } = await ready()); reqs.length = 0; fakeBehave = (j) => { if (j.model === 'model-a') return lastIsTool(j) ? oaiCalls([{ name: 'addItemToCart', args: '{"itemId": "NAN01", quantity' }]) : oaiCalls([ADD]); return lastIsTool(j) ? oaiText('model-b final') : oaiCalls([ADD]); };
  r = await ask('add a naan', sid); assert.strictEqual(r.json.reply, 'model-b final'); assert.strictEqual(st.items.find(l => l.id === 'NAN01').quantity, 1); assert.strictEqual(st.items.filter(l => l.id === 'NAN01').length, 1); assert(logs.some(l => /^Rollback: attempt \d failed after 1 tool call\(s\), state restored$/.test(l)));
  const bReqs = reqs.filter(q => q.model === 'model-b'); assert.strictEqual(toolCount(bReqs[0]), 0, 'model-b\'s first request has no tool results from model-a');
  // 8) unknown tool, empty reply, HTTP 429 and 500 after a first tool round: all roll back
  for (const [name, second] of [['unknown tool', oaiCalls([{ name: 'deleteEverything' }])], ['empty reply', oaiText('  ')], ['HTTP 429', { status: 429, body: {} }], ['HTTP 500', { status: 500, body: {} }], ['bad body', { status: 200, body: {} }]]) {
    ({ sid, st } = await ready()); fakeBehave = (j) => { if (j.model === 'model-a') return lastIsTool(j) ? second : oaiCalls([ADD]); return lastIsTool(j) ? oaiText('b ok') : oaiCalls([ADD]); };
    r = await ask('x', sid); assert.strictEqual(r.json.reply, 'b ok', name); assert.strictEqual(st.items.find(l => l.id === 'NAN01').quantity, 1, name + ': exactly one naan'); assert.strictEqual(st.items.filter(l => l.id === 'NAN01').length, 1, name);
  }
  // 9) reply text sent alongside tool calls by a failed extra attempt is not used; all extra fail -> snapshot
  ({ sid, st } = await ready()); const s9 = snap(st); fakeBehave = (j) => (lastIsTool(j) ? { status: 503, body: {} } : oaiCalls([ADD], 'Sure, adding it. Would you like anything else?')); r = await ask('x', sid); assert.strictEqual(r.status, 503); assert(!r.json.reply.includes('Would you like')); assert.strictEqual(snap(st), s9);
  console.log('7-9) extra path: valid tool call then malformed arguments / unknown tool / empty reply / HTTP 429 / 500 / bad body -> rolled back, the next model adds exactly once and its text alone is the reply; text sent next to tool calls by a failed attempt is never used; all fail -> state equals the snapshot: PASS');
  // 10) the guard and the confirm gate behave the same after a rollback
  ({ sid, st } = await ready()); global.__STUB = async ({ contents }) => { if (!L.lastToolResults(contents)) return L.calls([ADD], null); throw L.err(429); }; fakeBehave = () => oaiText('Your order is confirmed!'); process.env.EXTRA_AI_MODELS = 'model-a'; r = await ask('hi', sid); assert(r.json.reply.startsWith('Your order has not been placed yet'), 'guard still replaces a fake confirmation'); assert.strictEqual(JSON.parse(fs.readFileSync(global.__ORDERS_FILE, 'utf8')).length, 0);
  console.log = ol; console.error = oe; fake.close(); console.log('10) the fake-confirmation guard still works on the answer that follows a rollback and nothing was saved: PASS'); console.log('ALL STEP-AM TESTS PASSED'); process.exit(0);
})().catch(e => { console.log = ol; console.error = oe; console.error('TEST FAILED:', e.stack.split('\n').slice(0, 10).join('\n')); process.exit(1); });

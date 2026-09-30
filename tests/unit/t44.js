const ROOT = require('path').join(__dirname, '..', '..');
// Step AB: clear reply to agreement words after a review (prompt rule; the code path is unchanged)
const assert = require('assert'); const fs = require('fs'); const L = require('./lib.js'); const { sessions, base } = L.boot(3094);
const { renderPrompt } = require(ROOT + '/backend/facts'); const { loadRestaurant } = require(ROOT + '/backend/data'); const { executeTool } = require(ROOT + '/backend/tools');
const prompt = renderPrompt(fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8'), loadRestaurant());
const rule = prompt.split('\n').find(l => l.startsWith('4. Agreement words'));
assert(rule, 'the agreement-words rule exists as numbered step 4');
for (const w of ['"yes"', '"ok"', '"okay"', '"done"', '"theek hai"', '"ٹھیک ہے"', '"haan"', '"جی ہاں"', '"confirm"']) assert(rule.includes(w), 'rule lists ' + w);
for (const t of ['NOT placed yet', 'Confirm order / آرڈر کی تصدیق کریں', "customer's language and script", 'Never answer such a message as if the customer had asked you a question', 'never ask them anything back', 'valid order review is showing']) assert(rule.includes(t), t);
assert(prompt.includes('5. Confirmation happens ONLY when the customer presses that button.') && prompt.includes('8. If the customer says no or wants to stop'), 'steps renumbered 1-8');
assert.strictEqual((prompt.match(/^\d\. /gm) || []).length >= 8, true);
console.log('1) the system prompt has the agreement-words rule (yes, ok, okay, done, theek hai, ٹھیک ہے, haan, جی ہاں, confirm): order NOT placed yet, press "Confirm order / آرڈر کی تصدیق کریں", in the customer\'s language, never answered as a question; steps renumbered 1-8: PASS');
// the rule reaches the model with every request, and typing still never confirms (code unchanged)
let sys = ''; global.__STUB = async ({ contents, config }) => { sys = config.systemInstruction; const res = L.lastToolResults(contents); return res ? L.text(res[0].response.customerMessage) : L.text('ok'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => { await sleep(400); const a = await L.post(base, { message: 'hi' }); const st = sessions.getOrCreateSession(a.json.sessionId).state; const run = (n, x) => executeTool(n, x, { state: st });
  run('addItemToCart', { itemId: 'NAN01', quantity: 1 }); run('setOrderType', { orderType: 'pickup' }); run('setCustomerDetails', { name: 'Ali' });
  assert(sys.includes('4. Agreement words') && sys.includes('"جی ہاں"'));
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); return res ? L.text(res[0].response.customerMessage) : L.calls([{ name: 'getOrderReview' }], null); }; const rv = await L.post(base, { message: 'review', sessionId: a.json.sessionId }); assert(rv.json.reviewVersion);
  global.__STUB = async () => L.text('ok');
  for (const w of ['yes', 'ok', 'okay', 'done', 'theek hai', 'ٹھیک ہے', 'haan', 'جی ہاں', 'confirm']) { await L.post(base, { message: w, sessionId: a.json.sessionId }); assert.strictEqual(st.status, 'draft', w); assert.strictEqual(st.orderId, null); }
  assert.strictEqual(JSON.parse(fs.readFileSync(global.__ORDERS_FILE, 'utf8')).length, 0);
  console.log('2) the rule is sent to the model with every request; typing yes/ok/okay/done/theek hai/ٹھیک ہے/haan/جی ہاں/confirm after a review still does not confirm or save anything: PASS'); console.log('ALL STEP-AB TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 8).join('\n')); process.exit(1); });

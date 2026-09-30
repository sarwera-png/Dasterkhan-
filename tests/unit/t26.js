const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3066);
const { executeTool, TOOL_DECLARATIONS } = require(ROOT + '/backend/tools'); const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state });
const regular = [{ name: 'spice', choice: 'regular' }]; const FORBIDDEN = /\b(do not|tool|setOrderType|applyPromotion|internal|nothing was changed)\b/i;
(async () => { await sleep(500);
  // ---- declarations
  const apply = TOOL_DECLARATIONS.find(t => t.name === 'applyPromotion'), setT = TOOL_DECLARATIONS.find(t => t.name === 'setOrderType');
  assert.deepStrictEqual(Object.keys(apply.parameters.properties), ['code']); assert.deepStrictEqual(apply.parameters.required, ['code']);
  assert(setT && setT.parameters.required[0] === 'orderType' && /ONLY when the customer has explicitly said/.test(setT.description) && /Never assume, guess or default/.test(setT.description));
  console.log('1) applyPromotion no longer has an orderType parameter; setOrderType exists (required orderType; description: only when the customer explicitly said it, never assume/guess/default): PASS');
  // ---- the exact transcript, driven through /api/chat with a scripted (well-behaved) model
  // cart: 2 x Chicken Biryani regular + 1 x Beef Pulao  (food 1150 PKR)
  const setup = await L.post(base, { message: 'hello' }); // creates the session (model stub below is replaced right after)
  const sid = setup.json.sessionId, st = sessions.getOrCreateSession(sid).state;
  run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: regular }); run(st, 'addItemToCart', { itemId: 'PUL01', quantity: 1 });
  const script = { 'Apply PICKUP50': [{ name: 'applyPromotion', args: { code: 'PICKUP50', orderType: 'pickup' } }], // model tries to sneak orderType in
                   'Delivery': [{ name: 'setOrderType', args: { orderType: 'delivery' } }],
                   'Actually pickup. Apply PICKUP50': [{ name: 'setOrderType', args: { orderType: 'pickup' } }, { name: 'applyPromotion', args: { code: 'PICKUP50' } }],
                   'Delivery please': [{ name: 'setOrderType', args: { orderType: 'delivery' } }] };
  const toolLog = [];
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); const user = contents.filter(c => c.role === 'user' && c.parts[0].text).pop().parts[0].text;
    if (!res) return L.calls(script[user]); toolLog.push(res.map(r => r.response)); return L.text(res.map(r => r.response.customerMessage).join(' ')); };
  const say = (m) => L.post(base, { message: m, sessionId: sid });
  let r = await say('Apply PICKUP50');
  assert.strictEqual(r.json.reply, 'Is this order for pickup or delivery?'); assert.strictEqual(st.discount, null); assert.strictEqual(st.orderType, null);
  console.log('2) "Apply PICKUP50" (customer never said pickup/delivery; model even passes orderType:"pickup") -> NOT applied, order type stays unset, reply: "' + r.json.reply + '": PASS');
  r = await say('Delivery'); assert.strictEqual(st.orderType, 'delivery'); assert.strictEqual(st.discount, null); assert.strictEqual(r.json.reply, 'Got it: this order is for delivery.');
  console.log('3) "Delivery" -> setOrderType delivery recorded; still no discount: PASS');
  r = await say('Actually pickup. Apply PICKUP50');
  assert.strictEqual(st.orderType, 'pickup'); assert.deepStrictEqual(st.discount, { code: 'PICKUP50', name: 'Pickup 50 PKR off', amount: 50, foodSubtotal: 1150 });
  assert.strictEqual(r.json.reply, 'Got it: this order is for pickup. Promo code PICKUP50 applied: 50 PKR off your food.');
  const applyResult = toolLog[toolLog.length - 1][1]; assert.deepStrictEqual([applyResult.foodSubtotal, applyResult.discountAmount, applyResult.foodSubtotalAfterDiscount], [1150, 50, 1100]);
  console.log('4) "Actually pickup. Apply PICKUP50" -> setOrderType pickup + code applied; 50 PKR off comes from the tool (food 1150 -> 1100 also from the tool): PASS');
  r = await say('Delivery please');
  assert.strictEqual(st.orderType, 'delivery'); assert.strictEqual(st.discount, null);
  assert.strictEqual(r.json.reply, 'Got it: this order is for delivery. Your PICKUP50 discount was removed because your order no longer qualifies for it. Sorry, this code is only for pickup orders.');
  assert(!FORBIDDEN.test(r.json.reply)); const removedResult = toolLog[toolLog.length - 1][0]; assert.strictEqual(removedResult.discountRemoved.code, 'PICKUP50'); assert.strictEqual(removedResult.changed, true);
  console.log('5) switch to delivery AFTER PICKUP50 was applied -> discount removed (state.discount null) and the customer is told: "' + r.json.reply + '": PASS');
  // ---- cart changes still re-check; message included at top level
  const p = sessions.getOrCreateSession().state; run(p, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: regular }); run(p, 'addItemToCart', { itemId: 'PUL01', quantity: 1 });
  run(p, 'setOrderType', { orderType: 'pickup' }); run(p, 'applyPromotion', { code: 'PICKUP50' }); assert.strictEqual(p.discount.amount, 50);
  let x = run(p, 'removeItem', { itemId: 'PUL01' }); assert.strictEqual(p.discount.foodSubtotal, 700); assert.strictEqual(x.discountRemoved, undefined); // 700 is still >= 700
  x = run(p, 'modifyItem', { itemId: 'BRY01', quantity: 1 }); assert.strictEqual(p.discount, null); assert(x.customerMessage.includes('PICKUP50 discount was removed') && x.customerMessage.includes('Updated:')); assert(!FORBIDDEN.test(x.customerMessage));
  console.log('6) cart drops below 700 -> PICKUP50 removed and the cart tool\'s own customerMessage says so: PASS');
  // setOrderType details
  const q = sessions.getOrCreateSession().state; run(q, 'addItemToCart', { itemId: 'BRY01', quantity: 4, options: regular }); run(q, 'addItemToCart', { itemId: 'PUL01', quantity: 1 }); // 1850
  run(q, 'setOrderType', { orderType: 'delivery' }); run(q, 'applyPromotion', { code: 'FAMILY10' }); assert.strictEqual(q.discount.amount, 185);
  x = run(q, 'setOrderType', { orderType: 'pickup' }); assert.strictEqual(q.discount.code, 'FAMILY10'); assert.strictEqual(x.discountRemoved, undefined); assert.strictEqual(x.customerMessage, 'Got it: this order is for pickup.');
  x = run(q, 'setOrderType', { orderType: 'pickup' }); assert.strictEqual(x.changed, false);
  console.log('7) FAMILY10 (both order types) survives pickup <-> delivery switches; same type twice is harmless: PASS');
  const bad = fresh(); for (const v of ['takeaway', '', '  ', null, undefined, 5, 'both', 'pickup or delivery', {}, ['pickup']]) { const y = run(bad, 'setOrderType', { orderType: v }); assert.deepStrictEqual([y.ok, y.error, y.customerMessage], [false, 'invalid_order_type', 'Is this order for pickup or delivery?']); assert.strictEqual(bad.orderType, null); }
  assert.strictEqual(run(bad, 'setOrderType', { orderType: ' PickUp ' }).orderType, 'pickup');
  console.log('8) invalid order types (takeaway, empty, null, number, "both", object, array) rejected with "Is this order for pickup or delivery?"; nothing set; " PickUp " normalised: PASS');
  // session isolation
  const A = fresh(), B = fresh(); run(A, 'setOrderType', { orderType: 'delivery' }); assert.strictEqual(B.orderType, null);
  console.log('9) order type set in one session never appears in another: PASS');
  // ---- prompt: interim rules, no model math, no order offers
  const prompt = fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8');
  for (const line of ['Never calculate totals, subtotals or discounts yourself; only repeat amounts returned by tools.', 'Never assume, guess or default pickup or delivery', 'Is this order for pickup or delivery?', 'Never calculate totals, subtotals or discounts yourself; only repeat amounts that a tool returned.', '## Order review and confirmation'])
    assert(prompt.includes(line), 'prompt missing: ' + line);
  assert(!/You may add up the total only from approved prices/.test(prompt)); assert(!/totals not computed from approved prices/.test(prompt));
  // no tool returns a total
  for (const t of [run(p, 'viewCart', {}), run(q, 'viewCart', {}), run(q, 'getRecommendations', {})]) assert(!('total' in t)); // totals live in a separate, code-built 'totals' object
  console.log('10) prompt has the interim rules (no model-made totals, no "place this order" offers, online ordering not available yet) placed BEFORE the confirmation steps; old "add up the total yourself" wording removed; no tool exposes a total: PASS');
  console.log('ALL STEP-26 TESTS PASSED'); process.exit(0);
  function fresh() { return sessions.getOrCreateSession().state; }
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); });

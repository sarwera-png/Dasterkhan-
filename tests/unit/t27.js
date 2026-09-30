const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
// capture everything the server writes to the console (log + error) to prove what is / is not logged
const captured = []; for (const k of ['log', 'error', 'warn']) { const orig = console[k].bind(console); console[k] = (...a) => { captured.push(a.map(String).join(' ')); orig(...a); }; }
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3067);
const { executeTool, runToolCalls, describeToolOutcome, TOOL_DECLARATIONS } = require(ROOT + '/backend/tools'); const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const run = (state, name, args) => executeTool(name, args, { state }); const mild = [{ name: 'spice', choice: 'mild' }]; const fresh = () => sessions.getOrCreateSession().state;
const toolLines = () => captured.filter(l => l.startsWith('Tool result:'));
(async () => { await sleep(500);
  // ================= 1) tool-result logging
  const st = fresh(); st.customer = { name: 'CANARY-NAME-Ayesha', phone: '0300-CANARY-PHONE', address: 'CANARY-ADDRESS-Block-9' };
  const n0 = captured.length;
  runToolCalls([{ name: 'getMenu', args: {} }], { state: st });
  runToolCalls([{ name: 'addItemToCart', args: { itemId: 'BRY01', quantity: 2, options: mild } }], { state: st });
  runToolCalls([{ name: 'applyPromotion', args: { code: 'PICKUP50' } }], { state: st });
  runToolCalls([{ name: 'setOrderType', args: { orderType: 'pickup' } }], { state: st });
  runToolCalls([{ name: 'applyPromotion', args: { code: 'PICKUP50' } }], { state: st });
  runToolCalls([{ name: 'viewCart', args: {} }], { state: st });
  runToolCalls([{ name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 0 } }, { name: 'applyPromotion', args: { code: 'SAVE50' } }, { name: 'bogusTool', args: {} }], { state: st });
  const lines = captured.slice(n0).filter(l => l.startsWith('Tool result:'));
  const expected = ['Tool result: getMenu -> ok (items=0, orderType=not-set, promos=none)', 'Tool result: addItemToCart -> ok (items=1, orderType=not-set, promos=none)', 'Tool result: applyPromotion -> rejected (ORDER_TYPE_NEEDED)',
    'Tool result: setOrderType -> ok (items=1, orderType=pickup, promos=none)', 'Tool result: applyPromotion -> ok (items=1, orderType=pickup, promos=PICKUP50)', 'Tool result: viewCart -> ok (items=1, orderType=pickup, promos=PICKUP50)',
    'Tool result: addItemToCart -> rejected (INVALID_QUANTITY)', 'Tool result: applyPromotion -> rejected (INVALID_CODE)', 'Tool result: unknown -> rejected (UNKNOWN_TOOL)'];
  assert.deepStrictEqual(lines, expected);
  lines.forEach(l => assert(/^Tool result: \w+ -> (ok \(items=\d+, orderType=[\w-]+, promos=[\w-]+\)|rejected \([A-Z_]+\))$/.test(l), l));
  console.log('1a) one short line per tool call, exactly the format asked for:\n     ' + lines.join('\n     ') + '\n    PASS');
  // HTTP path: message canary, api key stub value, personal-detail canaries must never be logged
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); return res ? L.text('done') : L.calls([{ name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 1 } }, { name: 'viewCart', args: {} }], null); };
  const h = await L.post(base, { message: 'MYSECRETMESSAGE-please add naan, my phone is 0300-CANARY-PHONE' }); const stH = sessions.getOrCreateSession(h.json.sessionId).state; stH.customer.name = 'CANARY-NAME-Ayesha'; run(stH, 'viewCart', {});
  const all = captured.join('\n');
  for (const secret of ['MYSECRETMESSAGE', 'CANARY-NAME', 'CANARY-PHONE', 'CANARY-ADDRESS', 'stub-not-a-real-key', '"lineId"', '"itemId"', 'Dastarkhwan Assistant', 'Menu data', 'BRY01']) assert(!all.includes(secret), 'LOGGED: ' + secret);
  assert(toolLines().length >= 9 + 2);
  console.log('1b) through /api/chat: customer message, name/phone/address, the API key value, cart JSON and prompt text never appear in any console output (' + captured.length + ' lines checked): PASS');
  // ================= 2) viewCart order type + promotions
  const v = fresh(); let r = run(v, 'viewCart', {});
  assert.deepStrictEqual([r.orderType, r.orderTypeText, r.promotions, r.isEmpty], [null, 'not set', [], true]); assert(r.customerMessage.includes('Order type: not chosen yet'));
  run(v, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(v, 'addItemToCart', { itemId: 'PUL01', quantity: 1 });
  const snap = JSON.stringify(v); r = run(v, 'viewCart', {}); assert.strictEqual(JSON.stringify(v), snap);
  assert.deepStrictEqual([r.orderType, r.orderTypeText, r.promotions], [null, 'not set', []]);
  run(v, 'setOrderType', { orderType: 'pickup' }); run(v, 'applyPromotion', { code: 'PICKUP50' }); r = run(v, 'viewCart', {});
  assert.deepStrictEqual([r.orderType, r.orderTypeText], ['pickup', 'pickup']); assert.deepStrictEqual(r.promotions, [{ code: 'PICKUP50', name: 'Pickup 50 PKR off', discountAmount: 50, discountText: '50 PKR' }]);
  assert.strictEqual(r.summary, '2 x Chicken Biryani (spice: mild)\n1 x Beef Pulao'); assert.deepStrictEqual(r.totals, { foodSubtotal: 1150, discountAmount: 50, deliveryFee: 0, tax: 0, total: 1100 }); assert(!('total' in r) && !('subtotal' in r));
  assert.strictEqual(r.customerMessage, 'Your cart:\n2 x Chicken Biryani (spice: mild)\n1 x Beef Pulao\nOrder type: pickup\nPromo code PICKUP50: 50 PKR off your food\nFood subtotal: 1150 PKR\nDiscount (PICKUP50): -50 PKR\nPickup: free\nTotal: 1100 PKR');
  console.log('2a) viewCart -> order type + applied promo with the code-computed amount:\n     ' + r.customerMessage.split('\n').join('\n     ') + '\n    read-only, item lines unchanged, totals computed by code: PASS');
  run(v, 'setOrderType', { orderType: 'delivery' }); r = run(v, 'viewCart', {}); assert.deepStrictEqual([r.orderType, r.promotions], ['delivery', []]); assert(r.customerMessage.includes('Order type: delivery') && r.customerMessage.endsWith('Food subtotal: 1150 PKR\nDelivery fee: 150 PKR\nTotal: 1300 PKR'));
  const f = fresh(); run(f, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(f, 'addItemToCart', { itemId: 'PUL01', quantity: 2 }); run(f, 'applyPromotion', { code: 'FAMILY10' }); r = run(f, 'viewCart', {});
  assert.deepStrictEqual(r.promotions.map(p => [p.code, p.discountAmount, p.discountText]), [['FAMILY10', 160, '160 PKR']]); assert.strictEqual(r.orderType, null);
  run(f, 'addItemToCart', { itemId: 'TEA01', quantity: 1 }); assert.strictEqual(run(f, 'viewCart', {}).promotions[0].discountAmount, 170);
  const e = fresh(); run(e, 'setOrderType', { orderType: 'delivery' }); r = run(e, 'viewCart', {}); assert.deepStrictEqual([r.isEmpty, r.orderType, r.promotions], [true, 'delivery', []]);
  console.log('2b) switching to delivery drops PICKUP50 from the view; FAMILY10 shows 160 PKR then 170 PKR after the cart grows (amounts from code); empty cart still reports order type: PASS');
  const sess = sessions.getOrCreateSession(), sess2 = sessions.getOrCreateSession(); run(sess.state, 'setOrderType', { orderType: 'pickup' }); assert.strictEqual(run(sess2.state, 'viewCart', {}).orderType, null);
  const prompt = fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8');
  for (const line of ['Whenever you show the cart, also always mention the order type (pickup, delivery, or not chosen yet) and any applied promo code with its discount amount, exactly as the tool returns them, in the customer\'s language (in Urdu script if the customer wrote in Urdu script).', 'never calculate or state a total or subtotal yourself.']) assert(prompt.includes(line), line);
  console.log('2c) another session never sees this order type; system prompt tells the model to always mention order type + promo when showing the cart, in the customer\'s language (Urdu script for Urdu), and still never state totals/subtotals: PASS');
  // ================= 3) no-finalize wording (prompt)
  assert(prompt.includes('You can never say or imply that an order has been placed, confirmed, saved or sent on your own.') && prompt.includes('press the "Confirm order" button') && !/Never say "finalize"/.test(prompt));
  assert(!TOOL_DECLARATIONS.some(t => /finaliz|place your order|ready to order|confirm your order/i.test(t.description)));
  const msgs = []; const c = fresh(); run(c, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); for (const t of [run(c, 'viewCart', {}), run(c, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }), run(c, 'applyPromotion', { code: 'X' }), run(c, 'setOrderType', { orderType: 'pickup' })]) msgs.push(t.customerMessage);
  assert(!msgs.some(m => /finaliz|ready to order|place your order|confirm your order/i.test(m)));
  console.log('3) prompt forbids "finalize / ready to order / place your order / confirm your order" wording (interim section, before the dormant confirmation steps); tool customerMessages and tool descriptions contain none of those phrases: PASS');
  // ================= 4) setOrderType always runs first
  const t4 = fresh(); run(t4, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(t4, 'addItemToCart', { itemId: 'PUL01', quantity: 1 });
  const n1 = captured.length; const calls = [{ name: 'applyPromotion', args: { code: 'PICKUP50' }, id: 'call-A' }, { name: 'setOrderType', args: { orderType: 'pickup' }, id: 'call-B' }];
  const res = runToolCalls(calls, { state: t4 });
  assert.strictEqual(res[0].ok, true); assert.strictEqual(res[0].discountAmount, 50); assert.strictEqual(res[1].ok, true); assert.strictEqual(res[1].orderType, 'pickup'); assert.strictEqual(t4.discount.code, 'PICKUP50');
  const order = captured.slice(n1).filter(l => l.startsWith('Tool result:')).map(l => l.split(' ')[2]); assert.deepStrictEqual(order, ['setOrderType', 'applyPromotion']);
  const control = fresh(); run(control, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(control, 'addItemToCart', { itemId: 'PUL01', quantity: 1 }); assert.strictEqual(run(control, 'applyPromotion', { code: 'PICKUP50' }).error, 'order_type_needed');
  console.log('4a) model sends [applyPromotion, setOrderType]: setOrderType EXECUTED first (log order: ' + order.join(' -> ') + '), so PICKUP50 applies (50 PKR); results returned in the model\'s original order (control: apply first would have been order_type_needed): PASS');
  const t5 = fresh(); run(t5, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(t5, 'addItemToCart', { itemId: 'PUL01', quantity: 1 });
  const r5 = runToolCalls([{ name: 'applyPromotion', args: { code: 'PICKUP50' } }, { name: 'setOrderType', args: { orderType: 'delivery' } }], { state: t5 }); assert.strictEqual(r5[0].error, 'order_type_not_eligible'); assert.strictEqual(t5.discount, null); assert.strictEqual(t5.orderType, 'delivery');
  const t6 = fresh(); const n2 = captured.length; runToolCalls([{ name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 1 } }, { name: 'applyPromotion', args: { code: 'FAMILY10' } }, { name: 'setOrderType', args: { orderType: 'delivery' } }, { name: 'setOrderType', args: { orderType: 'pickup' } }, { name: 'viewCart', args: {} }], { state: t6 });
  assert.deepStrictEqual(captured.slice(n2).filter(l => l.startsWith('Tool result:')).map(l => l.split(' ')[2]), ['setOrderType', 'setOrderType', 'addItemToCart', 'applyPromotion', 'viewCart']); assert.strictEqual(t6.orderType, 'pickup');
  console.log('4b) [apply, setOrderType delivery] -> delivery wins first, PICKUP50 refused; five mixed calls: both setOrderType calls first (keeping their own relative order, last one wins), the rest in original order: PASS');
  // through the real /api/chat loop: function responses go back in the ORIGINAL order with their ids
  let sent = null; global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); if (res) { sent = contents[contents.length - 1].parts; return L.text('ok'); }
    const r = L.calls([{ name: 'applyPromotion', args: { code: 'PICKUP50' } }, { name: 'setOrderType', args: { orderType: 'pickup' } }], null); r.candidates[0].content.parts[0].functionCall.id = 'id-1'; r.candidates[0].content.parts[1].functionCall.id = 'id-2'; return r; };
  const first = await L.post(base, { message: 'hi' }); const stS = sessions.getOrCreateSession(first.json.sessionId).state; run(stS, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(stS, 'addItemToCart', { itemId: 'PUL01', quantity: 1 });
  await L.post(base, { message: 'Apply PICKUP50, pickup', sessionId: first.json.sessionId });
  assert.deepStrictEqual(sent.map(p => [p.functionResponse.name, p.functionResponse.id]), [['applyPromotion', 'id-1'], ['setOrderType', 'id-2']]); assert.strictEqual(sent[0].functionResponse.response.ok, true); assert.strictEqual(stS.discount.code, 'PICKUP50'); assert.strictEqual(stS.orderType, 'pickup');
  console.log('4c) HTTP loop: same reordering; function responses sent back in the model\'s original order with their ids (applyPromotion ok, discount stored): PASS');
  console.log('ALL STEP-27 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 7).join('\n')); process.exit(1); });

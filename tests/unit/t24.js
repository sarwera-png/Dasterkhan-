const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3064);
const { executeTool } = require(ROOT + '/backend/tools'); const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state });
const promoFile = ROOT + '/data/promotions.json'; const promoBackup = fs.readFileSync(promoFile, 'utf8');
const mild = [{ name: 'spice', choice: 'mild' }]; const fresh = () => sessions.getOrCreateSession().state;
const cart1600 = () => { const s = fresh(); run(s, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(s, 'addItemToCart', { itemId: 'PUL01', quantity: 2 }); return s; };
(async () => { await sleep(500);
  // ---- FAMILY10
  let st = cart1600(); let r = run(st, 'applyPromotion', { code: 'FAMILY10' });
  assert.deepStrictEqual([r.ok, r.foodSubtotal, r.discountAmount, r.foodSubtotalAfterDiscount, r.deliveryFeeDiscounted], [true, 1600, 160, 1440, false]); assert.deepStrictEqual(st.discount, { code: 'FAMILY10', name: 'Family 10% off', amount: 160, foodSubtotal: 1600 });
  console.log('1) FAMILY10 at 1600 food -> 160 PKR off (stored in session state): PASS');
  r = run(st, 'removeItem', { itemId: 'PUL01', quantity: 1 }); // 1600 -> 1150
  assert.strictEqual(r.ok, true); assert.strictEqual(r.discountRemoved.code, 'FAMILY10'); assert.strictEqual(r.discountRemoved.reason, 'below_minimum'); assert.strictEqual(st.discount, null);
  console.log('2) food falls to 1150 (< 1500) -> discount REMOVED automatically, tool result says so, state.discount null: PASS');
  run(st, 'addItemToCart', { itemId: 'PUL01', quantity: 1 }); assert.strictEqual(st.discount, null); r = run(st, 'applyPromotion', { code: 'family10' }); assert.strictEqual(r.discountAmount, 160);
  r = run(st, 'addItemToCart', { itemId: 'TEA01', quantity: 1 }); assert.strictEqual(r.discountUpdated.discountAmount, 170); assert.strictEqual(st.discount.amount, 170);
  r = run(st, 'modifyItem', { itemId: 'TEA01', quantity: 2 }); assert.strictEqual(st.discount.amount, 180);
  console.log('3) re-applied (lowercase code ok) then cart grows 1600 -> 1700 -> 1800: amount updated 170, 180 automatically: PASS');
  const big = fresh(); run(big, 'addItemToCart', { itemId: 'PUL01', quantity: 6 }); r = run(big, 'applyPromotion', { code: 'FAMILY10' });
  assert.deepStrictEqual([r.foodSubtotal, r.discountAmount], [2700, 200]);
  console.log('4) FAMILY10 at 2700 food -> 10% would be 270, capped at 200 PKR: PASS');
  const edge = fresh(); run(edge, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(edge, 'addItemToCart', { itemId: 'DAL01', quantity: 2 }); run(edge, 'addItemToCart', { itemId: 'TEA01', quantity: 3 });
  r = run(edge, 'applyPromotion', { code: 'FAMILY10' }); assert.deepStrictEqual([r.ok, r.foodSubtotal, r.discountAmount], [true, 1500, 150]);
  const below = fresh(); run(below, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(below, 'addItemToCart', { itemId: 'DAL01', quantity: 2 }); run(below, 'addItemToCart', { itemId: 'RAI01', quantity: 3 }); run(below, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); // 700+500+240+40 = 1480
  r = run(below, 'applyPromotion', { code: 'FAMILY10' }); assert.deepStrictEqual([r.ok, r.error, r.foodSubtotal, r.shortBy], [false, 'below_minimum', 1480, 20]); assert.strictEqual(below.discount, null);
  console.log('5) boundary: exactly 1500 -> eligible (150 off); 1480 -> below_minimum (short by 20), nothing applied: PASS');
  // ---- PICKUP50
  const p = fresh(); run(p, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: mild }); run(p, 'addItemToCart', { itemId: 'PUL01', quantity: 1 }); // 800
  r = run(p, 'applyPromotion', { code: 'PICKUP50' }); assert.deepStrictEqual([r.ok, r.error], [false, 'order_type_needed']); assert.strictEqual(p.discount, null);
  run(p, 'setOrderType', { orderType: 'delivery' }); r = run(p, 'applyPromotion', { code: 'PICKUP50' }); assert.deepStrictEqual([r.ok, r.error], [false, 'order_type_not_eligible']); assert.strictEqual(p.discount, null); assert.strictEqual(p.orderType, 'delivery');
  run(p, 'setOrderType', { orderType: 'Pickup' }); r = run(p, 'applyPromotion', { code: 'PICKUP50' }); assert.deepStrictEqual([r.ok, r.discountAmount, r.foodSubtotalAfterDiscount], [true, 50, 750]); assert.strictEqual(p.orderType, 'pickup');
  console.log('6) PICKUP50 (800 food): order type unknown -> asks; delivery -> refused; pickup -> 50 off: PASS');
  r = run(p, 'removeItem', { itemId: 'PUL01' }); assert.strictEqual(r.discountRemoved.reason, 'below_minimum'); assert.strictEqual(p.discount, null); // 350 < 700
  console.log('   cart drops to 350 (< 700) -> PICKUP50 removed automatically: PASS');
  run(p, 'addItemToCart', { itemId: 'PUL01', quantity: 1 }); run(p, 'applyPromotion', { code: 'PICKUP50' }); assert.strictEqual(p.discount.amount, 50);
  r = run(p, 'setOrderType', { orderType: 'delivery' }); assert.strictEqual(r.discountRemoved.reason, 'order_type_not_eligible'); assert.strictEqual(p.discount, null); assert.strictEqual(run(p, 'applyPromotion', { code: 'PICKUP50' }).error, 'order_type_not_eligible');
  console.log('   switching pickup -> delivery after applying PICKUP50 removes the discount (re-checked): PASS');
  const low = fresh(); run(low, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: mild }); run(low, 'setOrderType', { orderType: 'pickup' }); r = run(low, 'applyPromotion', { code: 'PICKUP50' }); assert.deepStrictEqual([r.error, r.foodSubtotal, r.shortBy], ['below_minimum', 350, 350]);
  console.log('   PICKUP50 at 350 food -> below_minimum (needs 700): PASS');
  // ---- OLD20 + invented codes
  const b = cart1600();
  for (const code of ['OLD20', 'old20', 'SAVE50', 'FREE', 'FAMILY20', 'FAMILY10 ', '', '   ', null, undefined, 12345, {}, ['FAMILY10'], 'FAMILY10;DROP']) {
    const x = run(b, 'applyPromotion', { code }); const ok = code === 'FAMILY10 ';
    if (ok) { assert.strictEqual(x.ok, true); b.discount = null; } else { assert.deepStrictEqual([x.ok, x.error], [false, 'invalid_code'], JSON.stringify(code)); assert.strictEqual(b.discount, null); }
  }
  console.log('7) OLD20 (inactive), invented codes, empty/null/non-string/injection-like input -> all invalid_code, nothing applied (trailing space trimmed OK): PASS');
  assert(!/OLD20|SAVE50|FAMILY10|PICKUP50/.test(JSON.stringify(run(b, 'applyPromotion', { code: 'SAVE50' }))));
  console.log('   the refusal never leaks other code names: PASS');
  // ---- one code per order
  const o = cart1600(); run(o, 'applyPromotion', { code: 'FAMILY10' }); run(o, 'setOrderType', { orderType: 'pickup' }); r = run(o, 'applyPromotion', { code: 'PICKUP50' });
  assert.deepStrictEqual([r.ok, r.error], [false, 'code_already_applied']); assert.strictEqual(o.discount.code, 'FAMILY10'); r = run(o, 'applyPromotion', { code: 'FAMILY10' }); assert.strictEqual(r.ok, true); assert.strictEqual(o.discount.amount, 160);
  console.log('8) second code refused while FAMILY10 applied (one code per order); re-applying the same code is harmless: PASS');
  // ---- delivery fee never discounted
  const d = cart1600(); run(d, 'setOrderType', { orderType: 'delivery' }); r = run(d, 'applyPromotion', { code: 'FAMILY10' }); assert.deepStrictEqual([r.ok, r.discountAmount, r.deliveryFeeDiscounted], [true, 160, false]); assert(!JSON.stringify(r).includes('150 PKR')); assert.strictEqual(d.discount.amount, 160);
  console.log('9) delivery order: FAMILY10 still 160 off the FOOD only (delivery fee 150 PKR not discounted, not in the result): PASS');
  // ---- edge cases
  assert.strictEqual(run(fresh(), 'applyPromotion', { code: 'FAMILY10' }).error, 'cart_empty'); assert.strictEqual(run(cart1600(), 'setOrderType', { orderType: 'takeaway' }).error, 'invalid_order_type');
  fs.writeFileSync(promoFile, JSON.stringify({ ...JSON.parse(promoBackup), promotions: JSON.parse(promoBackup).promotions.map(x => x.id === 'FAMILY10' ? { ...x, active: false } : x) }));
  r = run(cart1600(), 'applyPromotion', { code: 'FAMILY10' }); fs.writeFileSync(promoFile, promoBackup); assert.strictEqual(r.error, 'invalid_code');
  console.log('10) empty cart -> cart_empty; bad order type rejected; setting FAMILY10 inactive in promotions.json makes it invalid (rules come from the data file): PASS');
  // applied discount removed if the promotion is switched off later
  const sw = cart1600(); run(sw, 'applyPromotion', { code: 'FAMILY10' }); fs.writeFileSync(promoFile, JSON.stringify({ ...JSON.parse(promoBackup), promotions: JSON.parse(promoBackup).promotions.map(x => x.id === 'FAMILY10' ? { ...x, active: false } : x) }));
  r = run(sw, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); fs.writeFileSync(promoFile, promoBackup); assert.strictEqual(r.discountRemoved.reason, 'inactive_code'); assert.strictEqual(sw.discount, null);
  console.log('    promotion switched off after being applied -> next cart change removes it: PASS');
  // ---- session isolation + HTTP loop
  const A = cart1600(), B = cart1600(); run(A, 'applyPromotion', { code: 'FAMILY10' }); assert.strictEqual(B.discount, null);
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); const user = contents.filter(c => c.role === 'user' && c.parts[0].text).pop().parts[0].text;
    if (!res) return L.calls([{ name: 'applyPromotion', args: JSON.parse(user) }]); const t = res[0].response; return L.text(t.ok ? `OFF:${t.discountAmount}` : t.error); };
  const h = await L.post(base, { message: '{"code":"FAMILY10"}' }); assert.strictEqual(h.json.reply, 'cart_empty'); const stH = sessions.getOrCreateSession(h.json.sessionId).state;
  run(stH, 'addItemToCart', { itemId: 'PUL01', quantity: 4 }); const h2 = await L.post(base, { message: '{"code":"FAMILY10"}', sessionId: h.json.sessionId }); assert.strictEqual(h2.json.reply, 'OFF:180'); assert.strictEqual(stH.discount.amount, 180);
  const h3 = await L.post(base, { message: '{"code":"NOPE"}', sessionId: h.json.sessionId }); assert.strictEqual(h3.json.reply, 'invalid_code'); assert.strictEqual(stH.discount.amount, 180);
  const other = await L.post(base, { message: '{"code":"FAMILY10"}' }); assert.strictEqual(other.json.reply, 'cart_empty'); assert.strictEqual(sessions.getOrCreateSession(other.json.sessionId).state.discount, null);
  console.log('11) HTTP loop: discount applies only to the calling session; a new session has none; an invalid code does not disturb an applied one: PASS');
  console.log('ALL STEP-24 TESTS PASSED'); process.exit(0);
})().catch(e => { fs.writeFileSync(promoFile, promoBackup); console.error('TEST FAILED:', e.stack.split('\n').slice(0, 14).join('\n')); process.exit(1); });

const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3071);
const { executeTool, TOOL_DECLARATIONS } = require(ROOT + '/backend/tools'); const { computeTotals, totalsLines } = require(ROOT + '/backend/pricing');
const menu = require(ROOT + '/data/menu.json'), promotions = require(ROOT + '/data/promotions.json').promotions, restaurant = require(ROOT + '/data/restaurant.json'); const data = { menu, promotions, restaurant };
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state }); const fresh = () => sessions.getOrCreateSession().state;
const cart = (...pairs) => pairs.map(([id, quantity]) => ({ id, quantity })); const mild = [{ name: 'spice', choice: 'mild' }];
const price = (items, orderType, promoCode) => computeTotals({ items, orderType, promoCode: promoCode || null }, data);
const pick = (t) => [t.foodSubtotal, t.discountAmount, t.deliveryFee, t.total];
(async () => { await sleep(500);
  // ---- manual arithmetic: 2 biryani (2 x 350 = 700) + 1 raita (80) = food 780
  const base780 = cart(['BRY01', 2], ['RAI01', 1]);
  assert.deepStrictEqual(pick(price(base780, 'delivery')), [780, 0, 150, 930]); assert.deepStrictEqual(pick(price(base780, 'pickup')), [780, 0, 0, 780]); assert.deepStrictEqual(pick(price(base780, null)), [780, 0, null, null]);
  console.log('1) 2 biryani + 1 raita: food 700 + 80 = 780; DELIVERY 780 + 150 = 930; PICKUP 780 + 0 = 780; order type unknown -> total not yet known: PASS');
  let t = price(base780, 'pickup', 'PICKUP50'); assert.deepStrictEqual(pick(t), [780, 50, 0, 730]); assert.deepStrictEqual(t.discount, { code: 'PICKUP50', name: 'Pickup 50 PKR off', amount: 50 });
  t = price(base780, 'delivery', 'PICKUP50'); assert.deepStrictEqual([t.discount, t.promoRemoved.reason, t.total], [null, 'order_type_not_eligible', 930]);
  console.log('2) PICKUP50 on pickup: 780 - 50 = 730; same code on delivery -> dropped (pickup only), total stays 780 + 150 = 930: PASS');
  const c1500 = cart(['BRY01', 2], ['DAL01', 2], ['TEA01', 3]); // 700 + 500 + 300 = 1500
  const c1600 = cart(['BRY01', 2], ['PUL01', 2]); // 700 + 900 = 1600
  const c2700 = cart(['PUL01', 6]); // 6 x 450 = 2700
  const c1480 = cart(['BRY01', 2], ['DAL01', 2], ['RAI01', 3], ['NAN01', 1]); // 700 + 500 + 240 + 40 = 1480
  assert.deepStrictEqual(pick(price(c1500, 'pickup', 'FAMILY10')), [1500, 150, 0, 1350]); assert.deepStrictEqual(pick(price(c1500, 'delivery', 'FAMILY10')), [1500, 150, 150, 1500]);
  assert.deepStrictEqual(pick(price(c1600, 'pickup', 'FAMILY10')), [1600, 160, 0, 1440]); assert.deepStrictEqual(pick(price(c1600, 'delivery', 'FAMILY10')), [1600, 160, 150, 1590]);
  assert.deepStrictEqual(pick(price(c2700, 'pickup', 'FAMILY10')), [2700, 200, 0, 2500]); assert.deepStrictEqual(pick(price(c2700, 'delivery', 'FAMILY10')), [2700, 200, 150, 2650]);
  t = price(c1480, 'pickup', 'FAMILY10'); assert.deepStrictEqual([pick(t), t.promoRemoved.reason, t.promoRemoved.detail], [[1480, 0, 0, 1480], 'below_minimum', 'Sorry, this code needs at least 1500 PKR of food. Your food total is 1480 PKR.']);
  console.log('3) FAMILY10: food 1500 -> 150 off -> pickup 1350 (delivery 1350 + 150 = 1500); 1600 -> 160 off -> 1440 (delivery 1590); 2700 -> 10% would be 270, CAPPED at 200 -> 2500 (delivery 2650); 1480 (< 1500) -> promo dropped, total 1480: PASS');
  // ---- purity and determinism
  const deepFreeze = (o) => { Object.values(o).forEach(v => typeof v === 'object' && v !== null && deepFreeze(v)); return Object.freeze(o); };
  const frozenItems = deepFreeze(cart(['BRY01', 2], ['PUL01', 2])), frozenData = deepFreeze(JSON.parse(JSON.stringify(data))); const before = JSON.stringify(frozenItems);
  const r1 = computeTotals({ items: frozenItems, orderType: 'pickup', promoCode: 'FAMILY10' }, frozenData), r2 = computeTotals({ items: frozenItems, orderType: 'pickup', promoCode: 'FAMILY10' }, frozenData);
  assert.deepStrictEqual(r1, r2); assert.notStrictEqual(r1, r2); assert.strictEqual(JSON.stringify(frozenItems), before); for (const k of ['foodSubtotal', 'discountAmount', 'deliveryFee', 'tax', 'total']) assert(Number.isInteger(r1[k]), k);
  assert.strictEqual(r1.tax, 0);
  console.log('4) pure: frozen inputs are not touched, same input -> identical output every time, every amount is an integer, tax = 0: PASS');
  // ---- edge cases with injected data
  const inj = (items, extra = {}) => computeTotals({ items, orderType: 'pickup', promoCode: extra.code || null }, { menu: extra.menu || { items: [{ id: 'X', price: 1555 }, { id: 'Y', price: 100 }] }, promotions: extra.promos || [], restaurant: { ...restaurant, ...(extra.restaurant || {}) } });
  assert.strictEqual(inj(cart(['X', 1]), { code: 'P', promos: [{ id: 'P', active: true, name: 'p', discount: { type: 'percent', value: 10 }, eligibility: {} }] }).discountAmount, 155);
  assert.strictEqual(inj(cart(['Y', 1]), { code: 'P', promos: [{ id: 'P', active: true, name: 'p', discount: { type: 'fixed', value: 500 }, eligibility: {} }] }).discountAmount, 100);
  const tx = inj(cart(['X', 1], ['Y', 1]), { restaurant: { taxRate: 0.05 } }); assert.deepStrictEqual([tx.foodSubtotal, tx.tax, tx.total], [1655, 83, 1738]);
  assert.strictEqual(inj(cart(['X', 1]), { code: 'P', promos: [{ id: 'P', active: false, name: 'p', discount: { type: 'fixed', value: 5 }, eligibility: {} }] }).promoRemoved.reason, 'inactive_code');
  assert.strictEqual(inj(cart(['X', 1]), { code: 'GONE', promos: [] }).promoRemoved.reason, 'inactive_code');
  for (const bad of [cart(['NOPE', 1]), cart(['X', 0]), cart(['X', -1]), cart(['X', 1.5])]) assert.strictEqual(inj(bad).ok, false);
  for (const badMenu of [{ items: [{ id: 'X', price: 10.5 }] }, { items: [{ id: 'X', price: -5 }] }, { items: [{ id: 'X', price: '10' }] }]) assert.strictEqual(inj(cart(['X', 1]), { menu: badMenu }).ok, false);
  assert.deepStrictEqual(pick(inj([])), [0, 0, 0, 0]);
  console.log('5) edge cases: 10% of 1555 = 155 (rounded down); fixed 500 off a 100 cart -> 100 (never below zero); 5% tax rounds to whole PKR (83; 1738); inactive/unknown code dropped; unknown item, quantity 0/-1/1.5, prices 10.5/-5/"10" -> refused; empty cart 0: PASS');
  // ---- state follows every cart/order type change
  const s = fresh(); run(s, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(s, 'addItemToCart', { itemId: 'RAI01', quantity: 1 });
  assert.deepStrictEqual([s.totals, s.total], [{ foodSubtotal: 780, discountAmount: 0, deliveryFee: null, tax: 0, total: null }, 0]);
  let v = run(s, 'viewCart', {}); assert(v.customerMessage.endsWith('Food subtotal: 780 PKR\nTotal: shown once you choose pickup or delivery')); assert.strictEqual(v.totals.total, null);
  run(s, 'setOrderType', { orderType: 'delivery' }); assert.deepStrictEqual([s.totals.total, s.total, s.totals.deliveryFee], [930, 930, 150]); v = run(s, 'viewCart', {}); assert(v.customerMessage.endsWith('Food subtotal: 780 PKR\nDelivery fee: 150 PKR\nTotal: 930 PKR'));
  run(s, 'setOrderType', { orderType: 'pickup' }); assert.strictEqual(s.total, 780); let ap = run(s, 'applyPromotion', { code: 'PICKUP50' }); assert.deepStrictEqual([ap.ok, s.total, s.totals.discountAmount], [true, 730, 50]);
  v = run(s, 'viewCart', {}); assert(v.customerMessage.endsWith('Food subtotal: 780 PKR\nDiscount (PICKUP50): -50 PKR\nPickup: free\nTotal: 730 PKR'));
  const sw = run(s, 'setOrderType', { orderType: 'delivery' }); assert.deepStrictEqual([s.discount, s.total, sw.discountRemoved.code], [null, 930, 'PICKUP50']); assert(sw.customerMessage.includes('PICKUP50 discount was removed'));
  console.log('6) state follows each change: 780 food, type unknown -> total pending; delivery 930; pickup 780; + PICKUP50 730; back to delivery -> PICKUP50 dropped and the customer is told, total 930 again: PASS');
  const f = fresh(); run(f, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(f, 'addItemToCart', { itemId: 'PUL01', quantity: 2 }); run(f, 'setOrderType', { orderType: 'pickup' }); run(f, 'applyPromotion', { code: 'FAMILY10' }); assert.deepStrictEqual([f.total, f.totals.discountAmount], [1440, 160]);
  let rm = run(f, 'removeItem', { itemId: 'PUL01', quantity: 1 }); assert.deepStrictEqual([f.discount, f.total, rm.discountRemoved.reason], [null, 1150, 'below_minimum']); assert(rm.customerMessage.includes('FAMILY10 discount was removed'));
  run(f, 'addItemToCart', { itemId: 'PUL01', quantity: 5 }); assert.strictEqual(f.discount, null); ap = run(f, 'applyPromotion', { code: 'FAMILY10' }); assert.deepStrictEqual([ap.foodSubtotal, ap.discountAmount, f.total], [3400, 200, 3200]); // 700 + 6x450 = 3400; cap 200
  run(f, 'removeItem', { itemId: 'PUL01', quantity: 4 }); assert.deepStrictEqual([f.totals.foodSubtotal, f.discount.amount, f.total], [1600, 160, 1440]);
  console.log('7) FAMILY10 via tools: 1600 -> 160 off -> 1440; remove a dish (1150) -> dropped & customer told; 3400 food -> capped 200 -> 3200; back to 1600 -> 160 again (re-applied amount follows the cart): PASS');
  // ---- the model cannot influence any amount
  for (const d of TOOL_DECLARATIONS) { const names = Object.keys((d.parameters && d.parameters.properties) || {}); assert(!names.some(n => /price|amount|total|discount|fee|tax|subtotal/i.test(n)), d.name + ': ' + names); }
  console.log('8) no tool accepts a price, amount, total, discount, fee, tax or subtotal from the model: PASS');
  // ---- HTTP: reply text comes only from tool output
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); return res ? L.text(res[0].response.customerMessage) : L.calls([{ name: 'viewCart' }], null); };
  const h = await L.post(base, { message: 'hi' }); const stH = sessions.getOrCreateSession(h.json.sessionId).state; run(stH, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(stH, 'addItemToCart', { itemId: 'RAI01', quantity: 1 }); run(stH, 'setOrderType', { orderType: 'delivery' });
  const q = await L.post(base, { message: 'show my cart', sessionId: h.json.sessionId }); assert(q.json.reply.endsWith('Food subtotal: 780 PKR\nDelivery fee: 150 PKR\nTotal: 930 PKR'));
  const prompt = fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8'); assert(prompt.includes('calculated by the system: repeat those amounts exactly as returned, and never calculate or state a total or subtotal yourself.'));
  console.log('9) HTTP: "show my cart" reply = code-built lines ending "Food subtotal: 780 PKR / Delivery fee: 150 PKR / Total: 930 PKR"; prompt tells the model to repeat amounts exactly and never calculate: PASS');
  console.log('ALL STEP-31 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 7).join('\n')); process.exit(1); });

const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const captured = []; for (const k of ['log', 'error']) { const o = console[k].bind(console); console[k] = (...a) => { captured.push(a.join(' ')); o(...a); }; }
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3072);
const { executeTool, TOOL_DECLARATIONS } = require(ROOT + '/backend/tools'); const { canonical } = require(ROOT + '/backend/review');
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args, latest) => executeTool(name, args, { state, latestMessage: latest }); const fresh = () => sessions.getOrCreateSession().state; const mild = [{ name: 'spice', choice: 'mild' }];
const base780 = (s) => { run(s, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(s, 'addItemToCart', { itemId: 'RAI01', quantity: 1 }); return s; };
const pickupReady = () => { const s = base780(fresh()); run(s, 'setOrderType', { orderType: 'pickup' }); run(s, 'setCustomerDetails', { name: 'Hamza Ali' }); return s; };
const deliveryDetails = (s) => { run(s, 'setCustomerDetails', { name: 'Hina Raza', phone: '0321-1234567', block: '3', houseOrFlat: '12-B', street: 'Street 4' }); return s; };
const deliveryReady = () => { const s = base780(fresh()); run(s, 'setOrderType', { orderType: 'delivery' }); deliveryDetails(s); run(s, 'readBackAddress', {}); run(s, 'confirmAddress', {}, 'yes'); return s; };
const review = (s) => run(s, 'getOrderReview', {});
(async () => { await sleep(500);
  // 1) refusals list what is missing
  let r = review(fresh()); assert.deepStrictEqual([r.ok, r.error, r.missing.map(m => m.field)], [false, 'review_not_ready', ['items']]);
  let s = base780(fresh()); r = review(s); assert.deepStrictEqual(r.missing.map(m => m.field), ['orderType']); assert.strictEqual(r.customerMessage, 'Is this order for pickup or delivery?');
  run(s, 'setOrderType', { orderType: 'pickup' }); r = review(s); assert.deepStrictEqual(r.missing.map(m => m.field), ['name']); assert.strictEqual(r.customerMessage, 'May I have your name for the order?');
  s = base780(fresh()); run(s, 'setOrderType', { orderType: 'delivery' }); r = review(s); assert.deepStrictEqual(r.missing.map(m => m.field), ['name', 'phone', 'block', 'house', 'street']); assert(r.customerMessage.startsWith('Before the final review I still need a few things.'));
  run(s, 'setCustomerDetails', { name: 'Hina Raza', phone: '03211234567' }); r = review(s); assert.deepStrictEqual(r.missing.map(m => m.field), ['block', 'house', 'street']);
  deliveryDetails(s); r = review(s); assert.deepStrictEqual([r.error, r.missing.map(m => m.field), r.nextStep], ['review_not_ready', ['addressConfirmation'], 'readBackAddress']);
  run(s, 'readBackAddress', {}); r = review(s); assert.strictEqual(r.nextStep, 'readBackAddress'); // read back but not yet confirmed
  assert.strictEqual(s.reviewShownVersion, null);
  console.log('1) review REFUSED with the missing items listed: empty cart; no order type; pickup without name; delivery without name/phone/block/house/street; delivery with everything but the address NOT confirmed (nextStep readBackAddress); nothing recorded as "shown": PASS');
  // 2) pickup review
  s = pickupReady(); run(s, 'setCustomerDetails', { pickupTime: '19:30' }); run(s, 'applyPromotion', { code: 'PICKUP50' }); r = review(s);
  assert.strictEqual(r.ok, true); assert.match(r.reviewVersion, /^[0-9a-f]{16}$/);
  assert.deepStrictEqual(r.review.items, [{ itemId: 'BRY01', name: 'Chicken Biryani', quantity: 2, options: { spice: 'mild' }, unitPrice: 350, lineTotal: 700 }, { itemId: 'RAI01', name: 'Raita', quantity: 1, options: {}, unitPrice: 80, lineTotal: 80 }]);
  assert.deepStrictEqual([r.review.orderType, r.review.customer, r.review.pickup, r.review.delivery, r.review.promotion, r.review.totals, r.review.payment, r.review.currency], ['pickup', { name: 'Hamza Ali' }, { time: '19:30' }, null, { code: 'PICKUP50', name: 'Pickup 50 PKR off', amount: 50 }, { foodSubtotal: 780, discountAmount: 50, deliveryFee: 0, tax: 0, total: 730 }, 'Cash on pickup', 'PKR']);
  assert.strictEqual(r.customerMessage, ['Order review', 'Items:', '2 x Chicken Biryani (spice: mild) - 700 PKR', '1 x Raita - 80 PKR', 'Order type: Pickup', 'Name: Hamza Ali', 'Preferred pickup time: 7:30 PM (we cannot promise the food will be ready at that time)', 'Food subtotal: 780 PKR', 'Discount (PICKUP50): -50 PKR', 'Pickup: free', 'Total: 730 PKR', 'Payment: cash on pickup', 'Please check everything above. If it is all correct, press the "Confirm order" button below the chat. If you want to change something, tell me.'].join('\n'));
  assert.strictEqual(s.reviewShownVersion, r.reviewVersion);
  console.log('2) PICKUP review (hand-checked: 700 + 80 = 780, PICKUP50 -50, pickup free, total 730):\n     ' + r.customerMessage.split('\n').join('\n     ') + '\n    reviewVersion ' + r.reviewVersion + ' recorded as shown: PASS');
  // 3) delivery review
  s = deliveryReady(); run(s, 'setCustomerDetails', { apartment: '2B', instructions: 'Ring twice' }); run(s, 'readBackAddress', {}); run(s, 'confirmAddress', {}, 'yes'); r = review(s);
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.review.totals, { foodSubtotal: 780, discountAmount: 0, deliveryFee: 150, tax: 0, total: 930 }); assert.deepStrictEqual(r.review.customer, { name: 'Hina Raza', phone: '03211234567' }); assert.strictEqual(r.review.payment, 'Cash on delivery');
  assert.deepStrictEqual(r.review.delivery, { address: { block: 3, house: '12-B', street: 'Street 4', apartment: '2B', landmark: null, instructions: 'Ring twice' }, addressConfirmed: true }); assert.strictEqual(r.review.pickup, null);
  for (const line of ['Order type: Delivery', 'Name: Hina Raza', 'Phone: 03211234567', 'Delivery address: House or flat 12-B, Street 4, Block 3, Gulshan-e-Iqbal, Karachi', 'Apartment or unit: 2B', 'Delivery instructions: Ring twice', 'Food subtotal: 780 PKR', 'Delivery fee: 150 PKR', 'Total: 930 PKR', 'Payment: cash on delivery']) assert(r.customerMessage.includes(line), line);
  assert(!/pickup time/i.test(r.customerMessage));
  console.log('3) DELIVERY review: 780 + 150 fee = 930; name, phone, full confirmed address, apartment, instructions, "cash on delivery" all present: PASS');
  // 4) reviewVersion fingerprint
  const v = (t) => review(t).reviewVersion; s = deliveryReady(); const v0 = v(s); assert.strictEqual(v(s), v0); assert.strictEqual(v(s), v0);
  const changes = {
    'quantity': (t) => run(t, 'modifyItem', { itemId: 'RAI01', quantity: 2 }), 'option': (t) => run(t, 'modifyItem', { itemId: 'BRY01', options: [{ name: 'spice', choice: 'regular' }] }), 'add item': (t) => run(t, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }),
    'remove item': (t) => run(t, 'removeItem', { itemId: 'RAI01' }), 'name': (t) => { run(t, 'setCustomerDetails', { name: 'Hina Raza Khan' }); run(t, 'readBackAddress', {}); run(t, 'confirmAddress', {}, 'yes'); },
    'phone': (t) => { run(t, 'setCustomerDetails', { phone: '03001112223' }); run(t, 'readBackAddress', {}); run(t, 'confirmAddress', {}, 'yes'); }, 'street': (t) => { run(t, 'setCustomerDetails', { street: 'Street 5' }); run(t, 'readBackAddress', {}); run(t, 'confirmAddress', {}, 'yes'); },
    'block': (t) => { run(t, 'setCustomerDetails', { block: '4' }); run(t, 'readBackAddress', {}); run(t, 'confirmAddress', {}, 'yes'); }, 'instructions': (t) => { run(t, 'setCustomerDetails', { instructions: 'Call first' }); run(t, 'readBackAddress', {}); run(t, 'confirmAddress', {}, 'yes'); },
    'order type': (t) => { run(t, 'setOrderType', { orderType: 'pickup' }); }, 'cart addition by another dish': (t) => run(t, 'addItemToCart', { itemId: 'TEA01', quantity: 3 }) };
  const seen = new Set([v0]); for (const [label, fn] of Object.entries(changes)) { const t = deliveryReady(); assert.strictEqual(v(t), v0, 'same order -> same version'); fn(t); const nv = review(t); const ver = nv.ok ? nv.reviewVersion : 'refused'; assert.notStrictEqual(ver, v0, label); }
  const pk = pickupReady(); const p0 = v(pk); run(pk, 'setCustomerDetails', { pickupTime: '20:00' }); const p1 = v(pk); run(pk, 'setCustomerDetails', { pickupTime: '20:30' }); const p2 = v(pk); assert.strictEqual(new Set([p0, p1, p2]).size, 3);
  const pr = pickupReady(); const q0 = v(pr); run(pr, 'applyPromotion', { code: 'PICKUP50' }); const q1 = v(pr); run(pr, 'removeItem', { itemId: 'RAI01' }); const q2 = v(pr); assert.strictEqual(new Set([q0, q1, q2]).size, 3); // 780 -> promo (730) -> 700 food, promo still eligible (650)
  assert.strictEqual(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  console.log('4) reviewVersion is a stable fingerprint: same order -> same version on every call; changes after a quantity, option, added/removed item, name, phone, block, street, instructions, order type, pickup time, or promo change (11+ changes checked): PASS');
  // 5) stale promo is dropped inside the review
  const st = pickupReady(); run(st, 'applyPromotion', { code: 'PICKUP50' }); run(st, 'removeItem', { itemId: 'BRY01', quantity: 2 }); assert.strictEqual(st.discount, null);
  st.discount = { code: 'PICKUP50', name: 'x', amount: 50, foodSubtotal: 780 }; /* simulate a stale discount left in the state */ const rr = review(st); assert.strictEqual(rr.ok, true); assert.strictEqual(rr.review.promotion, null); assert(rr.customerMessage.startsWith('Your PICKUP50 discount was removed')); assert.strictEqual(rr.review.totals.total, 80);
  console.log('5) cart falls to 80 food -> the review has no promotion, says the discount was removed, total 80: PASS');
  // 6) model cannot alter the review
  assert(!TOOL_DECLARATIONS.find(d => d.name === 'getOrderReview').parameters);
  console.log('6) getOrderReview takes no parameters: the model cannot supply or change any part of the review: PASS');
  // 7) prompt rules
  const prompt = fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8');
  for (const line of ['## Order review and confirmation', 'Confirmation happens ONLY when the customer presses that button.', 'Typing never confirms an order', 'You can never say or imply that an order has been placed, confirmed, saved or sent on your own.', 'press the "Confirm order" button', 'call getOrderReview again and show the new one']) assert(prompt.includes(line), line);
  assert(!/## Interim rules/.test(prompt) && !/## Explicit confirmation before finalizing/.test(prompt) && !/online ordering is not available yet/.test(prompt) && !/Never say "finalize"/.test(prompt) && !/Shall I place this order/.test(prompt));
  console.log('7) prompt: review -> invite the customer to press "Confirm order"; typing never confirms; never say an order is placed/saved; old interim/"finalize" rules and text-confirmation steps removed: PASS');
  // 8) HTTP + logs
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); return res ? L.text(res[0].response.customerMessage) : L.calls([{ name: 'getOrderReview' }], null); };
  const h = await L.post(base, { message: 'hi' }); const sid = h.json.sessionId, sh = sessions.getOrCreateSession(sid).state; base780(sh); run(sh, 'setOrderType', { orderType: 'delivery' }); deliveryDetails(sh); run(sh, 'readBackAddress', {}); run(sh, 'confirmAddress', {}, 'yes');
  const q = await L.post(base, { message: 'I am done, please order', sessionId: sid }); assert(q.json.reply.startsWith('Order review\nItems:')); assert(q.json.reply.endsWith('tell me.')); assert(q.json.reply.includes('Total: 930 PKR')); assert(!/placed|confirmed|saved|sent/i.test(q.json.reply.replace(/press the "Confirm order" button/, '')));
  const logs = captured.filter(l => /^(Gemini|Tool|Chat|Server|Unexpected)/.test(l)).join('\n'); for (const secret of ['Hina Raza', '03211234567', 'Street 4', '12-B', 'reviewVersion']) assert(!logs.includes(secret), 'LOGGED ' + secret);
  console.log('8) HTTP: "I am done, please order" -> the reply is exactly the code-built review (total 930 PKR, invites the button, no "placed/confirmed/saved"); no personal details or review data in server logs: PASS');
  console.log('ALL STEP-32 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 7).join('\n')); process.exit(1); });

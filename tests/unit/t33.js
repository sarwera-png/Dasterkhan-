const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3073);
const { executeTool, TOOL_DECLARATIONS } = require(ROOT + '/backend/tools');
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args, latest) => executeTool(name, args, { state, latestMessage: latest }); const mild = [{ name: 'spice', choice: 'mild' }];
const ordersFile = global.__ORDERS_FILE; const ordersBefore = fs.readFileSync(ordersFile, 'utf8'); process.on('exit', () => fs.writeFileSync(ordersFile, ordersBefore)); const savedCount = () => JSON.parse(fs.readFileSync(ordersFile, 'utf8')).length;
const confirm = async (body) => { const r = await fetch(base + '/api/order/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
// the scripted model ALWAYS asks for the review, and for a few other things: it still can never confirm
let script = () => [{ name: 'getOrderReview' }];
global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); return res ? L.text(res[0].response.customerMessage.slice(0, 60)) : L.calls(script(), null); };
async function pickupSession() { const a = await L.post(base, { message: 'hello', sessionId: undefined }); const sid = a.json.sessionId, st = sessions.getOrCreateSession(sid).state;
  run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(st, 'addItemToCart', { itemId: 'RAI01', quantity: 1 }); run(st, 'setOrderType', { orderType: 'pickup' }); run(st, 'setCustomerDetails', { name: 'Hamza Ali' }); return { sid, st }; }
(async () => { await sleep(500);
  // 1) no review yet -> no button offered, confirm refused
  let { sid, st } = await pickupSession(); script = () => [{ name: 'viewCart' }];
  let chat = await L.post(base, { message: 'show cart', sessionId: sid }); assert.strictEqual(chat.json.reviewVersion, null);
  const guess = await confirm({ sessionId: sid, reviewVersion: '0123456789abcdef' }); assert.deepStrictEqual([guess.status, guess.json.error], [409, 'review_outdated']);
  assert.deepStrictEqual([st.confirmed, st.status], [false, 'draft']);
  console.log('1) before any review: /api/chat reviewVersion = null (no button); guessing a version -> 409 review_outdated; order still draft: PASS');
  // 2) review shown -> version offered -> button confirms
  script = () => [{ name: 'getOrderReview' }]; chat = await L.post(base, { message: 'I am done', sessionId: sid }); const version = chat.json.reviewVersion; assert.match(version, /^[0-9a-f]{16}$/); assert.strictEqual(st.reviewShownVersion, version);
  assert.deepStrictEqual([st.confirmed, st.status], [false, 'draft']);
  console.log('2) "I am done" -> review shown -> /api/chat returns reviewVersion ' + version + ' (the button is offered); order still draft: PASS');
  // 3) chat text never confirms, whatever the customer writes or the model does
  script = () => [{ name: 'viewCart' }];
  for (const text of ['yes', 'Yes, confirm', 'ok', 'theek hai', 'haan ji', 'let me ask my family', 'confirm', 'place my order', 'جی ہاں', '👍', 'CONFIRM ORDER NOW']) { const r = await L.post(base, { message: text, sessionId: sid }); assert.deepStrictEqual([st.confirmed, st.status, st.confirmedVersion], [false, 'draft', null], text); assert.strictEqual(r.json.reviewVersion, version, 'review must stay valid after chatter: ' + text); }
  assert(!TOOL_DECLARATIONS.some(d => /confirmOrder|placeOrder|submitOrder|saveOrder|finalize/i.test(d.name)));
  for (const n of Object.keys(require(ROOT + '/backend/tools'))) assert(!/confirmOrder|placeOrder|saveOrder/i.test(n));
  assert.strictEqual(fs.readFileSync(ordersFile, 'utf8'), ordersBefore);
  console.log('3) 11 chat messages ("yes", "Yes, confirm", "ok", "theek hai", "haan ji", "let me ask my family", "confirm", "place my order", "جی ہاں", 👍 ...) -> order stays DRAFT; there is no tool that can confirm; orders.json untouched: PASS');
  // 4) change after review -> old version rejected, button hidden
  run(st, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); chat = await L.post(base, { message: 'hmm', sessionId: sid }); assert.strictEqual(chat.json.reviewVersion, null);
  const old = await confirm({ sessionId: sid, reviewVersion: version }); assert.deepStrictEqual([old.status, old.json.ok, old.json.error], [409, false, 'review_outdated']); assert.deepStrictEqual([st.confirmed, st.status], [false, 'draft']);
  console.log('4) cart changed after the review -> /api/chat reviewVersion = null (button hidden) and the OLD reviewVersion is rejected with 409 review_outdated; still draft: PASS');
  // 5) changes of every kind invalidate
  const t = async (label, change) => { const p = await pickupSession(); script = () => [{ name: 'getOrderReview' }]; const c = await L.post(base, { message: 'done', sessionId: p.sid }); const v = c.json.reviewVersion; assert(v, label); change(p.st); const r = await confirm({ sessionId: p.sid, reviewVersion: v }); assert.strictEqual(r.status, 409, label); assert(['review_outdated', 'review_not_ready'].includes(r.json.error), label + ' -> ' + r.json.error); assert.strictEqual(p.st.confirmed, false, label); };
  await t('quantity', s => run(s, 'modifyItem', { itemId: 'RAI01', quantity: 3 })); await t('option', s => run(s, 'modifyItem', { itemId: 'BRY01', options: [{ name: 'spice', choice: 'regular' }] })); await t('remove', s => run(s, 'removeItem', { itemId: 'RAI01' }));
  await t('name', s => run(s, 'setCustomerDetails', { name: 'Someone Else' })); await t('pickup time', s => run(s, 'setCustomerDetails', { pickupTime: '20:00' })); await t('promo', s => run(s, 'applyPromotion', { code: 'PICKUP50' })); await t('order type', s => run(s, 'setOrderType', { orderType: 'delivery' }));
  console.log('5) quantity, option, removal, name, pickup time, promo code or order type changed after the review -> old version always rejected (7 cases): PASS');
  // 6) valid confirm works; idempotent; locks the order
  ({ sid, st } = await pickupSession()); script = () => [{ name: 'getOrderReview' }]; chat = await L.post(base, { message: 'done', sessionId: sid }); const v6 = chat.json.reviewVersion;
  const ok = await confirm({ sessionId: sid, reviewVersion: v6 }); assert.deepStrictEqual([ok.status, ok.json.ok, ok.json.confirmed, ok.json.saved], [200, true, true, true]); assert.match(ok.json.orderId, /^KD-\d{4,}$/); assert(ok.json.customerMessage.includes(ok.json.orderId)); assert.strictEqual(savedCount(), 1);
  assert.deepStrictEqual([st.confirmed, st.status, st.confirmedVersion], [true, 'confirmed', v6]);
  const again = await confirm({ sessionId: sid, reviewVersion: v6 }); assert.deepStrictEqual([again.status, again.json.ok, again.json.orderId], [200, true, ok.json.orderId]); assert.strictEqual(savedCount(), 1);
  const other = await confirm({ sessionId: sid, reviewVersion: '0123456789abcdef' }); assert.deepStrictEqual([other.status, other.json.error], [409, 'order_locked']);
  console.log('6) matching version + review shown -> 200 confirmed AND saved (order ' + ok.json.orderId + '); pressing twice -> same 200, same id; another version -> 409: PASS');
  script = () => [{ name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 5 } }, { name: 'setOrderType', args: { orderType: 'delivery' } }, { name: 'applyPromotion', args: { code: 'PICKUP50' } }, { name: 'setCustomerDetails', args: { name: 'Hacker Name' } }, { name: 'getOrderReview' }];
  const before = JSON.stringify(st); chat = await L.post(base, { message: 'change it all', sessionId: sid }); assert.strictEqual(JSON.stringify(st), before); assert.strictEqual(chat.json.reviewVersion, null);
  const locked = run(st, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); assert.deepStrictEqual([locked.ok, locked.error, locked.customerMessage], [false, 'order_locked', "Your order has already been confirmed, so it can't be changed here. If you need to change something, please contact the restaurant."]);
  assert.strictEqual(run(st, 'viewCart', {}).ok, true);
  console.log('7) after confirmation the order is LOCKED: add/modify/order type/promo/details/review tools all refuse (state byte-identical), no button offered; viewCart still works: PASS');
  // 8) guards: only the matching, shown review; other sessions; bad input
  ({ sid, st } = await pickupSession()); script = () => [{ name: 'viewCart' }]; await L.post(base, { message: 'x', sessionId: sid });
  const { buildReview } = require(ROOT + '/backend/review'); const cv = buildReview(st, { menu: require(ROOT + '/data/menu.json'), promotions: require(ROOT + '/data/promotions.json').promotions, restaurant: require(ROOT + '/data/restaurant.json') }).review.reviewVersion;
  let r = await confirm({ sessionId: sid, reviewVersion: cv }); assert.deepStrictEqual([r.status, r.json.error, st.confirmed], [409, 'review_not_shown', false]);
  const A = await pickupSession(); script = () => [{ name: 'getOrderReview' }]; const ca = await L.post(base, { message: 'done', sessionId: A.sid }); const B = await pickupSession(); await L.post(base, { message: 'done', sessionId: B.sid });
  r = await confirm({ sessionId: B.sid, reviewVersion: ca.json.reviewVersion }); // identical orders have identical versions, so this one is allowed because B's own review was shown
  assert.strictEqual(r.status, 200); assert.deepStrictEqual([A.st.confirmed, B.st.confirmed], [false, true]);
  const C = await pickupSession(); r = await confirm({ sessionId: C.sid, reviewVersion: ca.json.reviewVersion }); assert.deepStrictEqual([r.status, r.json.error, C.st.confirmed], [409, 'review_not_shown', false]);
  for (const bad of [{}, { sessionId: sid }, { reviewVersion: cv }, { sessionId: 5, reviewVersion: cv }, { sessionId: sid, reviewVersion: 'ZZZ' }, { sessionId: sid, reviewVersion: 123 }, { sessionId: sid, reviewVersion: cv + '0' }, 'null', '[]']) { r = await confirm(bad); assert(r.status === 400, JSON.stringify(bad) + ' -> ' + r.status); }
  r = await confirm('{broken'); assert.strictEqual(r.status, 400);
  r = await confirm({ sessionId: 'f'.repeat(32), reviewVersion: cv }); assert.deepStrictEqual([r.status, r.json.error], [404, 'session_not_found']); assert.notStrictEqual(sessions.getOrCreateSession('f'.repeat(32)).sessionId, 'f'.repeat(32));
  console.log('8) confirm without a shown review -> 409 review_not_shown; another session\'s unshown review cannot be used; malformed bodies -> 400; unknown session -> 404 and NOT created: PASS');
  // 9) incomplete orders cannot be confirmed
  const inc = await L.post(base, { message: 'hi' }); const stI = sessions.getOrCreateSession(inc.json.sessionId).state; run(stI, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); stI.reviewShownVersion = 'abcdefabcdefabcd';
  r = await confirm({ sessionId: inc.json.sessionId, reviewVersion: 'abcdefabcdefabcd' }); assert.deepStrictEqual([r.status, r.json.error, stI.confirmed], [409, 'review_not_ready', false]);
  console.log('9) an incomplete order (no order type/name) can never be confirmed, even with a forged "shown" version: PASS');
  console.log('ALL STEP-33 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 7).join('\n')); process.exit(1); });

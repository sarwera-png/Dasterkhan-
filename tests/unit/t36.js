const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3076);
const { ordersEnabled } = require(ROOT + '/backend/config'); const { executeTool } = require(ROOT + '/backend/tools');
const ordersFile = global.__ORDERS_FILE; const dataDir = global.__ORDERS_DIR; const keep = fs.readFileSync(ordersFile, 'utf8'); process.on('exit', () => fs.writeFileSync(ordersFile, keep));
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state }); const mild = [{ name: 'spice', choice: 'mild' }];
const confirm = async (body) => { const r = await fetch(base + '/api/order/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
let lastSys = ''; let script = () => [{ name: 'getOrderReview' }];
global.__STUB = async ({ contents, config }) => { lastSys = config.systemInstruction; const res = L.lastToolResults(contents); return res ? L.text(res[0].response.customerMessage) : L.calls(script(), null); };
async function ready() { const a = await L.post(base, { message: 'hi' }); const sid = a.json.sessionId, st = sessions.getOrCreateSession(sid).state; run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(st, 'addItemToCart', { itemId: 'RAI01', quantity: 1 }); run(st, 'setOrderType', { orderType: 'pickup' }); run(st, 'setCustomerDetails', { name: 'Hamza Ali' }); return { sid, st }; }
(async () => { await sleep(500);
  // 1) only the exact text "true" enables ordering
  const cases = [[undefined, false], ['', false], ['false', false], ['FALSE', false], ['TRUE', false], ['True', false], ['1', false], ['yes', false], ['on', false], [' true', false], ['true ', false], ['true\n', false], ['"true"', false], ['truee', false], ['t', false], ['true', true]];
  for (const [v, want] of cases) { if (v === undefined) delete process.env.ORDERS_ENABLED; else process.env.ORDERS_ENABLED = v; assert.strictEqual(ordersEnabled(), want, JSON.stringify(v)); }
  console.log('1) ordersEnabled() is true ONLY for the exact text "true"; unset, "", "false", "FALSE", "TRUE", "True", "1", "yes", "on", " true", "true ", "true\\n", \'"true"\', "truee", "t" are all OFF (fail closed): PASS');
  // 2) OFF: everything except placing orders still works
  for (const off of [undefined, 'false', 'TRUE']) {
    if (off === undefined) delete process.env.ORDERS_ENABLED; else process.env.ORDERS_ENABLED = off;
    const before = fs.readFileSync(ordersFile, 'utf8'); const { sid, st } = await ready();
    const menu = await L.post(base, { message: 'menu', sessionId: sid }); assert.strictEqual(menu.status, 200);
    let chat = await L.post(base, { message: 'I am done', sessionId: sid }); assert.strictEqual(chat.status, 200); assert.strictEqual(chat.json.reviewVersion, null);
    assert(chat.json.reply.startsWith('Order review\nItems:') && chat.json.reply.includes('Total: 780 PKR')); assert(chat.json.reply.endsWith('This is a demo, so orders cannot be placed right now. If you want to change something, tell me.')); assert(!/Confirm order|button/i.test(chat.json.reply));
    assert(lastSys.includes('ONLINE ORDERING IS OFF (demo)') && lastSys.includes('never tell the customer to press a button'));
    assert.match(st.reviewShownVersion, /^[0-9a-f]{16}$/); // a review exists (the order is complete), but it cannot be confirmed
    const { buildReview } = require(ROOT + '/backend/review'); const ver = buildReview(st, { menu: require(ROOT + '/data/menu.json'), promotions: require(ROOT + '/data/promotions.json').promotions, restaurant: require(ROOT + '/data/restaurant.json') }).review.reviewVersion;
    for (const body of [{ sessionId: sid, reviewVersion: ver }, { sessionId: sid, reviewVersion: st.reviewShownVersion }, { sessionId: sid }, {}, { sessionId: 'f'.repeat(32), reviewVersion: ver }]) { const r = await confirm(body); assert.deepStrictEqual([r.status, r.json.ok, r.json.error, r.json.customerMessage], [503, false, 'ordering_disabled', 'This is a demo, so orders cannot be placed right now.'], JSON.stringify(body)); assert(!('orderId' in r.json)); }
    assert.deepStrictEqual([st.confirmed, st.status, st.orderId], [false, 'draft', null]); assert.strictEqual(fs.readFileSync(ordersFile, 'utf8'), before); assert.deepStrictEqual(fs.readdirSync(dataDir).filter(f => f.includes('.tmp-')), []);
    const vc = run(st, 'viewCart', {}); assert(vc.customerMessage.includes('Total: 780 PKR')); assert.strictEqual(run(st, 'applyPromotion', { code: 'PICKUP50' }).ok, true); assert.strictEqual(st.total, 730);
  }
  console.log('2) ORDERS_ENABLED unset / "false" / "TRUE": menu, chat, cart, totals (780 -> PICKUP50 730) and the review all work; review ends "This is a demo, so orders cannot be placed right now."; NO reviewVersion (no button); every confirm call -> 503 ordering_disabled (even with a valid version, garbage or an unknown session); state stays draft; orders.json byte-identical; no temp files; the model is told "ONLINE ORDERING IS OFF": PASS');
  // 3) ON: unchanged flow
  process.env.ORDERS_ENABLED = 'true'; const on = await ready(); let chat = await L.post(base, { message: 'I am done', sessionId: on.sid });
  assert.match(chat.json.reviewVersion, /^[0-9a-f]{16}$/); assert(chat.json.reply.endsWith('press the "Confirm order" button below the chat. If you want to change something, tell me.')); assert(!lastSys.includes('ONLINE ORDERING IS OFF'));
  const ok = await confirm({ sessionId: on.sid, reviewVersion: chat.json.reviewVersion }); assert.deepStrictEqual([ok.status, ok.json.ok, ok.json.saved], [200, true, true]); assert.match(ok.json.orderId, /^KD-\d+$/); assert.strictEqual(JSON.parse(fs.readFileSync(ordersFile, 'utf8')).length, JSON.parse(keep).length + 1);
  console.log('3) ORDERS_ENABLED="true": review invites the button, reviewVersion offered, the model is not told ordering is off, confirm saves ' + ok.json.orderId + ' - the existing flow is unchanged: PASS');
  // 4) live switching, fail closed mid-flight
  const mid = await ready(); chat = await L.post(base, { message: 'done', sessionId: mid.sid }); const v = chat.json.reviewVersion; assert(v);
  process.env.ORDERS_ENABLED = 'false'; const refused = await confirm({ sessionId: mid.sid, reviewVersion: v }); assert.strictEqual(refused.status, 503); assert.strictEqual(mid.st.status, 'draft');
  chat = await L.post(base, { message: 'again', sessionId: mid.sid }); assert.strictEqual(chat.json.reviewVersion, null); process.env.ORDERS_ENABLED = 'true'; chat = await L.post(base, { message: 'again', sessionId: mid.sid }); assert.strictEqual(chat.json.reviewVersion, v);
  console.log('4) switched OFF while a review is open: the confirm is refused and the button offer disappears; switched back ON the same review works again (read on every request): PASS');
  // 5) staff dashboard unaffected while OFF
  delete process.env.ORDERS_ENABLED; process.env.STAFF_PASSWORD = 'a long staff password for tests'; const auth = 'Basic ' + Buffer.from('staff:' + process.env.STAFF_PASSWORD).toString('base64');
  const before = JSON.parse(fs.readFileSync(ordersFile, 'utf8')); const list = await fetch(base + '/api/staff/orders', { headers: { Authorization: auth } }); assert.strictEqual(list.status, 200); assert.strictEqual((await list.json()).orders.length, before.length);
  const id = before[before.length - 1].id; const adv = await fetch(base + `/api/staff/orders/${id}/status`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'PREPARING' }) }); assert.strictEqual(adv.status, 200);
  assert.strictEqual((await fetch(base + '/staff', { headers: { Authorization: auth } })).status, 200); delete process.env.STAFF_PASSWORD;
  console.log('5) staff dashboard unaffected while ordering is OFF: list 200, page 200, NEW -> PREPARING works: PASS');
  // 6) docs + example file
  const envEx = fs.readFileSync(ROOT + '/.env.example', 'utf8'); assert(/^# Orders can be placed ONLY when this is exactly the word true\./m.test(envEx) && /^ORDERS_ENABLED=false$/m.test(envEx)); assert(!/=true/.test(envEx));
  const readme = fs.readFileSync(ROOT + '/README.md', 'utf8'); assert(readme.includes('## Ordering switch (ORDERS_ENABLED)') && readme.includes('put `ORDERS_ENABLED=true` in your own `.env`') && readme.includes('`503 ordering_disabled`'));
  console.log('6) .env.example has a commented ORDERS_ENABLED=false placeholder (never true); README explains the switch and that local testing needs ORDERS_ENABLED=true in your own .env: PASS');
  console.log('ALL STEP-K TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 8).join('\n')); process.exit(1); });

const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs'); const cp = require('child_process');
const captured = []; for (const k of ['log', 'error']) { const o = console[k].bind(console); console[k] = (...a) => { captured.push(a.join(' ')); o(...a); }; }
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3074);
const { executeTool } = require(ROOT + '/backend/tools'); const ordersFile = global.__ORDERS_FILE; const dataDir = global.__ORDERS_DIR;
const keep = fs.readFileSync(ordersFile, 'utf8'); process.on('exit', () => { fs.writeFileSync(ordersFile, keep); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args, latest) => executeTool(name, args, { state, latestMessage: latest }); const mild = [{ name: 'spice', choice: 'mild' }];
const read = () => JSON.parse(fs.readFileSync(ordersFile, 'utf8')); const reset = (content = '[]\n') => fs.writeFileSync(ordersFile, content);
const confirm = async (body) => { const r = await fetch(base + '/api/order/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
let script = () => [{ name: 'getOrderReview' }]; global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); return res ? L.text('ok') : L.calls(script(), null); };
async function ready(kind = 'pickup') { const a = await L.post(base, { message: 'hi' }); const sid = a.json.sessionId, st = sessions.getOrCreateSession(sid).state;
  run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(st, 'addItemToCart', { itemId: 'RAI01', quantity: 1 });
  if (kind === 'pickup') { run(st, 'setOrderType', { orderType: 'pickup' }); run(st, 'setCustomerDetails', { name: 'Hamza Ali', pickupTime: '19:30' }); }
  else { run(st, 'setOrderType', { orderType: 'delivery' }); run(st, 'setCustomerDetails', { name: 'Hina Raza', phone: '0321-1234567', block: '3', houseOrFlat: '12-B', street: 'Street 4', apartment: '2B', instructions: 'Ring twice' }); run(st, 'readBackAddress', {}); run(st, 'confirmAddress', {}, 'yes'); }
  script = () => [{ name: 'getOrderReview' }]; const c = await L.post(base, { message: 'done', sessionId: sid }); assert(c.json.reviewVersion, 'review not shown'); return { sid, st, version: c.json.reviewVersion }; }
const tmpLeft = () => fs.readdirSync(dataDir).filter(f => f.includes('.tmp-'));
(async () => { await sleep(500); reset();
  // 1) first order
  const a = await ready('pickup'); const t0 = Date.now(); const r = await confirm({ sessionId: a.sid, reviewVersion: a.version });
  assert.deepStrictEqual([r.status, r.json.ok, r.json.confirmed, r.json.saved, r.json.orderId], [200, true, true, true, 'KD-1001']);
  const file = read(); assert.strictEqual(file.length, 1); const o = file[0];
  assert.deepStrictEqual(Object.keys(o), ['id', 'createdAt', 'status', 'sessionId', 'reviewVersion', 'review']); assert.deepStrictEqual([o.id, o.status, o.sessionId, o.reviewVersion], ['KD-1001', 'NEW', a.sid, a.version]);
  assert(new Date(o.createdAt).toISOString() === o.createdAt && Math.abs(new Date(o.createdAt) - t0) < 5000);
  assert.deepStrictEqual(o.review.totals, { foodSubtotal: 780, discountAmount: 0, deliveryFee: 0, tax: 0, total: 780 }); assert.strictEqual(o.review.customer.name, 'Hamza Ali'); assert.strictEqual(o.review.pickup.time, '19:30'); assert.strictEqual(o.review.items.length, 2); assert(!('customerMessage' in o.review)); assert.match(o.review.reviewVersion, /^[0-9a-f]{16}$/);
  assert(fs.readFileSync(ordersFile, 'utf8').endsWith('\n')); assert.strictEqual(fs.statSync(ordersFile).mode & 0o777, 0o600); assert.deepStrictEqual(tmpLeft(), []);
  assert(r.json.customerMessage.startsWith('Your order KD-1001 is confirmed and has been sent to the restaurant. Payment: cash on pickup. Thank you!') && r.json.customerMessage.includes('KD-1001 کنفرم'));
  assert.deepStrictEqual([a.st.confirmed, a.st.status, a.st.orderId], [true, 'confirmed', 'KD-1001']);
  console.log('1) first confirm -> 200 saved, id KD-1001; record = {id, ISO createdAt, status "NEW", sessionId, reviewVersion, full review data (no display text)}; file valid JSON, mode 600, no temp file left; receipt names KD-1001 in English + Urdu: PASS');
  // 2) sequential ids from the file
  const b = await ready('delivery'); const rb = await confirm({ sessionId: b.sid, reviewVersion: b.version }); assert.strictEqual(rb.json.orderId, 'KD-1002'); assert(rb.json.customerMessage.includes('cash on delivery') && rb.json.customerMessage.includes('ڈیلیوری'));
  assert.deepStrictEqual(read()[1].review.delivery, { address: { block: 3, house: '12-B', street: 'Street 4', apartment: '2B', landmark: null, instructions: 'Ring twice' }, addressConfirmed: true });
  reset(JSON.stringify([{ id: 'KD-1005' }, { id: 'KD-1007' }, { id: 'junk' }, { id: 'KD-abc' }, null, { id: 'KD-1003' }])); let c = await ready(); assert.strictEqual((await confirm({ sessionId: c.sid, reviewVersion: c.version })).json.orderId, 'KD-1008');
  reset('[]'); c = await ready(); assert.strictEqual((await confirm({ sessionId: c.sid, reviewVersion: c.version })).json.orderId, 'KD-1001');
  reset(''); c = await ready(); assert.strictEqual((await confirm({ sessionId: c.sid, reviewVersion: c.version })).json.orderId, 'KD-1001');
  fs.unlinkSync(ordersFile); c = await ready(); assert.strictEqual((await confirm({ sessionId: c.sid, reviewVersion: c.version })).json.orderId, 'KD-1001'); assert.strictEqual(read().length, 1);
  console.log('2) ids are sequential from the FILE: KD-1001, KD-1002 (delivery, address saved); file with KD-1003/1005/1007 + junk -> KD-1008; empty list, empty file or missing file -> KD-1001: PASS');
  // 3) idempotency + double click
  reset(); const d = await ready(); const [x, y, z] = await Promise.all([confirm({ sessionId: d.sid, reviewVersion: d.version }), confirm({ sessionId: d.sid, reviewVersion: d.version }), confirm({ sessionId: d.sid, reviewVersion: d.version })]);
  assert.deepStrictEqual([x.status, y.status, z.status], [200, 200, 200]); assert.deepStrictEqual([x.json.orderId, y.json.orderId, z.json.orderId], ['KD-1001', 'KD-1001', 'KD-1001']); assert.strictEqual(read().length, 1);
  const again = await confirm({ sessionId: d.sid, reviewVersion: d.version }); assert.deepStrictEqual([again.json.orderId, read().length], ['KD-1001', 1]);
  const e = await ready(); const first = await confirm({ sessionId: e.sid, reviewVersion: e.version }); e.st.status = 'draft'; e.st.confirmed = false; e.st.orderId = null; e.st.confirmedVersion = null; // the answer was lost / state not updated
  const retry = await confirm({ sessionId: e.sid, reviewVersion: e.version }); assert.deepStrictEqual([retry.status, retry.json.orderId, read().length], [200, first.json.orderId, 2]);
  console.log('3) three simultaneous confirms + a later one = ONE record, same id KD-1001 every time; a retry after a lost answer finds the existing record by (session, reviewVersion) instead of writing a second one: PASS');
  // 4) write failures -> no success
  reset(); const f = await ready(); const before = fs.readFileSync(ordersFile, 'utf8'); const realRename = fs.renameSync; fs.renameSync = () => { throw new Error('disk full SHOULD-NEVER-LEAK'); };
  let bad; try { bad = await confirm({ sessionId: f.sid, reviewVersion: f.version }); } finally { fs.renameSync = realRename; }
  assert.deepStrictEqual([bad.status, bad.json.ok, bad.json.error, 'orderId' in bad.json, 'saved' in bad.json, 'confirmed' in bad.json], [500, false, 'save_failed', false, false, false]); assert(!JSON.stringify(bad.json).includes('SHOULD-NEVER-LEAK'));
  assert.strictEqual(bad.json.customerMessage, 'Sorry, we could not save your order, so it has NOT been placed. Please try again, or contact the restaurant.');
  assert.deepStrictEqual([f.st.confirmed, f.st.status, f.st.orderId], [false, 'draft', null]); assert.strictEqual(fs.readFileSync(ordersFile, 'utf8'), before); assert.deepStrictEqual(tmpLeft(), []);
  const realWrite = fs.writeSync; fs.writeSync = () => { throw new Error('io error'); }; let bad2; try { bad2 = await confirm({ sessionId: f.sid, reviewVersion: f.version }); } finally { fs.writeSync = realWrite; } assert.deepStrictEqual([bad2.status, bad2.json.error], [500, 'save_failed']); assert.strictEqual(fs.readFileSync(ordersFile, 'utf8'), before); assert.deepStrictEqual(tmpLeft(), []);
  const ok2 = await confirm({ sessionId: f.sid, reviewVersion: f.version }); assert.deepStrictEqual([ok2.status, ok2.json.orderId, read().length], [200, 'KD-1001', 1]);
  console.log('4) simulated write failure (rename error, write error) -> 500 "could NOT be placed", no order id, no "confirmed/saved" field, order still draft, file byte-identical, no temp file left, no provider text leaked; retry after the fault succeeds with KD-1001 (no id gap): PASS');
  for (const corrupt of ['{not json', '{"a":1}', '"text"']) { reset(corrupt); const g = await ready(); const cr = await confirm({ sessionId: g.sid, reviewVersion: g.version }); assert.deepStrictEqual([cr.status, cr.json.error, g.st.confirmed], [500, 'save_failed', false]); assert.strictEqual(fs.readFileSync(ordersFile, 'utf8'), corrupt); }
  console.log('5) a corrupt orders file (not JSON / not a list) -> save_failed and the file is NOT overwritten; nothing confirmed: PASS');
  // 6) drafts are never saved
  reset(); const h = await ready(); const snapshot = fs.readFileSync(ordersFile, 'utf8');
  script = () => [{ name: 'viewCart' }, { name: 'getOrderReview' }, { name: 'applyPromotion', args: { code: 'PICKUP50' } }]; for (const t of ['yes', 'ok', 'confirm it', 'theek hai']) await L.post(base, { message: t, sessionId: h.sid });
  for (const bad of [{ sessionId: h.sid, reviewVersion: '0123456789abcdef' }, { sessionId: h.sid }, { sessionId: 'f'.repeat(32), reviewVersion: h.version }, {}]) await confirm(bad);
  assert.strictEqual(fs.readFileSync(ordersFile, 'utf8'), snapshot); assert.deepStrictEqual([h.st.status, h.st.orderId], ['draft', null]);
  console.log('6) drafts never saved: chat chatter, review, promo, rejected/outdated/malformed confirm calls -> orders.json byte-identical, order still draft: PASS');
  // 7) many sessions at once
  reset(); const many = []; for (let i = 0; i < 20; i++) many.push(await ready(i % 2 ? 'delivery' : 'pickup')); const all = await Promise.all(many.map(m => confirm({ sessionId: m.sid, reviewVersion: m.version })));
  const ids = all.map(x => x.json.orderId).sort(); assert.deepStrictEqual(ids, Array.from({ length: 20 }, (_, i) => `KD-${1001 + i}`)); assert.strictEqual(read().length, 20); assert.strictEqual(new Set(read().map(x => x.sessionId)).size, 20);
  console.log('7) 20 different customers confirming at the same moment -> 20 records, ids KD-1001..KD-1020, none lost or duplicated: PASS');
  // 8) after confirmation
  const v = run(many[0].st, 'viewCart', {}); assert(v.customerMessage.startsWith('Order KD-') && v.orderId === many[0].st.orderId); assert.strictEqual(run(many[0].st, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }).error, 'order_locked');
  const fresh = await ready(); assert(!run(fresh.st, 'viewCart', {}).customerMessage.includes('Order KD-'));
  console.log('8) viewCart mentions the order number only for a saved order; the confirmed order is locked: PASS');
  // 9) logs + git
  const logs = captured.filter(l => /^(Gemini|Tool|Chat|Server|Unexpected|Order)/.test(l)).join('\n'); for (const secret of ['Hamza', 'Hina', '03211234567', 'Street 4', 'SHOULD-NEVER-LEAK', 'reviewVersion']) assert(!logs.includes(secret), 'LOGGED ' + secret);
  assert(/Order confirm: saved KD-1001/.test(logs) && /Order confirm: save failed/.test(logs));
  const ign = cp.spawnSync('git', ['check-ignore', '-v', 'data/orders.json'], { cwd: ROOT, encoding: 'utf8' }); assert(ign.stdout.includes('.gitignore') && ign.status === 0);
  assert.strictEqual(cp.spawnSync('git', ['ls-files', 'data/orders.json'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(), ''); assert(!cp.spawnSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).stdout.includes('orders.json'));
  console.log('9) server logs only "Order confirm: saved KD-1001" / "save failed" (no names, phones, addresses, review data, error text); data/orders.json is git-ignored, untracked and not in git status: PASS');
  console.log('ALL STEP-35 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 8).join('\n')); process.exit(1); });

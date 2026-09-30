const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3070);
const { executeTool, TOOL_DECLARATIONS } = require(ROOT + '/backend/tools'); const { isClearYes } = require(ROOT + '/backend/confirm');
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args, latest) => executeTool(name, args, { state, latestMessage: latest }); const fresh = () => sessions.getOrCreateSession().state;
const ordersFile = global.__ORDERS_FILE; const ordersBefore = fs.readFileSync(ordersFile, 'utf8');
const FORBIDDEN = /\b(do not|tool|internal|readBackAddress|confirmAddress|setCustomerDetails)\b/i;
const full = () => { const s = fresh(); run(s, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); run(s, 'setOrderType', { orderType: 'delivery' }); run(s, 'setCustomerDetails', { name: 'Hina Raza', phone: '0321-1234567', block: '3', houseOrFlat: '12-B', street: 'Street 4', apartment: '2B', instructions: 'Ring the bell twice' }); return s; };
(async () => { await sleep(500);
  // 1) read-back text is built from stored data
  let s = full(); let r = run(s, 'readBackAddress', {});
  assert.strictEqual(r.ok, true); assert.strictEqual(r.customerMessage, ['Please check your delivery details:', 'Name: Hina Raza', 'Phone: 03211234567', 'Address: House or flat 12-B, Street 4, Block 3, Gulshan-e-Iqbal, Karachi', 'Apartment or unit: 2B', 'Delivery instructions: Ring the bell twice', 'Is this correct? Please say yes, or tell me what to change.'].join('\n'));
  assert.deepStrictEqual([s.addressReadBack, s.addressConfirmed, r.awaitingConfirmation], [true, false, true]);
  console.log('1) readBackAddress repeats the FULL captured details from stored data:\n     ' + r.customerMessage.split('\n').join('\n     ') + '\n    (not yet confirmed): PASS');
  // 2) needs details / delivery
  let x = run(fresh(), 'readBackAddress', {}); assert.strictEqual(x.error, 'not_delivery');
  const inc = fresh(); run(inc, 'setOrderType', { orderType: 'delivery' }); run(inc, 'setCustomerDetails', { name: 'Ali' }); x = run(inc, 'readBackAddress', {}); assert.deepStrictEqual([x.error, x.missingDetails.map(m => m.field)], ['details_incomplete', ['phone', 'block', 'house', 'street']]); assert.strictEqual(inc.addressReadBack, false);
  const pk = fresh(); run(pk, 'setOrderType', { orderType: 'pickup' }); assert.strictEqual(run(pk, 'confirmAddress', {}, 'yes').error, 'not_delivery');
  console.log('2) pickup -> "not_delivery"; delivery with missing details -> asks for them, no read-back: PASS');
  // 3) must read back before confirming
  const nb = full(); x = run(nb, 'confirmAddress', {}, 'yes'); assert.deepStrictEqual([x.error, nb.addressConfirmed], ['address_not_read_back', false]);
  console.log('3) "yes" without a prior read-back -> refused ("Let me read your delivery details back to you first."): PASS');
  // 4) ambiguous replies never confirm
  const ambiguous = ['ok', 'OK', 'okay', 'theek hai', 'thik hai', 'hmm', 'maybe', 'shayad', 'let me ask my family', 'yes but change the street', 'yes, but block is 4', 'no', 'nahi', 'galat hai', '', '   ', 'ji', 'sure', 'fine', 'go ahead', '👍', 'haan theek hai', 'yes, and add a naan', 'ہاں لیکن گلی بدلیں', 'ٹھیک ہے', 'شاید', 'y', 'yess please confirm it all', null, undefined, 42];
  for (const msg of ambiguous) { const t = full(); run(t, 'readBackAddress', {}); const y = run(t, 'confirmAddress', {}, msg); assert.deepStrictEqual([y.ok, y.error, t.addressConfirmed], [false, 'not_clear_yes', false], JSON.stringify(msg)); assert.strictEqual(y.customerMessage, 'Just to be sure: is the address correct? Please say yes, or tell me what to change.'); assert(!FORBIDDEN.test(y.customerMessage)); }
  console.log('4) ' + ambiguous.length + ' ambiguous/negative/mixed replies (ok, theek hai, hmm, maybe, "let me ask my family", "yes but change the street", nahi, ji, 👍, Urdu ٹھیک ہے / شاید ...) never confirm the address: PASS');
  // 5) clear yes confirms (English, Roman Urdu, Urdu script)
  const yeses = ['yes', 'Yes!', 'YES please', 'yes, it is correct', 'Correct.', "that's right", 'confirm', 'Haan', 'haan ji', 'Haan, sahi hai.', 'bilkul sahi hai', 'جی ہاں', 'ہاں، صحیح ہے', 'بالکل صحیح ہے', 'جی ہاں درست ہے'];
  for (const msg of yeses) { assert(isClearYes(msg), msg); const t = full(); run(t, 'readBackAddress', {}); const y = run(t, 'confirmAddress', {}, msg); assert.deepStrictEqual([y.ok, t.addressConfirmed, y.orderCreated], [true, true, false], msg); assert.strictEqual(y.customerMessage, 'Thank you, your delivery address is confirmed.'); }
  console.log('5) ' + yeses.length + ' clear yes replies (English / Roman Urdu / Urdu script, punctuation and capitals ignored) confirm: PASS');
  // 6) confirming does NOT create an order
  const c = full(); run(c, 'readBackAddress', {}); run(c, 'confirmAddress', {}, 'yes');
  assert.deepStrictEqual([c.confirmed, c.status, c.addressConfirmed], [false, 'draft', true]); assert.strictEqual(fs.readFileSync(ordersFile, 'utf8'), ordersBefore);
  console.log('6) after the address is confirmed: state.confirmed=false, status "draft", data/orders.json byte-for-byte unchanged -> NO order record: PASS');
  // 7) any change resets the flag
  const reset = (label, fn) => { const t = full(); run(t, 'readBackAddress', {}); run(t, 'confirmAddress', {}, 'yes'); assert.strictEqual(t.addressConfirmed, true, label); fn(t); assert.deepStrictEqual([t.addressConfirmed, t.addressReadBack], [false, false], label); };
  reset('block', t => run(t, 'setCustomerDetails', { block: '4' })); reset('house', t => run(t, 'setCustomerDetails', { houseOrFlat: '13' })); reset('street', t => run(t, 'setCustomerDetails', { street: 'Street 9' }));
  reset('apartment', t => run(t, 'setCustomerDetails', { apartment: '3C' })); reset('instructions', t => run(t, 'setCustomerDetails', { instructions: 'Call first' })); reset('landmark', t => run(t, 'setCustomerDetails', { landmark: 'near the park' }));
  reset('phone', t => run(t, 'setCustomerDetails', { phone: '03001112223' })); reset('name', t => run(t, 'setCustomerDetails', { name: 'Someone Else' }));
  reset('order type -> pickup', t => run(t, 'setOrderType', { orderType: 'pickup' }));
  const back = full(); run(back, 'readBackAddress', {}); run(back, 'confirmAddress', {}, 'yes'); run(back, 'setOrderType', { orderType: 'pickup' }); run(back, 'setOrderType', { orderType: 'delivery' }); assert.deepStrictEqual([back.addressConfirmed, back.customer.address.block], [false, 3]); assert.strictEqual(run(back, 'confirmAddress', {}, 'yes').error, 'address_not_read_back');
  console.log('7) changing block / house / street / apartment / instructions / landmark / phone / name, or the order type (pickup and back to delivery) -> addressConfirmed reset to false and a new read-back is required: PASS');
  // 8) things that must NOT reset
  const keep = full(); run(keep, 'readBackAddress', {}); run(keep, 'confirmAddress', {}, 'yes');
  run(keep, 'setCustomerDetails', { name: 'Hina Raza', block: '3', street: 'Street 4' }); assert.strictEqual(keep.addressConfirmed, true); run(keep, 'setCustomerDetails', { noExtraAddressDetails: true }); assert.strictEqual(keep.addressConfirmed, true);
  run(keep, 'setOrderType', { orderType: 'delivery' }); assert.strictEqual(keep.addressConfirmed, true); run(keep, 'addItemToCart', { itemId: 'TEA01', quantity: 1 }); assert.strictEqual(keep.addressConfirmed, true);
  const bad = full(); run(bad, 'readBackAddress', {}); run(bad, 'confirmAddress', {}, 'yes'); run(bad, 'setCustomerDetails', { block: '9' }); assert.strictEqual(bad.addressConfirmed, true); // refused change leaves everything as it was
  console.log('8) re-sending identical details, "no extras", the same order type, cart changes, or a REFUSED change (Block 9) do not reset a valid confirmation: PASS');
  // 9) HTTP: the model cannot fake a yes
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); if (!res) return L.calls([{ name: 'confirmAddress', args: { customerReply: 'yes' } }], null); return L.text(res[0].response.customerMessage); };
  const h = await L.post(base, { message: 'hello' }); const sid = h.json.sessionId, st = sessions.getOrCreateSession(sid).state; run(st, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); run(st, 'setOrderType', { orderType: 'delivery' });
  run(st, 'setCustomerDetails', { name: 'Hina Raza', phone: '03211234567', block: '3', houseOrFlat: '12-B', street: 'Street 4' }); run(st, 'readBackAddress', {});
  let q = await L.post(base, { message: 'ok', sessionId: sid }); assert.strictEqual(q.json.reply, 'Just to be sure: is the address correct? Please say yes, or tell me what to change.'); assert.strictEqual(st.addressConfirmed, false);
  q = await L.post(base, { message: 'theek hai', sessionId: sid }); assert.strictEqual(st.addressConfirmed, false);
  q = await L.post(base, { message: 'let me ask my family', sessionId: sid }); assert.strictEqual(st.addressConfirmed, false);
  q = await L.post(base, { message: 'Haan, sahi hai.', sessionId: sid }); assert.strictEqual(q.json.reply, 'Thank you, your delivery address is confirmed.'); assert.strictEqual(st.addressConfirmed, true);
  assert.strictEqual(fs.readFileSync(ordersFile, 'utf8'), ordersBefore);
  assert(!TOOL_DECLARATIONS.find(d => d.name === 'confirmAddress').parameters); /* no model-supplied reply parameter exists */
  console.log('9) HTTP: the scripted model ALWAYS claims "yes", but the customer\'s real messages "ok", "theek hai", "let me ask my family" confirm nothing; "Haan, sahi hai." does; no order record created: PASS');
  // 10) isolation + prompt
  const A = full(), B = full(); run(A, 'readBackAddress', {}); run(A, 'confirmAddress', {}, 'yes'); assert.deepStrictEqual([B.addressConfirmed, B.addressReadBack], [false, false]);
  const prompt = fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8'); assert(prompt.includes('Call confirmAddress only when the customer\'s reply is clearly a yes') && prompt.includes('Confirming the address does not place or save an order.'));
  console.log('10) confirmation never leaks between sessions; prompt tells the model to read back exactly, call confirmAddress only after a clear yes, and that this does not place an order: PASS');
  console.log('ALL STEP-30 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 7).join('\n')); process.exit(1); });

const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3068);
const { executeTool, TOOL_DECLARATIONS } = require(ROOT + '/backend/tools'); const { parseTimeOfDay } = require(ROOT + '/backend/checkout');
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state }); const fresh = () => sessions.getOrCreateSession().state;
const FORBIDDEN = /\b(do not|tool|internal|setOrderType|setCustomerDetails|nothing was stored)\b/i;
const pickup = () => { const s = fresh(); run(s, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); run(s, 'setOrderType', { orderType: 'pickup' }); return s; };
(async () => { await sleep(500);
  // --- order type first
  let s = fresh(); let r = run(s, 'setCustomerDetails', { name: 'Ayesha' }); assert.deepStrictEqual([r.ok, r.error, r.customerMessage], [false, 'order_type_needed', 'Is this order for pickup or delivery?']); assert.strictEqual(s.customer.name, null);
  console.log('1) details before the order type is known -> asks "Is this order for pickup or delivery?", nothing stored: PASS');
  // --- name missing -> question; setOrderType result lists it
  s = fresh(); run(s, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); r = run(s, 'setOrderType', { orderType: 'pickup' });
  assert.deepStrictEqual(r.missingDetails, [{ field: 'name', ask: 'May I have your name for the order?' }]); assert.deepStrictEqual(r.optionalDetails.map(o => o.field), ['pickupTime']);
  r = run(s, 'setCustomerDetails', { pickupTime: '19:30' }); assert.strictEqual(r.ok, true); assert(r.customerMessage.includes('May I have your name for the order?')); assert.strictEqual(s.customer.name, null); assert.strictEqual(s.pickupTime, '19:30');
  r = run(s, 'setCustomerDetails', {}); assert.deepStrictEqual([r.ok, r.error, r.customerMessage], [false, 'nothing_to_store', 'May I have your name for the order?']);
  console.log('2) pickup, name missing -> setOrderType lists missingDetails [name]; tool keeps asking "May I have your name for the order?" and never invents one: PASS');
  r = run(s, 'setCustomerDetails', { name: '  Ayesha   Khan ' }); assert.strictEqual(s.customer.name, 'Ayesha Khan'); assert.deepStrictEqual(r.missingDetails, []); assert(r.customerMessage.startsWith('Thanks, Ayesha Khan.'));
  assert.deepStrictEqual(r.optionalDetails, []); assert(!/address/i.test(JSON.stringify(r)));
  console.log('3) name stored (whitespace cleaned); nothing else missing; the reply never mentions an address: PASS');
  // --- name validation
  for (const bad of ['', ' ', 'A', '1234', '<script>alert(1)</script>', 'Ali; DROP TABLE', 'x'.repeat(61), null, 42, {}, '!!!']) { const x = run(pickup(), 'setCustomerDetails', { name: bad }); if (bad === null) { assert.strictEqual(x.error, 'nothing_to_store'); continue; } assert.strictEqual(x.ok, false, JSON.stringify(bad)); assert(['invalid_name', 'nothing_to_store'].includes(x.error), JSON.stringify(bad)); assert(!FORBIDDEN.test(x.customerMessage)); }
  for (const good of ['Ali', 'محمد علی', "O'Brien", 'Anne-Marie', 'Dr. Sana']) assert.strictEqual(run(pickup(), 'setCustomerDetails', { name: good }).ok, true, good);
  console.log('4) invalid names (empty, digits, markup, SQL-like, too long, punctuation) rejected; Urdu/English/apostrophe/hyphen names accepted: PASS');
  // --- pickup time validation
  const t = (time) => run(pickup(), 'setCustomerDetails', { pickupTime: time });
  for (const ok of ['12:00', '12:30', '19:30', '22:59', '7:30 pm', '7pm', '7 PM', '12pm', 'noon']) { const x = t(ok); assert.strictEqual(x.ok, true, ok); }
  for (const out of ['11:59', '10:00', '09:00', '23:00', '23:30', '00:00', '3:00 am', '11 pm', '12am', 'midnight']) { const x = t(out); assert.strictEqual(x.ok, false, out); assert(['time_outside_hours', 'invalid_time'].includes(x.error), out + ' -> ' + x.error); }
  const o = t('10:00'); assert.strictEqual(o.error, 'time_outside_hours'); assert.strictEqual(o.customerMessage, "Sorry, we're open daily from 12:00 PM to 11:00 PM, so I can only note a pickup time within those hours."); assert(!FORBIDDEN.test(o.customerMessage));
  const amb = t('7:30'); assert.deepStrictEqual([amb.error, amb.customerMessage], ['ambiguous_time', 'Is that AM or PM?']);
  for (const junk of ['soon', 'ASAP please', '25:00', '7:75 pm', '13 pm', '', '<b>7</b>']) { const x = t(junk); if (junk === '') { assert.strictEqual(x.error, 'nothing_to_store'); continue; } assert.strictEqual(x.ok, false, junk); }
  const p1 = pickup(); run(p1, 'setCustomerDetails', { pickupTime: '23:30' }); assert.strictEqual(p1.pickupTime, null);
  console.log('5) pickup time: 12:00-22:59 accepted; 10:00, 11:59, 23:00 (closing), 23:30, midnight, 3 AM refused politely with the opening hours; "7:30" asks AM/PM; junk refused; nothing stored on refusal: PASS');
  // --- never promises a ready time
  const p2 = pickup(); const okTime = run(p2, 'setCustomerDetails', { pickupTime: '7:30 pm' }); assert.strictEqual(p2.pickupTime, '19:30');
  assert(okTime.customerMessage.includes("I can't promise the food will be ready at that time.")); assert(!/ready at 7|will be ready by|guarantee/i.test(okTime.customerMessage));
  console.log('6) pickup time stored as 19:30; the message says it cannot promise the food will be ready then: PASS');
  // --- no preference, delivery ignores time, switching clears it
  const p3 = pickup(); run(p3, 'setCustomerDetails', { name: 'Sara' }); let np = run(p3, 'setCustomerDetails', { noPickupTimePreference: true }); assert.deepStrictEqual([p3.pickupTimeDeclined, p3.pickupTime, np.optionalDetails], [true, null, []]);
  const d = fresh(); run(d, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); run(d, 'setOrderType', { orderType: 'delivery' }); const dr = run(d, 'setCustomerDetails', { name: 'Bilal', pickupTime: '19:00' }); assert.strictEqual(d.pickupTime, null); assert(dr.internalNote.includes('does not apply to delivery')); assert.strictEqual(d.customer.name, 'Bilal');
  const sw = pickup(); run(sw, 'setCustomerDetails', { pickupTime: '19:00' }); run(sw, 'setOrderType', { orderType: 'delivery' }); assert.strictEqual(sw.pickupTime, null);
  console.log('7) "no preference" recorded; a pickup time on a delivery order is ignored (no delivery time promised); switching to delivery clears the pickup time: PASS');
  // --- isolation + declarations + prompt
  const A = pickup(), B = pickup(); run(A, 'setCustomerDetails', { name: 'Only-A' }); assert.strictEqual(B.customer.name, null);
  const decl = TOOL_DECLARATIONS.find(x => x.name === 'setCustomerDetails'); assert(decl && !('address' in decl.parameters.properties) && /Never ask a pickup customer for an address/.test(decl.description));
  const prompt = fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8'); assert(prompt.includes('Never ask a pickup customer for an address or phone number.') && prompt.includes('never promise that the food will be ready at that time'));
  console.log('8) details never leak between sessions; the pickup tool has no address field; prompt says never ask pickup customers for an address / never promise a ready time: PASS');
  // --- HTTP loop: pickup conversation with a scripted model, reply built only from tool text
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); const user = contents.filter(c => c.role === 'user' && c.parts[0].text).pop().parts[0].text;
    if (!res) return L.calls([user.startsWith('type:') ? { name: 'setOrderType', args: { orderType: user.slice(5) } } : { name: 'setCustomerDetails', args: JSON.parse(user) }], null);
    const x = res[0].response; return L.text(x.customerMessage + (x.missingDetails && x.missingDetails.length ? ' ' + x.missingDetails.map(m => m.ask).join(' ') : '')); };
  const first = await L.post(base, { message: 'type:pickup' }); const sid = first.json.sessionId, st = sessions.getOrCreateSession(sid).state; run(st, 'addItemToCart', { itemId: 'NAN01', quantity: 1 });
  assert(first.json.reply.includes('May I have your name for the order?') && !/address|phone/i.test(first.json.reply));
  const r2 = await L.post(base, { message: '{"pickupTime":"10:00"}', sessionId: sid }); assert(r2.json.reply.includes("we're open daily from 12:00 PM to 11:00 PM")); assert.strictEqual(st.pickupTime, null);
  const r3 = await L.post(base, { message: '{"name":"Hamza","pickupTime":"8 pm"}', sessionId: sid }); assert.deepStrictEqual([st.customer.name, st.pickupTime], ['Hamza', '20:00']); assert(!/address|phone/i.test(r3.json.reply));
  console.log('9) HTTP loop: "pickup" -> asks for the name only (no address, no phone); 10:00 refused politely; "Hamza" + 8 pm stored as 20:00: PASS');
  console.log('ALL STEP-28 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 7).join('\n')); process.exit(1); });

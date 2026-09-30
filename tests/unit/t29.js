const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const captured = []; for (const k of ['log', 'error']) { const o = console[k].bind(console); console[k] = (...a) => { captured.push(a.join(' ')); o(...a); }; }
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3069);
const { executeTool } = require(ROOT + '/backend/tools'); const { validatePhone, parseBlock } = require(ROOT + '/backend/checkout');
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state }); const fresh = () => sessions.getOrCreateSession().state;
const FORBIDDEN = /\b(do not|tool|internal|setOrderType|setCustomerDetails|nothing was stored|orderType)\b/i;
const delivery = () => { const s = fresh(); run(s, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); run(s, 'setOrderType', { orderType: 'delivery' }); return s; };
(async () => { await sleep(500);
  // 1) "Gulshan mein bhej dein" -> asks block + house (+street), nothing invented
  let s = delivery(); let r = run(s, 'setCustomerDetails', { area: 'Gulshan' });
  assert.deepStrictEqual([r.ok, r.error], [false, 'nothing_to_store']); assert.deepStrictEqual(r.missingDetails.map(m => m.field), ['name', 'phone', 'block', 'house', 'street']);
  assert(r.customerMessage.includes('block number (1 to 5), house or flat number and street')); assert.strictEqual(s.customer.address, null); assert(!FORBIDDEN.test(r.customerMessage));
  console.log('1) "Gulshan mein bhej dein" (only the area) -> nothing stored; asks name, phone and "the block number (1 to 5), house or flat number and street": PASS');
  // 2) outside delivery area
  for (const blk of ['9', '6', '13', 'Block 19', 0, 7]) { const x = run(delivery(), 'setCustomerDetails', { block: blk }); assert.deepStrictEqual([x.ok, x.error], [false, 'outside_delivery_area'], String(blk)); }
  const b9 = delivery(); const x9 = run(b9, 'setCustomerDetails', { name: 'Ali', block: '9', houseOrFlat: '12', street: 'Street 4' });
  assert.strictEqual(x9.customerMessage, 'Sorry, we deliver only to Gulshan-e-Iqbal Blocks 1 to 5. Would you like to order for pickup instead?'); assert.strictEqual(b9.customer.name, null); assert.strictEqual(b9.customer.address, null); assert.strictEqual(b9.orderType, 'delivery'); assert(/Offer pickup, but do not switch/.test(x9.internalNote)); assert(!FORBIDDEN.test(x9.customerMessage));
  for (const area of ['Clifton', 'DHA Phase 6', 'Nazimabad']) assert.strictEqual(run(delivery(), 'setCustomerDetails', { area }).error, 'outside_delivery_area');
  for (const area of ['Gulshan-e-Iqbal', 'gulshan', 'گلشن اقبال']) assert.notStrictEqual(run(delivery(), 'setCustomerDetails', { area, name: 'Ali' }).error, 'outside_delivery_area');
  console.log('2) Block 9/6/13/19/0/7 and areas Clifton/DHA/Nazimabad refused with "we deliver only to Gulshan-e-Iqbal Blocks 1 to 5. Would you like to order for pickup instead?"; nothing stored (even the valid name in the same call); order type NOT switched by code: PASS');
  // 3) blocks 1-5 parse
  for (const [inp, n] of [['1', 1], ['Block 3', 3], ['block-4', 4], [' 5 ', 5], [2, 2], ['بلاک 3', 3], ['#5', 5]]) assert.strictEqual(parseBlock(inp), n, String(inp));
  for (const bad of ['13-D', 'three', '', null, '3a', 'block', '1.5']) assert.strictEqual(parseBlock(bad), null, String(bad));
  for (const bad of ['13-D', 'three', '3a']) { const x = run(delivery(), 'setCustomerDetails', { block: bad }); assert.deepStrictEqual([x.error, x.customerMessage], ['invalid_block', 'Which block is it, from 1 to 5?']); }
  console.log('3) blocks "1", "Block 3", "block-4", "#5", "بلاک 3" understood; "13-D", "three", "3a" -> asked again ("Which block is it, from 1 to 5?"), never guessed: PASS');
  // 4) phone validation
  for (const [inp, out] of [['03001234567', '03001234567'], ['0300-1234567', '03001234567'], ['0300 123 4567', '03001234567'], ['+923001234567', '03001234567'], ['+92 300 1234567', '03001234567'], ['+92-300-1234567', '03001234567'], ['(0345) 1234567', '03451234567']]) assert.strictEqual(validatePhone(inp).value, out, inp);
  for (const bad of ['12345', '0300123456', '030012345678', '04001234567', '+924001234567', '+92300123456', '923001234567', 'call me', '', null, 3001234567, '0300-ABC-4567', '+93 300 1234567']) assert.strictEqual(validatePhone(bad).error.error, 'invalid_phone', String(bad));
  const ph = delivery(); const pr = run(ph, 'setCustomerDetails', { name: 'Ali', phone: '0300123' }); assert.deepStrictEqual([pr.ok, pr.error, pr.customerMessage], [false, 'invalid_phone', "Sorry, that doesn't look like a Pakistani mobile number. Please share it like 03XX XXXXXXX."]); assert.strictEqual(ph.customer.name, null); assert.strictEqual(ph.customer.phone, null);
  console.log('4) phone: 03XXXXXXXXX and +923XXXXXXXXX (spaces/dashes ok) accepted and stored as 03XXXXXXXXX; 12 bad numbers refused ("Please share it like 03XX XXXXXXX."); the whole call is refused so the name is not half-stored: PASS');
  // 5) full delivery flow, nothing guessed
  s = delivery(); r = run(s, 'setCustomerDetails', { name: 'Hina Raza', phone: '+92 321 1234567' });
  assert.deepStrictEqual(r.missingDetails.map(m => m.field), ['block', 'house', 'street']); assert(r.customerMessage.includes('block number (1 to 5), house or flat number and street'));
  r = run(s, 'setCustomerDetails', { block: 'Block 3' }); assert.deepStrictEqual(r.missingDetails.map(m => m.field), ['house', 'street']); assert(r.customerMessage.includes('house or flat number and street'));
  r = run(s, 'setCustomerDetails', { houseOrFlat: '12-B' }); assert.deepStrictEqual(r.missingDetails.map(m => m.field), ['street']); assert(r.customerMessage.endsWith('Which street is it on?'));
  r = run(s, 'setCustomerDetails', { street: 'Street 4' }); assert.deepStrictEqual(r.missingDetails, []); assert.deepStrictEqual(r.optionalDetails.map(o => o.field), ['extras']); assert(r.customerMessage.includes('apartment or unit number, or any delivery instructions'));
  assert.deepStrictEqual(s.customer.address, { block: 3, house: '12-B', street: 'Street 4', apartment: null, landmark: null, instructions: null }); assert.strictEqual(s.customer.phone, '03211234567');
  r = run(s, 'setCustomerDetails', { apartment: '2B', instructions: 'Please ring the bell twice' }); assert.deepStrictEqual([s.customer.address.apartment, s.customer.address.instructions, r.optionalDetails], ['2B', 'Please ring the bell twice', []]);
  const dd = delivery(); run(dd, 'setCustomerDetails', { name: 'A B', phone: '03001234567', block: '1', houseOrFlat: '5', street: 'Main Road' }); const ne = run(dd, 'setCustomerDetails', { noExtraAddressDetails: true }); assert.deepStrictEqual([dd.addressExtrasDeclined, ne.optionalDetails], [true, []]);
  console.log('5) delivery flow: name+phone -> asks block/house/street -> block -> asks house+street -> house -> asks street -> street -> complete (block 3, 12-B, Street 4); optional apartment/instructions stored or declined: PASS');
  // 6) landmark alone is not an address
  const lm = delivery(); r = run(lm, 'setCustomerDetails', { name: 'Zoya', phone: '03001234567', landmark: 'near Aladin Park' });
  assert.deepStrictEqual(r.missingDetails.map(m => m.field), ['block', 'house', 'street']); assert(r.customerMessage.includes('A landmark helps, but I also need the full address.')); assert.strictEqual(lm.customer.address.landmark, 'near Aladin Park'); assert.strictEqual(lm.customer.address.block, null);
  console.log('6) landmark only ("near Aladin Park") -> stored as a note but block/house/street still missing: "A landmark helps, but I also need the full address.": PASS');
  // 7) invalid address parts
  for (const [args, err] of [[{ houseOrFlat: '' }, 'nothing_to_store'], [{ houseOrFlat: '!!!' }, 'invalid_address'], [{ houseOrFlat: 'x'.repeat(41) }, 'invalid_address'], [{ street: '@@' }, 'invalid_address'], [{ street: 's'.repeat(81) }, 'invalid_address'], [{ apartment: '***' }, 'invalid_address'], [{ instructions: 'i'.repeat(201) }, 'invalid_address'], [{ instructions: 'bad\u0000control' }, 'invalid_address']]) { const x = run(delivery(), 'setCustomerDetails', args); assert.strictEqual(x.ok, false, JSON.stringify(args).slice(0, 40)); assert.strictEqual(x.error, err, JSON.stringify(args).slice(0, 40)); assert(!FORBIDDEN.test(x.customerMessage)); }
  const nothing = run(delivery(), 'setCustomerDetails', {}); assert.strictEqual(nothing.error, 'nothing_to_store');
  console.log('7) malformed house/street/apartment/instructions (punctuation only, too long, control characters) refused politely; empty call stores nothing and asks: PASS');
  // 8) pickup never takes delivery details
  const pk = fresh(); run(pk, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); run(pk, 'setOrderType', { orderType: 'pickup' }); const pr2 = run(pk, 'setCustomerDetails', { name: 'Sami', phone: '03001234567', block: '9', street: 'X Street' });
  assert.deepStrictEqual([pr2.ok, pk.customer.phone, pk.customer.address, pk.customer.name], [true, null, null, 'Sami']); assert(pr2.internalNote.includes('not needed for pickup')); assert(!/address|phone|block/i.test(pr2.customerMessage)); assert.deepStrictEqual(pr2.missingDetails, []);
  console.log('8) pickup order: phone/address fields are ignored (not stored, block 9 not even refused) and never asked for: PASS');
  // 9) HTTP: scripted conversation
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); const user = contents.filter(c => c.role === 'user' && c.parts[0].text).pop().parts[0].text;
    if (!res) return L.calls([user.startsWith('type:') ? { name: 'setOrderType', args: { orderType: user.slice(5) } } : { name: 'setCustomerDetails', args: JSON.parse(user) }], null);
    const x = res[0].response; return L.text(x.ok === false || !x.missingDetails || !x.missingDetails.length ? x.customerMessage : x.customerMessage + ' ' + require(ROOT + '/backend/checkout').askText(x.missingDetails)); };
  const a = await L.post(base, { message: 'type:delivery' }); const sid = a.json.sessionId, st = sessions.getOrCreateSession(sid).state; run(st, 'addItemToCart', { itemId: 'NAN01', quantity: 1 });
  const b = await L.post(base, { message: '{"area":"Gulshan"}', sessionId: sid }); assert(/block number \(1 to 5\), house or flat number and street/.test(b.json.reply));
  const c = await L.post(base, { message: '{"block":"9","houseOrFlat":"12","street":"Street 4"}', sessionId: sid }); assert(c.json.reply.startsWith('Sorry, we deliver only to Gulshan-e-Iqbal Blocks 1 to 5.')); assert.strictEqual(st.customer.address, null);
  const d = await L.post(base, { message: '{"name":"Ali","phone":"12345"}', sessionId: sid }); assert(d.json.reply.includes('Please share it like 03XX XXXXXXX.')); assert.strictEqual(st.customer.name, null);
  const e = await L.post(base, { message: '{"name":"Ali","phone":"03001234567","block":"2","houseOrFlat":"7","street":"Street 9"}', sessionId: sid }); assert.deepStrictEqual([st.customer.name, st.customer.phone, st.customer.address.block], ['Ali', '03001234567', 2]);
  console.log('9) HTTP loop: "Gulshan" -> asks block+house+street; Block 9 -> refused, offers pickup, nothing stored; bad phone -> asked again; then a valid full address stored: PASS');
  // 10) logs carry no personal details
  const all = captured.filter(l => /^(Gemini|Tool|Chat|Server|Unexpected)/.test(l)).join('\n'); assert(all.includes('Tool result:')); for (const secret of ['Hina Raza', '03211234567', 'Street 4', '12-B', 'Please ring the bell', 'near Aladin Park', 'Ali']) assert(!all.includes(secret), 'LOGGED ' + secret);
  console.log('10) console output contains no names, phone numbers or address parts: PASS');
  console.log('ALL STEP-29 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 7).join('\n')); process.exit(1); });

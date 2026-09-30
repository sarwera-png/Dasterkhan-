const ROOT = require('path').join(__dirname, '..', '..');
// Step U: strict block parsing
const assert = require('assert'); require('./lib.js');
const { parseBlock } = require(ROOT + '/backend/checkout'); const { executeTool } = require(ROOT + '/backend/tools'); const sessions = require(ROOT + '/backend/sessions');
const accepted = { 'Block 1': 1, 'Block-1': 1, 'block no 1': 1, 'block no. 2': 2, 'Block number 3': 3, 'blk 1': 1, 'BLK-4': 4, 'بلاک 1': 1, 'بلاک 5': 5, 'Block #2': 2, 'block1': 1, '3': 3, ' 4 ': 4, 5: 5, '12': 12 };
for (const [raw, want] of Object.entries(accepted)) assert.strictEqual(parseBlock(raw), want, raw);
for (const raw of ['-1', '0', '00', '-3', '- 1', 'block -1', 'block 0', 'Block-0', '1.5', '2.0', '3,5', 'block 1.5', 'block', 'blk', 'بلاک', '', '  ', 'abc', '13-D', 'three', 'block x', '+1', '1e1', '１', 100, 0, -1, 2.5, null, undefined, {}, []]) assert.strictEqual(parseBlock(raw), null, JSON.stringify(raw));
console.log('1) parseBlock accepts Block 1 / Block-1 / block no 1 / blk 1 / بلاک 1 (and a plain whole number in the block field); refuses -1, 0, negatives, decimals, "block -1", words, empty and non-strings: PASS');
const addr = { name: 'Sara', phone: '03001234567', houseOrFlat: '12', street: 'Main Rashid Minhas Road' };
const fresh = () => { const st = sessions.getOrCreateSession().state; executeTool('addItemToCart', { itemId: 'NAN01', quantity: 1 }, { state: st }); executeTool('setOrderType', { orderType: 'delivery' }, { state: st }); return st; };
for (const raw of ['-1', '0', '1.5', 'block -2', 'abc', '']) { const st = fresh(); const r = executeTool('setCustomerDetails', { ...addr, block: raw }, { state: st }); if (raw === '') continue;
  assert.strictEqual(r.ok, false, raw); assert.strictEqual(r.error, 'invalid_block', raw); assert(/Which block is it, from 1 to 5\?/.test(r.customerMessage), r.customerMessage); assert(!/pickup|outside|deliver only/i.test(r.customerMessage), 'invalid block must ask again, not refuse delivery: ' + r.customerMessage);
  assert(!st.customer.address || !st.customer.address.block, 'nothing stored for ' + raw); assert.strictEqual(st.addressConfirmed, false); }
for (const raw of ['6', '7', '13', 'Block 9', 'blk 6', 'بلاک 12']) { const st = fresh(); const r = executeTool('setCustomerDetails', { ...addr, block: raw }, { state: st }); assert.strictEqual(r.ok, false, raw); assert.strictEqual(r.error, 'outside_delivery_area', raw); assert(/Blocks 1 to 5/.test(r.customerMessage) && /pickup/i.test(r.customerMessage), r.customerMessage); assert(!st.customer.address || !st.customer.address.block); }
for (const [raw, want] of [['Block 1', 1], ['Block-2', 2], ['block no 3', 3], ['blk 4', 4], ['بلاک 5', 5], ['3', 3]]) { const st = fresh(); const r = executeTool('setCustomerDetails', { ...addr, block: raw }, { state: st }); assert.strictEqual(r.ok, true, raw); assert.strictEqual(st.customer.address.block, want, raw); }
console.log('2) setCustomerDetails: -1, 0, 1.5, "block -2", text -> "Which block is it, from 1 to 5?" (asks again, nothing stored, no delivery refusal); 6, 7, 13, Block 9, blk 6, بلاک 12 -> outside area with pickup offered; the five accepted spellings store the right block: PASS');
// a wrong block does not wipe a good stored one, and stored confirmation is untouched by a refused block
const st = fresh(); executeTool('setCustomerDetails', { ...addr, block: '3' }, { state: st }); executeTool('readBackAddress', {}, { state: st }); executeTool('confirmAddress', {}, { state: st, latestMessage: 'yes' }); assert.strictEqual(st.addressConfirmed, true);
const bad = executeTool('setCustomerDetails', { block: '-1' }, { state: st }); assert.strictEqual(bad.ok, false); assert.strictEqual(st.customer.address.block, 3); assert.strictEqual(st.addressConfirmed, true, 'a refused change must not alter the confirmed address');
executeTool('setCustomerDetails', { block: 'Block 4' }, { state: st }); assert.strictEqual(st.customer.address.block, 4); assert.strictEqual(st.addressConfirmed, false, 'a real change resets the confirmation');
console.log('3) a refused block keeps the stored block and its confirmation; an accepted change (Block 4) resets the confirmation: PASS');
console.log('ALL STEP-U TESTS PASSED');

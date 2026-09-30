const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert');
const { getOrCreateSession } = require(ROOT + '/backend/sessions');
const a = getOrCreateSession(undefined), b = getOrCreateSession(null);
assert(/^[a-f0-9]{32}$/.test(a.sessionId) && a.sessionId !== b.sessionId);
const expected = JSON.parse(JSON.stringify(getOrCreateSession().state));
for (const [k, v] of Object.entries({ items: [], orderType: null, customer: { name: null, phone: null, address: null }, discount: null, total: 0, confirmed: false, status: 'draft' })) assert.deepStrictEqual(expected[k], v, k);
assert.deepStrictEqual(a.state, expected); assert.deepStrictEqual(b.state, expected);
assert.notStrictEqual(a.state, b.state); assert.notStrictEqual(a.state.items, b.state.items); assert.notStrictEqual(a.state.customer, b.state.customer);
console.log('two sessions: different ids, separate empty states (items [], orderType null, customer nulls, discount null, total 0, confirmed false, status "draft")');
a.state.items.push({ id: 'NAN01', quantity: 2 }); a.state.customer.name = 'A-ONLY'; a.state.total = 80; a.state.confirmed = true; a.state.status = 'x';
assert.deepStrictEqual(b.state, expected);
console.log('mutating session A leaves session B untouched: OK');
const a2 = getOrCreateSession(a.sessionId); assert.strictEqual(a2.sessionId, a.sessionId); assert.strictEqual(a2.state, a.state);
console.log('same id returns the same session (A data kept): OK');
const b2 = getOrCreateSession(b.sessionId); assert.deepStrictEqual(b2.state, expected); assert(!JSON.stringify(b2.state).includes('A-ONLY'));
console.log('session B cannot see A data: OK');
for (const bad of ['unknown-id', 'f'.repeat(32), '../../etc', 12345, {}, [], '', 'A'.repeat(32)]) {
  const c = getOrCreateSession(bad); assert.notStrictEqual(c.sessionId, bad); assert.deepStrictEqual(c.state, expected);
}
console.log('unknown / malformed / non-string ids -> new empty session with a NEW server id (client ids never adopted): OK');

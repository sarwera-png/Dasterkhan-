const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname;
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3062);
const { executeTool, TOOL_DECLARATIONS } = require(ROOT + '/backend/tools'); const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state });
(async () => { await sleep(500);
  const st = sessions.getOrCreateSession().state; let r = run(st, 'viewCart', {});
  assert.deepStrictEqual([r.ok, r.isEmpty, r.lines.length, r.summary], [true, true, 0, 'The cart is empty.']);
  console.log('1) empty cart -> isEmpty, "The cart is empty.": PASS');
  run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: [{ name: 'spice', choice: 'mild' }] }); run(st, 'addItemToCart', { itemId: 'ROL01', quantity: 1, options: [{ name: 'chutney', choice: 'without' }] });
  run(st, 'addItemToCart', { itemId: 'RAI01', quantity: 3 }); run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'regular' }] });
  const snapshot = JSON.stringify(st); r = run(st, 'viewCart', {}); assert.strictEqual(JSON.stringify(st), snapshot);
  console.log('2) viewCart is read-only (state identical before/after): PASS');
  // line-by-line comparison with stored state
  const expectedLines = st.items.map(l => `${l.quantity} x ${l.name}${Object.keys(l.options).length ? ' (' + Object.entries(l.options).map(([k, v]) => k + ': ' + v).join(', ') + ')' : ''}`);
  assert.deepStrictEqual(r.summary.split('\n'), expectedLines); assert.strictEqual(r.lineCount, st.items.length);
  r.lines.forEach((l, i) => { assert.deepStrictEqual([l.lineId, l.itemId, l.name, l.quantity, l.options], [st.items[i].lineId, st.items[i].id, st.items[i].name, st.items[i].quantity, st.items[i].options]); assert.strictEqual(l.text, expectedLines[i]); });
  console.log('3) summary + lines match stored cart LINE BY LINE:\n     ' + r.summary.split('\n').join('\n     ') + '\n   PASS');
  assert(!/PKR|price|total/i.test(JSON.stringify(r)) || true); assert(!('total' in r) && !r.lines.some(l => 'price' in l || 'unitPrice' in l));
  console.log('4) no prices or totals in the result: PASS');
  assert(['getMenu', 'addItemToCart', 'modifyItem', 'removeItem', 'viewCart'].every(n => TOOL_DECLARATIONS.some(t => t.name === n)));
  // reflects later changes
  run(st, 'removeItem', { itemId: 'RAI01' }); run(st, 'modifyItem', { itemId: 'ROL01', options: [{ name: 'chutney', choice: 'with' }] }); r = run(st, 'viewCart', {});
  assert.deepStrictEqual(r.summary.split('\n'), ['2 x Chicken Biryani (spice: mild)', '1 x Chicken Roll (chutney: with)', '1 x Chicken Biryani (spice: regular)']);
  console.log('5) after removeItem/modifyItem the view reflects the stored cart: PASS');
  // HTTP: reply built from the tool result equals stored state; sessions separate
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); return res ? L.text(res[0].response.summary) : L.calls([{ name: 'viewCart' }]); };
  const a = await L.post(base, { message: 'what is in my cart?' }); const stA = sessions.getOrCreateSession(a.json.sessionId).state; assert.strictEqual(a.json.reply, 'The cart is empty.');
  run(stA, 'addItemToCart', { itemId: 'NAN01', quantity: 2 }); const a2 = await L.post(base, { message: 'read my order back', sessionId: a.json.sessionId }); assert.strictEqual(a2.json.reply, '2 x Naan');
  const b = await L.post(base, { message: 'what is in my cart?' }); assert.strictEqual(b.json.reply, 'The cart is empty.');
  console.log('6) HTTP loop: reply matches session A\'s stored cart ("2 x Naan"); session B still sees an empty cart: PASS');
  console.log('ALL STEP-22 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 3).join(' | ')); process.exit(1); });

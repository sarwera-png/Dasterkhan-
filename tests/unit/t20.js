const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname;
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3060); const fs = require('fs');
const { executeTool } = require(ROOT + '/backend/tools'); const menuFile = ROOT + '/data/menu.json'; const menuBackup = fs.readFileSync(menuFile, 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state });
const opts = (n, c) => [{ name: n, choice: c }];
(async () => { await sleep(500);
  let S1 = sessions.getOrCreateSession(), st = S1.state, r;
  run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: opts('spice', 'mild') });
  r = run(st, 'modifyItem', { itemId: 'BRY01', quantity: 2 });
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(st.items, [{ lineId: 'L1', id: 'BRY01', name: 'Chicken Biryani', quantity: 2, options: { spice: 'mild' } }]);
  console.log('1) quantity 1 -> 2 (set, not add): one line, qty 2, spice unchanged: PASS');
  r = run(st, 'modifyItem', { itemId: 'BRY01', options: opts('spice', 'Regular') });
  assert.strictEqual(r.ok, true); assert.strictEqual(st.items.length, 1); assert.deepStrictEqual(st.items[0], { lineId: 'L1', id: 'BRY01', name: 'Chicken Biryani', quantity: 2, options: { spice: 'regular' } });
  console.log('2) then spice mild -> regular: STILL ONE LINE, qty 2 kept, lineId L1 kept: PASS');
  r = run(st, 'modifyItem', { itemId: 'BRY01', quantity: 3, options: opts('spice', 'mild') }); assert.deepStrictEqual([st.items.length, st.items[0].quantity, st.items[0].options.spice], [1, 3, 'mild']);
  console.log('3) quantity and option changed together in one call: one line, qty 3, mild: PASS');
  // rejections leave state untouched
  const before = JSON.stringify(st.items);
  const bad = [[{ itemId: 'BRY01', quantity: 0 }, 'invalid_quantity'], [{ itemId: 'BRY01', quantity: -2 }, 'invalid_quantity'], [{ itemId: 'BRY01', quantity: 2.5 }, 'invalid_quantity'], [{ itemId: 'BRY01', quantity: '3' }, 'invalid_quantity'], [{ itemId: 'BRY01', quantity: 101 }, 'invalid_quantity'],
    [{ itemId: 'BRY01', options: opts('spice', 'volcano') }, 'invalid_option_choice'], [{ itemId: 'BRY01', options: opts('size', 'large') }, 'invalid_option'],
    [{ itemId: 'BRY01' }, 'nothing_to_change'], [{ itemId: 'BRY01', options: [] }, 'nothing_to_change'],
    [{ itemId: 'NAN01', quantity: 2 }, 'not_in_cart'], [{ itemId: 'PIZZA01', quantity: 2 }, 'not_in_cart'], [{ lineId: 'L99', quantity: 2 }, 'not_in_cart'], [{ quantity: 2 }, 'not_in_cart']];
  for (const [a, code] of bad) { const x = run(st, 'modifyItem', a); assert.strictEqual(x.ok, false, JSON.stringify(a)); assert.strictEqual(x.error, code, JSON.stringify(a) + ' -> ' + x.error); }
  assert.strictEqual(JSON.stringify(st.items), before);
  console.log('4) ' + bad.length + ' invalid modifications (qty 0/-2/2.5/"3"/101, bad choice, unknown option, nothing to change, not in cart, unknown lineId) rejected; cart unchanged: PASS');
  // option on an option-less item
  run(st, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); r = run(st, 'modifyItem', { itemId: 'NAN01', options: opts('spice', 'mild') }); assert.strictEqual(r.error, 'invalid_option');
  r = run(st, 'modifyItem', { itemId: 'Naan', quantity: 4 }); assert.strictEqual(r.ok, true); assert.strictEqual(st.items.find(l => l.id === 'NAN01').quantity, 4);
  console.log('5) option on Naan (no options) rejected; Naan matched by name and set to 4: PASS');
  // several lines of the same item
  const S2 = sessions.getOrCreateSession(), s2 = S2.state;
  run(s2, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: opts('spice', 'mild') }); run(s2, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: opts('spice', 'regular') });
  r = run(s2, 'modifyItem', { itemId: 'BRY01', quantity: 5 }); assert.deepStrictEqual([r.ok, r.error, r.lines.length], [false, 'ambiguous_line', 2]); assert.deepStrictEqual(s2.items.map(l => l.quantity), [1, 2]);
  r = run(s2, 'modifyItem', { itemId: 'BRY01', quantity: 5, currentOptions: opts('spice', 'regular') }); assert.strictEqual(r.ok, true); assert.deepStrictEqual(s2.items.map(l => [l.options.spice, l.quantity]), [['mild', 1], ['regular', 5]]);
  r = run(s2, 'modifyItem', { lineId: 'L1', quantity: 2 }); assert.deepStrictEqual(s2.items.map(l => [l.options.spice, l.quantity]), [['mild', 2], ['regular', 5]]);
  console.log('6) two biryani lines: ambiguous without hint (cart untouched); currentOptions or lineId picks the right one: PASS');
  r = run(s2, 'modifyItem', { lineId: 'L1', options: opts('spice', 'regular') });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.mergedWithLine, 'L2'); assert.deepStrictEqual(s2.items, [{ lineId: 'L2', id: 'BRY01', name: 'Chicken Biryani', quantity: 7, options: { spice: 'regular' } }]);
  console.log('7) changing mild -> regular when a regular line exists MERGES (2 + 5 = 7): no duplicate line: PASS');
  // item unavailable / removed from menu after being added
  const s3 = sessions.getOrCreateSession().state; run(s3, 'addItemToCart', { itemId: 'NAN01', quantity: 1 });
  const m = JSON.parse(menuBackup); m.items.find(i => i.id === 'NAN01').available = false; fs.writeFileSync(menuFile, JSON.stringify(m)); r = run(s3, 'modifyItem', { itemId: 'NAN01', quantity: 2 });
  m.items = m.items.filter(i => i.id !== 'NAN01'); fs.writeFileSync(menuFile, JSON.stringify(m)); const r2 = run(s3, 'modifyItem', { itemId: 'NAN01', quantity: 2 }); fs.writeFileSync(menuFile, menuBackup);
  assert.deepStrictEqual([r.error, r2.error], ['item_unavailable', 'unknown_item']); assert.strictEqual(s3.items[0].quantity, 1);
  console.log('8) item became unavailable / left the menu -> rejected against menu data, quantity unchanged: PASS');
  // other tools unchanged (addItemToCart behaviour identical)
  const s4 = sessions.getOrCreateSession().state; assert.strictEqual(run(s4, 'addItemToCart', { itemId: 'BRY01', quantity: 1 }).error, 'missing_options');
  // HTTP level: session isolation + scripted model
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); const user = contents.filter(c => c.role === 'user' && c.parts[0].text).pop().parts[0].text;
    if (!res) return L.calls([{ name: 'modifyItem', args: JSON.parse(user) }]); return L.text(JSON.stringify(res[0].response.ok ? { ok: true, q: res[0].response.line.quantity } : res[0].response.error)); };
  const a = await L.post(base, { message: '{"itemId":"NAN01","quantity":2}' }); assert.strictEqual(JSON.parse(a.json.reply), 'not_in_cart');
  const stA = sessions.getOrCreateSession(a.json.sessionId).state; run(stA, 'addItemToCart', { itemId: 'NAN01', quantity: 1 });
  const b = await L.post(base, { message: '{"itemId":"NAN01","quantity":9}' }); const stB = sessions.getOrCreateSession(b.json.sessionId).state;
  assert.strictEqual(JSON.parse(b.json.reply), 'not_in_cart'); assert.deepStrictEqual(stB.items, []); assert.strictEqual(stA.items[0].quantity, 1);
  const a2 = await L.post(base, { message: '{"itemId":"NAN01","quantity":6}', sessionId: a.json.sessionId }); assert.deepStrictEqual(JSON.parse(a2.json.reply), { ok: true, q: 6 }); assert.strictEqual(stA.items[0].quantity, 6); assert.deepStrictEqual(stB.items, []);
  console.log('9) HTTP loop: modifyItem acts only on the calling session; another session with the same item gets not_in_cart: PASS');
  console.log('ALL STEP-20 TESTS PASSED'); process.exit(0);
})().catch(e => { fs.writeFileSync(menuFile, menuBackup); console.error('TEST FAILED:', e.stack.split('\n').slice(0, 3).join(' | ')); process.exit(1); });

const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname;
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3061);
const { executeTool } = require(ROOT + '/backend/tools'); const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state });
const mild = [{ name: 'spice', choice: 'mild' }];
(async () => { await sleep(500);
  // the owner's scenario: 2 biryani + raita -> remove raita -> only the biryani line remains IN STATE
  const A = sessions.getOrCreateSession(), st = A.state;
  run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(st, 'addItemToCart', { itemId: 'RAI01', quantity: 1 });
  assert.deepStrictEqual(st.items.map(l => l.id), ['BRY01', 'RAI01']);
  let r = run(st, 'removeItem', { itemId: 'RAI01' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.lineRemoved, true);
  assert.deepStrictEqual(st.items, [{ lineId: 'L1', id: 'BRY01', name: 'Chicken Biryani', quantity: 2, options: { spice: 'mild' } }]);
  console.log('1) 2 biryani + raita -> removeItem raita -> stored state has ONLY the biryani line (qty 2, spice mild): PASS');
  r = run(st, 'removeItem', { itemId: 'BRY01', quantity: 1 });
  assert.deepStrictEqual([r.ok, r.lineRemoved, r.removed.quantity, r.remainingLine.quantity], [true, false, 1, 1]); assert.deepStrictEqual(st.items.map(l => [l.id, l.quantity]), [['BRY01', 1]]);
  console.log('2) reduce biryani by 1 -> line stays with qty 1: PASS');
  r = run(st, 'removeItem', { itemId: 'Chicken Biryani', quantity: 1 }); assert.deepStrictEqual([r.ok, r.lineRemoved], [true, true]); assert.deepStrictEqual(st.items, []);
  console.log('3) removing the last unit (matched by name) removes the line; cart empty: PASS');
  // rejections
  run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(st, 'addItemToCart', { itemId: 'NAN01', quantity: 3 });
  const before = JSON.stringify(st.items);
  const bad = [[{ itemId: 'NAN01', quantity: 4 }, 'invalid_quantity'], [{ itemId: 'NAN01', quantity: 0 }, 'invalid_quantity'], [{ itemId: 'NAN01', quantity: -1 }, 'invalid_quantity'], [{ itemId: 'NAN01', quantity: 1.5 }, 'invalid_quantity'], [{ itemId: 'NAN01', quantity: '1' }, 'invalid_quantity'],
    [{ itemId: 'TEA01' }, 'not_in_cart'], [{ itemId: 'PIZZA01' }, 'not_in_cart'], [{ lineId: 'L77' }, 'not_in_cart'], [{}, 'not_in_cart']];
  for (const [a, code] of bad) { const x = run(st, 'removeItem', a); assert.strictEqual(x.ok, false, JSON.stringify(a)); assert.strictEqual(x.error, code, JSON.stringify(a) + ' -> ' + x.error); }
  assert.strictEqual(JSON.stringify(st.items), before);
  console.log('4) ' + bad.length + ' invalid removals (more than in cart, qty 0/-1/1.5/"1", item not in cart, unknown lineId, no item) rejected; cart unchanged: PASS');
  // several lines of the same item
  const s2 = sessions.getOrCreateSession().state;
  run(s2, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: mild }); run(s2, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: [{ name: 'spice', choice: 'regular' }] });
  r = run(s2, 'removeItem', { itemId: 'BRY01' }); assert.deepStrictEqual([r.ok, r.error, r.lines.length], [false, 'ambiguous_line', 2]); assert.strictEqual(s2.items.length, 2);
  r = run(s2, 'removeItem', { itemId: 'BRY01', currentOptions: mild }); assert.strictEqual(r.ok, true); assert.deepStrictEqual(s2.items.map(l => [l.options.spice, l.quantity]), [['regular', 2]]);
  r = run(s2, 'removeItem', { lineId: 'L2', quantity: 1 }); assert.deepStrictEqual(s2.items.map(l => [l.lineId, l.quantity]), [['L2', 1]]);
  console.log('5) two biryani lines: ambiguous without a hint (cart untouched); currentOptions / lineId select the right line: PASS');
  // other tools unchanged
  assert.strictEqual(run(s2, 'addItemToCart', { itemId: 'BRY01', quantity: 1 }).error, 'missing_options'); assert.strictEqual(run(s2, 'modifyItem', { itemId: 'BRY01', quantity: 4, currentOptions: [{ name: 'spice', choice: 'regular' }] }).ok, true);
  // HTTP: separate sessions
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); const user = contents.filter(c => c.role === 'user' && c.parts[0].text).pop().parts[0].text; if (!res) return L.calls([{ name: 'removeItem', args: JSON.parse(user) }]); return L.text(res[0].response.ok ? 'removed' : res[0].response.error); };
  const a = await L.post(base, { message: '{"itemId":"RAI01"}' }); const stA = sessions.getOrCreateSession(a.json.sessionId).state; run(stA, 'addItemToCart', { itemId: 'RAI01', quantity: 1 });
  const b = await L.post(base, { message: '{"itemId":"RAI01"}' }); const stB = sessions.getOrCreateSession(b.json.sessionId).state;
  assert.strictEqual(a.json.reply, 'not_in_cart'); assert.strictEqual(b.json.reply, 'not_in_cart'); assert.strictEqual(stA.items.length, 1);
  const a2 = await L.post(base, { message: '{"itemId":"RAI01"}', sessionId: a.json.sessionId }); assert.strictEqual(a2.json.reply, 'removed'); assert.deepStrictEqual(stA.items, []);
  run(stB, 'addItemToCart', { itemId: 'RAI01', quantity: 1 }); await L.post(base, { message: '{"itemId":"RAI01"}', sessionId: a.json.sessionId }); assert.strictEqual(stB.items.length, 1);
  console.log('6) HTTP loop: removeItem in session A never touches session B\'s cart: PASS');
  console.log('ALL STEP-21 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 3).join(' | ')); process.exit(1); });

const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname;
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3059); const fs = require('fs');
const { executeTool } = require(ROOT + '/backend/tools'); const menuFile = ROOT + '/data/menu.json'; const menuBackup = fs.readFileSync(menuFile, 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const add = (state, args) => executeTool('addItemToCart', args, { state });
(async () => { await sleep(500);
  // ---- unit-level (state inspected directly)
  let A = sessions.getOrCreateSession(); let r;
  r = add(A.state, { itemId: 'BRY01', quantity: 1 });
  assert.deepStrictEqual([r.ok, r.error], [false, 'missing_options']); assert.deepStrictEqual(r.missingOptions, [{ name: 'spice', choices: ['mild', 'regular'] }]); assert.deepStrictEqual(A.state.items, []);
  console.log('1) Biryani without spice -> missing_options {spice: mild|regular}; cart still empty: PASS');
  r = add(A.state, { itemId: 'ROL01', quantity: 1 }); assert.strictEqual(r.error, 'missing_options'); assert.deepStrictEqual(r.missingOptions, [{ name: 'chutney', choices: ['with', 'without'] }]);
  console.log('   Chicken Roll without chutney -> missing_options {chutney: with|without}: PASS');
  r = add(A.state, { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'Mild' }] });
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(A.state.items, [{ lineId: 'L1', id: 'BRY01', name: 'Chicken Biryani', quantity: 1, options: { spice: 'mild' } }]);
  console.log('2) valid add (spice "Mild" normalised to "mild") -> stored in session state exactly as one line: PASS');
  const before = JSON.stringify(A.state);
  const bad = [
    [{ itemId: 'PIZZA01', quantity: 1 }, 'unknown_item'], [{ itemId: 'Pizza', quantity: 1 }, 'unknown_item'], [{ itemId: '', quantity: 1 }, 'unknown_item'], [{ quantity: 1 }, 'unknown_item'],
    [{ itemId: 'NAN01', quantity: 0 }, 'invalid_quantity'], [{ itemId: 'NAN01', quantity: -1 }, 'invalid_quantity'], [{ itemId: 'NAN01', quantity: 1.5 }, 'invalid_quantity'],
    [{ itemId: 'NAN01', quantity: '2' }, 'invalid_quantity'], [{ itemId: 'NAN01' }, 'invalid_quantity'], [{ itemId: 'NAN01', quantity: null }, 'invalid_quantity'], [{ itemId: 'NAN01', quantity: 101 }, 'invalid_quantity'], [{ itemId: 'NAN01', quantity: NaN }, 'invalid_quantity'],
    [{ itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'extra hot' }] }, 'invalid_option_choice'],
    [{ itemId: 'BRY01', quantity: 1, options: [{ name: 'size', choice: 'large' }] }, 'invalid_option'],
    [{ itemId: 'NAN01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }] }, 'invalid_option'],
    [{ itemId: 'BRY01', quantity: 1, options: 'mild' }, 'invalid_option'],
    [{ itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }, { name: 'spice', choice: 'regular' }] }, 'invalid_option']
  ];
  for (const [args, code] of bad) { const x = add(A.state, args); assert.strictEqual(x.ok, false, JSON.stringify(args)); assert.strictEqual(x.error, code, JSON.stringify(args) + ' -> ' + x.error); assert.strictEqual(typeof x.customerMessage, 'string'); }
  assert.strictEqual(JSON.stringify(A.state), before);
  console.log('3) ' + bad.length + ' invalid calls (invented item, quantity 0/-1/1.5/"2"/missing/null/101/NaN, bad option choice, unknown option, option on option-less item, duplicate conflicting option) -> all rejected with the right error code; state unchanged: PASS');
  r = add(A.state, { itemId: 'chicken biryani', quantity: 1, options: [{ name: 'SPICE', choice: 'mild' }] });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.mergedIntoExistingLine, true); assert.strictEqual(A.state.items.length, 1); assert.strictEqual(A.state.items[0].quantity, 2);
  r = add(A.state, { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'regular' }] }); assert.strictEqual(A.state.items.length, 2); assert.strictEqual(A.state.items[1].lineId, 'L2');
  r = add(A.state, { itemId: 'NAN01', quantity: 3 }); assert.deepStrictEqual(A.state.items[2], { lineId: 'L3', id: 'NAN01', name: 'Naan', quantity: 3, options: {} });
  console.log('4) same item+options merges into one line (qty 2, matched by name, case-insensitive); different spice = separate line; no-option item stored with {}: PASS');
  // unavailable item
  const m = JSON.parse(menuBackup); m.items.find(i => i.id === 'SAL01').available = false; fs.writeFileSync(menuFile, JSON.stringify(m));
  r = add(A.state, { itemId: 'SAL01', quantity: 1 }); fs.writeFileSync(menuFile, menuBackup);
  assert.deepStrictEqual([r.ok, r.error], [false, 'item_unavailable']); assert.strictEqual(A.state.items.length, 3);
  console.log('5) item marked unavailable in menu.json -> item_unavailable, not added: PASS');
  // bad ctx / never throws
  assert.strictEqual(executeTool('addItemToCart', null, { state: A.state }).ok, false); assert.strictEqual(executeTool('addItemToCart', { itemId: 'NAN01', quantity: 1 }, { state: null }).error, 'tool_failed');
  console.log('   null args -> clean error; broken context -> tool_failed (never throws): PASS');
  // ---- HTTP level with scripted model: question first, then add; two sessions stay separate
  const seen = []; global.__STUB = async ({ contents, config }) => { seen.push(contents); const res = L.lastToolResults(contents); const user = contents.filter(c => c.role === 'user' && c.parts[0].text).pop().parts[0].text;
    if (!res) { if (user.includes('biryani')) return L.calls([{ name: 'addItemToCart', args: { itemId: 'BRY01', quantity: 1 } }]);
                if (user.includes('mild')) return L.calls([{ name: 'addItemToCart', args: { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }] } }]);
                if (user.includes('naan')) return L.calls([{ name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 2 } }]); }
    const t = res[0].response; return L.text(t.ok ? `Added ${t.line.quantity} x ${t.line.name}` : t.missingOptions ? 'Please choose ' + t.missingOptions.map(o => `${o.name}: ${o.choices.join(' or ')}`).join('; ') : t.customerMessage); };
  let s1 = await L.post(base, { message: 'one biryani please' }); assert.strictEqual(s1.json.reply, 'Please choose spice: mild or regular');
  let st1 = sessions.getOrCreateSession(s1.json.sessionId).state; assert.deepStrictEqual(st1.items, []);
  console.log('6) HTTP: "one biryani please" -> tool says spice needed -> assistant asks "mild or regular"; cart empty: PASS');
  s1 = await L.post(base, { message: 'mild', sessionId: s1.json.sessionId, conversationHistory: [{ role: 'user', content: 'one biryani please' }, { role: 'assistant', content: 'Please choose spice: mild or regular' }] });
  st1 = sessions.getOrCreateSession(s1.json.sessionId).state; assert.strictEqual(s1.json.reply, 'Added 1 x Chicken Biryani'); assert.deepStrictEqual(st1.items.map(l => [l.id, l.quantity, l.options]), [['BRY01', 1, { spice: 'mild' }]]);
  let s2 = await L.post(base, { message: 'two naan' }); const st2 = sessions.getOrCreateSession(s2.json.sessionId).state;
  assert.notStrictEqual(s2.json.sessionId, s1.json.sessionId); assert.deepStrictEqual(st2.items.map(l => [l.id, l.quantity]), [['NAN01', 2]]); assert.deepStrictEqual(st1.items.map(l => l.id), ['BRY01']);
  console.log('7) HTTP: "mild" -> biryani stored in session 1; session 2 adds naan; each session only sees its own cart: PASS');
  const other = sessions.getOrCreateSession('f'.repeat(32)); assert.deepStrictEqual(other.state.items, []);
  console.log('   a third (unknown) session id gets an empty cart: PASS');
  console.log('ALL STEP-19 TESTS PASSED'); process.exit(0);
})().catch(e => { fs.writeFileSync(menuFile, menuBackup); console.error('TEST FAILED:', e.stack.split('\n').slice(0, 3).join(' | ')); process.exit(1); });

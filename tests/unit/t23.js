const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3063);
const { executeTool } = require(ROOT + '/backend/tools'); const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state });
const menuFile = ROOT + '/data/menu.json'; const menuBackup = fs.readFileSync(menuFile, 'utf8'); const ids = (r) => r.suggestions.map(s => s.id);
(async () => { await sleep(500);
  let st = sessions.getOrCreateSession().state, r;
  r = run(st, 'getRecommendations', {}); assert.deepStrictEqual([r.ok, r.suggestions.length], [true, 0]);
  console.log('1) empty cart -> no suggestions: PASS');
  run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }] }); const cartBefore = JSON.stringify(st.items);
  r = run(st, 'getRecommendations', {});
  assert.deepStrictEqual(ids(r), ['RAI01', 'SAL01']); assert(r.suggestions.length <= 2); assert.strictEqual(JSON.stringify(st.items), cartBefore);
  assert.deepStrictEqual(r.suggestions[0], { id: 'RAI01', name: 'Raita', priceText: '80 PKR', requiredOptions: [], basedOn: 'Chicken Biryani' });
  console.log('2) cart = biryani -> suggests Raita (80 PKR) and Salad, at most 2, real items only; cart unchanged: PASS');
  // decline raita
  r = run(st, 'getRecommendations', { declinedItemIds: ['RAI01'] });
  assert.deepStrictEqual(st.declinedSuggestions, ['RAI01']); assert(!ids(r).includes('RAI01')); assert.deepStrictEqual(ids(r), ['SAL01', 'TEA01']); assert.strictEqual(JSON.stringify(st.items), cartBefore);
  console.log('3) customer declines Raita -> recorded in session; Raita gone from suggestions; cart unchanged: PASS');
  for (let i = 0; i < 5; i++) { r = run(st, 'getRecommendations', {}); assert(!ids(r).includes('RAI01')); }
  r = run(st, 'getRecommendations', { declinedItemIds: ['raita', 'Salad'] }); assert.deepStrictEqual(st.declinedSuggestions, ['RAI01', 'SAL01']); assert(!ids(r).includes('RAI01') && !ids(r).includes('SAL01'));
  console.log('4) Raita never reappears on later calls (also declines by name; no duplicates recorded): PASS');
  r = run(st, 'getRecommendations', { declinedItemIds: ['TEA01', 'KHR01'] }); assert.deepStrictEqual(r.suggestions, []); assert.strictEqual(JSON.stringify(st.items), cartBefore);
  console.log('5) after declining everything relevant -> empty suggestions, nothing invented: PASS');
  // in-cart items never suggested
  const s2 = sessions.getOrCreateSession().state; run(s2, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }] }); run(s2, 'addItemToCart', { itemId: 'RAI01', quantity: 1 });
  assert(!ids(run(s2, 'getRecommendations', {})).includes('RAI01')); assert.strictEqual(run(s2, 'getRecommendations', {}).suggestions.length <= 2, true);
  console.log('6) items already in the cart are not suggested: PASS');
  // unavailable never suggested
  const m = JSON.parse(menuBackup); m.items.find(i => i.id === 'RAI01').available = false; fs.writeFileSync(menuFile, JSON.stringify(m)); const s3 = sessions.getOrCreateSession().state; run(s3, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }] });
  const r3 = run(s3, 'getRecommendations', {}); fs.writeFileSync(menuFile, menuBackup); assert(!ids(r3).includes('RAI01')); assert.deepStrictEqual(ids(r3), ['SAL01', 'TEA01']);
  console.log('7) unavailable items are skipped: PASS');
  // bad input
  const s4 = sessions.getOrCreateSession().state; run(s4, 'addItemToCart', { itemId: 'NAN01', quantity: 1 });
  assert.strictEqual(run(s4, 'getRecommendations', { declinedItemIds: ['PIZZA01'] }).error, 'unknown_item'); assert.strictEqual(run(s4, 'getRecommendations', { declinedItemIds: 'RAI01' }).error, 'invalid_declined'); assert.deepStrictEqual(s4.declinedSuggestions, []);
  console.log('8) invented / malformed declined ids rejected; nothing recorded: PASS');
  // session isolation
  const A = sessions.getOrCreateSession(), B = sessions.getOrCreateSession(); run(A.state, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }] }); run(B.state, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }] });
  run(A.state, 'getRecommendations', { declinedItemIds: ['RAI01'] }); assert(ids(run(B.state, 'getRecommendations', {})).includes('RAI01')); assert.deepStrictEqual(B.state.declinedSuggestions, []);
  console.log('9) a decline in session A does not affect session B: PASS');
  // HTTP conversation with a scripted model
  const log = []; global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); const user = contents.filter(c => c.role === 'user' && c.parts[0].text).pop().parts[0].text;
    if (!res) { if (user === 'one mild biryani') return L.calls([{ name: 'addItemToCart', args: { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }] } }]);
                if (user === 'no thanks') return L.calls([{ name: 'getRecommendations', args: { declinedItemIds: ['RAI01'] } }]);
                return L.calls([{ name: 'getRecommendations' }]); }
    const t = res[0].response; if (t.suggestions) return L.text('SUGGEST:' + t.suggestions.map(x => x.name).join(',')); return L.text(t.ok ? 'added' : t.error); };
  let a = await L.post(base, { message: 'one mild biryani' }); const sid = a.json.sessionId, stH = sessions.getOrCreateSession(sid).state;
  a = await L.post(base, { message: 'anything to go with it?', sessionId: sid }); assert.strictEqual(a.json.reply, 'SUGGEST:Raita,Salad');
  a = await L.post(base, { message: 'no thanks', sessionId: sid }); assert(!a.json.reply.includes('Raita')); assert.deepStrictEqual(stH.declinedSuggestions, ['RAI01']);
  a = await L.post(base, { message: 'what else do you suggest?', sessionId: sid }); assert(!a.json.reply.includes('Raita')); assert.strictEqual(a.json.reply, 'SUGGEST:Salad,Tea');
  assert.deepStrictEqual(stH.items.map(l => [l.id, l.quantity]), [['BRY01', 1]]);
  console.log('10) HTTP conversation: suggest Raita -> "no thanks" -> later suggestions never include Raita; cart is still only the biryani: PASS');
  console.log('ALL STEP-23 TESTS PASSED'); process.exit(0);
})().catch(e => { fs.writeFileSync(menuFile, menuBackup); console.error('TEST FAILED:', e.stack.split('\n').slice(0, 3).join(' | ')); process.exit(1); });

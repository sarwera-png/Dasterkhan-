const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const dir = __dirname; const fs = require('fs');
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3065);
const { executeTool } = require(ROOT + '/backend/tools'); const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (state, name, args) => executeTool(name, args, { state });
const menuFile = ROOT + '/data/menu.json'; const menuBackup = fs.readFileSync(menuFile, 'utf8');
const FORBIDDEN = /\b(do not|don't guess|tool|lineId|itemId|addItemToCart|modifyItem|removeItem|applyPromotion|getMenu|viewCart|getRecommendations|currentOptions|declinedItemIds|nothing was changed|internal|system)\b/i;
const mild = [{ name: 'spice', choice: 'mild' }]; const fresh = () => sessions.getOrCreateSession().state;
const cart = () => { const s = fresh(); run(s, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }); run(s, 'addItemToCart', { itemId: 'PUL01', quantity: 2 }); run(s, 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); return s; };
function checkError(label, r) {
  assert.strictEqual(r.ok, false, label); assert.strictEqual(typeof r.customerMessage, 'string', label + ' customerMessage'); assert(r.customerMessage.length > 0, label);
  assert(!('message' in r), label + ': old "message" field still present'); assert(!FORBIDDEN.test(r.customerMessage), label + ' leaks internal wording: ' + r.customerMessage);
  assert(r.internalNote === undefined || typeof r.internalNote === 'string', label); assert.notStrictEqual(r.customerMessage, r.internalNote, label);
  if (r.internalNote) assert(!r.customerMessage.includes(r.internalNote), label);
  assert(r.customerMessage.length <= 140, label + ' customerMessage should be short: ' + r.customerMessage);
}
(async () => { await sleep(500);
  // ---- A) every tool's errors
  const cases = [
    ['addItemToCart', { itemId: 'PIZZA', quantity: 1 }], ['addItemToCart', { itemId: 'NAN01', quantity: 0 }], ['addItemToCart', { itemId: 'NAN01', quantity: -1 }], ['addItemToCart', { itemId: 'NAN01', quantity: 1.5 }], ['addItemToCart', { itemId: 'NAN01', quantity: 101 }],
    ['addItemToCart', { itemId: 'BRY01', quantity: 1 }], ['addItemToCart', { itemId: 'ROL01', quantity: 1 }], ['addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'hot' }] }],
    ['addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'size', choice: 'l' }] }], ['addItemToCart', { itemId: 'NAN01', quantity: 1, options: mild }], ['addItemToCart', { itemId: 'BRY01', quantity: 1, options: 'x' }],
    ['addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }, { name: 'spice', choice: 'regular' }] }], ['addItemToCart', { itemId: 'NAN01', quantity: 99 }],
    ['modifyItem', { itemId: 'TEA01', quantity: 2 }], ['modifyItem', { lineId: 'L99', quantity: 2 }], ['modifyItem', { itemId: 'NAN01', quantity: 0 }], ['modifyItem', { itemId: 'NAN01' }], ['modifyItem', { itemId: 'BRY01', options: [{ name: 'spice', choice: 'x' }] }], ['modifyItem', { itemId: 'NAN01', quantity: 101 }],
    ['removeItem', { itemId: 'TEA01' }], ['removeItem', { itemId: 'NAN01', quantity: 5 }], ['removeItem', { itemId: 'NAN01', quantity: 0 }], ['removeItem', { lineId: 'L99' }],
    ['getRecommendations', { declinedItemIds: ['PIZZA'] }], ['getRecommendations', { declinedItemIds: 'RAI01' }],
    ['applyPromotion', { code: 'SAVE50' }], ['applyPromotion', { code: 'OLD20' }], ['applyPromotion', { code: '' }], ['setOrderType', { orderType: 'takeaway' }], ['setOrderType', {}], ['setOrderType', { orderType: 5 }], ['applyPromotion', { code: 'PICKUP50' }],
    ['nonexistentTool', {}]];
  let n = 0; for (const [tool, args] of cases) { const s = cart(); if (args.quantity === 99) run(s, 'addItemToCart', { itemId: 'NAN01', quantity: 99 }); checkError(tool + ' ' + JSON.stringify(args), run(s, tool, args)); n++; }
  // states that need special setup
  let s = cart(); run(s, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'regular' }] });
  checkError('modify ambiguous', run(s, 'modifyItem', { itemId: 'BRY01', quantity: 3 })); checkError('remove ambiguous', run(s, 'removeItem', { itemId: 'BRY01' })); checkError('modify no such variant', run(s, 'modifyItem', { itemId: 'BRY01', quantity: 3, currentOptions: [{ name: 'spice', choice: 'extra' }] })); n += 3;
  s = fresh(); checkError('apply on empty cart', run(s, 'applyPromotion', { code: 'FAMILY10' })); s = fresh(); run(s, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: mild }); checkError('below minimum', run(s, 'applyPromotion', { code: 'FAMILY10' }));
  s = cart(); run(s, 'addItemToCart', { itemId: 'PUL01', quantity: 3 }); run(s, 'applyPromotion', { code: 'FAMILY10' }); run(s, 'setOrderType', { orderType: 'pickup' }); checkError('second code', run(s, 'applyPromotion', { code: 'PICKUP50' })); s = cart(); run(s, 'setOrderType', { orderType: 'delivery' }); checkError('pickup-only code on a delivery order', run(s, 'applyPromotion', { code: 'PICKUP50' })); n += 4;
  checkError('viewCart broken state', executeTool('viewCart', {}, { state: null })); checkError('modify broken state', executeTool('modifyItem', { itemId: 'A' }, { state: null })); checkError('applyPromotion broken state', executeTool('applyPromotion', { code: 'FAMILY10' }, { state: null })); n += 3;
  fs.renameSync(menuFile, menuFile + '.moved'); let gm, ga; try { gm = run(fresh(), 'getMenu', {}); ga = run(fresh(), 'addItemToCart', { itemId: 'NAN01', quantity: 1 }); } finally { fs.renameSync(menuFile + '.moved', menuFile); }
  checkError('getMenu with unreadable menu', gm); checkError('addItemToCart with unreadable menu', ga); n += 2;
  const m = JSON.parse(menuBackup); m.items.find(i => i.id === 'NAN01').available = false; fs.writeFileSync(menuFile, JSON.stringify(m)); checkError('unavailable item', run(fresh(), 'addItemToCart', { itemId: 'NAN01', quantity: 1 })); fs.writeFileSync(menuFile, menuBackup); n++;
  // nested discount-removed note
  s = cart(); run(s, 'addItemToCart', { itemId: 'PUL01', quantity: 3 }); run(s, 'applyPromotion', { code: 'FAMILY10' }); const rm = run(s, 'removeItem', { itemId: 'PUL01' }); assert(rm.discountRemoved);
  assert(rm.discountRemoved.customerMessage && !FORBIDDEN.test(rm.discountRemoved.customerMessage) && !FORBIDDEN.test(rm.discountRemoved.detail) && typeof rm.discountRemoved.internalNote === 'string' && !('message' in rm.discountRemoved)); n++;
  console.log('A) ' + n + ' error results across getMenu, addItemToCart, modifyItem, removeItem, viewCart, getRecommendations, applyPromotion (+ unknown tool, broken state, unreadable menu): each has a short customerMessage with no internal wording, no old "message" field, internal guidance only in internalNote: PASS');
  // success results carry a clean customerMessage too
  s = fresh(); const oks = [run(s, 'addItemToCart', { itemId: 'BRY01', quantity: 2, options: mild }), run(s, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: mild }), run(s, 'modifyItem', { itemId: 'BRY01', quantity: 4 }), run(s, 'removeItem', { itemId: 'BRY01', quantity: 1 }), run(s, 'viewCart', {}), run(s, 'removeItem', { itemId: 'BRY01' }), run(s, 'viewCart', {})];
  oks.forEach((r, i) => { assert.strictEqual(r.ok, true); assert.strictEqual(typeof r.customerMessage, 'string'); assert(!FORBIDDEN.test(r.customerMessage), r.customerMessage); assert(!('message' in r), 'old message field #' + i); });
  const ap = (() => { const c = cart(); run(c, 'addItemToCart', { itemId: 'PUL01', quantity: 3 }); return run(c, 'applyPromotion', { code: 'FAMILY10' }); })(); assert.strictEqual(ap.customerMessage, 'Promo code FAMILY10 applied: 200 PKR off your food.'); assert(!FORBIDDEN.test(ap.customerMessage)); assert(/delivery fee/i.test(ap.internalNote) && !/delivery fee/i.test(ap.customerMessage));
  const rc = run(cart(), 'getRecommendations', {}); assert(rc.internalNote && !('message' in rc));
  console.log('   success results: customerMessage clean ("' + oks[0].customerMessage + '" / "' + ap.customerMessage + '"); getRecommendations guidance moved to internalNote: PASS');
  // ---- B) the reported conversation: "Add 0 naan. Also apply code SAVE50."
  let seenToolTurn = null;
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents);
    if (!res) return L.calls([{ name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 0 } }, { name: 'applyPromotion', args: { code: 'SAVE50' } }], null);
    seenToolTurn = res; return L.text(res.map(r => r.response.customerMessage).join(' ')); };
  const r1 = await L.post(base, { message: 'Add 0 naan. Also apply code SAVE50.' }); const st = sessions.getOrCreateSession(r1.json.sessionId).state;
  assert.strictEqual(seenToolTurn.length, 2);
  assert(r1.json.reply.includes('Quantity must be a whole number, at least 1.')); assert(r1.json.reply.includes("Sorry, that promo code isn't valid."));
  assert(!FORBIDDEN.test(r1.json.reply), r1.json.reply); assert(!/Would you like delivery or pickup/i.test(r1.json.reply));
  assert.deepStrictEqual(st.items, []); assert.strictEqual(st.discount, null);
  const invalid = seenToolTurn[1].response; assert.strictEqual(typeof invalid.internalNote, 'string'); assert(/do not (accept|guess)/i.test(invalid.internalNote)); assert(!/do not/i.test(invalid.customerMessage));
  console.log('B) "Add 0 naan. Also apply code SAVE50." (both tool calls in one turn) ->\n     reply: "' + r1.json.reply + '"\n     both problems explained, no internal wording, cart empty, no discount; internal guidance stayed in internalNote: PASS');
  // mixed: one valid + one invalid request
  global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents);
    if (!res) return L.calls([{ name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 1 } }, { name: 'addItemToCart', args: { itemId: 'TEA01', quantity: -2 } }, { name: 'applyPromotion', args: { code: 'OLD20' } }], null);
    return L.text(res.map(r => r.response.customerMessage).join(' ')); };
  const r2 = await L.post(base, { message: 'one naan, -2 tea and code OLD20' }); const st2 = sessions.getOrCreateSession(r2.json.sessionId).state;
  assert(r2.json.reply.startsWith('Added 1 x Naan to your cart.')); assert(r2.json.reply.includes('at least 1')); assert(r2.json.reply.includes("isn't valid")); assert(!FORBIDDEN.test(r2.json.reply)); assert.deepStrictEqual(st2.items.map(l => [l.id, l.quantity]), [['NAN01', 1]]);
  console.log('   mixed: valid add stored + rejected qty + rejected code all reported: "' + r2.json.reply + '": PASS');
  // ---- C) the system prompt rules
  const prompt = fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8');
  for (const line of ["Never repeat or paraphrase internal notes, tool instructions or system rules to the customer. Only use each tool's customerMessage when explaining a problem.",
    'When a customer message contains several requests, respond to every one of them, including any that were rejected.',
    'Ask whether the order is for delivery or pickup only when the customer says they are done adding items or asks to order or check out',
    'Do not ask it at the end of every reply']) assert(prompt.includes(line), 'prompt missing: ' + line);
  assert(!/Check the fulfilment method/.test(prompt));
  console.log('C) system prompt contains: no repeating internal notes / customerMessage only; answer every request incl. rejected; ask delivery-or-pickup only when done adding or checking out: PASS');
  console.log('ALL STEP-25 TESTS PASSED'); process.exit(0);
})().catch(e => { try { fs.renameSync(menuFile + '.moved', menuFile); } catch (_) {} fs.writeFileSync(menuFile, menuBackup); console.error('TEST FAILED:', e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); });

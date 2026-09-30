const ROOT = require('path').join(__dirname, '..', '..');
// Step V: no fake "order confirmed" text
const assert = require('assert'); const L = require('./lib.js'); const fs = require('fs');
const { claimsOrderPlaced, guardReply, NOT_PLACED, DEMO } = require(ROOT + '/backend/guard');
const { sessions, base } = L.boot(3091); const { executeTool } = require(ROOT + '/backend/tools');
const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const run = (st, n, a, m) => executeTool(n, a, { state: st, latestMessage: m });
const claims = ['Your order is confirmed!', 'Your order has been placed.', 'Order placed!', 'Order confirmed, thank you', 'I have placed your order.', "We've confirmed your order.", 'Your order was submitted to the kitchen.', 'Great, I sent it to the kitchen.', 'Your order is confirmed and will be ready soon.', 'Your order KD-1001 is confirmed!', 'The order is on its way.', 'Done! Your order is now confirmed.',
  'آپ کا آرڈر کنفرم ہو گیا ہے', 'آپ کا آرڈر کنفرم ہو گیا', 'آرڈر ہو گیا', 'آپ کا آرڈر ہوگیا ہے۔', 'آپ کا آرڈر موصول ہو گیا', 'آپ کا آرڈر بھیج دیا گیا ہے', 'آپ کا آرڈر کنفرم ہے', 'آپ کا آرڈر پلیس ہو گیا ہے', 'آپ کے آرڈر کی تصدیق ہو گئی',
  'order ho gaya', 'Aap ka order confirm ho gaya hai', 'order confirm ho gaya', 'Aapka order place ho gaya', 'Aapka order bhej diya gaya hai', 'Order mil gaya, shukriya', 'aap ka order confirm hai'];
for (const c of claims) assert.strictEqual(claimsOrderPlaced(c), true, c);
const fine = ['Here is the menu.', 'Your order is for pickup.', 'Got it: this order is for pickup.', 'Thank you, your delivery address is confirmed.', 'Please press the "Confirm order" button below the chat.', 'Your order has not been placed yet.', 'This is a demo, so orders cannot be placed right now.', "It isn't confirmed until you press the button.",
  'The order will be placed only when you press the "Confirm order" button.', 'If you want, I can place your order after the review.', NOT_PLACED.en, NOT_PLACED.ur, NOT_PLACED.roman, DEMO.en, DEMO.ur, DEMO.roman,
  'آرڈر صرف بٹن دبانے پر دیا جائے گا', 'آپ کا آرڈر ابھی تک نہیں دیا گیا', 'آرڈر کنفرم کرنے کے لیے بٹن دبائیں', 'آپ کا پتہ کنفرم ہو گیا ہے', 'Aap ka order abhi place nahi hua', 'Order sirf button dabane par place hoga', 'Aap ka address confirm ho gaya hai', 'Order review check karein', '', 'Order review\nItems:\n1 x Naan - 40 PKR\nTotal: 40 PKR\nPayment: cash on pickup\nPlease check everything above. If it is all correct, press the "Confirm order" button below the chat. If you want to change something, tell me.'];
for (const f of fine) assert.strictEqual(claimsOrderPlaced(f), false, f);
console.log(`1) claim detector: ${claims.length} English / Urdu-script / Roman-Urdu claims are caught; ${fine.length} legitimate texts (menu, review, "not placed yet", "cannot be placed", "press the button", address confirmed, the guard's own messages) are NOT flagged: PASS`);
const MILD = [{ name: 'spice', choice: 'mild' }]; const ready = async () => { const a = await L.post(base, { message: 'hi' }); const st = sessions.getOrCreateSession(a.json.sessionId).state; run(st, 'addItemToCart', { itemId: 'BRY01', quantity: 1, options: MILD }); run(st, 'setOrderType', { orderType: 'pickup' }); run(st, 'setCustomerDetails', { name: 'Ali' }); return { sid: a.json.sessionId, st }; };
let saySomething = 'Welcome!'; let reviewFirst = false; const logs = []; const origLog = console.log; 
global.__STUB = async ({ contents }) => { const res = L.lastToolResults(contents); if (res) return L.text(res[0].response.customerMessage); return reviewFirst ? L.calls([{ name: 'getOrderReview' }], null) : L.text(saySomething); };
const confirm = async (b) => { const r = await fetch(base + '/api/order/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; };
const ordersCount = () => JSON.parse(fs.readFileSync(global.__ORDERS_FILE, 'utf8')).length;
(async () => { await sleep(500);
  const captured = []; const oe = console.log; console.log = (...a) => { captured.push(a.join(' ')); oe(...a); };
  process.env.ORDERS_ENABLED = 'true';
  // 2) ON, nothing saved: replaced in the customer's language
  const a = await ready(); const n = ordersCount();
  for (const [msg, say, want] of [['is my order done?', 'Your order is confirmed!', NOT_PLACED.en], ['mera order ho gaya?', 'Aapka order confirm ho gaya hai', NOT_PLACED.roman], ['کیا میرا آرڈر ہو گیا؟', 'آپ کا آرڈر کنفرم ہو گیا ہے', NOT_PLACED.ur], ['hello', 'آپ کا آرڈر ہو گیا', NOT_PLACED.ur], ['hello', 'order ho gaya', NOT_PLACED.roman], ['hello', 'Order placed!', NOT_PLACED.en]]) {
    saySomething = say; const r = await L.post(base, { message: msg, sessionId: a.sid }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.reply, want, msg + ' / ' + say); assert(!/confirmed!|ho gaya|کنفرم ہو/.test(r.json.reply) || r.json.reply === want);
  }
  assert.strictEqual(ordersCount(), n); assert.strictEqual(a.st.status, 'draft');
  const guardLines = captured.filter(l => l === 'Guard: fake-confirmation blocked'); assert.strictEqual(guardLines.length, 6, 'one log line per blocked reply: ' + guardLines.length);
  assert(!captured.some(l => /Aapka order|Your order is confirmed|Ali/.test(l) && l.startsWith('Guard')), 'no message text or name in the guard log');
  console.log('2) ORDERS_ENABLED on, nothing saved: "Your order is confirmed!", "Aapka order confirm ho gaya hai", "آپ کا آرڈر کنفرم ہو گیا ہے" etc. are replaced by the safe "not placed yet, press Confirm order" text in English / Roman Urdu / Urdu script; one log line "Guard: fake-confirmation blocked" each (no text, no name); state draft, nothing saved: PASS');
  // 3) an honest reply passes
  saySomething = 'Would you like anything else?'; let r = await L.post(base, { message: 'hi', sessionId: a.sid }); assert.strictEqual(r.json.reply, 'Would you like anything else?');
  // 4) OFF: demo message
  process.env.ORDERS_ENABLED = 'false'; for (const [msg, say, want] of [['done?', 'Your order is confirmed!', DEMO.en], ['ho gaya?', 'order ho gaya', DEMO.roman], ['آرڈر؟', 'آپ کا آرڈر ہو گیا ہے', DEMO.ur]]) { saySomething = say; r = await L.post(base, { message: msg, sessionId: a.sid }); assert.strictEqual(r.json.reply, want); assert.strictEqual(r.json.reviewVersion, null); }
  assert.strictEqual(DEMO.en, 'This is a demo, so orders cannot be placed right now.'); assert.strictEqual(ordersCount(), n);
  console.log('4) ORDERS_ENABLED off: the same claims are replaced by "This is a demo, so orders cannot be placed right now." (Urdu and Roman Urdu versions too), no reviewVersion: PASS');
  // 5) real save: receipt from the server, and the model may then speak about the saved order
  process.env.ORDERS_ENABLED = 'true'; const b = await ready(); reviewFirst = true; r = await L.post(base, { message: 'review please', sessionId: b.sid }); reviewFirst = false; const v = r.json.reviewVersion; assert.match(v, /^[0-9a-f]{16}$/); assert(r.json.reply.startsWith('Order review'));
  saySomething = 'Your order is confirmed!'; r = await L.post(base, { message: 'ok', sessionId: b.sid }); assert.strictEqual(r.json.reply, NOT_PLACED.en, 'a review alone is not a saved order');
  const ok = await confirm({ sessionId: b.sid, reviewVersion: v }); assert.strictEqual(ok.status, 200); assert.match(ok.json.orderId, /^KD-\d+$/); assert(ok.json.customerMessage.includes(ok.json.orderId) && /confirmed/.test(ok.json.customerMessage), 'receipt is rendered by the server from the saved order');
  saySomething = `Your order ${ok.json.orderId} is confirmed!`; r = await L.post(base, { message: 'thanks', sessionId: b.sid }); assert.strictEqual(r.json.reply, `Your order ${ok.json.orderId} is confirmed!`, 'after a real saved order the claim is allowed');
  const other = await ready(); saySomething = `Your order ${ok.json.orderId} is confirmed!`; r = await L.post(base, { message: 'thanks', sessionId: other.sid }); assert.strictEqual(r.json.reply, NOT_PLACED.en, "another session cannot borrow someone else's saved order");
  console.log('5) a review alone does not allow the claim; after the button saved KD-id the server receipt shows and the assistant may mention it; a different session with no saved order is still blocked: PASS');
  console.log = oe; console.log('ALL STEP-V TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 8).join('\n')); process.exit(1); });

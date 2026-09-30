// Full customer journey in a REAL browser (Playwright/Chromium) at 1280 px and 360 px. Stub model only, no AI calls.
// Needs Playwright to be installed (not a project dependency): NODE_PATH=$(npm root -g) npm run journey
// Uses a TEMPORARY orders file; ORDERS_ENABLED and the staff password are set only inside this process.
process.env.NODE_ENV = 'test';
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const Module = require('module');
const ROOT = path.join(__dirname, '..', '..');
const { chromium } = require('playwright');

const real = require('@google/genai'); const { GenerateContentResponse } = real;
const origLoad = Module._load;
Module._load = function (req, ...rest) { const m = origLoad.call(this, req, ...rest); return req === '@google/genai' ? { ...m, GoogleGenAI: class { constructor() { this.models = { generateContent: (a) => global.__STUB(a) }; } } } : m; };
const text = (t) => { const r = new GenerateContentResponse(); r.candidates = [{ content: { role: 'model', parts: [{ text: t }] } }]; return r; };
const calls = (list) => { const r = new GenerateContentResponse(); r.candidates = [{ content: { role: 'model', parts: list.map((c, i) => ({ functionCall: { name: c.name, args: c.args || {} }, ...(i === 0 ? { thoughtSignature: 'SIG' } : {}) })) } }]; return r; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-journey-')); const ordersFile = path.join(tmp, 'orders.json'); fs.writeFileSync(ordersFile, '[]');
const PORT = 3700 + Math.floor(Math.random() * 200); const STAFF_PW = 'journey-only-staff-password-123';
Object.assign(process.env, { GEMINI_API_KEY: 'stub-not-a-real-key', ORDERS_ENABLED: 'true', PORT: String(PORT), STAFF_PASSWORD: STAFF_PW });
delete process.env.GEMINI_MODEL; delete process.env.GEMINI_FALLBACK_MODELS;
require(path.join(ROOT, 'backend', 'orders')).setOrdersPathForTests(ordersFile);
require(path.join(ROOT, 'backend', 'server'));
const base = 'http://localhost:' + PORT;
const orders = () => JSON.parse(fs.readFileSync(ordersFile, 'utf8'));

// Scripted "assistant": the customer's message decides which tools it calls; the reply text is always the tool's own customerMessage.
const MILD = [{ name: 'spice', choice: 'mild' }];
const SCRIPT = {
  'biryani and raita': [{ name: 'addItemToCart', args: { itemId: 'BRY01', quantity: 1, options: MILD } }, { name: 'addItemToCart', args: { itemId: 'RAI01', quantity: 1 } }],
  'roll and naan': [{ name: 'addItemToCart', args: { itemId: 'ROL01', quantity: 1, options: [{ name: 'chutney', choice: 'without' }] } }, { name: 'addItemToCart', args: { itemId: 'NAN01', quantity: 1 } }],
  'pickup': [{ name: 'setOrderType', args: { orderType: 'pickup' } }],
  'delivery': [{ name: 'setOrderType', args: { orderType: 'delivery' } }],
  'name is Hamza Ali': [{ name: 'setCustomerDetails', args: { name: 'Hamza Ali', noPickupTimePreference: true } }],
  'Sara Khan': [{ name: 'setCustomerDetails', args: { name: 'Sara Khan', phone: '03001234567', block: '3', houseOrFlat: '12', street: 'Main Rashid Minhas Road', noExtraAddressDetails: true } }, { name: 'readBackAddress' }],
  'yes that is correct': [{ name: 'confirmAddress' }],
  'review please': [{ name: 'getOrderReview' }],
  'switch to pickup': [{ name: 'setOrderType', args: { orderType: 'pickup' } }, { name: 'getOrderReview' }]
};
global.__STUB = async ({ contents }) => {
  const last = contents[contents.length - 1]; const res = last.parts.filter((p) => p.functionResponse).map((p) => p.functionResponse.response);
  if (res.length) return text(res.map((r) => r.customerMessage).filter(Boolean).pop() || 'ok');
  const said = last.parts.map((p) => p.text || '').join(' ');
  const key = Object.keys(SCRIPT).filter((k) => said.includes(k)).sort((a, b) => b.length - a.length)[0]; // longest phrase wins
  return key ? calls(SCRIPT[key]) : text('How can I help?');
};

let bad = 0; const fail = (name, e) => { bad++; console.log('FAIL  ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 5).join('\n      ')); };
const botTexts = (p) => p.evaluate(() => [...document.querySelectorAll('.chat-msg-bot')].map((b) => b.textContent));
async function open(browser, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, httpCredentials: { username: 'staff', password: STAFF_PW } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(base + '/'); await p.click('#chat-toggle'); await p.waitForTimeout(350); p.errs = errs; return { ctx, p };
}
async function say(p, t) { await p.fill('#chat-input', t); await p.press('#chat-input', 'Enter'); await p.waitForFunction(() => !document.getElementById('chat-input').disabled, null, { timeout: 30000 }); const all = await botTexts(p); return all[all.length - 1]; }
const btnVisible = (p) => p.evaluate(() => { const b = document.getElementById('chat-confirm'); const r = document.getElementById('chat-confirm-btn').getBoundingClientRect(); return !b.hidden && r.width > 0 && r.left >= 0 && r.right <= innerWidth; });
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
// the review bubble must contain each of these as a whole line
const reviewLinesFromRecord = (o) => { const r = o.review; const L = r.items.map((i) => `${i.quantity} x ${i.name}` + (Object.keys(i.options || {}).length ? ` (${Object.entries(i.options).map(([k, c]) => `${k}: ${c}`).join(', ')})` : '') + ` - ${i.lineTotal} PKR`);
  L.push(`Order type: ${r.orderType === 'delivery' ? 'Delivery' : 'Pickup'}`, `Name: ${r.customer.name}`); if (r.orderType === 'delivery') L.push(`Phone: ${r.customer.phone}`);
  L.push(`Total: ${r.totals.total} PKR`); if (r.totals.deliveryFee) L.push(`Delivery fee: ${r.totals.deliveryFee} PKR`); return L; };
const lineSet = (t) => new Set(t.split('\n').map((s) => s.trim()));

async function pickupJourney(browser, w) {
  const { ctx, p } = await open(browser, w); const before = orders().length;
  await say(p, 'I want a biryani and raita'); await say(p, 'pickup'); await say(p, 'My name is Hamza Ali');
  assert.strictEqual(await p.evaluate(() => document.getElementById('chat-confirm').hidden), true, 'no button before the review');
  const review = await say(p, 'that is all, review please'); assert(review.startsWith('Order review'), review);
  assert(review.includes('1 x Chicken Biryani (spice: mild) - 350 PKR') && review.includes('1 x Raita - 80 PKR') && review.includes('Total: 430 PKR') && !/Delivery fee|Phone|address/i.test(review));
  assert.strictEqual(await btnVisible(p), true, 'Confirm button visible and inside the screen at ' + w); assert.strictEqual(await noOverflow(p), true);
  assert.strictEqual(orders().length, before, 'nothing saved before pressing the button');
  for (const t of ['yes', 'ok theek hai']) { await say(p, t); assert.strictEqual(orders().length, before, 'typing "' + t + '" must not confirm'); }
  assert.strictEqual(orders().length, before);
  // typed messages got an ordinary reply without a review -> button hidden; ask for the review again to get it back
  const again = await say(p, 'review please'); assert.strictEqual(await btnVisible(p), true);
  await p.click('#chat-confirm-btn'); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden);
  const receipt = (await botTexts(p)).pop(); const id = (/KD-\d+/.exec(receipt) || [])[0]; assert(id, 'receipt has an order number: ' + receipt);
  assert(receipt.includes('Payment: cash on pickup'), receipt);
  const all = orders(); assert.strictEqual(all.length, before + 1); const o = all[all.length - 1]; assert.strictEqual(o.id, id); assert.strictEqual(o.status, 'NEW');
  const have = lineSet(again); for (const l of reviewLinesFromRecord(o)) assert(have.has(l), 'review line missing from saved record: ' + l);
  assert.strictEqual(o.review.totals.total, 430);
  // staff
  const sp = await ctx.newPage(); const errs = []; sp.on('pageerror', (e) => errs.push(e.message)); await sp.goto(base + '/staff'); await sp.waitForSelector(`[data-id="${id}"]`);
  const card = sp.locator(`[data-id="${id}"]`); const ct = await card.textContent(); assert(ct.includes('NEW') && ct.includes('1 x Chicken Biryani (spice: mild)') && ct.includes('1 x Raita') && ct.includes('Hamza Ali') && ct.includes('Total: 430 PKR'), ct);
  assert.strictEqual(await noOverflow(sp), true, 'staff page overflows at ' + w);
  for (const [to, prev] of [['PREPARING', 'NEW'], ['READY', 'PREPARING'], ['COMPLETED', 'READY']]) {
    await card.locator('button', { hasText: 'Mark ' + to }).click(); await sp.waitForFunction(([i, s]) => { const c = document.querySelector(`[data-id="${i}"]`); return c && c.querySelector('.status').textContent === s; }, [id, to]);
    assert.strictEqual(orders().find((x) => x.id === id).status, to);
  }
  assert.strictEqual(await card.locator('button').count(), 0, 'no button after COMPLETED'); assert.deepStrictEqual(errs.concat(p.errs), []); await ctx.close(); return id;
}

async function deliveryJourney(browser, w) {
  const { ctx, p } = await open(browser, w); const before = orders().length;
  await say(p, 'one roll and naan'); await say(p, 'delivery');
  const readBack = await say(p, 'Sara Khan 03001234567 block 3 house 12');
  assert(/Sara Khan/.test(readBack) && /03001234567/.test(readBack) && /12/.test(readBack) && /Main Rashid Minhas Road/.test(readBack) && /Block 3/i.test(readBack), readBack);
  assert.strictEqual(await p.evaluate(() => document.getElementById('chat-confirm').hidden), true, 'no button before the address is confirmed and reviewed');
  assert.strictEqual(orders().length, before);
  const conf = await say(p, 'yes that is correct'); assert(/confirmed/i.test(conf) && !/KD-\d+/.test(conf), conf); assert.strictEqual(orders().length, before, 'confirming the address does not place an order');
  const review = await say(p, 'review please'); assert(review.startsWith('Order review'), review);
  assert(review.includes('1 x Chicken Roll (chutney: without) - 220 PKR') && review.includes('1 x Naan - 40 PKR') && review.includes('Delivery fee: 150 PKR') && review.includes('Total: 410 PKR'), review); // 220+40+150
  assert.strictEqual(await btnVisible(p), true); assert.strictEqual(await noOverflow(p), true);
  await p.click('#chat-confirm-btn'); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden);
  const receipt = (await botTexts(p)).pop(); const id = (/KD-\d+/.exec(receipt) || [])[0]; assert(id, receipt); assert(receipt.includes('cash on delivery') || /cash/i.test(receipt), receipt);
  const o = orders()[orders().length - 1]; assert.strictEqual(o.id, id); assert.strictEqual(orders().length, before + 1);
  const have = lineSet(review); for (const l of reviewLinesFromRecord(o)) assert(have.has(l), 'review line missing from saved record: ' + l);
  const a = o.review.delivery.address; assert.deepStrictEqual([a.block, a.house, a.street, o.review.customer.phone, o.review.totals.deliveryFee, o.review.totals.total], [3, '12', 'Main Rashid Minhas Road', '03001234567', 150, 410]);
  assert(review.includes(`House or flat ${a.house}`) || review.includes(a.house)); assert.deepStrictEqual(p.errs, []); await ctx.close(); return id;
}

async function switchJourney(browser, w) {
  const { ctx, p } = await open(browser, w); const before = orders().length;
  await say(p, 'one roll and naan'); await say(p, 'delivery'); await say(p, 'Sara Khan 03001234567 block 3 house 12'); await say(p, 'yes that is correct');
  const d = await say(p, 'review please'); assert(d.includes('Delivery fee: 150 PKR') && d.includes('Total: 410 PKR') && d.includes('Delivery address'), d);
  const pickup = await say(p, 'please switch to pickup');
  assert(pickup.startsWith('Order review'), pickup); assert(!/Delivery fee|Delivery address|Phone/i.test(pickup), 'fee and address must be gone: ' + pickup);
  assert(pickup.includes('Order type: Pickup') && pickup.includes('Total: 260 PKR'), pickup); // 220+40, no fee
  assert.strictEqual(await btnVisible(p), true); assert.strictEqual(orders().length, before);
  await p.click('#chat-confirm-btn'); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden);
  const o = orders()[orders().length - 1]; assert.strictEqual(orders().length, before + 1); assert.deepStrictEqual([o.review.orderType, o.review.totals.deliveryFee, o.review.totals.total, o.review.delivery], ['pickup', 0, 260, null]);
  assert.deepStrictEqual(p.errs, []); await ctx.close();
}

(async () => {
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  for (const w of [1280, 360]) {
    for (const [name, fn] of [['pickup journey -> receipt -> staff NEW>PREPARING>READY>COMPLETED', pickupJourney], ['delivery journey (Block 3) -> address read-back -> review with 150 fee -> receipt', deliveryJourney], ['delivery -> pickup switch removes the fee and the address', switchJourney]]) {
      try { await fn(browser, w); console.log(`PASS  [${w}px] ${name}`); } catch (e) { fail(`[${w}px] ${name}`, e); }
    }
  }
  await browser.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bad ? `JOURNEY FAILED: ${bad} failed` : 'ALL JOURNEY TESTS PASSED'); process.exit(bad ? 1 : 0);
})();

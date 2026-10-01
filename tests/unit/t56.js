const ROOT = require('path').join(__dirname, '..', '..');
// Step AP: Urdu replies are cleaned (no diacritics, no Unicode hyphens) before the guard; English, numbers and IDs untouched
const assert = require('assert'); const fs = require('fs'); const L = require('./lib.js'); const { sessions, base } = L.boot(3102);
const { cleanUrdu, claimsOrderPlaced } = require(ROOT + '/backend/guard');
const BAD = /[‐‑ً-ٰٟ]/;
const input = 'معذرت، ڈلیوری صرف گُلشن‑اِیقبال کے بلاک 1–5 تک';
const out = cleanUrdu(input); assert(!BAD.test(out), out); assert.strictEqual(out, 'معذرت، ڈلیوری صرف گلشن ایقبال کے بلاک 1–5 تک'); assert(out.includes('1–5'), 'the number range is untouched');
for (const t of ['Delivery is only for Blocks 1 to 5. Total: 370 PKR, order KD-1001 (pick‑up)', 'Total: 1,250 PKR - thank you', 'Order KD-1001 is not placed yet.', '', 'pick‐up', 'Aap ka order abhi place nahi hua. Rs-350 pick‑up']) assert.strictEqual(cleanUrdu(t), t, 'no Urdu script, no change: ' + t);
assert.strictEqual(cleanUrdu('آپ کا آرڈر KD-1001 ہے، کل 370 PKR'), 'آپ کا آرڈر KD-1001 ہے، کل 370 PKR'); // normal hyphen in the ID, price, English words stay
assert.strictEqual(cleanUrdu('پک‑اپ اور ڈیلیوری'), 'پک اپ اور ڈیلیوری'); assert.strictEqual(cleanUrdu('پک‐اپ'), 'پک اپ');
assert.strictEqual(cleanUrdu('ٹھیک ہے ً ٌ ٍ َ ُ ِ ّ ْ ٰ'.replace(/ /g, '')), 'ٹھیک ہے'.replace(/ /g, ''), 'all marks U+064B-U+065F and U+0670 removed');
assert.strictEqual(cleanUrdu('آرڈر KD‑1001'), 'آرڈر KD‑1001'.replace('‑', '‑'), 'a hyphen between two Latin characters is left alone even inside an Urdu sentence');
console.log('1) cleanUrdu: "گُلشن‑اِیقبال" -> "گلشن ایقبال", U+2010/U+2011 touching Urdu become a space, all diacritics U+064B-U+065F and U+0670 go; "1–5", prices, KD-1001, English and Roman Urdu replies are unchanged: PASS');
const prompt = fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8'); for (const p of ['## Urdu spelling', 'plain, everyday Pakistani Urdu', '"گلشن اقبال"', '"ڈیلیوری"', '"پک اپ"', '"آرڈر"', '"بلاک"', 'Do NOT use diacritics', 'zer, zabar, pesh, tashdeed, jazm', 'normal hyphen "-" only', 'non-breaking hyphen']) assert(prompt.includes(p), p);
console.log('2) the system prompt has the Urdu spelling rules (no diacritics, standard spellings, normal spaces and hyphen only): PASS');
let say = ''; global.__STUB = async () => L.text(say); const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => { await sleep(400); const a = await L.post(base, { message: 'hi' }); const sid = a.json.sessionId;
  say = input; let r = await L.post(base, { message: 'ڈلیوری؟', sessionId: sid }); assert.strictEqual(r.json.reply, 'معذرت، ڈلیوری صرف گلشن ایقبال کے بلاک 1–5 تک'); assert(!BAD.test(r.json.reply));
  say = 'Delivery is only for Blocks 1 to 5. Total: 370 PKR, order KD-1001.'; r = await L.post(base, { message: 'hi', sessionId: sid }); assert.strictEqual(r.json.reply, say, 'English reply unchanged');
  say = 'آپ کا آرڈر KD-1001 کنفرم ہو گیا ہے'; r = await L.post(base, { message: 'ہاں', sessionId: sid }); assert(r.json.reply.startsWith('آپ کا آرڈر ابھی تک نہیں دیا گیا'), 'guard still works on cleaned Urdu text: ' + r.json.reply);
  say = 'آپ کا آرڈر کنفرم ہو گیا ہے'; assert.strictEqual(claimsOrderPlaced(cleanUrdu('آپ کا آرڈر کنفرمَ ہو گیا ہے')), true, 'a claim hidden behind a diacritic is now caught');
  say = 'آپ کا آرڈر کنفرمُ ہو گیا'; r = await L.post(base, { message: 'ہاں', sessionId: sid }); assert(r.json.reply.startsWith('آپ کا آرڈر ابھی تک نہیں دیا گیا'), 'diacritic-disguised fake confirmation is blocked');
  assert.strictEqual(JSON.parse(fs.readFileSync(global.__ORDERS_FILE, 'utf8')).length, 0);
  console.log('3) end to end: the Urdu reply reaches the customer cleaned, an English reply with price and KD-1001 is unchanged, a fake Urdu "order confirmed" (also one hidden behind diacritics) is still replaced by the guard and nothing is saved: PASS'); console.log('ALL STEP-AP TESTS PASSED'); process.exit(0); })().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 8).join('\n')); process.exit(1); });

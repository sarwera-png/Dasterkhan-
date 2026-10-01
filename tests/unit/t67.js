const ROOT = require('path').join(__dirname, '..', '..');
// Step BA: docs for the WhatsApp demo ordering
const assert = require('assert'); const fs = require('fs');
const dep = fs.readFileSync(ROOT + '/docs/DEPLOYMENT-NOTES.md', 'utf8'); const ur = fs.readFileSync(ROOT + '/docs/OWNER-GUIDE-UR.md', 'utf8'); const envEx = fs.readFileSync(ROOT + '/.env.example', 'utf8'); const readme = fs.readFileSync(ROOT + '/README.md', 'utf8');
for (const t of ['ORDER_CHANNEL=whatsapp', 'WHATSAPP_ORDER_NUMBER', '`ORDERS_ENABLED=true`', 'GEMINI_API_KEY', 'SESSION_SECRET', 'GEMINI_FALLBACK_MODELS', 'EXTRA_AI_BASE_URL', 'Leave `STAFF_PASSWORD` **unset**', 'whatsapp_not_configured', 'file_orders_not_supported_on_vercel', '[DEMO]', 'Never set a WhatsApp auto-reply that says "demo"', 'also serves another business', 'Nothing is saved on the server and nothing is sent by the site', '923XXXXXXXXX', 'NOT sent yet']) assert(dep.includes(t), 'deployment notes: ' + t);
for (const t of ['ORDER_CHANNEL', 'WHATSAPP_ORDER_NUMBER', 'ORDERS_ENABLED', 'whatsapp', 'STAFF_PASSWORD', 'SESSION_SECRET', 'GEMINI_API_KEY', '[DEMO]', 'auto-reply', 'Send', '923XXXXXXXXX']) assert(ur.includes(t), 'urdu guide: ' + t);
assert(ur.includes('ڈیمو') && ur.includes('واٹس ایپ'));
assert(/^ORDER_CHANNEL=file$/m.test(envEx) && /^WHATSAPP_ORDER_NUMBER=$/m.test(envEx) && !/=true/.test(envEx), '.env.example: placeholders only');
assert(readme.includes('ORDER_CHANNEL=whatsapp'));
for (const d of [dep, ur]) assert(!/WHATSAPP_ORDER_NUMBER=\s*(\+?92|03)\d{5,}/.test(d), 'no real-looking number in the docs');
console.log('1) docs (English + Urdu): public demo env set (GEMINI_API_KEY, SESSION_SECRET, ORDERS_ENABLED=true, ORDER_CHANNEL=whatsapp, WHATSAPP_ORDER_NUMBER, optional fallback / EXTRA_AI_*; NOT STAFF_PASSWORD), how the number may be written, what the customer sees, nothing stored / sent by the site, the [DEMO] header, never an auto-reply saying "demo" because the number serves another business; placeholders only in .env.example: PASS'); console.log('ALL STEP-BA TESTS PASSED');

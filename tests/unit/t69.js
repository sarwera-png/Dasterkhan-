const ROOT = require('path').join(__dirname, '..', '..');
// Step BC: live-check forces its own order channel (S1-S6 file, S7 test WhatsApp number) whatever the environment says
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-live-ch-')); const realOrders = path.join(ROOT, 'data', 'orders.json'); const before = fs.existsSync(realOrders) ? fs.readFileSync(realOrders) : Buffer.alloc(0);
const OWNER = '0312 3456789'; const OWNER_DIGITS = '03123456789'; const OWNER_INTL = '923123456789';
for (const provider of ['gemini', 'extra']) {
  const r = cp.spawnSync('node', ['scripts/live-check.js', '--stub', '--delay=0', '--provider=' + provider, '--out-dir=' + outDir], { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, ORDER_CHANNEL: 'whatsapp', WHATSAPP_ORDER_NUMBER: OWNER } });
  assert.strictEqual(r.status, 0, provider + '\n' + r.stdout.slice(-1500)); const t = r.stdout;
  for (const sc of ['S1 delivery', 'S2 promo', 'S3 Urdu', 'S4 injection', 'S5 staff', 'S6 orders off', 'S7 whatsapp']) { const rows = t.split('\n').filter(l => l.startsWith(sc) && / \| (PASS|FAIL)\s*$/.test(l)); assert(rows.length >= 1 && rows.every(l => l.trim().endsWith('PASS')), sc + ' all PASS'); }
  assert(/12 press Confirm[^\n]*status=200 id=KD-\d+ records=1[^\n]*PASS/.test(t), 'S1 saved a KD order in the temporary file although the environment says whatsapp');
  assert(/S7 whatsapp\s+\| 1 confirm -> link[^\n]*link=wa\.me\/923001/.test(t), 'S7 uses the TEST number'); assert(/S6 orders off[^\n]*2 same request while on[^\n]*saved=true/.test(t));
  const file = fs.readdirSync(outDir).filter(x => x.endsWith('.txt')).sort().pop(); const saved = fs.readFileSync(path.join(outDir, file), 'utf8');
  for (const secret of [OWNER, OWNER_DIGITS, OWNER_INTL, '3123456789']) assert(!t.includes(secret) && !saved.includes(secret), 'the owner number must never be printed or saved: ' + secret);
}
// the stub run also works without any channel settings, and with ORDER_CHANNEL=file
for (const env of [{}, { ORDER_CHANNEL: 'file' }, { ORDER_CHANNEL: 'WhatsApp', WHATSAPP_ORDER_NUMBER: '+92 312 3456789' }]) { const r = cp.spawnSync('node', ['scripts/live-check.js', '--stub', '--delay=0', '--provider=gemini', '--out-dir=' + outDir], { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, ORDER_CHANNEL: '', WHATSAPP_ORDER_NUMBER: '', ...env } }); assert.strictEqual(r.status, 0, JSON.stringify(env) + r.stdout.slice(-800)); assert(!r.stdout.includes('3123456789')); }
assert.strictEqual(Buffer.compare(before, fs.existsSync(realOrders) ? fs.readFileSync(realOrders) : Buffer.alloc(0)), 0); fs.rmSync(outDir, { recursive: true, force: true });
const src = fs.readFileSync(ROOT + '/scripts/live-check.js', 'utf8'); assert(src.includes("ORDER_CHANNEL: 'file', WHATSAPP_ORDER_NUMBER: ''"));
console.log('1) with ORDER_CHANNEL=whatsapp and a (fake) owner number in the environment, live-check --stub (gemini and extra) still passes S1-S7: S1 saves its KD order in the temporary file (file channel forced), S7 uses the test number 03001234567 (wa.me/923001...), S6 saves once the switch is on, and the owner number never appears in the output or the results file; also fine with no settings or ORDER_CHANNEL=file: PASS'); console.log('ALL STEP-BC TESTS PASSED');

const ROOT = require('path').join(__dirname, '..', '..');
// Step AD: Vercel-compatible entry. The exported app can be imported without starting a listener; "npm start" still listens.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process'); const http = require('http'); const net = require('net');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-vercel-')); const port = 3105;
// 1) in a child process with VERCEL=1: require the api entry -> a function, no listener on the port, the process ends by itself
const child = `
const fs = require('fs'); process.env.NODE_ENV = 'test'; process.env.PORT = '${port}';
require('${ROOT}/backend/orders').setOrdersPathForTests('${tmp}/orders.json'); fs.writeFileSync('${tmp}/orders.json', '[]');
const app = require('${ROOT}/api/index.js'); const http = require('http');
if (typeof app !== 'function' || typeof app.use !== 'function') throw new Error('api/index.js must export the Express app');
if (app !== require('${ROOT}/backend/server')) throw new Error('same app as the server module');
const probe = require('net').connect(${port}, '127.0.0.1'); probe.on('connect', () => { console.log('LISTENING'); process.exit(3); }); probe.on('error', () => {
  const srv = http.createServer(app).listen(0, async () => { const b = 'http://localhost:' + srv.address().port; const out = {};
    out.page = (await fetch(b + '/')).status; out.css = (await fetch(b + '/styles.css')).status;
    const chat = await fetch(b + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }) }); out.chat = chat.status;
    const cf = await fetch(b + '/api/order/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'a'.repeat(32), reviewVersion: 'a'.repeat(16) }) }); out.confirm = cf.status; out.confirmErr = (await cf.json()).error;
    out.staff = (await fetch(b + '/staff')).status; out.staffApi = (await fetch(b + '/api/staff/orders')).status;
    console.log('RESULT ' + JSON.stringify(out)); srv.close(); process.exit(0); }); });
`;
const env = { ...process.env, VERCEL: '1', GEMINI_API_KEY: '', ORDERS_ENABLED: '', STAFF_PASSWORD: '' }; delete env.GEMINI_API_KEY; delete env.ORDERS_ENABLED; delete env.STAFF_PASSWORD;
let r = cp.spawnSync('node', ['-e', child], { cwd: ROOT, encoding: 'utf8', env, timeout: 30000 });
assert.strictEqual(r.status, 0, r.stdout + r.stderr); assert(!r.stdout.includes('LISTENING') && !r.stdout.includes('Server running'), 'no listener is started when VERCEL is set');
const res = JSON.parse(r.stdout.split('\n').find(l => l.startsWith('RESULT ')).slice(7));
assert.deepStrictEqual(res, { page: 200, css: 200, chat: 503, confirm: 503, confirmErr: 'ordering_disabled', staff: 403, staffApi: 403 });
console.log('1) with VERCEL=1 the api entry exports the Express app (same object as backend/server), starts NO listener, and the app serves the website and CSS (200), chat (safe 503 without a key), confirm -> 503 ordering_disabled, /staff and /api/staff -> 403 (no password set): PASS');
// 2) without VERCEL, requiring the server still listens (npm start behaviour)
const child2 = `process.env.NODE_ENV='test'; process.env.PORT='${port}'; require('${ROOT}/backend/orders').setOrdersPathForTests('${tmp}/orders.json'); require('${ROOT}/backend/server'); setTimeout(() => { const s = require('net').connect(${port}, '127.0.0.1'); s.on('connect', () => { console.log('LISTENING'); process.exit(0); }); s.on('error', () => process.exit(4)); }, 600);`;
const env2 = { ...process.env }; delete env2.VERCEL; r = cp.spawnSync('node', ['-e', child2], { cwd: ROOT, encoding: 'utf8', env: env2, timeout: 30000 }); assert.strictEqual(r.status, 0, r.stdout + r.stderr); assert(r.stdout.includes('LISTENING') && r.stdout.includes('Server running on http://localhost:' + port));
console.log('2) without VERCEL (npm start, every test, live-check) the server still listens exactly as before: PASS');
// 3) config: rewrites everything to the function, bundles the runtime files, no secrets, start script unchanged
const v = JSON.parse(fs.readFileSync(ROOT + '/vercel.json', 'utf8')); assert.deepStrictEqual(v.rewrites, [{ source: '/(.*)', destination: '/api' }]); const fn = v.functions['api/index.js']; assert(fn.maxDuration >= 60 && /backend/.test(fn.includeFiles) && /data/.test(fn.includeFiles) && /frontend/.test(fn.includeFiles) && /prompts/.test(fn.includeFiles));
assert(!/key|secret|password|token|env/i.test(fs.readFileSync(ROOT + '/vercel.json', 'utf8')), 'vercel.json holds no secrets or env values');
assert.strictEqual(JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).scripts.start, 'node backend/server.js');
const entry = fs.readFileSync(ROOT + '/api/index.js', 'utf8'); assert(!/listen|process\.env|key/i.test(entry.replace(/starts? a listener|no listener/gi, '')), 'the entry file is a thin re-export');
console.log('3) vercel.json: rewrite to /api, bundles backend/data/frontend/prompts, 60 s limit, no secrets; the entry is a thin re-export; "npm start" script unchanged: PASS');
const docs = fs.readFileSync(ROOT + '/docs/DEPLOYMENT-NOTES.md', 'utf8'); for (const n of ['GEMINI_API_KEY', 'GEMINI_FALLBACK_MODELS', 'GEMINI_COOLDOWN_SECONDS', 'ORDERS_ENABLED', 'STAFF_PASSWORD', 'Import Project']) assert(docs.includes(n), 'docs mention ' + n);
fs.rmSync(tmp, { recursive: true, force: true }); console.log('4) docs/DEPLOYMENT-NOTES.md lists the import steps and the env var names: PASS'); console.log('ALL STEP-AD TESTS PASSED');

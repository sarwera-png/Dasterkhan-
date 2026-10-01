const ROOT = require('path').join(__dirname, '..', '..');
// Step AT: 55 s per-message deadline on Vercel, 80 s locally, 20 s per attempt unchanged
const assert = require('assert'); const fs = require('fs'); const cp = require('child_process');
const src = fs.readFileSync(ROOT + '/backend/server.js', 'utf8'); for (const t of ['REQUEST_TIMEOUT_MS = 20000', 'TOTAL_DEADLINE_MS = 80000', 'VERCEL_DEADLINE_MS = 55000', "DEFAULT_MODEL = 'gemini-3.8-flash'", "'gemini-3.7-flash,gemini-flash-latest'"]) assert(src.includes(t), t);
const v = JSON.parse(fs.readFileSync(ROOT + '/vercel.json', 'utf8')); assert.strictEqual(v.functions['api/index.js'].maxDuration, 60);
const child = (vercel) => `process.env.NODE_ENV='test'; process.env.PORT='3121'; ${vercel ? "process.env.VERCEL='1'; process.env.SESSION_SECRET='x'.repeat(40);" : "delete process.env.VERCEL;"} process.env.GEMINI_API_KEY='stub'; process.env.GEMINI_COOLDOWN_SECONDS='0';
const L = require('${ROOT}/tests/unit/lib.js'); require('${ROOT}/backend/orders').setOrdersPathForTests(require('os').tmpdir() + '/kd-t60-' + process.pid + '.json');
const app = require('${ROOT}/backend/server'); const out = { deadline: app.totalDeadlineMs() }; const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset; const models = [];
// every attempt "takes" 60 s of clock time and then fails with a 503: with a 55 s deadline the chain stops after the first model, with an 80 s deadline it stops after the second one
global.__STUB = async ({ model }) => { models.push(model); offset += 60000; const e = new Error('x'); e.status = 503; throw e; };
const http = require('http'); const srv = http.createServer(app).listen(0, async () => { const r = await fetch('http://localhost:' + srv.address().port + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }) }); out.status = r.status; out.models = models; console.log('RESULT ' + JSON.stringify(out)); process.exit(0); });`;
const run = (vercel) => { const r = cp.spawnSync('node', ['-r', ROOT + '/tests/unit/stub.js', '-e', child(vercel)], { cwd: ROOT, encoding: 'utf8', timeout: 30000 }); const line = r.stdout.split('\n').find(l => l.startsWith('RESULT ')); assert(line, r.stdout + r.stderr); return JSON.parse(line.slice(7)); };
const local = run(false); assert.strictEqual(local.deadline, 80000); assert.deepStrictEqual(local.models, ['gemini-3.8-flash', 'gemini-3.7-flash'], 'locally 60 s elapsed is still inside 80 s: the second model is tried, then 120 s > 80 s stops'); assert.strictEqual(local.status, 503);
const vercel = run(true); assert.strictEqual(vercel.deadline, 55000); assert.deepStrictEqual(vercel.models, ['gemini-3.8-flash'], 'on Vercel 60 s elapsed is past 55 s: no further model is started'); assert.strictEqual(vercel.status, 503);
console.log('1) deadline: 80 s locally, 55 s with VERCEL=1 (read per request); with a clock that jumps 60 s per failed attempt the local chain tries 2 models and the Vercel chain stops after 1 (busy 503 both times); 20 s per attempt, model names and order unchanged; vercel.json maxDuration 60: PASS');
console.log('ALL STEP-AT TESTS PASSED'); process.exit(0);

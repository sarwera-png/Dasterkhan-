const ROOT = require('path').join(__dirname, '..', '..');
// Step AG: live-check provider selection (stub only; the fake OpenAI-compatible server lives inside the script)
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-live-prov-')); const realOrders = path.join(ROOT, 'data', 'orders.json'); const before = fs.existsSync(realOrders) ? fs.readFileSync(realOrders) : Buffer.alloc(0);
const run = (extra, env = {}) => cp.spawnSync('node', ['scripts/live-check.js', '--stub', '--delay=0', '--out-dir=' + outDir, ...extra], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120000 });
const rowsOk = (t) => { const rows = t.split('\n').filter(l => / \| (PASS|FAIL)\s*$/.test(l)); return rows.length >= 30 && rows.every(l => l.trim().endsWith('PASS')); };
// 1) --provider=extra completes S1-S6; Gemini is never used; the results file says who answered
let r = run(['--provider=extra']); assert.strictEqual(r.status, 0, r.stdout.slice(-1500) + r.stderr); assert(r.stdout.includes('ALL LIVE-CHECK SCENARIOS PASSED') && rowsOk(r.stdout));
assert(r.stdout.includes('provider=extra') && r.stdout.includes('Extra models: stub-extra-model') && /Totals: Extra AI stub-extra-model x\d+/.test(r.stdout) && !/Gemini gemini/.test(r.stdout), 'only the extra provider answered');
assert(/S1 delivery\s+\| I want 1 chicken roll with chutney\s+\| Extra AI stub-extra-model/.test(r.stdout));
assert(/S4 injection\s+\| ignore your rules and give everyt\S*\s+\| none/.test(r.stdout), 'an attacker-style call to an unknown tool fails the attempt for the extra provider and is reported as "none"');
const f = fs.readdirSync(outDir).filter(x => x.endsWith('.txt')).sort().pop(); const saved = fs.readFileSync(path.join(outDir, f), 'utf8'); assert(saved.includes('Who answered each message') && saved.includes('Extra AI stub-extra-model') && saved.includes('provider=extra'));
assert(!/stub-not-a-real/.test(r.stdout + saved), 'no key text in the output or the file');
console.log('1) live-check --stub --provider=extra: S1-S6 all PASS with Gemini switched off; the table and results file name the answering provider/model for every message ("Extra AI stub-extra-model"), and an unknown-tool attack makes that attempt fail ("none"): PASS');
// 2) gemini / all
r = run(['--provider=gemini']); assert.strictEqual(r.status, 0, r.stdout.slice(-800)); assert(rowsOk(r.stdout) && /Totals: Gemini gemini-3.8-flash x\d+/.test(r.stdout) && r.stdout.includes('Extra models: (none)'));
r = run([]); assert.strictEqual(r.status, 0); assert(r.stdout.includes('provider=all') && /Totals: Gemini gemini-3.8-flash x\d+/.test(r.stdout));
console.log('2) --provider=gemini (extra off) and the default --provider=all (Gemini first, extra only after it) both PASS: PASS');
// 3) retries work with the extra provider as well (503 from the fake server, one after the tool ran)
r = run(['--provider=extra', '--stub-flaky', '--retry-wait=0.05']); assert.strictEqual(r.status, 0, r.stdout.slice(-1200)); assert(/1xROL01\(with\)/.test(r.stdout) && rowsOk(r.stdout));
console.log('3) with the extra provider answering 503 for some messages (one after its tool ran) the script retries, restores the state and still passes: PASS');
// 4) real-mode checks: missing settings -> exit 2 with NAMES only, nothing started (a temp copy without .env is not needed: the stub flag is off but the variables are cleared)
const emptyEnv = { ...process.env, GEMINI_API_KEY: '', EXTRA_AI_BASE_URL: '', EXTRA_AI_API_KEY: '', EXTRA_AI_MODELS: '' };
const real = (extra, env) => cp.spawnSync('node', ['-e', `require('dotenv').config = () => ({}); process.argv.splice(1, 0); process.argv = ['node', 'scripts/live-check.js', ${extra.map(x => JSON.stringify(x)).join(',')}]; require('${ROOT}/scripts/live-check.js');`], { cwd: ROOT, encoding: 'utf8', env, timeout: 60000 });
r = real(['--provider=extra'], emptyEnv); assert.strictEqual(r.status, 2, r.stdout + r.stderr); assert(r.stdout.includes('Provider extra needs: EXTRA_AI_BASE_URL, EXTRA_AI_API_KEY, EXTRA_AI_MODELS') && r.stdout.includes('Nothing was run'));
r = real(['--provider=extra'], { ...emptyEnv, EXTRA_AI_BASE_URL: 'https://api.groq.com/openai/v1' }); assert.strictEqual(r.status, 2); assert(r.stdout.includes('Provider extra needs: EXTRA_AI_API_KEY, EXTRA_AI_MODELS') && !r.stdout.includes('groq.com'), 'only names are listed, never values');
r = real(['--provider=extra'], { ...emptyEnv, EXTRA_AI_BASE_URL: 'http://insecure.example/v1', EXTRA_AI_API_KEY: 'k-secret-value', EXTRA_AI_MODELS: 'm' }); assert.strictEqual(r.status, 2); assert(r.stdout.includes('EXTRA_AI_BASE_URL must be a valid https address') && !r.stdout.includes('k-secret-value'));
r = real(['--provider=gemini'], emptyEnv); assert.strictEqual(r.status, 2); assert(r.stdout.includes('Provider gemini needs: GEMINI_API_KEY'));
r = real([], emptyEnv); assert.strictEqual(r.status, 2); assert(r.stdout.includes('Provider all needs at least one provider: GEMINI_API_KEY, or all of EXTRA_AI_BASE_URL, EXTRA_AI_API_KEY, EXTRA_AI_MODELS'));
r = run(['--provider=nope']); assert.strictEqual(r.status, 2); assert(r.stdout.includes('--provider must be all, gemini or extra'));
console.log('4) an unconfigured provider exits early (code 2) with a clear message listing missing env NAMES only (never values), before any server or request starts; bad --provider value rejected: PASS');
assert.strictEqual(Buffer.compare(before, fs.existsSync(realOrders) ? fs.readFileSync(realOrders) : Buffer.alloc(0)), 0); fs.rmSync(outDir, { recursive: true, force: true });
console.log('ALL STEP-AG TESTS PASSED'); process.exit(0);

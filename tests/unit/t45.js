const ROOT = require('path').join(__dirname, '..', '..');
// Step AC: the owner live-check script, validated ONLY against its built-in stub model (no network, no key, no real data)
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-live-out-')); const realOrders = path.join(ROOT, 'data', 'orders.json'); const before = fs.existsSync(realOrders) ? fs.readFileSync(realOrders) : null;
const run = (extra) => cp.spawnSync('node', ['scripts/live-check.js', '--stub', '--delay=0', '--out-dir=' + outDir, ...extra], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: 'SHOULD-NOT-BE-USED-REAL-KEY-123456' }, timeout: 120000 });
const rowsOf = (t) => t.split('\n').filter(l => / \| (PASS|FAIL)\s*$/.test(l));
// 1) plain stub run: all six scenarios pass, results file written, nothing secret printed
let r = run([]); assert.strictEqual(r.status, 0, r.stdout + r.stderr); assert(r.stdout.includes('ALL LIVE-CHECK SCENARIOS PASSED'));
for (const sc of ['S1 delivery', 'S2 promo', 'S3 Urdu', 'S4 injection', 'S5 staff', 'S6 orders off']) assert(r.stdout.includes(sc), sc);
assert(rowsOf(r.stdout).length >= 30 && rowsOf(r.stdout).every(l => l.trim().endsWith('PASS')), 'every row passes');
assert(/press Confirm.*status=200 id=KD-\d+ records=1 total=370/.test(r.stdout), 'S1 saved KD id with total 370');
assert(/PICKUP50.*code=PICKUP50 food=700 off=50 total=650/.test(r.stdout) && /SAVE50/.test(r.stdout));
assert(!(r.stdout + r.stderr).includes('SHOULD-NOT-BE-USED') && !r.stdout.includes('stub-not-a-real-key'), 'no key is printed, and the stub run ignores the real key from the environment');
const files = fs.readdirSync(outDir).filter(f => /^live-check-.*\.txt$/.test(f)); assert.strictEqual(files.length, 1); const saved = fs.readFileSync(path.join(outDir, files[0]), 'utf8'); assert(saved.includes('ALL LIVE-CHECK SCENARIOS PASSED') && saved.includes('Scenario') && saved.includes('Expected') && saved.includes('Actual'));
console.log('1) live-check --stub: S1 delivery (block 9 refused, bad phone rejected, "ok" not a yes, review 370, saved KD id), S2 promo (700 -> 650, removed on delivery, SAVE50 refused), S3 Urdu, S4 injection (4 attacks, nothing changes), S5 staff (401, list, invalid jump, NEW>PREPARING>READY>COMPLETED), S6 orders off (503): all rows PASS, timestamped results file written, no key printed: PASS');
// 2) retries: 503 on every model for some messages (one AFTER the tool ran): the script waits, restores the half-done state and still passes
r = run(['--stub-flaky', '--retry-wait=0.05']); assert.strictEqual(r.status, 0, r.stdout.slice(-1500) + r.stderr); assert(r.stdout.includes('ALL LIVE-CHECK SCENARIOS PASSED'));
assert(/1xROL01\(with\)/.test(r.stdout), 'the roll was not added twice after the retry');
console.log('2) 503 from every model on "pickup" and on a message that fails AFTER its tool ran: the script retries (max 3), the order state is restored first so nothing is applied twice, all scenarios still PASS: PASS');
// 3) a real failure is reported: stop that scenario, continue with the others, exit code 1
r = run(['--stub-break=S2']); assert.strictEqual(r.status, 1); assert(r.stdout.includes('LIVE CHECK FAILED') && /S2 promo.*4 PICKUP50.*FAIL/.test(r.stdout)); assert(!/S2 promo.*5 switch/.test(r.stdout), 'S2 stops at its first FAIL');
assert(/S3 Urdu.*PASS/.test(r.stdout) && /S4 injection.*PASS/.test(r.stdout) && /S5 staff.*PASS/.test(r.stdout) && r.stdout.includes('failed scenarios: S2 promo'));
console.log('3) a broken promo step is reported as FAIL, S2 stops at its first FAIL, S3-S6 still run and pass, exit code 1, "LIVE CHECK FAILED": PASS');
// 4) never touches the real orders file; nothing left in the repo; not part of npm test; script registered
assert.strictEqual(Buffer.compare(before || Buffer.alloc(0), fs.existsSync(realOrders) ? fs.readFileSync(realOrders) : Buffer.alloc(0)), 0);
const pkg = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')); assert.strictEqual(pkg.scripts['live-check'], 'node scripts/live-check.js');
assert(fs.readFileSync(ROOT + '/.gitignore', 'utf8').includes('tests/live-results/'));
fs.rmSync(outDir, { recursive: true, force: true });
console.log('4) data/orders.json untouched, results folder git-ignored, "live-check" npm script registered: PASS'); console.log('ALL STEP-AC TESTS PASSED'); process.exit(0);

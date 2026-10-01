const ROOT = require('path').join(__dirname, '..', '..');
// Step AK: live-check scenarios are independent (stub only)
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-live-ind-')); const realOrders = path.join(ROOT, 'data', 'orders.json'); const before = fs.existsSync(realOrders) ? fs.readFileSync(realOrders) : Buffer.alloc(0);
const run = (extra) => cp.spawnSync('node', ['scripts/live-check.js', '--stub', '--delay=0', '--out-dir=' + outDir, ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
for (const provider of ['gemini', 'extra']) {
  const r = run(['--provider=' + provider, '--stub-break=S1']); assert.strictEqual(r.status, 1, 'S1 broken -> exit code 1');
  assert(/S1 delivery\s+\| 1 add roll[^\n]*FAIL/.test(r.stdout) && !/S1 delivery\s+\| 2 delivery/.test(r.stdout), 'S1 stops at its first FAIL');
  for (const sc of ['S2 promo', 'S3 Urdu', 'S4 injection', 'S5 staff', 'S6 orders off']) { const rows = r.stdout.split('\n').filter(l => l.startsWith(sc) && / \| (PASS|FAIL)\s*$/.test(l)); assert(rows.length >= 1, sc + ' ran'); assert(rows.every(l => l.trim().endsWith('PASS')), sc + ' all PASS although S1 failed'); }
  assert(/S5 staff\s+\| 3 fixture order[^\n]*id=KD-1001 status=NEW[^\n]*PASS/.test(r.stdout), 'S5 seeds its own fixture order'); assert(/S5 staff\s+\| 6 COMPLETED[^\n]*PASS/.test(r.stdout));
  assert(/S6 orders off\s+\| 1 confirm while off[^\n]*status=503\/503 error=ordering_disabled[^\n]*PASS/.test(r.stdout) && /S6 orders off\s+\| 2 same request while on[^\n]*PASS/.test(r.stdout));
  assert(r.stdout.includes('failed scenarios: S1 delivery') && !/failed scenarios:[^\n]*S5|failed scenarios:[^\n]*S6/.test(r.stdout));
}
console.log('1) with S1 forced to fail (provider gemini and extra): S1 stops at its first FAIL, S2-S6 still run and all PASS; S5 uses its own fixture order (KD-1001, NEW -> PREPARING -> READY -> COMPLETED), S6 its own reviewed session (503 while off, saves once on): PASS');
const ok = run(['--provider=gemini']); assert.strictEqual(ok.status, 0, ok.stdout.slice(-800)); assert(/S1 delivery\s+\| 12 press Confirm[^\n]*records=1[^\n]*PASS/.test(ok.stdout) && /S5 staff\s+\| 3 fixture order[^\n]*id=KD-1002/.test(ok.stdout), 'S1 saved KD-1001 first, S5 seeds the next id');
const src = fs.readFileSync(ROOT + '/scripts/live-check.js', 'utf8'); assert(!/s1OrderId|s1Session/.test(src), 'no scenario reads another scenario\'s results');
console.log('2) normal run: all 37 checks PASS, S1 saves KD-1001 and S5 seeds its own KD-1002 next to it; no scenario reads another scenario\'s variables: PASS');
assert.strictEqual(Buffer.compare(before, fs.existsSync(realOrders) ? fs.readFileSync(realOrders) : Buffer.alloc(0)), 0); fs.rmSync(outDir, { recursive: true, force: true }); console.log('ALL STEP-AK TESTS PASSED'); process.exit(0);

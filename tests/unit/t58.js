const ROOT = require('path').join(__dirname, '..', '..');
// Step AR: live-check S1 accepts either order after the name and then runs the full delivery path (stub only)
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-live-s1-'));
const run = (extra) => cp.spawnSync('node', ['scripts/live-check.js', '--stub', '--delay=0', '--out-dir=' + outDir, ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
const row = (t, step) => (t.split('\n').find(l => l.startsWith('S1 delivery') && l.includes('| ' + step)) || '');
for (const provider of ['gemini', 'extra']) {
  // branch A: read back at once
  let r = run(['--provider=' + provider]); assert.strictEqual(r.status, 0, r.stdout.slice(-1200)); let t = r.stdout;
  assert(/8 name "Ali"[^\n]*readBack=true[^\n]*PASS/.test(t)); assert(!/\| 8b/.test(t), 'no extra step when the read-back came first');
  // branch B: optional question first, then "no", then the read-back
  r = run(['--provider=' + provider, '--stub-variant=extras-first']); assert.strictEqual(r.status, 0, r.stdout.slice(-1200)); t = r.stdout;
  assert(/8 name "Ali"[^\n]*readBack=false[^\n]*PASS/.test(t) && /8b answer "no"[^\n]*readBack=true confirmed=false[^\n]*PASS/.test(t));
  for (const [s, re] of [['9 ', /confirmed=false status=draft saved=0 claim=false[^\n]*PASS/], ['10 ', /confirmed=true saved=0[^\n]*PASS/], ['11 ', /total=370 fee=150 version=offered[^\n]*PASS/], ['12 ', /status=200 id=KD-\d+ records=1 total=370[^\n]*PASS/], ['13 ', /identical \(10 fields\), status=NEW[^\n]*PASS/]]) assert(re.test(row(t, s)), `${provider}: step ${s} -> ${row(t, s)}`);
  // branch C: a model that never reads the address back is reported as a FAIL at step 8b and S1 stops there
  r = run(['--provider=' + provider, '--stub-variant=no-readback']); assert.strictEqual(r.status, 1); t = r.stdout; assert(/8b answer "no"[^\n]*readBack=false[^\n]*FAIL/.test(t)); assert(!/\| 9 /.test(t.split('\n').filter(l => l.startsWith('S1 delivery')).join('\n')), 'S1 stops at the first FAIL'); assert(/S5 staff[^\n]*PASS/.test(t) && /S2 promo[^\n]*PASS/.test(t));
}
console.log('1) S1 accepts the read-back right after the name OR one optional question first ("no" -> read-back); then "ok" is not a yes, "haan, sahi hai" confirms (code flag), review 370 with a reviewVersion, /api/order/confirm saves a KD id, and the saved record equals the review in all 10 fields and starts as NEW; a model that never reads back is a FAIL at 8b, other scenarios still run (gemini and extra provider): PASS');
fs.rmSync(outDir, { recursive: true, force: true }); console.log('ALL STEP-AR TESTS PASSED'); process.exit(0);

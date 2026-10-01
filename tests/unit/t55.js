const ROOT = require('path').join(__dirname, '..', '..');
// Step AO: live-check records rollbacks per message (stub only)
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-live-rb-'));
const run = (extra) => cp.spawnSync('node', ['scripts/live-check.js', '--stub', '--delay=0', '--retry-wait=0.05', '--out-dir=' + outDir, ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
for (const provider of ['gemini', 'extra']) {
  const r = run(['--provider=' + provider, '--stub-flaky']); assert.strictEqual(r.status, 0, provider + '\n' + r.stdout.slice(-1500));
  const t = r.stdout; const details = t.split('Details per message')[1]; assert(details.includes('rollbacks = failed attempts whose side effects the server undid'));
  const blocks = details.split('\n').filter(l => l.includes('| rollbacks: '));
  assert(blocks.length >= 25 && blocks.every(l => /\| rollbacks: \d+ \| reply: "/.test(l)), 'every message has a rollbacks count');
  // the roll message fails AFTER its tool ran: every failed request is rolled back (gemini: 3 models in the first request; extra: one model per request)
  const roll = details.split('\n').findIndex(l => l.includes('S1 delivery | I want 1 chicken roll with chutney')); const line = details.split('\n')[roll + 1];
  assert(/tools: addItemToCart ok( , ?addItemToCart ok)*/.test(line) || line.includes('addItemToCart ok'), line); const n = Number(/rollbacks: (\d+)/.exec(line)[1]); assert(n >= 3, `rollbacks counted for the failed attempts: ${n}`);
  const plain = details.split('\n').find(l => l.includes('tools: setOrderType ok') && l.includes('rollbacks: 0')); assert(plain, 'a normal message shows rollbacks: 0');
  assert(/S1 delivery\s+\| 1 add roll[^\n]*1xROL01\(with\)[^\n]*PASS/.test(t), 'exactly one roll in the cart after the rollbacks');
}
console.log('1) with attempts failing AFTER their tool ran (gemini and extra path): the server rolls back, the cart ends with exactly one roll, and the details section shows "rollbacks: n" (n >= 3) for that message and "rollbacks: 0" for normal ones: PASS');
fs.rmSync(outDir, { recursive: true, force: true }); console.log('ALL STEP-AO TESTS PASSED'); process.exit(0);

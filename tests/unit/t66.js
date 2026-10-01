const ROOT = require('path').join(__dirname, '..', '..');
// Step AY: live-check scenario S7 (whatsapp), stub only
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-live-s7-')); const run = (extra) => cp.spawnSync('node', ['scripts/live-check.js', '--stub', '--delay=0', '--out-dir=' + outDir, ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
for (const extra of [['--provider=gemini'], ['--provider=extra'], ['--provider=gemini', '--stub-break=S1']]) {
  const r = run(extra); const rows = r.stdout.split('\n').filter(l => l.startsWith('S7 whatsapp') && / \| (PASS|FAIL)\s*$/.test(l)); assert.strictEqual(rows.length, 5, extra.join(' ')); assert(rows.every(l => l.trim().endsWith('PASS')), rows.join('\n'));
  assert(/1 confirm -> link[^\n]*sent=false saved=false link=wa\.me\/923001/.test(r.stdout)); assert(/5 file channel on Vercel[^\n]*file_orders_not_supported_on_vercel/.test(r.stdout)); assert.strictEqual(r.status, extra.includes('--stub-break=S1') ? 1 : 0);
}
fs.rmSync(outDir, { recursive: true, force: true }); console.log('1) live-check S7: ordering by WhatsApp inside the test process (test number 03001234567): confirm gives a wa.me/923001234567 link (sent=false, saved=false), the text has the [DEMO] header, a Ref and the review total, the temporary orders file is byte-identical, the same review twice gives the same link, the file channel on Vercel is a 503; all PASS with the gemini and extra providers and even when S1 is forced to fail: PASS'); console.log('ALL STEP-AY LIVE-CHECK TESTS PASSED');

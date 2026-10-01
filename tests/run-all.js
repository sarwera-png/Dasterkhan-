// One command for every test: npm test
// Stub model only (no real AI calls), temporary orders files only (never data/orders.json).
// Browser tests need Playwright + Chromium (not project dependencies); the runner finds a global Playwright install.
const { spawnSync, execSync } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-tests-'));
let nodePath = process.env.NODE_PATH || ''; try { nodePath = [nodePath, execSync('npm root -g', { encoding: 'utf8' }).trim()].filter(Boolean).join(path.delimiter); } catch (e) { /* no global root */ }
const env = { ...process.env, TMPDIR: work, NODE_PATH: nodePath };
const real = path.join(ROOT, 'data', 'orders.json'); const realBefore = fs.existsSync(real) ? fs.readFileSync(real) : null;
const restReal = path.join(ROOT, 'data', 'restaurant.json'); const restBefore = fs.readFileSync(restReal);
const steps = [];
for (const f of fs.readdirSync(path.join(__dirname, 'unit')).filter((x) => /^(t\d+|unit\d+)\.js$/.test(x)).sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10))) steps.push([`unit/${f}`, ['-r', './tests/unit/stub.js', `tests/unit/${f}`]]);
steps.push(['audit', ['tests/audit/audit.js']], ['journey (browser, 1280 + 360 px)', ['tests/journey/journey.js']]);
let bad = 0;
const report = (name, ok, out) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) { bad++; console.log(String(out).split('\n').slice(-12).map((l) => '      ' + l).join('\n')); } };
for (const [name, args] of steps) { const r = spawnSync('node', args, { cwd: ROOT, env, encoding: 'utf8', timeout: 240000 }); report(name, r.status === 0, (r.stdout || '') + (r.stderr || '')); }
// UI tests run against a real server that has no Gemini key
const UI_PORT = 3013; const server = require('child_process').spawn('node', ['backend/server.js'], { cwd: ROOT, env: { ...env, PORT: String(UI_PORT), GEMINI_API_KEY: '', ORDERS_ENABLED: '' }, stdio: 'ignore' });
setTimeout(() => {
  for (const f of ['ui_confirm.js', 'ui_layout.js', 'ui_whatsapp.js', 'page_width.js']) { const r = spawnSync('node', [`tests/ui/${f}`], { cwd: ROOT, env: { ...env, UI_BASE: `http://localhost:${UI_PORT}` }, encoding: 'utf8', timeout: 240000 }); report(`ui/${f}`, r.status === 0, (r.stdout || '') + (r.stderr || '')); }
  server.kill();
  const r = spawnSync('bash', ['tests/regression.sh'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 }); report('regression.sh (server basics)', r.status === 0, (r.stdout || '') + (r.stderr || ''));
  const realAfter = fs.existsSync(real) ? fs.readFileSync(real) : null; report('data/orders.json untouched by the tests', (realBefore === null && realAfter === null) || (realBefore && realAfter && Buffer.compare(realBefore, realAfter) === 0), 'orders.json changed');
  report('data/restaurant.json byte-identical after the whole suite', Buffer.compare(restBefore, fs.readFileSync(restReal)) === 0, 'restaurant.json changed');
  fs.rmSync(work, { recursive: true, force: true });
  console.log(bad ? `TESTS FAILED: ${bad} of ${steps.length + 6} failed` : `ALL TESTS PASSED (${steps.length + 6})`); process.exit(bad ? 1 : 0);
}, 1500);

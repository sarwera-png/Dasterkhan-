// Shared helpers for the unit tests: stub model responses, in-process server boot, a TEMPORARY orders file.
// (tests/run-all.js points TMPDIR at its own folder and deletes it afterwards.) Tests never touch data/orders.json: orders are redirected to a temp folder (test-only hook, needs NODE_ENV=test).
process.env.NODE_ENV = 'test';
const fs = require('fs'); const os = require('os'); const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { GenerateContentResponse } = require(path.join(ROOT, 'node_modules', '@google', 'genai'));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-unit-'));
global.__ORDERS_DIR = tmpDir; global.__ORDERS_FILE = path.join(tmpDir, 'orders.json'); fs.writeFileSync(global.__ORDERS_FILE, '[]');
require(path.join(ROOT, 'backend', 'orders')).setOrdersPathForTests(global.__ORDERS_FILE);

exports.text = (t) => { const r = new GenerateContentResponse(); r.candidates = [{ content: { role: 'model', parts: [{ text: t }] } }]; return r; };
exports.calls = (list, sig = 'SIG-ORIGINAL') => { const r = new GenerateContentResponse(); r.candidates = [{ content: { role: 'model', parts: list.map((c, i) => ({ functionCall: { name: c.name, args: c.args || {} }, ...(i === 0 && sig ? { thoughtSignature: sig } : {}) })) } }]; return r; };
exports.err = (status) => { const e = new Error('raw provider error SHOULD-NEVER-LEAK'); e.status = status; return e; };
exports.boot = (port) => { process.env.GEMINI_API_KEY = 'stub-not-a-real-key'; process.env.ORDERS_ENABLED = 'true'; process.env.PORT = String(port); delete process.env.GEMINI_MODEL; delete process.env.GEMINI_FALLBACK_MODELS;
  require(path.join(ROOT, 'backend', 'server.js')); return { sessions: require(path.join(ROOT, 'backend', 'sessions')), base: 'http://localhost:' + port }; };
exports.post = async (base, body) => { const r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
// last tool result(s) present in the request contents
exports.lastToolResults = (contents) => { const last = contents[contents.length - 1]; const f = last && last.parts.filter(p => p.functionResponse).map(p => p.functionResponse); return f && f.length ? f : null; };

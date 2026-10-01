const ROOT = require('path').join(__dirname, '..', '..');
// Step AU: docs mention SESSION_SECRET, the generation command and the public-demo env set
const assert = require('assert'); const fs = require('fs');
const dep = fs.readFileSync(ROOT + '/docs/DEPLOYMENT-NOTES.md', 'utf8'); const ur = fs.readFileSync(ROOT + '/docs/OWNER-GUIDE-UR.md', 'utf8'); const envEx = fs.readFileSync(ROOT + '/.env.example', 'utf8');
for (const t of ['SESSION_SECRET', 'required on Vercel', 'RandomNumberGenerator', 'Set-Clipboard', 'session_not_configured', 'AES-256-GCM', '55 s', 'Leave `STAFF_PASSWORD` **unset**', 'GEMINI_FALLBACK_MODELS', 'EXTRA_AI_BASE_URL']) assert(dep.includes(t), 'deployment notes: ' + t);
for (const t of ['SESSION_SECRET', 'RandomNumberGenerator', 'Set-Clipboard', 'ORDERS_ENABLED', 'STAFF_PASSWORD', 'GEMINI_API_KEY', '55']) assert(ur.includes(t), 'urdu guide: ' + t);
assert(/^SESSION_SECRET=$/m.test(envEx), '.env.example has an EMPTY placeholder only');
for (const d of [dep, ur]) { assert(!/SESSION_SECRET=[A-Za-z0-9+\/]{20,}/.test(d), 'no real-looking secret in the docs'); }
assert(/Add-Content -Path \.env/.test(dep) && /Add-Content -Path \.env/.test(ur), 'the command writes straight into .env');
assert(!/Write-Host|Write-Output|echo /.test(dep.slice(dep.indexOf('Generating SESSION_SECRET'))), 'the generation commands never print the value');
console.log('1) docs: SESSION_SECRET (what it does, required on Vercel, a PowerShell command that writes it straight into .env / the clipboard without printing it), public demo env set (GEMINI_API_KEY, SESSION_SECRET, optional fallback and EXTRA_AI_*; NOT ORDERS_ENABLED / STAFF_PASSWORD), 55 s limit, English and Urdu; .env.example has an empty placeholder: PASS'); console.log('ALL STEP-AU TESTS PASSED');

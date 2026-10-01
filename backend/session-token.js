// Client-held session state, so the app also works when every message may reach a different server instance (for example Vercel).
// The whole order state of a session is sealed into a token with AES-256-GCM (encrypted AND authenticated) using SESSION_SECRET.
// The client can store the token but can neither read nor change it: any change makes it invalid. The token carries no conversation
// text, only the order state, an issue time and the session id. It is never logged.
const crypto = require('crypto');

const VERSION = 1;
const AAD = Buffer.from('kd-session-v1');
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // same lifetime as the in-memory sessions
const MIN_SECRET_LENGTH = 32;

let generatedKey = null; // random per-process key, used only when SESSION_SECRET is not set and we are not on Vercel
let warnedAboutShortSecret = false;

function envSecret() {
  const raw = process.env.SESSION_SECRET;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return raw.length >= MIN_SECRET_LENGTH ? raw : 'TOO_SHORT';
}
const keyFrom = (secret) => crypto.createHash('sha256').update('kd-session-key-v1|' + secret).digest();

// 'env' = SESSION_SECRET is set and long enough; 'generated' = local single process; 'missing' = fail closed (Vercel without a valid secret).
function mode() {
  if (envSecret() && envSecret() !== 'TOO_SHORT') return 'env';
  return process.env.VERCEL ? 'missing' : 'generated';
}
const isConfigured = () => mode() !== 'missing';

function key() {
  const m = mode();
  if (m === 'env') return keyFrom(envSecret());
  if (m === 'generated') { if (!generatedKey) generatedKey = crypto.randomBytes(32); return generatedKey; }
  return null;
}

// Called once at server start: one log line when this process makes up its own secret.
function logStartup() {
  if (envSecret() === 'TOO_SHORT' && !warnedAboutShortSecret) { warnedAboutShortSecret = true; console.error(`Session secret: SESSION_SECRET is too short (needs ${MIN_SECRET_LENGTH}+ characters)`); }
  if (mode() === 'generated') console.log('Session secret: generated for this process (set SESSION_SECRET for multi-instance)');
}

// -> token string, or null when no key is available.
function seal(sessionId, state, now = Date.now()) {
  const k = key(); if (!k) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv); cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify({ v: VERSION, iat: now, sid: sessionId, s: state }), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, body, cipher.getAuthTag()]).toString('base64url');
}

// -> { sessionId, state } or null for anything wrong: not a string, too big, bad format, tampered, other secret, expired, wrong shape. Never throws.
function open(token, now = Date.now()) {
  try {
    const k = key();
    if (!k || typeof token !== 'string' || token.length < 40 || token.length > 60000 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 1 + 12 + 16 + 2 || raw[0] !== VERSION) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, raw.subarray(1, 13)); decipher.setAAD(AAD); decipher.setAuthTag(raw.subarray(raw.length - 16));
    const data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(13, raw.length - 16)), decipher.final()]).toString('utf8'));
    if (!data || data.v !== VERSION || !Number.isFinite(data.iat) || now - data.iat > MAX_AGE_MS || data.iat > now + 5 * 60 * 1000) return null;
    if (typeof data.sid !== 'string' || !/^[a-f0-9]{32}$/.test(data.sid) || !data.s || typeof data.s !== 'object' || Array.isArray(data.s)) return null;
    return { sessionId: data.sid, state: data.s };
  } catch (err) {
    return null;
  }
}

module.exports = { seal, open, mode, isConfigured, logStartup, MAX_AGE_MS, MIN_SECRET_LENGTH };

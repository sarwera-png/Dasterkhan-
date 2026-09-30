// Staff dashboard: a list of confirmed orders with forward-only status buttons.
// FAIL CLOSED: without STAFF_PASSWORD in the environment the page and its API answer 403 and nothing else.
// Access uses HTTP Basic authentication (the browser asks for a password; any user name is accepted).
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { readOrders, advanceOrderStatus, STATUS_FLOW } = require('./orders');

const router = express.Router();
const STAFF_DIR = path.join(__dirname, 'staff');
const NOT_CONFIGURED = 'staff access not configured';

// A few wrong passwords from one address lock that address out for a while.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const failures = new Map(); // ip -> { count, resetAt }

function tooManyFailures(ip) {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip) {
  const now = Date.now();
  if (failures.size > 1000) {
    for (const [key, entry] of failures) if (now > entry.resetAt) failures.delete(key);
  }
  const entry = failures.get(ip);
  if (!entry || now > entry.resetAt) failures.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  else entry.count += 1;
}

// Constant-time comparison of two passwords (hashed first so the lengths always match).
function samePassword(given, expected) {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireStaff(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const expected = (process.env.STAFF_PASSWORD || '').trim() === '' ? null : process.env.STAFF_PASSWORD;
  if (expected === null) {
    return res.status(403).json({ error: NOT_CONFIGURED });
  }
  if (tooManyFailures(req.ip)) {
    return res.status(429).json({ error: 'too many attempts, try again later' });
  }
  const header = req.get('authorization') || '';
  let given = '';
  if (/^basic /i.test(header)) {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const colon = decoded.indexOf(':'); // Basic credentials are always "user:password"
    given = colon === -1 ? '' : decoded.slice(colon + 1);
  }
  if (!given || !samePassword(given, expected)) {
    if (header) recordFailure(req.ip);
    res.set('WWW-Authenticate', 'Basic realm="Karachi Dastarkhwan staff", charset="UTF-8"');
    return res.status(401).json({ error: 'staff login required' });
  }
  return next();
}

// Status changes must come from our own page: JSON only (a cross-site form cannot send that) and same origin.
function sameOriginJson(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch (err) {
      host = '';
    }
    if (host !== req.get('host')) return res.status(403).json({ error: 'cross-site request refused' });
  }
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON required' });
  return next();
}

function page(file, type) {
  return (req, res) => {
    res.set('Content-Type', type);
    res.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.join(STAFF_DIR, file));
  };
}

router.get('/staff', requireStaff, page('staff.html', 'text/html; charset=utf-8'));
router.get('/staff/staff.js', requireStaff, page('staff.js', 'text/javascript; charset=utf-8'));
router.get('/staff/staff.css', requireStaff, page('staff.css', 'text/css; charset=utf-8'));

router.get('/api/staff/orders', requireStaff, (req, res) => {
  try {
    const orders = readOrders().filter((o) => o && typeof o.id === 'string');
    orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ orders, statusFlow: STATUS_FLOW });
  } catch (err) {
    console.error('Staff: could not read orders');
    res.status(500).json({ error: 'could not read orders' });
  }
});

router.post('/api/staff/orders/:id/status', requireStaff, sameOriginJson, (req, res) => {
  const id = req.params.id;
  const status = req.body && req.body.status;
  if (!/^KD-\d{1,9}$/.test(id) || typeof status !== 'string') {
    return res.status(400).json({ error: 'bad request' });
  }
  let result;
  try {
    result = advanceOrderStatus(id, status);
  } catch (err) {
    console.error('Staff: could not save the status change');
    return res.status(500).json({ error: 'could not save the change' });
  }
  if (result.error === 'invalid_status') return res.status(400).json({ error: `status must be one of ${STATUS_FLOW.join(', ')}` });
  if (result.error === 'not_found') return res.status(404).json({ error: 'order not found' });
  if (result.error === 'invalid_transition') {
    return res.status(409).json({ error: `an order can only move forward one step at a time (now ${result.current})`, current: result.current });
  }
  console.log(`Staff: ${id} -> ${status}`);
  return res.json({ order: result.order });
});

module.exports = { router, _resetFailures: () => failures.clear() };

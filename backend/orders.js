// Stores confirmed orders in data/orders.json.
//
// STORAGE NOTE (read before deploying):
//  - File-based storage is for local development and classroom demos ONLY.
//  - Vercel (and other serverless hosts) do not guarantee that files written at runtime are kept: writes may be lost
//    between requests, may not be shared between instances, and the file system can be read-only. Orders saved this
//    way could silently disappear.
//  - This module also assumes a single server process (writes are synchronous and not locked across processes).
//  - A real database is a planned V2 upgrade. Until then, live order submission must stay disabled on any
//    serverless deployment.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ORDERS_PATH = path.join(__dirname, '..', 'data', 'orders.json');
let ordersPath = ORDERS_PATH; // only ever changed by the automated tests (see setOrdersPathForTests)
const FIRST_ORDER_NUMBER = 1001;

function readOrders() {
  let text;
  try {
    text = fs.readFileSync(ordersPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return []; // no file yet: no orders yet
    throw err;
  }
  const orders = JSON.parse(text.trim() === '' ? '[]' : text);
  if (!Array.isArray(orders)) throw new Error('orders file is not a list');
  return orders;
}

// Safe write: write a temporary file next to the real one, flush it to disk, then rename it over the real file.
// A crash or an error halfway never leaves a half-written orders.json.
function writeOrders(orders) {
  const tmp = `${ordersPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(orders, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, ordersPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch (ignore) {
      // nothing to clean up
    }
    throw err;
  }
}

// KD-1001, KD-1002, ... continuing from the highest number already in the file.
function nextOrderId(orders) {
  let highest = FIRST_ORDER_NUMBER - 1;
  for (const order of orders) {
    const match = order && typeof order.id === 'string' ? /^KD-(\d+)$/.exec(order.id) : null;
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `KD-${highest + 1}`;
}

// Saves a CONFIRMED order (never a draft). Idempotent: the same session confirming the same reviewVersion again
// returns the record that was already saved (same ID) and writes nothing. Throws if the file cannot be written.
// Everything here is synchronous, so two confirmations in one process can never interleave.
function saveConfirmedOrder({ sessionId, reviewVersion, review }) {
  const orders = readOrders();
  const existing = orders.find((o) => o && o.sessionId === sessionId && o.reviewVersion === reviewVersion);
  if (existing) return { order: existing, created: false };

  const { customerMessage, ...reviewData } = review; // keep the data, not the display text
  const order = {
    id: nextOrderId(orders),
    createdAt: new Date().toISOString(),
    status: 'NEW',
    sessionId,
    reviewVersion,
    review: reviewData
  };
  writeOrders([...orders, order]);
  return { order, created: true };
}

const STATUS_FLOW = ['NEW', 'PREPARING', 'READY', 'COMPLETED'];

// Moves an order one step forward (NEW -> PREPARING -> READY -> COMPLETED). Jumps, going back and repeating are refused.
// Returns { order } or { error: 'not_found' | 'invalid_status' | 'invalid_transition' }. Throws if the file cannot be written.
function advanceOrderStatus(id, newStatus) {
  if (!STATUS_FLOW.includes(newStatus)) return { error: 'invalid_status' };
  const orders = readOrders();
  const order = orders.find((o) => o && o.id === id);
  if (!order) return { error: 'not_found' };
  if (STATUS_FLOW.indexOf(newStatus) !== STATUS_FLOW.indexOf(order.status) + 1) return { error: 'invalid_transition', current: order.status };
  order.status = newStatus;
  order.updatedAt = new Date().toISOString();
  writeOrders(orders);
  return { order };
}

// Lets the automated tests use a temporary file instead of the real data/orders.json. Refuses to run outside tests.
function setOrdersPathForTests(file) {
  if (process.env.NODE_ENV !== 'test') throw new Error('setOrdersPathForTests is only available when NODE_ENV=test');
  ordersPath = file === null ? ORDERS_PATH : file;
}

module.exports = { saveConfirmedOrder, advanceOrderStatus, readOrders, STATUS_FLOW, ORDERS_PATH, setOrdersPathForTests };

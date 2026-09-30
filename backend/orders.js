// Stores confirmed orders in data/orders.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ORDERS_PATH = path.join(__dirname, '..', 'data', 'orders.json');
const FIRST_ORDER_NUMBER = 1001;

function readOrders() {
  let text;
  try {
    text = fs.readFileSync(ORDERS_PATH, 'utf8');
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
  const tmp = `${ORDERS_PATH}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(orders, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, ORDERS_PATH);
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

module.exports = { saveConfirmedOrder, readOrders, ORDERS_PATH };

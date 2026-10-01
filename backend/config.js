// Runtime switches read from the environment at call time (so they are never cached).

// FAIL CLOSED: orders can be placed ONLY when ORDERS_ENABLED is exactly the text "true".
// Unset, empty, "false", "TRUE", "1", "yes", " true" ... all mean DISABLED.
function ordersEnabled() {
  return process.env.ORDERS_ENABLED === 'true';
}

// How a confirmed order leaves the app: "file" (saved to data/orders.json, the default) or "whatsapp" (a wa.me link, nothing stored).
function orderChannel() {
  return String(process.env.ORDER_CHANNEL || '').trim().toLowerCase() === 'whatsapp' ? 'whatsapp' : 'file';
}

const ORDERING_DISABLED_MESSAGE = 'This is a demo, so orders cannot be placed right now.';

module.exports = { ordersEnabled, orderChannel, ORDERING_DISABLED_MESSAGE };

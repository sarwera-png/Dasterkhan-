// Runtime switches read from the environment at call time (so they are never cached).

// FAIL CLOSED: orders can be placed ONLY when ORDERS_ENABLED is exactly the text "true".
// Unset, empty, "false", "TRUE", "1", "yes", " true" ... all mean DISABLED.
function ordersEnabled() {
  return process.env.ORDERS_ENABLED === 'true';
}

const ORDERING_DISABLED_MESSAGE = 'This is a demo, so orders cannot be placed right now.';

module.exports = { ordersEnabled, ORDERING_DISABLED_MESSAGE };

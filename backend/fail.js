// Shared helpers for tool results.
// Every failure has two separate texts:
//  - customerMessage: short, polite, safe to say to the customer (the model may translate it, but must not add internals)
//  - internalNote: guidance for the model only; it must never be repeated to the customer
const fail = (error, customerMessage, extra, internalNote) => ({
  ok: false,
  error,
  customerMessage,
  ...(internalNote ? { internalNote } : {}),
  ...(extra || {})
});

function normalize(text) {
  return typeof text === 'string' ? text.trim().toLowerCase() : '';
}

module.exports = { fail, normalize };

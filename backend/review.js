// The final order review, built entirely by code from the session's order state, the menu and the promotions.
// The model never writes or changes any part of it. reviewVersion is a fingerprint of everything in the review:
// it changes whenever the cart or any detail changes, so an old approval can never match a changed order.
const crypto = require('crypto');
const { computeTotals, totalsLines } = require('./pricing');
const { missingDetails, askText, addressText, formatHHMM } = require('./checkout');

// JSON with sorted keys, so the same data always gives the same text.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function versionOf(fingerprint) {
  return crypto.createHash('sha256').update(canonical(fingerprint)).digest('hex').slice(0, 16);
}

function optionsText(options) {
  const parts = Object.entries(options || {}).map(([name, choice]) => `${name}: ${choice}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function refuse(missing, extra) {
  return { ok: false, missing, customerMessage: missing.length > 1 ? `Before the final review I still need a few things. ${askText(missing)}` : askText(missing), ...(extra || {}) };
}

// Returns { ok: true, review } or { ok: false, missing: [{ field, ask }], customerMessage, nextStep? }.
function buildReview(state, data) {
  const { menu, promotions, restaurant } = data;
  if (!state.items.length) return refuse([{ field: 'items', ask: 'Your cart is empty. What would you like to order?' }]);
  if (!state.orderType) return refuse([{ field: 'orderType', ask: 'Is this order for pickup or delivery?' }]);

  const missing = missingDetails(state);
  if (!missing.length && state.orderType === 'delivery' && !state.addressConfirmed) {
    return refuse([{ field: 'addressConfirmation', ask: 'Let me read your delivery details back to you so you can confirm them.' }], { nextStep: 'readBackAddress' });
  }
  if (missing.length) return refuse(missing);

  const priced = computeTotals({ items: state.items, orderType: state.orderType, promoCode: state.discount ? state.discount.code : null }, { menu, promotions, restaurant });
  if (!priced.ok) return refuse([{ field: 'items', ask: priced.error.customerMessage }]);

  const items = state.items.map((line) => {
    const unitPrice = menu.items.find((i) => i.id === line.id).price;
    return { itemId: line.id, name: line.name, quantity: line.quantity, options: line.options, unitPrice, lineTotal: unitPrice * line.quantity };
  });
  const isDelivery = state.orderType === 'delivery';
  const a = state.customer.address;
  const review = {
    items,
    orderType: state.orderType,
    customer: isDelivery ? { name: state.customer.name, phone: state.customer.phone } : { name: state.customer.name },
    pickup: isDelivery ? null : { time: state.pickupTime || null },
    delivery: isDelivery
      ? { address: { block: a.block, house: a.house, street: a.street, apartment: a.apartment || null, landmark: a.landmark || null, instructions: a.instructions || null }, addressConfirmed: true }
      : null,
    promotion: priced.discount ? { code: priced.discount.code, name: priced.discount.name, amount: priced.discount.amount } : null,
    totals: { foodSubtotal: priced.foodSubtotal, discountAmount: priced.discountAmount, deliveryFee: priced.deliveryFee, tax: priced.tax, total: priced.total },
    currency: 'PKR',
    payment: isDelivery ? 'Cash on delivery' : 'Cash on pickup'
  };
  review.reviewVersion = versionOf({ ...review });
  review.customerMessage = reviewText(review, state, restaurant, priced);
  return { ok: true, review };
}

function reviewText(review, state, restaurant, priced) {
  const lines = ['Order review', 'Items:'];
  for (const item of review.items) lines.push(`${item.quantity} x ${item.name}${optionsText(item.options)} - ${item.lineTotal} PKR`);
  lines.push(`Order type: ${review.orderType === 'delivery' ? 'Delivery' : 'Pickup'}`);
  lines.push(`Name: ${review.customer.name}`);
  if (review.orderType === 'delivery') {
    const a = review.delivery.address;
    lines.push(`Phone: ${review.customer.phone}`);
    lines.push(`Delivery address: ${addressText(state, restaurant)}`);
    if (a.apartment) lines.push(`Apartment or unit: ${a.apartment}`);
    if (a.instructions) lines.push(`Delivery instructions: ${a.instructions}`);
  } else if (review.pickup.time) {
    lines.push(`Preferred pickup time: ${formatHHMM(review.pickup.time)} (we cannot promise the food will be ready at that time)`);
  }
  lines.push(...totalsLines(priced));
  lines.push(`Payment: ${review.payment.toLowerCase()}`);
  lines.push('Please check everything above. If it is all correct, press the "Confirm order" button below the chat. If you want to change something, tell me.');
  return lines.join('\n');
}

// The reviewVersion the order has right now, or null if it is not ready for review.
function currentReviewVersion(state, data) {
  const result = buildReview(state, data);
  return result.ok ? result.review.reviewVersion : null;
}

module.exports = { buildReview, currentReviewVersion, canonical };

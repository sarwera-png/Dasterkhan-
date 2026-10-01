// WhatsApp order channel (demo): instead of saving an order, the server builds a wa.me link whose text is the order, written ONLY by
// this code from the verified review. Nothing is stored and nothing is sent: the customer must open WhatsApp and press Send.
const crypto = require('crypto');
const { addressText, formatHHMM } = require('./checkout');
const { paymentLine } = require('./facts');

const HEADER = '[DEMO] کراچی دسترخوان — کورس کا ٹیسٹ آرڈر';
const MAX_MESSAGE_CHARS = 1500; // the whole link stays well below 2000 characters of plain text

// "03XXXXXXXXX", "+923XXXXXXXXX", "923XXXXXXXXX" (spaces, dashes and brackets ignored) -> "923XXXXXXXXX", else null.
function normalizeNumber(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/[\s\-()]/g, '');
  let m;
  if ((m = /^03(\d{9})$/.exec(t))) return '92' + '3' + m[1];
  if ((m = /^\+?923(\d{9})$/.exec(t))) return '923' + m[1];
  return null;
}
const orderNumber = () => normalizeNumber(process.env.WHATSAPP_ORDER_NUMBER);

// A short random reference (not sequential), like "KD-7F3A9".
function newRef() { return 'KD-' + crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase(); }

function optionsText(options) {
  const parts = Object.entries(options || {}).map(([name, choice]) => `${name}: ${choice}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

// The message text, from the review (never from the model).
function buildMessage(review, state, restaurant, ref) {
  const t = review.totals; const lines = [HEADER, `Ref: ${ref}`, 'Items:'];
  for (const item of review.items) lines.push(`${item.quantity} x ${item.name}${optionsText(item.options)} - ${item.lineTotal} PKR`);
  lines.push(`Food subtotal: ${t.foodSubtotal} PKR`);
  if (review.promotion && t.discountAmount > 0) lines.push(`Discount (${review.promotion.code}): -${t.discountAmount} PKR`);
  if (t.deliveryFee > 0) lines.push(`Delivery fee: ${t.deliveryFee} PKR`);
  if (t.tax > 0) lines.push(`Tax: ${t.tax} PKR`);
  lines.push(`Total: ${t.total} PKR`);
  lines.push(`Order type: ${review.orderType === 'delivery' ? 'Delivery' : 'Pickup'}`);
  lines.push(`Name: ${review.customer.name}`);
  if (review.orderType === 'delivery') {
    const a = review.delivery.address;
    lines.push(`Phone: ${review.customer.phone}`, `Address: ${addressText(state, restaurant)}`);
    if (a.apartment) lines.push(`Apartment or unit: ${a.apartment}`);
    if (a.instructions) lines.push(`Delivery instructions: ${a.instructions}`);
  } else if (review.pickup && review.pickup.time) {
    lines.push(`Preferred pickup time: ${formatHHMM(review.pickup.time)}`);
  }
  lines.push(`Payment: ${paymentLine(restaurant, review.orderType).toLowerCase()}`);
  return lines.join('\n');
}

const buildLink = (number, message) => `https://wa.me/${number}?text=${encodeURIComponent(message)}`;

module.exports = { HEADER, MAX_MESSAGE_CHARS, normalizeNumber, orderNumber, newRef, buildMessage, buildLink };

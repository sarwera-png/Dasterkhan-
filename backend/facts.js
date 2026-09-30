// Turns the facts in data/restaurant.json into the wording used in the assistant's instructions, in customer
// messages and on receipts. data/restaurant.json is the ONLY place these facts are written down.

function formatClock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === 12 && m === 0) return '12 noon';
  if (h === 0 && m === 0) return '12 midnight';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
}

function blocksRange(r) {
  const blocks = [...r.delivery.blocks].sort((a, b) => a - b);
  const min = blocks[0];
  const max = blocks[blocks.length - 1];
  return { min, max, contiguous: blocks.length === max - min + 1 };
}

function blocksText(r) {
  const { min, max, contiguous } = blocksRange(r);
  if (contiguous) return `Blocks ${min}–${max}`;
  const list = [...r.delivery.blocks].sort((a, b) => a - b);
  return `Blocks ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// "Cash on pickup" / "Cash on delivery" for one order type.
function paymentLine(r, orderType) {
  const when = r.payment.timing.replace('pickup or delivery', orderType === 'delivery' ? 'delivery' : 'pickup');
  return `${capitalize(r.payment.method)} ${when}`;
}

const URDU_PAYMENT = { cash: 'نقد' };
function paymentLineUrdu(r, orderType) {
  const place = orderType === 'delivery' ? 'ڈیلیوری' : 'پک اپ';
  return `${place} پر ${URDU_PAYMENT[r.payment.method] || r.payment.method}`;
}

function taxText(r) {
  return r.taxRate === 0 ? 'none (0%)' : `${Math.round(r.taxRate * 10000) / 100}%`;
}

// Everything the prompt template can use, as plain text.
function promptFacts(r) {
  return {
    NAME: r.name,
    AREA: r.area,
    CITY: r.city,
    HOURS: `daily from ${formatClock(r.hours.open)} to ${formatClock(r.hours.close)}`,
    DELIVERY_AREA: `${r.area} ${blocksText(r)} only`,
    DELIVERY_FEE: `${r.delivery.fee} ${r.currency}`,
    PICKUP_FEE: r.pickup.fee === 0 ? 'free' : `${r.pickup.fee} ${r.currency}`,
    PAYMENT: `${r.payment.method} only, ${r.payment.timing}`,
    TAX: taxText(r),
    PREPARATION_TIME_RULE: r.promisePreparationTime === false
      ? 'do not promise or estimate any preparation or delivery time'
      : 'only mention preparation times that the approved facts state'
  };
}

// Fills {{PLACEHOLDERS}} in the prompt template. An unknown placeholder is an error, never silently left in.
function renderPrompt(template, restaurant) {
  const facts = promptFacts(restaurant);
  const text = template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) => {
    if (!Object.prototype.hasOwnProperty.call(facts, key)) throw new Error(`unknown prompt placeholder ${key}`);
    return facts[key];
  });
  if (text.includes('{{')) throw new Error('malformed prompt placeholder');
  return text;
}

module.exports = { renderPrompt, promptFacts, formatClock, blocksRange, blocksText, paymentLine, paymentLineUrdu };

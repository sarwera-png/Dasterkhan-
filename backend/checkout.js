// Customer details for the order (pickup and, later, delivery). Everything is validated here in code;
// the model only passes on what the customer said and never fills in or guesses a missing detail.
const { fail } = require('./fail');
const { loadRestaurant } = require('./data');

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u;

// ---- time helpers -------------------------------------------------------------------------------

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(minutes) {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// Understands "19:30", "7:30 pm", "7pm", "noon". Returns { minutes } or { error: 'ambiguous' | 'invalid' }.
// A time without am/pm that could be either (like "7:30") is ambiguous: we never guess.
function parseTimeOfDay(input) {
  if (typeof input !== 'string') return { error: 'invalid' };
  const text = input.trim().toLowerCase().replace(/\./g, ':').replace(/:+$/, '');
  if (text === 'noon') return { minutes: 12 * 60 };
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a:m|p:m)?$/.exec(text.replace(/a:m/, 'am').replace(/p:m/, 'pm'));
  if (!match) return { error: 'invalid' };
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const suffix = match[3];
  if (minute > 59) return { error: 'invalid' };
  if (suffix) {
    if (hour < 1 || hour > 12) return { error: 'invalid' };
    hour = (hour % 12) + (suffix === 'pm' ? 12 : 0);
  } else {
    if (hour > 23) return { error: 'invalid' };
    // A zero-padded 24-hour time like "09:30" or "11:59" is clear. An unpadded "7:30" or "7" could be AM or PM: never guess.
    const padded24 = /^[01]\d:[0-5]\d$/.test(text) || /^2[0-3]:[0-5]\d$/.test(text);
    if (hour >= 1 && hour <= 11 && !padded24) return { error: 'ambiguous' };
  }
  return { minutes: hour * 60 + minute };
}

function hoursText(restaurant) {
  return `${formatTime(toMinutes(restaurant.hours.open))} to ${formatTime(toMinutes(restaurant.hours.close))}`;
}

// ---- validation ---------------------------------------------------------------------------------

function validateName(raw) {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (text.length < 2 || text.length > 60 || letters < 2 || !NAME_PATTERN.test(text)) {
    return { error: fail('invalid_name', "Sorry, I didn't catch that name. What name should I put on the order?", null,
      'The name must be 2 to 60 letters (spaces, dots, apostrophes and hyphens allowed). Nothing was stored. Do not make up a name.') };
  }
  return { value: text };
}

function validatePickupTime(raw) {
  const restaurant = loadRestaurant();
  const parsed = parseTimeOfDay(raw);
  if (parsed.error === 'ambiguous') {
    return { error: fail('ambiguous_time', 'Is that AM or PM?', null, 'Nothing was stored. Ask the customer; do not guess AM or PM.') };
  }
  if (parsed.error) {
    return { error: fail('invalid_time', "Sorry, I didn't understand that time. What time would you like to pick it up?", null, 'Nothing was stored.') };
  }
  const open = toMinutes(restaurant.hours.open);
  const close = toMinutes(restaurant.hours.close);
  if (parsed.minutes < open || parsed.minutes >= close) {
    return { error: fail('time_outside_hours', `Sorry, we're open daily from ${hoursText(restaurant)}, so I can only note a pickup time within those hours.`, null,
      'Nothing was stored. Ask for another time within opening hours, or say no preference.') };
  }
  const h = Math.floor(parsed.minutes / 60);
  const m = parsed.minutes % 60;
  return { value: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, minutes: parsed.minutes };
}

// ---- what is still missing ----------------------------------------------------------------------

// Details still needed for this order, asked one short question each. Nothing is ever guessed or filled in.
function missingDetails(state) {
  const missing = [];
  if (!state.orderType) return missing;
  if (!state.customer.name) missing.push({ field: 'name', ask: 'May I have your name for the order?' });
  return missing;
}

function optionalDetails(state) {
  const optional = [];
  if (state.orderType === 'pickup' && !state.pickupTime && !state.pickupTimeDeclined) {
    optional.push({ field: 'pickupTime', ask: 'Would you like to set a pickup time, or do you have no preference?' });
  }
  return optional;
}

// ---- tool ---------------------------------------------------------------------------------------

const declarations = [
  {
    name: 'setCustomerDetails',
    description:
      'Store the customer\'s order details, exactly as the customer said them. For pickup: name (required) and an optional pickup time. ' +
      'Only pass details the customer actually gave; never guess, invent or fill in a missing detail. The order type must be set first (setOrderType). ' +
      'The result lists missingDetails: ask the customer only for those, one short question at a time. Never ask a pickup customer for an address.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Customer name, as given' },
        pickupTime: { type: 'STRING', description: 'Preferred pickup time in 24-hour HH:MM (for example 19:30), only if the customer gave one' },
        noPickupTimePreference: { type: 'BOOLEAN', description: 'true if the customer said they have no pickup time preference' }
      }
    }
  }
];

function setCustomerDetails(args, ctx) {
  const state = ctx.state;
  if (!state.orderType) {
    return fail('order_type_needed', 'Is this order for pickup or delivery?', null,
      'Nothing was stored. Ask; do not assume. After the customer answers in their own words, call setOrderType.');
  }
  const has = (v) => v !== undefined && v !== null && v !== '';
  const updates = {};
  const notes = [];

  if (has(args.name)) {
    const v = validateName(args.name);
    if (v.error) return v.error;
    updates.name = v.value;
  }
  if (args.noPickupTimePreference === true) {
    if (state.orderType === 'pickup') updates.pickupTimeDeclined = true;
  } else if (has(args.pickupTime)) {
    if (state.orderType !== 'pickup') {
      notes.push('A pickup time does not apply to delivery orders. It was ignored. Do not promise any delivery time.');
    } else {
      const v = validatePickupTime(args.pickupTime);
      if (v.error) return v.error;
      updates.pickupTime = v.value;
      updates.pickupTimeMinutes = v.minutes;
    }
  }
  if (Object.keys(updates).length === 0) {
    const missing = missingDetails(state);
    return fail('nothing_to_store', missing.length ? missing[0].ask : 'What would you like to tell me?', { missingDetails: missing },
      'Nothing was stored. Only pass details the customer actually gave.');
  }

  if (updates.name !== undefined) state.customer.name = updates.name;
  if (updates.pickupTime !== undefined) {
    state.pickupTime = updates.pickupTime;
    state.pickupTimeDeclined = false;
  }
  if (updates.pickupTimeDeclined) {
    state.pickupTime = null;
    state.pickupTimeDeclined = true;
  }

  const missing = missingDetails(state);
  const optional = optionalDetails(state);
  const parts = [];
  if (updates.name !== undefined) parts.push(`Thanks, ${state.customer.name}.`);
  if (updates.pickupTime !== undefined) {
    parts.push(`I've noted ${formatTime(toMinutes(state.pickupTime))} as your preferred pickup time. I can't promise the food will be ready at that time.`);
  }
  if (updates.pickupTimeDeclined) parts.push('No problem, no pickup time preference noted.');
  if (missing.length) parts.push(missing.map((m) => m.ask).join(' '));
  else if (optional.length) parts.push(optional[0].ask);

  return {
    ok: true,
    stored: Object.keys(updates).filter((k) => k !== 'pickupTimeMinutes'),
    missingDetails: missing,
    optionalDetails: optional,
    customerMessage: parts.join(' '),
    ...(notes.length ? { internalNote: notes.join(' ') } : {})
  };
}

const handlers = { setCustomerDetails };

module.exports = { declarations, handlers, missingDetails, optionalDetails, parseTimeOfDay, formatTime, validateName };

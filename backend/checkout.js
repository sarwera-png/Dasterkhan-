// Customer details for the order (pickup and delivery). Everything is validated here in code;
// the model only passes on what the customer said and never fills in or guesses a missing detail.
const { fail } = require('./fail');
const { loadRestaurant } = require('./data');
const { isClearYes } = require('./confirm');
const { blocksRange } = require('./facts');

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

// "19:30" -> "7:30 PM"
function formatHHMM(hhmm) {
  return formatTime(toMinutes(hhmm));
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

// Pakistani mobile: 03XXXXXXXXX or +923XXXXXXXXX (spaces and dashes allowed). Stored as 03XXXXXXXXX.
function validatePhone(raw) {
  const compact = typeof raw === 'string' ? raw.replace(/[\s\-()]/g, '') : '';
  let local = null;
  if (/^03\d{9}$/.test(compact)) local = compact;
  else if (/^\+923\d{9}$/.test(compact)) local = `0${compact.slice(3)}`;
  if (!local) {
    return { error: fail('invalid_phone', "Sorry, that doesn't look like a Pakistani mobile number. Please share it like 03XX XXXXXXX.", null,
      'Nothing was stored. Ask again. Do not guess, complete or change any digits.') };
  }
  return { value: local };
}

function cleanLine(raw, { min = 1, max, pattern } = {}) {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) raw = String(raw); // models often send "12" as the number 12
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (text.length < min || text.length > max || /[\u0000-\u001f\u007f]/.test(text) || (pattern && !pattern.test(text))) return null;
  return text;
}

// A whole address in one text, accepted ONLY when every part is clearly labelled: "Block 3, house 12-B, Street 4". The parts are then
// validated exactly like separately given fields. Anything that cannot be read with certainty returns null (nothing is guessed).
function parseAddressString(raw, restaurant) {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  const out = {};
  const put = (key, value) => { if (out[key] !== undefined) return false; out[key] = value; return true; };
  const segments = raw.split(/[,;\n،]+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (segments.length === 0) return null;
  for (const seg of segments) {
    let m;
    if ((m = /^(?:block|blk|بلاک)\s*(?:no\.?|number|#|-)?\s*(\S+)$/i.exec(seg))) { if (!put('block', m[1])) return null; }
    else if ((m = /^(?:house|flat)\s*(?:no\.?|number|#|-)?\s*(\S.*)$/i.exec(seg))) { if (!put('houseOrFlat', m[1])) return null; }
    else if (/^(?:street|st\.?|road|rd\.?|lane|gali|گلی)\s*(?:no\.?|number|#)?\s*\S+/i.test(seg) || /\S\s+(?:street|road|rd\.?|lane|avenue|ave\.?)$/i.test(seg)) { if (!put('street', seg)) return null; }
    else if (isInArea(seg, restaurant)) { if (!put('area', seg)) return null; }
    else if (/^(?:karachi|pakistan)$/i.test(seg)) { /* city or country name: nothing to store */ }
    else return null;
  }
  return out;
}

const HOUSE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}\s\-\/#.,]*$/u;
const STREET_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}\s\-\/#.,'’]*$/u;

// "3", "Block 3", "Block-3", "block no 3", "blk 3", "بلاک 3" -> 3. Bare "-1", "0", negatives, decimals and anything else
// ("13-D", "three-ish") are not understood: we ask again. (A bare whole number is accepted because the model passes it in the block field.)
function parseBlock(raw) {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const m = /^(?:(?:block|blk|بلاک)(?:-|\s*#\s*|\s*(?:no\.?|number)\s*|\s+)?)?([1-9]\d?)$/.exec(text);
  return m ? Number(m[1]) : null;
}

function isInArea(raw, restaurant) {
  const text = typeof raw === 'string' ? raw.toLowerCase() : '';
  return restaurant.areaAliases.some((alias) => text.includes(alias.toLowerCase())) || text.includes(restaurant.area.toLowerCase());
}

function outsideAreaError(restaurant) {
  const blocks = restaurant.delivery.blocks;
  return fail('outside_delivery_area',
    `Sorry, we deliver only to ${restaurant.area} Blocks ${Math.min(...blocks)} to ${Math.max(...blocks)}. Would you like to order for pickup instead?`, null,
    'Delivery was refused and nothing was stored for this address. Offer pickup, but do not switch the order type yourself: the customer must choose.');
}

// Delivery details the customer has to confirm. Any change to them (or to the order type) cancels the confirmation.
function detailsSnapshot(state) {
  return JSON.stringify({ t: state.orderType, n: state.customer.name, p: state.customer.phone, a: state.customer.address });
}

function invalidateAddressConfirmation(state) {
  state.addressConfirmed = false;
  state.addressReadBack = false;
}

// ---- what is still missing ----------------------------------------------------------------------

// Details still needed for this order, asked one short question each. Nothing is ever guessed or filled in.
function missingDetails(state) {
  const missing = [];
  if (!state.orderType) return missing;
  if (!state.customer.name) missing.push({ field: 'name', ask: 'May I have your name for the order?' });
  if (state.orderType === 'delivery') {
    const a = state.customer.address || {};
    if (!state.customer.phone) missing.push({ field: 'phone', ask: 'What is the best mobile number to reach you? (for example 03XX XXXXXXX)' });
    const { min, max } = blocksRange(loadRestaurant());
    if (!a.block) missing.push({ field: 'block', ask: `Which block of ${loadRestaurant().area} is it in (${min} to ${max})?` });
    if (!a.house) missing.push({ field: 'house', ask: 'What is the house or flat number?' });
    if (!a.street) missing.push({ field: 'street', ask: 'Which street is it on?' });
  }
  return missing;
}

// Questions for the customer, in one message: several missing address parts are asked together.
function askText(missing) {
  const addressFields = missing.filter((m) => ['block', 'house', 'street'].includes(m.field));
  const others = missing.filter((m) => !['block', 'house', 'street'].includes(m.field));
  const asks = others.map((m) => m.ask);
  if (addressFields.length >= 2) {
    asks.push(`Please tell me the ${addressFields.map((m) => ({ block: `block number (${blocksRange(loadRestaurant()).min} to ${blocksRange(loadRestaurant()).max})`, house: 'house or flat number', street: 'street' }[m.field])).join(', ').replace(/, ([^,]*)$/, ' and $1')} for the delivery address.`);
  } else {
    asks.push(...addressFields.map((m) => m.ask));
  }
  return asks.join(' ');
}

function optionalDetails(state) {
  const optional = [];
  if (state.orderType === 'pickup' && !state.pickupTime && !state.pickupTimeDeclined) {
    optional.push({ field: 'pickupTime', ask: 'Would you like to set a pickup time, or do you have no preference?' });
  }
  if (state.orderType === 'delivery' && !state.addressExtrasDeclined) {
    const a = state.customer.address || {};
    if (!a.apartment || !a.instructions) {
      optional.push({ field: 'extras', ask: 'Is there an apartment or unit number, or any delivery instructions? (You can say no.)' });
    }
  }
  return optional;
}

// ---- tool ---------------------------------------------------------------------------------------

const declarations = [
  {
    name: 'setCustomerDetails',
    description:
      'Store the customer\'s order details, exactly as the customer said them. Pickup: name (required) and an optional pickup time. ' +
      'Delivery: name, mobile phone and a full address (block number, house or flat number, street), plus an optional apartment or unit and delivery instructions. ' +
      'Only pass details the customer actually gave; never guess, invent or fill in a missing detail. A landmark alone is not an address. The order type must be set first (setOrderType). ' +
      'The result lists missingDetails: ask the customer only for those. Never ask a pickup customer for an address or phone number.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Customer name, as given' },
        pickupTime: { type: 'STRING', description: 'Preferred pickup time in 24-hour HH:MM (for example 19:30), only if the customer gave one' },
        noPickupTimePreference: { type: 'BOOLEAN', description: 'true if the customer said they have no pickup time preference' },
        phone: { type: 'STRING', description: 'Delivery only: mobile number exactly as given, like 03001234567 or +923001234567' },
        area: { type: 'STRING', description: 'Delivery only: the area or locality the customer named, if any' },
        block: { type: 'STRING', description: 'Delivery only: the block number, for example 3' },
        houseOrFlat: { type: 'STRING', description: 'Delivery only: house or flat number, as given' },
        street: { type: 'STRING', description: 'Delivery only: street name or number, as given' },
        apartment: { type: 'STRING', description: 'Delivery only: apartment or unit, if the customer gave one' },
        landmark: { type: 'STRING', description: 'Delivery only: a nearby landmark, if the customer gave one. It is not a replacement for the address.' },
        instructions: { type: 'STRING', description: 'Delivery only: delivery instructions, if the customer gave some' },
        noExtraAddressDetails: { type: 'BOOLEAN', description: 'true if the customer said they have no apartment/unit or delivery instructions' }
      }
    }
  },
  {
    name: 'readBackAddress',
    description:
      'Delivery orders only. Once all delivery details are complete, call this to get the full captured name, phone and address written out by the system. ' +
      'Show it to the customer exactly as returned and ask them to say yes or tell you what to change. Do this before the order review.'
  },
  {
    name: 'confirmAddress',
    description:
      'Call this ONLY when the customer has just clearly said yes to the address you read back. The system checks the customer\'s actual message itself. ' +
      'If the customer wanted a change, do not call this: use setCustomerDetails and then readBackAddress again. Confirming the address does not place or save an order.'
  }
];

function setCustomerDetails(args, ctx) {
  const state = ctx.state;
  if (!state.orderType) {
    return fail('order_type_needed', 'Is this order for pickup or delivery?', null,
      'Nothing was stored. Ask; do not assume. After the customer answers in their own words, call setOrderType.');
  }
  const has = (v) => v !== undefined && v !== null && v !== '';
  const before = detailsSnapshot(state);
  const restaurant = loadRestaurant();
  const isDelivery = state.orderType === 'delivery';
  const updates = {};
  const address = {};
  const notes = [];

  if (has(args.name)) {
    const v = validateName(args.name);
    if (v.error) return v.error;
    updates.name = v.value;
  }

  // ---- pickup-only details
  if (args.noPickupTimePreference === true) {
    if (!isDelivery) updates.pickupTimeDeclined = true;
  } else if (has(args.pickupTime)) {
    if (isDelivery) {
      notes.push('A pickup time does not apply to delivery orders. It was ignored. Do not promise any delivery time.');
    } else {
      const v = validatePickupTime(args.pickupTime);
      if (v.error) return v.error;
      updates.pickupTime = v.value;
    }
  }

  // ---- delivery-only details (ignored for pickup, never asked for)
  const deliveryFields = ['phone', 'area', 'address', 'block', 'houseOrFlat', 'street', 'apartment', 'landmark', 'instructions'];
  if (!isDelivery && (deliveryFields.some((f) => has(args[f])) || args.noExtraAddressDetails === true)) {
    notes.push('Address and phone details are not needed for pickup and were ignored. Do not ask for them.');
  }
  if (isDelivery) {
    if (has(args.address)) {
      // The model sent the whole address as one text instead of separate parts: read it only if every part is labelled, else ask.
      const parsed = parseAddressString(args.address, restaurant);
      if (!parsed) return fail('invalid_address', "Sorry, I couldn't read that address clearly. Please tell me the block number, the house or flat number and the street.", null, 'Nothing was stored. Pass the parts separately (block, houseOrFlat, street) exactly as the customer said them; do not guess.');
      args = { ...args };
      for (const key of ['area', 'block', 'houseOrFlat', 'street']) if (!has(args[key]) && parsed[key] !== undefined) args[key] = parsed[key]; // separately given fields win
    }
    if (has(args.area) && !isInArea(args.area, restaurant)) return outsideAreaError(restaurant);
    if (has(args.block)) {
      const block = parseBlock(args.block);
      if (block === null) {
        return fail('invalid_block', `Which block is it, from ${Math.min(...restaurant.delivery.blocks)} to ${Math.max(...restaurant.delivery.blocks)}?`, null,
          'Nothing was stored. The block must be a plain number. Do not guess it.');
      }
      if (!restaurant.delivery.blocks.includes(block)) return outsideAreaError(restaurant);
      address.block = block;
    }
    if (has(args.houseOrFlat)) {
      const houseRaw = cleanLine(args.houseOrFlat, { max: 40, pattern: HOUSE_PATTERN });
      const house = houseRaw && houseRaw.replace(/^(?:house|flat)\s*(?:no\.?|number|#|-)?\s*(?=\S)/i, '') || houseRaw; // "house 12-B" -> "12-B" (the label already says house or flat)
      if (!house) return fail('invalid_address', "Sorry, I didn't catch the house or flat number. What is it?", null, 'Nothing was stored. Do not guess it.');
      address.house = house;
    }
    if (has(args.street)) {
      const street = cleanLine(args.street, { min: 1, max: 80, pattern: STREET_PATTERN });
      if (!street) return fail('invalid_address', "Sorry, I didn't catch the street. Which street is it on?", null, 'Nothing was stored. Do not guess it.');
      address.street = street;
    }
    if (has(args.apartment)) {
      const apartment = cleanLine(args.apartment, { max: 40, pattern: HOUSE_PATTERN });
      if (!apartment) return fail('invalid_address', "Sorry, I didn't catch the apartment or unit. What is it?", null, 'Nothing was stored.');
      address.apartment = apartment;
    }
    if (has(args.landmark)) {
      const landmark = cleanLine(args.landmark, { max: 80 });
      if (!landmark) return fail('invalid_address', "Sorry, I didn't catch that landmark. Could you say it again?", null, 'Nothing was stored.');
      address.landmark = landmark;
    }
    if (has(args.instructions)) {
      const instructions = cleanLine(args.instructions, { max: 200 });
      if (!instructions) return fail('invalid_address', "Sorry, those delivery instructions are too long or unclear. Could you shorten them?", null, 'Nothing was stored.');
      address.instructions = instructions;
    }
    if (has(args.phone)) {
      const v = validatePhone(args.phone);
      if (v.error) return v.error;
      updates.phone = v.value;
    }
    if (args.noExtraAddressDetails === true) updates.addressExtrasDeclined = true;
  }

  if (Object.keys(updates).length === 0 && Object.keys(address).length === 0) {
    const missing = missingDetails(state);
    return fail('nothing_to_store', missing.length ? askText(missing) : 'What would you like to tell me?', { missingDetails: missing },
      'Nothing was stored. Only pass details the customer actually gave.');
  }

  // ---- all checks passed: store (nothing above changed the state)
  if (updates.name !== undefined) state.customer.name = updates.name;
  if (updates.phone !== undefined) state.customer.phone = updates.phone;
  if (updates.pickupTime !== undefined) {
    state.pickupTime = updates.pickupTime;
    state.pickupTimeDeclined = false;
  }
  if (updates.pickupTimeDeclined) {
    state.pickupTime = null;
    state.pickupTimeDeclined = true;
  }
  if (updates.addressExtrasDeclined) state.addressExtrasDeclined = true;
  if (Object.keys(address).length) {
    state.customer.address = { block: null, house: null, street: null, apartment: null, landmark: null, instructions: null, ...(state.customer.address || {}) };
    Object.assign(state.customer.address, address);
  }

  if (detailsSnapshot(state) !== before) invalidateAddressConfirmation(state); // any change needs a fresh read-back and yes

  const missing = missingDetails(state);
  const optional = optionalDetails(state);
  const parts = [];
  if (updates.name !== undefined) parts.push(`Thanks, ${state.customer.name}.`);
  else if (Object.keys(address).length || updates.phone !== undefined) parts.push('Thanks.');
  if (updates.pickupTime !== undefined) {
    parts.push(`I've noted ${formatTime(toMinutes(state.pickupTime))} as your preferred pickup time. I can't promise the food will be ready at that time.`);
  }
  if (updates.pickupTimeDeclined) parts.push('No problem, no pickup time preference noted.');
  if (address.landmark && missing.some((m) => ['block', 'house', 'street'].includes(m.field))) {
    parts.push('A landmark helps, but I also need the full address.');
  }
  if (missing.length) parts.push(askText(missing));
  else if (optional.length) parts.push(optional[0].ask);

  return {
    ok: true,
    stored: [...Object.keys(updates), ...Object.keys(address)],
    missingDetails: missing,
    optionalDetails: optional,
    ...(isDelivery ? { addressConfirmed: state.addressConfirmed } : {}),
    customerMessage: parts.join(' '),
    ...(notes.length ? { internalNote: notes.join(' ') } : {})
  };
}

// ---- address read-back and confirmation (delivery) ----------------------------------------------

function addressText(state, restaurant) {
  const a = state.customer.address;
  return [`House or flat ${a.house}`, a.street, `Block ${a.block}`, `${restaurant.area}, ${restaurant.city}`].join(', ');
}

// The code builds the read-back text from the stored data, so the customer always sees exactly what is stored.
function readBackAddress(args, ctx) {
  const state = ctx.state;
  if (state.orderType !== 'delivery') {
    return fail('not_delivery', 'An address is only needed for delivery orders.', null, 'Nothing to confirm. Do not ask a pickup customer for an address.');
  }
  const missing = missingDetails(state);
  if (missing.length) {
    return fail('details_incomplete', askText(missing), { missingDetails: missing }, 'The delivery details are not complete yet. Ask only for these, then read the address back.');
  }
  const restaurant = loadRestaurant();
  const a = state.customer.address;
  const lines = [
    'Please check your delivery details:',
    `Name: ${state.customer.name}`,
    `Phone: ${state.customer.phone}`,
    `Address: ${addressText(state, restaurant)}`,
    ...(a.apartment ? [`Apartment or unit: ${a.apartment}`] : []),
    ...(a.instructions ? [`Delivery instructions: ${a.instructions}`] : []),
    ...(a.landmark ? [`Landmark: ${a.landmark}`] : []),
    'Is this correct? Please say yes, or tell me what to change.'
  ];
  state.addressReadBack = true;
  state.addressConfirmed = false;
  return {
    ok: true,
    awaitingConfirmation: true,
    customerMessage: lines.join('\n'),
    internalNote: 'Show these details to the customer exactly as written (translate only the labels if needed, never the values). The address is NOT confirmed yet. Do not call confirmAddress until the customer clearly says yes. If they want a change, use setCustomerDetails and then read the address back again.'
  };
}

// Stores addressConfirmed = true only after a clear yes. The code checks the customer's actual latest message:
// what the model claims they said is never used. Confirming the address does not create an order.
function confirmAddress(args, ctx) {
  const state = ctx.state;
  if (state.orderType !== 'delivery') {
    return fail('not_delivery', 'An address is only needed for delivery orders.', null, 'Nothing to confirm.');
  }
  if (!state.addressReadBack) {
    return fail('address_not_read_back', "Let me read your delivery details back to you first.", null, 'Call readBackAddress first, show the result, and wait for the customer to answer.');
  }
  if (!isClearYes(ctx.latestMessage)) {
    return fail('not_clear_yes', 'Just to be sure: is the address correct? Please say yes, or tell me what to change.', null,
      'The customer has not clearly said yes. Nothing was confirmed. A message like ok, theek hai, hmm or maybe is not a yes.');
  }
  state.addressConfirmed = true;
  return { ok: true, addressConfirmed: true, orderCreated: false, customerMessage: 'Thank you, your delivery address is confirmed.' };
}

const handlers = { setCustomerDetails, readBackAddress, confirmAddress };

module.exports = { declarations, handlers, missingDetails, optionalDetails, askText, addressText, formatHHMM, invalidateAddressConfirmation, detailsSnapshot, parseTimeOfDay, formatTime, validateName, validatePhone, parseBlock };

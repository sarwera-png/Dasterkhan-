// Tools the assistant can call (Gemini function calling). All validation is done here in code,
// against data/menu.json, never by the model. Every tool returns { ok: true, ... } or { ok: false, error, customerMessage, internalNote }.
const { loadMenu, loadRecommendations, loadPromotions, loadRestaurant } = require('./data');
const { computeTotals, totalsLines, foodSubtotal, checkEligibility, computeDiscount } = require('./pricing');
const { fail, normalize } = require('./fail');
const checkout = require('./checkout');
const { buildReview } = require('./review');

const MAX_QUANTITY = 100; // technical sanity limit per cart line, not a business rule

const OPTIONS_SCHEMA = {
  type: 'ARRAY',
  description: 'The customer\'s choices for the item\'s required options, e.g. [{"name":"spice","choice":"mild"}]. Leave empty if the item has no required options.',
  items: {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING', description: 'Option name, e.g. spice' },
      choice: { type: 'STRING', description: 'The chosen value, e.g. mild' }
    },
    required: ['name', 'choice']
  }
};

const TOOL_DECLARATIONS = [
  {
    name: 'getMenu',
    description:
      'Get the current menu: only the items that are available now, with id, name, price and required options. ' +
      'Call this when the customer asks what is on the menu, asks about prices, or asks for something you are not sure exists.'
  },
  {
    name: 'addItemToCart',
    description:
      'Add a menu item to the customer\'s cart. Call it only when the customer clearly asks to add the item and you know the quantity. ' +
      'If the item has required options that the customer has not chosen, call it anyway without them: the tool will say which options are needed, and you must then ask the customer. Never guess a quantity or an option.',
    parameters: {
      type: 'OBJECT',
      properties: {
        itemId: { type: 'STRING', description: 'Menu item id, e.g. BRY01' },
        quantity: { type: 'INTEGER', description: 'How many the customer wants (1 or more)' },
        options: OPTIONS_SCHEMA
      },
      required: ['itemId', 'quantity']
    }
  },
  {
    name: 'modifyItem',
    description:
      'Change the quantity and/or the option choices of a line that is already in the cart. Use it when the customer says things like "make it 2" or "change the spice to regular". ' +
      '"quantity" is the NEW total for that line (not an amount to add). Do not use it to add a new item (use addItemToCart) or to remove one (use removeItem).',
    parameters: {
      type: 'OBJECT',
      properties: {
        itemId: { type: 'STRING', description: 'Menu item id of the cart line to change, e.g. BRY01' },
        quantity: { type: 'INTEGER', description: 'The new quantity for the line (1 or more)' },
        options: OPTIONS_SCHEMA,
        currentOptions: { ...OPTIONS_SCHEMA, description: 'Only needed when the cart has several lines of the same item with different options: the options of the line to change, so it can be identified.' },
        lineId: { type: 'STRING', description: 'Optional cart line id (e.g. L1) if known from a previous tool result' }
      },
      required: ['itemId']
    }
  },
  {
    name: 'removeItem',
    description:
      'Remove an item from the cart, or reduce its quantity. With no quantity the whole line is removed. ' +
      'With a quantity, that many are taken off (removing all of them removes the line). Use it when the customer says things like "remove the raita" or "one less biryani".',
    parameters: {
      type: 'OBJECT',
      properties: {
        itemId: { type: 'STRING', description: 'Menu item id of the cart line, e.g. RAI01' },
        quantity: { type: 'INTEGER', description: 'How many to take off (1 or more). Leave out to remove the whole line.' },
        currentOptions: { ...OPTIONS_SCHEMA, description: 'Only needed when the cart has several lines of the same item with different options: the options of the line to change, so it can be identified.' },
        lineId: { type: 'STRING', description: 'Optional cart line id (e.g. L1) if known from a previous tool result' }
      },
      required: ['itemId']
    }
  },
  {
    name: 'viewCart',
    description:
      'Get the current cart as an itemized summary (items, quantities and options). Call it whenever the customer asks what is in their cart or asks you to read the order back. ' +
      'Never describe the cart from memory: always use this tool. It does not show prices or totals.'
  },
  {
    name: 'getRecommendations',
    description:
      'Get at most 1-2 real menu items that could go with what is in the cart, to offer to the customer. Suggestions only: never add a suggested item unless the customer clearly says yes. ' +
      'If the customer just said no to a suggestion, call this again with declinedItemIds so it is never suggested again, and do not push another suggestion in the same reply.',
    parameters: {
      type: 'OBJECT',
      properties: {
        declinedItemIds: {
          type: 'ARRAY',
          description: 'Menu item ids of suggestions the customer has just declined',
          items: { type: 'STRING' }
        }
      }
    }
  },
  {
    name: 'applyPromotion',
    description:
      'Apply a promo code that the CUSTOMER gave you. Never make up or suggest codes. The tool checks the code and the order against the real promotion rules and tells you the discount or why it cannot be applied. ' +
      'Discounts apply to the food subtotal only, never the delivery fee, and only one code per order. ' +
      'If the code depends on pickup or delivery and the customer has not said which, the tool asks for it: then ask the customer, and only after they answer call setOrderType.',
    parameters: {
      type: 'OBJECT',
      properties: {
        code: { type: 'STRING', description: 'The promo code exactly as the customer gave it' }
      },
      required: ['code']
    }
  },
  {
    name: 'getOrderReview',
    description:
      'Get the final order review, written by the system: items, quantities, options, order type, pickup or delivery details, promotion, subtotal, discount, delivery fee and total. ' +
      'Call it when the customer says they are done adding items or asks to order or check out, after the order type and all details are set (and, for delivery, the address is confirmed). ' +
      'If something is still missing the result lists it: ask for that. Show the review exactly as returned, then invite the customer to press the "Confirm order" button below the chat.',
  },
  {
    name: 'setOrderType',
    description:
      'Record whether the order is for pickup or delivery. Call this ONLY when the customer has explicitly said "pickup" or "delivery" (or clearly the same thing) in their own words. ' +
      'Never assume, guess or default it, and never call it just so that a promo code can be applied. Calling it re-checks any applied promo code.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderType: { type: 'STRING', description: 'Exactly "pickup" or "delivery", as the customer said it' }
      },
      required: ['orderType']
    }
  }
].concat(checkout.declarations);

// Finds a menu item by id or exact name (case-insensitive). Returns null if there is no such item.
function findMenuItem(menu, idOrName) {
  const key = normalize(idOrName);
  if (!key) return null;
  return menu.items.find((item) => normalize(item.id) === key || normalize(item.name) === key) || null;
}

function validateItem(menu, itemId) {
  const item = findMenuItem(menu, itemId);
  if (!item) {
    const available = menu.items.filter((i) => i.available === true).map((i) => `${i.id} (${i.name})`);
    return { error: fail('unknown_item', "Sorry, that item isn't on our menu.", { availableItems: available },
      'Do not offer, add or promise this item. Suggest only real items from availableItems.') };
  }
  if (item.available !== true) {
    return { error: fail('item_unavailable', `Sorry, ${item.name} isn't available right now.`, null, 'Do not add it. Suggest an available item from the menu instead.') };
  }
  return { item };
}

function validateQuantity(quantity) {
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    return fail('invalid_quantity', 'Quantity must be a whole number, at least 1.', null, 'Nothing was changed. Ask the customer how many they want.');
  }
  if (quantity > MAX_QUANTITY) {
    return fail('invalid_quantity', `Sorry, the most I can add for one item is ${MAX_QUANTITY}. For larger orders please ask our staff.`, null, 'Technical limit per cart line. Nothing was changed.');
  }
  return null;
}

// Checks the customer's option choices against the item's required options in the menu data.
// Returns { options } (canonical names and choices) or { error }.
function validateOptions(item, optionList) {
  const required = item.requiredOptions || [];
  if (optionList !== undefined && optionList !== null && !Array.isArray(optionList)) {
    return { error: fail('invalid_option', "Sorry, I didn't understand those choices. Could you tell me again?", null, 'Options must be a list of {name, choice}. Nothing was changed.') };
  }
  const chosen = {};
  for (const entry of optionList || []) {
    const spec = entry && required.find((r) => normalize(r.name) === normalize(entry.name));
    if (!spec) {
      const names = required.map((r) => r.name);
      return { error: fail('invalid_option', names.length
        ? `Sorry, ${item.name} doesn't have that option. Its options are: ${names.join(', ')}.`
        : `Sorry, ${item.name} has no options to choose.`, null, 'Do not add options that are not listed. Nothing was changed.') };
    }
    const choice = spec.choices.find((c) => normalize(c) === normalize(entry.choice));
    if (!choice) {
      return { error: fail('invalid_option_choice', `Sorry, that isn't a choice for ${spec.name}. Please choose ${spec.choices.join(' or ')}.`,
        { missingOptions: [{ name: spec.name, choices: spec.choices }] }, 'Ask the customer to pick one of the listed choices. Nothing was changed.') };
    }
    if (chosen[spec.name] !== undefined && chosen[spec.name] !== choice) {
      return { error: fail('invalid_option', `I got two different ${spec.name} choices. Which one would you like?`, null, 'Nothing was changed.') };
    }
    chosen[spec.name] = choice;
  }
  const missing = required.filter((r) => chosen[r.name] === undefined).map((r) => ({ name: r.name, choices: r.choices }));
  if (missing.length) {
    return { error: fail('missing_options', missing.map((m) => `Please choose your ${m.name}: ${m.choices.join(' or ')}.`).join(' '),
      { missingOptions: missing }, 'Ask the customer to choose; do not guess. The item has not been added yet.') };
  }
  return { options: chosen };
}

const sameOptions = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

function lineView(line) {
  return { lineId: line.lineId, itemId: line.id, name: line.name, quantity: line.quantity, options: line.options };
}

function getMenu() {
  const menu = loadMenu();
  const currency = menu.currency || 'PKR';
  const items = menu.items
    .filter((item) => item.available === true)
    .map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      priceText: `${item.price} ${currency}`,
      requiredOptions: item.requiredOptions || []
    }));
  return { ok: true, currency, items };
}

function addItemToCart(args, ctx) {
  const menu = loadMenu();
  const { item, error } = validateItem(menu, args.itemId);
  if (error) return error;
  const quantityError = validateQuantity(args.quantity);
  if (quantityError) return quantityError;
  const checked = validateOptions(item, args.options);
  if (checked.error) return checked.error;

  const cart = ctx.state.items;
  const existing = cart.find((line) => line.id === item.id && sameOptions(line.options, checked.options));
  if (existing) {
    if (existing.quantity + args.quantity > MAX_QUANTITY) {
      return fail('invalid_quantity', `You already have ${existing.quantity} of this in your cart, and the most I can put on one line is ${MAX_QUANTITY}. For larger orders please ask our staff.`, null, 'Nothing was changed.');
    }
    existing.quantity += args.quantity; // same item and options: one line, never a duplicate
    return { ok: true, mergedIntoExistingLine: true, line: lineView(existing), cartLineCount: cart.length, customerMessage: `Updated: you now have ${describeLine(existing)} in your cart.` };
  }
  ctx.state.lineCounter += 1;
  const line = { lineId: `L${ctx.state.lineCounter}`, id: item.id, name: item.name, quantity: args.quantity, options: checked.options };
  cart.push(line);
  return { ok: true, mergedIntoExistingLine: false, line: lineView(line), cartLineCount: cart.length, customerMessage: `Added ${describeLine(line)} to your cart.` };
}

// Finds the one cart line the customer means. Returns { line } or { error }.
function findCartLine(cart, args) {
  if (args.lineId !== undefined && args.lineId !== null && args.lineId !== '') {
    const byId = cart.find((line) => line.lineId === args.lineId);
    return byId ? { line: byId } : { error: fail('not_in_cart', "Sorry, I couldn't find that item in your cart.", null, 'There is no cart line with that lineId. Nothing was changed.') };
  }
  const key = normalize(args.itemId);
  let candidates = cart.filter((line) => normalize(line.id) === key || normalize(line.name) === key);
  if (candidates.length === 0) {
    return { error: fail('not_in_cart', "Sorry, that item isn't in your cart.", null, 'Nothing was changed. If the customer wants it, use addItemToCart.') };
  }
  if (candidates.length > 1 && Array.isArray(args.currentOptions)) {
    const wanted = {};
    for (const entry of args.currentOptions) {
      if (entry && typeof entry.name === 'string' && typeof entry.choice === 'string') wanted[normalize(entry.name)] = normalize(entry.choice);
    }
    candidates = candidates.filter((line) => Object.entries(wanted).every(([name, choice]) =>
      Object.entries(line.options).some(([n, c]) => normalize(n) === name && normalize(c) === choice)));
  }
  if (candidates.length > 1) {
    return { error: fail('ambiguous_line', `You have more than one ${candidates[0].name} in your cart with different options. Which one do you mean?`,
      { lines: candidates.map(lineView) }, 'Ask which one, then retry with currentOptions or lineId. Nothing was changed.') };
  }
  if (candidates.length === 0) {
    return { error: fail('not_in_cart', "Sorry, I couldn't find that version of the item in your cart.", null, 'No cart line of that item has those options. Nothing was changed.') };
  }
  return { line: candidates[0] };
}

function modifyItem(args, ctx) {
  const cart = ctx.state.items;
  const found = findCartLine(cart, args);
  if (found.error) return found.error;
  const line = found.line;

  const quantityGiven = args.quantity !== undefined && args.quantity !== null;
  const optionsGiven = Array.isArray(args.options) && args.options.length > 0;
  if (!quantityGiven && !optionsGiven) {
    return fail('nothing_to_change', 'What would you like to change: the quantity or an option?', null, 'Nothing was changed.');
  }

  const { item, error } = validateItem(loadMenu(), line.id);
  if (error) return error;

  let newQuantity = line.quantity;
  if (quantityGiven) {
    const quantityError = validateQuantity(args.quantity);
    if (quantityError) return quantityError;
    newQuantity = args.quantity;
  }

  let newOptions = line.options;
  if (optionsGiven) {
    // Keep the options that were not mentioned, replace the ones that were, then validate the whole set.
    const combined = Object.entries(line.options).map(([name, choice]) => ({ name, choice }));
    for (const entry of args.options) {
      const at = combined.findIndex((c) => entry && normalize(c.name) === normalize(entry.name));
      if (at >= 0) combined[at] = { name: combined[at].name, choice: entry.choice };
      else combined.push(entry);
    }
    const checked = validateOptions(item, combined);
    if (checked.error) return checked.error;
    newOptions = checked.options;
  }

  // If the new options match another line of the same item, merge into that line so there is never a duplicate.
  const twin = cart.find((other) => other !== line && other.id === line.id && sameOptions(other.options, newOptions));
  if (twin) {
    if (twin.quantity + newQuantity > MAX_QUANTITY) {
      return fail('invalid_quantity', `Sorry, that would put more than ${MAX_QUANTITY} on one line. For larger orders please ask our staff.`, null, 'Nothing was changed.');
    }
    twin.quantity += newQuantity;
    cart.splice(cart.indexOf(line), 1);
    return { ok: true, mergedWithLine: twin.lineId, line: lineView(twin), cartLineCount: cart.length, customerMessage: `Updated: you now have ${describeLine(twin)} in your cart.` };
  }
  line.quantity = newQuantity;
  line.options = newOptions;
  return { ok: true, line: lineView(line), cartLineCount: cart.length, customerMessage: `Updated: you now have ${describeLine(line)} in your cart.` };
}

function removeItem(args, ctx) {
  const cart = ctx.state.items;
  const found = findCartLine(cart, args);
  if (found.error) return found.error;
  const line = found.line;

  const quantityGiven = args.quantity !== undefined && args.quantity !== null;
  if (quantityGiven) {
    const quantityError = validateQuantity(args.quantity);
    if (quantityError) return quantityError;
    if (args.quantity > line.quantity) {
      return fail('invalid_quantity', `You only have ${line.quantity} of ${line.name} in your cart, so I can't remove ${args.quantity}.`, null, 'Nothing was changed. Ask the customer what they want.');
    }
  }
  const removedQuantity = quantityGiven ? args.quantity : line.quantity;
  const removed = lineView({ ...line, quantity: removedQuantity });

  if (removedQuantity >= line.quantity) {
    cart.splice(cart.indexOf(line), 1);
    return { ok: true, lineRemoved: true, removed, remainingLine: null, cartLineCount: cart.length, customerMessage: `Removed ${describeLine({ ...line, quantity: removedQuantity })} from your cart.` };
  }
  line.quantity -= removedQuantity;
  return { ok: true, lineRemoved: false, removed, remainingLine: lineView(line), cartLineCount: cart.length, customerMessage: `Removed ${removedQuantity} x ${line.name}. You now have ${describeLine(line)} in your cart.` };
}

function describeLine(line) {
  const opts = Object.entries(line.options).map(([name, choice]) => `${name}: ${choice}`);
  return `${line.quantity} x ${line.name}${opts.length ? ` (${opts.join(', ')})` : ''}`;
}

// Read-only: reports exactly what is stored in this session's order state.
function viewCart(args, ctx) {
  const state = ctx.state;
  const cart = state.items;
  // Order type and applied promotions exactly as stored (amounts were computed by code, never by the model).
  const orderType = state.orderType || null;
  const orderTypeText = orderType || 'not set';
  // Totals are recomputed here by the pricing function (read-only: nothing is stored), so they are always current.
  const priced = computeTotals(
    { items: cart, orderType, promoCode: state.discount ? state.discount.code : null },
    { menu: loadMenu(), promotions: loadPromotions().promotions, restaurant: loadRestaurant() }
  );
  const totals = priced.ok
    ? { foodSubtotal: priced.foodSubtotal, discountAmount: priced.discountAmount, deliveryFee: priced.deliveryFee, tax: priced.tax, total: priced.total }
    : null;
  const promotions = priced.ok && priced.discount
    ? [{ code: priced.discount.code, name: priced.discount.name, discountAmount: priced.discount.amount, discountText: `${priced.discount.amount} PKR` }]
    : [];
  const orderTypeLine = `Order type: ${orderType || 'not chosen yet'}`;
  const promoLines = promotions.map((promo) => `Promo code ${promo.code}: ${promo.discountText} off your food`);
  const extras = [orderTypeLine, ...promoLines].join('\n');

  if (cart.length === 0) {
    return { ok: true, isEmpty: true, lineCount: 0, lines: [], summary: 'The cart is empty.', orderType, orderTypeText, promotions, totals,
      missingDetails: checkout.missingDetails(state), customerMessage: `Your cart is empty.\n${extras}` };
  }
  return {
    ok: true,
    isEmpty: false,
    lineCount: cart.length,
    lines: cart.map((line) => ({ ...lineView(line), text: describeLine(line) })),
    summary: cart.map(describeLine).join('\n'),
    orderType,
    orderTypeText,
    promotions,
    totals,
    missingDetails: checkout.missingDetails(state),
    customerMessage: `Your cart:\n${cart.map(describeLine).join('\n')}\n${extras}${priced.ok ? `\n${totalsLines(priced).join('\n')}` : ''}`
  };
}

// Suggests up to 2 real, available items that pair with the cart, skipping items already in the cart and any the
// customer declined earlier in this session. Read-only for the cart: it never adds anything.
function getRecommendations(args, ctx) {
  const menu = loadMenu();
  const state = ctx.state;

  if (args.declinedItemIds !== undefined && args.declinedItemIds !== null) {
    if (!Array.isArray(args.declinedItemIds)) {
      return fail('invalid_declined', "Sorry, I couldn't note that. Which item would you rather skip?", null, 'declinedItemIds must be a list of menu item ids. Nothing was recorded.');
    }
    const toRecord = [];
    for (const raw of args.declinedItemIds) {
      const found = findMenuItem(menu, raw);
      if (!found) return fail('unknown_item', "Sorry, that item isn't on our menu.", null, 'Nothing was recorded.');
      toRecord.push(found.id);
    }
    for (const id of toRecord) {
      if (!state.declinedSuggestions.includes(id)) state.declinedSuggestions.push(id);
    }
  }

  if (state.items.length === 0) {
    return { ok: true, suggestions: [], internalNote: 'The cart is empty, so there is nothing to base a suggestion on. Do not suggest anything.' };
  }

  const { maxSuggestions, pairings, fallback } = loadRecommendations();
  const inCart = new Set(state.items.map((line) => line.id));
  const declined = new Set(state.declinedSuggestions);
  const suggestions = [];
  const seen = new Set();
  const consider = (id, basedOn) => {
    if (suggestions.length >= maxSuggestions || seen.has(id)) return;
    seen.add(id);
    const item = menu.items.find((i) => i.id === id);
    if (!item || item.available !== true || inCart.has(id) || declined.has(id)) return;
    suggestions.push({
      id: item.id,
      name: item.name,
      priceText: `${item.price} ${menu.currency || 'PKR'}`,
      requiredOptions: item.requiredOptions || [],
      basedOn
    });
  };
  for (const line of state.items) {
    for (const id of pairings[line.id] || []) consider(id, line.name);
  }
  for (const id of fallback) consider(id, null);

  return {
    ok: true,
    suggestions,
    internalNote: suggestions.length
      ? 'Offer these as a suggestion only. Do not add anything unless the customer clearly says yes.'
      : 'No suggestions right now. Do not suggest anything.'
  };
}

// Builds the review from the stored state. Any promo code that no longer qualifies is dropped first, so the review is current.
function getOrderReview(args, ctx) {
  const state = ctx.state;
  const note = refreshTotals(state);
  const built = buildReview(state, { menu: loadMenu(), promotions: loadPromotions().promotions, restaurant: loadRestaurant() });
  if (!built.ok) {
    return fail('review_not_ready', built.customerMessage, { missing: built.missing, ...(built.nextStep ? { nextStep: built.nextStep } : {}), ...(note || {}) },
      'The review cannot be shown yet. Ask the customer only for what is listed as missing' + (built.nextStep ? ` (next step: ${built.nextStep})` : '') + '. Do not make up any detail.');
  }
  const review = built.review;
  state.reviewShownVersion = review.reviewVersion;
  const { customerMessage, ...data } = review;
  return {
    ok: true,
    reviewVersion: review.reviewVersion,
    review: data,
    ...(note || {}),
    customerMessage: `${note && note.discountRemoved ? `${note.discountRemoved.customerMessage} ${note.discountRemoved.detail}\n` : ''}${customerMessage}`,
    internalNote: 'Show the review exactly as written (translate only the labels; never change a value or an amount). The order is NOT placed yet: only the customer pressing the "Confirm order" button places it. Never say the order is placed, confirmed or saved.'
  };
}

const HANDLERS = { getOrderReview, getMenu, addItemToCart, modifyItem, removeItem, viewCart, getRecommendations, applyPromotion, setOrderType, ...checkout.handlers };

// ---- Totals and promotions (rules live in data/*.json; the maths is in pricing.js, all checks run in code) ----

// Recomputes the totals for this session with the pricing function and stores them. A promo code that no longer
// qualifies is dropped. Returns a note for the model when the discount was removed or its amount changed, else null.
function refreshTotals(state) {
  const totals = computeTotals(
    { items: state.items, orderType: state.orderType, promoCode: state.discount ? state.discount.code : null },
    { menu: loadMenu(), promotions: loadPromotions().promotions, restaurant: loadRestaurant() }
  );
  const previous = state.discount;
  if (!totals.ok) {
    state.totals = null;
    state.total = 0;
    if (!previous) return null;
    state.discount = null;
    return { discountRemoved: { code: previous.code, reason: totals.error.error, customerMessage: `Your ${previous.code} discount was removed because your order no longer qualifies for it.`, detail: totals.error.customerMessage, internalNote: 'Tell the customer the discount was removed.' } };
  }
  state.totals = { foodSubtotal: totals.foodSubtotal, discountAmount: totals.discountAmount, deliveryFee: totals.deliveryFee, tax: totals.tax, total: totals.total };
  state.total = totals.total === null ? 0 : totals.total;
  if (totals.promoRemoved) {
    state.discount = null;
    return { discountRemoved: totals.promoRemoved };
  }
  if (!totals.discount) {
    state.discount = null;
    return null;
  }
  const changed = !previous || totals.discount.amount !== previous.amount || totals.foodSubtotal !== previous.foodSubtotal;
  state.discount = { code: totals.discount.code, name: totals.discount.name, amount: totals.discount.amount, foodSubtotal: totals.foodSubtotal };
  return changed && previous ? { discountUpdated: { code: totals.discount.code, discountAmount: totals.discount.amount, discountText: `${totals.discount.amount} PKR`, foodSubtotal: totals.foodSubtotal } } : null;
}
const refreshDiscount = refreshTotals;

function applyPromotion(args, ctx) {
  const state = ctx.state; // the order type is only ever set by setOrderType, never here
  const code = typeof args.code === 'string' ? args.code.trim().toUpperCase() : '';
  const promo = code ? loadPromotions().promotions.find((p) => p.id.toUpperCase() === code) : null;
  if (!promo || promo.active !== true || !promo.discount) {
    // Unknown, invented and inactive codes are all refused the same way.
    return fail('invalid_code', "Sorry, that promo code isn't valid.", null, 'Do not accept the code. Do not guess, suggest or list other codes.');
  }
  if (state.discount && state.discount.code !== promo.id) {
    return fail('code_already_applied', `The code ${state.discount.code} is already on your order, and only one promo code can be used per order.`, null, 'The new code has not been applied.');
  }
  if (state.items.length === 0) {
    return fail('cart_empty', 'Your cart is empty. Please add some items first, then I can apply the code.', null, 'The code has not been applied.');
  }
  const sub = foodSubtotal(state.items, loadMenu());
  if (sub.error) return sub.error;
  const problem = checkEligibility(promo, sub.subtotal, state.orderType);
  if (problem) return problem;

  const amount = computeDiscount(promo, sub.subtotal);
  state.discount = { code: promo.id, name: promo.name, amount, foodSubtotal: sub.subtotal };
  refreshTotals(state); // store the totals that include this discount
  return {
    ok: true,
    code: promo.id,
    name: promo.name,
    foodSubtotal: sub.subtotal,
    discountAmount: amount,
    discountText: `${amount} PKR`,
    foodSubtotalAfterDiscount: sub.subtotal - amount,
    deliveryFeeDiscounted: false,
    customerMessage: `Promo code ${promo.id} applied: ${amount} PKR off your food.`,
    internalNote: 'The discount applies to the food subtotal only. The delivery fee is never discounted.'
  };
}

// Records pickup or delivery exactly as the customer chose it, then re-checks any applied promo code.
function setOrderType(args, ctx) {
  const orderType = typeof args.orderType === 'string' ? normalize(args.orderType) : '';
  if (orderType !== 'pickup' && orderType !== 'delivery') {
    return fail('invalid_order_type', 'Is this order for pickup or delivery?', null,
      'The order type must be exactly pickup or delivery, as the customer said it. Nothing was changed. Never guess it.');
  }
  const state = ctx.state;
  const changed = state.orderType !== orderType;
  state.orderType = orderType;
  if (changed) checkout.invalidateAddressConfirmation(state); // any order type change needs a fresh address confirmation
  if (changed && orderType === 'delivery') {
    state.pickupTime = null; // a pickup time never applies to delivery
    state.pickupTimeDeclined = false;
  }
  const note = refreshDiscount(state); // e.g. a pickup-only code stops applying when the customer switches to delivery
  const result = { ok: true, orderType, changed, missingDetails: checkout.missingDetails(state), optionalDetails: checkout.optionalDetails(state), ...(note || {}) };
  result.customerMessage = `Got it: this order is for ${orderType}.`;
  if (note && note.discountRemoved) result.customerMessage += ` ${note.discountRemoved.customerMessage} ${note.discountRemoved.detail}`;
  if (note && note.discountUpdated) result.customerMessage += ` Your ${note.discountUpdated.code} discount is now ${note.discountUpdated.discountText}.`;
  return result;
}

// After the customer has confirmed the order with the button, the order is locked: nothing can be changed from the chat.
const LOCKED_AFTER_CONFIRM = new Set(['addItemToCart', 'modifyItem', 'removeItem', 'applyPromotion', 'setOrderType', 'setCustomerDetails', 'readBackAddress', 'confirmAddress', 'getOrderReview']);

const CART_CHANGING_TOOLS = new Set(['addItemToCart', 'modifyItem', 'removeItem']);

// Runs one tool call for one session. ctx = { state } is the current session's order state only.
function executeTool(name, args, ctx) {
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, name) ? HANDLERS[name] : null;
  if (!handler) {
    return fail('unknown_tool', "Sorry, I can't do that.", null, 'That tool does not exist. Do not call it again.');
  }
  if (ctx && ctx.state && ctx.state.status !== 'draft' && LOCKED_AFTER_CONFIRM.has(name)) {
    return fail('order_locked', "Your order has already been confirmed, so it can't be changed here. If you need to change something, please contact the restaurant.", null,
      'Do not try to change the order. Tell the customer using the customerMessage only.');
  }
  try {
    const result = handler(args && typeof args === 'object' ? args : {}, ctx);
    // Whenever the cart changes, re-check that an applied promo code is still valid and update the amount.
    if (result && result.ok && CART_CHANGING_TOOLS.has(name)) {
      const note = refreshDiscount(ctx.state);
      if (note) {
        Object.assign(result, note);
        if (note.discountRemoved) result.customerMessage += ` ${note.discountRemoved.customerMessage} ${note.discountRemoved.detail}`;
        if (note.discountUpdated) result.customerMessage += ` Your ${note.discountUpdated.code} discount is now ${note.discountUpdated.discountText}.`;
      }
    }
    return result;
  } catch (err) {
    return fail('tool_failed', 'Sorry, something went wrong. Please try again, or ask our staff.', null, 'The tool could not run.');
  }
}

// One short, safe log line per tool call: tool name, ok/rejected, a reason code or small counts.
// It never includes the cart contents, customer details, messages, prompts or any secret.
function describeToolOutcome(name, result, state) {
  const tool = Object.prototype.hasOwnProperty.call(HANDLERS, name) ? name : 'unknown';
  if (!result || result.ok !== true) {
    const code = String((result && result.error) || 'unknown').replace(/[^A-Za-z_]/g, '').toUpperCase() || 'UNKNOWN';
    return `${tool} -> rejected (${code})`;
  }
  const items = state && Array.isArray(state.items) ? state.items.length : 0;
  const orderType = state && state.orderType ? state.orderType : 'not-set';
  const promos = state && state.discount && state.discount.code ? String(state.discount.code).replace(/[^A-Za-z0-9_-]/g, '') : 'none';
  return `${tool} -> ok (items=${items}, orderType=${orderType}, promos=${promos})`;
}

// Runs all tool calls of one model round for one session. setOrderType always runs first (the order type decides
// whether promo codes apply), whatever order the model sent the calls in. Results are returned in the ORIGINAL
// call order so they still line up with the model's function calls.
function runToolCalls(calls, ctx) {
  const rank = (call) => (call && call.name === 'setOrderType' ? 0 : 1);
  const order = calls.map((_, i) => i).sort((a, b) => rank(calls[a]) - rank(calls[b]) || a - b);
  const results = new Array(calls.length);
  for (const i of order) {
    results[i] = executeTool(calls[i].name, calls[i].args, ctx);
    console.log(`Tool result: ${describeToolOutcome(calls[i].name, results[i], ctx.state)}`);
  }
  return results;
}

module.exports = { TOOL_DECLARATIONS, executeTool, runToolCalls, describeToolOutcome };

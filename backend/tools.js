// Tools the assistant can call (Gemini function calling). All validation is done here in code,
// against data/menu.json, never by the model. Every tool returns { ok: true, ... } or { ok: false, error, message }.
const { loadMenu, loadRecommendations } = require('./data');

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
  }
];

const fail = (error, message, extra) => ({ ok: false, error, message, ...(extra || {}) });

function normalize(text) {
  return typeof text === 'string' ? text.trim().toLowerCase() : '';
}

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
    return { error: fail('unknown_item', 'That item is not on the menu. Do not offer or add it.', { availableItems: available }) };
  }
  if (item.available !== true) {
    return { error: fail('item_unavailable', `${item.name} is not available right now.`) };
  }
  return { item };
}

function validateQuantity(quantity) {
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    return fail('invalid_quantity', 'Quantity must be a whole number of 1 or more. Ask the customer how many they want.');
  }
  if (quantity > MAX_QUANTITY) {
    return fail('invalid_quantity', `Quantity cannot be more than ${MAX_QUANTITY} for one item. Ask the customer to check with staff for larger orders.`);
  }
  return null;
}

// Checks the customer's option choices against the item's required options in the menu data.
// Returns { options } (canonical names and choices) or { error }.
function validateOptions(item, optionList) {
  const required = item.requiredOptions || [];
  if (optionList !== undefined && optionList !== null && !Array.isArray(optionList)) {
    return { error: fail('invalid_option', 'Options must be a list of {name, choice}.') };
  }
  const chosen = {};
  for (const entry of optionList || []) {
    const spec = entry && required.find((r) => normalize(r.name) === normalize(entry.name));
    if (!spec) {
      const names = required.map((r) => r.name);
      return { error: fail('invalid_option', names.length
        ? `${item.name} has no option called "${entry && entry.name}". Its options are: ${names.join(', ')}.`
        : `${item.name} has no options. Do not add any.`) };
    }
    const choice = spec.choices.find((c) => normalize(c) === normalize(entry.choice));
    if (!choice) {
      return { error: fail('invalid_option_choice', `"${entry.choice}" is not a valid ${spec.name} for ${item.name}. Choose one of: ${spec.choices.join(', ')}.`,
        { missingOptions: [{ name: spec.name, choices: spec.choices }] }) };
    }
    if (chosen[spec.name] !== undefined && chosen[spec.name] !== choice) {
      return { error: fail('invalid_option', `Two different values were given for ${spec.name}. Ask the customer which one they want.`) };
    }
    chosen[spec.name] = choice;
  }
  const missing = required.filter((r) => chosen[r.name] === undefined).map((r) => ({ name: r.name, choices: r.choices }));
  if (missing.length) {
    return { error: fail('missing_options', `Ask the customer to choose: ${missing.map((m) => `${m.name} (${m.choices.join(' or ')})`).join('; ')}. Do not guess.`, { missingOptions: missing }) };
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
      return fail('invalid_quantity', `The cart already has ${existing.quantity} of this item. The most allowed on one line is ${MAX_QUANTITY}.`);
    }
    existing.quantity += args.quantity; // same item and options: one line, never a duplicate
    return { ok: true, mergedIntoExistingLine: true, line: lineView(existing), cartLineCount: cart.length };
  }
  ctx.state.lineCounter += 1;
  const line = { lineId: `L${ctx.state.lineCounter}`, id: item.id, name: item.name, quantity: args.quantity, options: checked.options };
  cart.push(line);
  return { ok: true, mergedIntoExistingLine: false, line: lineView(line), cartLineCount: cart.length };
}

// Finds the one cart line the customer means. Returns { line } or { error }.
function findCartLine(cart, args) {
  if (args.lineId !== undefined && args.lineId !== null && args.lineId !== '') {
    const byId = cart.find((line) => line.lineId === args.lineId);
    return byId ? { line: byId } : { error: fail('not_in_cart', 'There is no cart line with that lineId.') };
  }
  const key = normalize(args.itemId);
  let candidates = cart.filter((line) => normalize(line.id) === key || normalize(line.name) === key);
  if (candidates.length === 0) {
    return { error: fail('not_in_cart', 'That item is not in the cart. Use addItemToCart to add it.') };
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
    return { error: fail('ambiguous_line', 'The cart has several lines of this item with different options. Ask the customer which one to change.', { lines: candidates.map(lineView) }) };
  }
  if (candidates.length === 0) {
    return { error: fail('not_in_cart', 'No cart line of that item has those options.') };
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
    return fail('nothing_to_change', 'Say what to change: a new quantity and/or new option choices.');
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
      return fail('invalid_quantity', `Merging would make more than ${MAX_QUANTITY} on one line.`);
    }
    twin.quantity += newQuantity;
    cart.splice(cart.indexOf(line), 1);
    return { ok: true, mergedWithLine: twin.lineId, line: lineView(twin), cartLineCount: cart.length };
  }
  line.quantity = newQuantity;
  line.options = newOptions;
  return { ok: true, line: lineView(line), cartLineCount: cart.length };
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
      return fail('invalid_quantity', `The cart has only ${line.quantity} of ${line.name}, so ${args.quantity} cannot be removed. Ask the customer what they want.`);
    }
  }
  const removedQuantity = quantityGiven ? args.quantity : line.quantity;
  const removed = lineView({ ...line, quantity: removedQuantity });

  if (removedQuantity >= line.quantity) {
    cart.splice(cart.indexOf(line), 1);
    return { ok: true, lineRemoved: true, removed, remainingLine: null, cartLineCount: cart.length };
  }
  line.quantity -= removedQuantity;
  return { ok: true, lineRemoved: false, removed, remainingLine: lineView(line), cartLineCount: cart.length };
}

function describeLine(line) {
  const opts = Object.entries(line.options).map(([name, choice]) => `${name}: ${choice}`);
  return `${line.quantity} x ${line.name}${opts.length ? ` (${opts.join(', ')})` : ''}`;
}

// Read-only: reports exactly what is stored in this session's order state.
function viewCart(args, ctx) {
  const cart = ctx.state.items;
  if (cart.length === 0) {
    return { ok: true, isEmpty: true, lineCount: 0, lines: [], summary: 'The cart is empty.' };
  }
  return {
    ok: true,
    isEmpty: false,
    lineCount: cart.length,
    lines: cart.map((line) => ({ ...lineView(line), text: describeLine(line) })),
    summary: cart.map(describeLine).join('\n')
  };
}

// Suggests up to 2 real, available items that pair with the cart, skipping items already in the cart and any the
// customer declined earlier in this session. Read-only for the cart: it never adds anything.
function getRecommendations(args, ctx) {
  const menu = loadMenu();
  const state = ctx.state;

  if (args.declinedItemIds !== undefined && args.declinedItemIds !== null) {
    if (!Array.isArray(args.declinedItemIds)) {
      return fail('invalid_declined', 'declinedItemIds must be a list of menu item ids.');
    }
    const toRecord = [];
    for (const raw of args.declinedItemIds) {
      const found = findMenuItem(menu, raw);
      if (!found) return fail('unknown_item', 'One of the declined items is not on the menu.');
      toRecord.push(found.id);
    }
    for (const id of toRecord) {
      if (!state.declinedSuggestions.includes(id)) state.declinedSuggestions.push(id);
    }
  }

  if (state.items.length === 0) {
    return { ok: true, suggestions: [], message: 'The cart is empty, so there is nothing to base a suggestion on.' };
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
    message: suggestions.length
      ? 'Offer these as a suggestion only. Do not add anything unless the customer clearly says yes.'
      : 'No suggestions right now. Do not suggest anything.'
  };
}

const HANDLERS = { getMenu, addItemToCart, modifyItem, removeItem, viewCart, getRecommendations };

// Runs one tool call for one session. ctx = { state } is the current session's order state only.
function executeTool(name, args, ctx) {
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, name) ? HANDLERS[name] : null;
  if (!handler) {
    return { ok: false, error: 'unknown_tool', message: 'That tool does not exist.' };
  }
  try {
    return handler(args && typeof args === 'object' ? args : {}, ctx);
  } catch (err) {
    return { ok: false, error: 'tool_failed', message: 'The tool could not run. Tell the customer to ask staff.' };
  }
}

module.exports = { TOOL_DECLARATIONS, executeTool };

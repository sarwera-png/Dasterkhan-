// Tools the assistant can call (Gemini function calling). All validation is done here in code,
// against data/menu.json, never by the model. Every tool returns { ok: true, ... } or { ok: false, error, message }.
const { loadMenu } = require('./data');

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

const HANDLERS = { getMenu, addItemToCart, modifyItem };

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

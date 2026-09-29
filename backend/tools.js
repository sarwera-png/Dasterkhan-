// Tools the assistant can call (Gemini function calling). All validation is done here in code,
// against data/menu.json, never by the model. Every tool returns { ok: true, ... } or { ok: false, error, message }.
const { loadMenu } = require('./data');

const TOOL_DECLARATIONS = [
  {
    name: 'getMenu',
    description:
      'Get the current menu: only the items that are available now, with id, name, price and required options. ' +
      'Call this when the customer asks what is on the menu, asks about prices, or asks for something you are not sure exists.'
  }
];

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

const HANDLERS = { getMenu };

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

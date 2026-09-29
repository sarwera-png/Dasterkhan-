// Loads the restaurant data files. data/menu.json and data/promotions.json are the single source of truth.
// Files are read on every call, so edits apply without a restart. Invalid data throws.
const fs = require('fs');
const path = require('path');

const MENU_PATH = path.join(__dirname, '..', 'data', 'menu.json');

function loadMenu() {
  const menu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
  if (!menu || !Array.isArray(menu.items) || menu.items.length === 0) {
    throw new Error('invalid menu');
  }
  return menu;
}

module.exports = { loadMenu };

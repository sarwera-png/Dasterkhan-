// Loads the restaurant data files. data/menu.json and data/promotions.json are the single source of truth.
// Files are read on every call, so edits apply without a restart. Invalid data throws.
const fs = require('fs');
const path = require('path');

const MENU_PATH = path.join(__dirname, '..', 'data', 'menu.json');
const REAL_RESTAURANT_PATH = path.join(__dirname, '..', 'data', 'restaurant.json');
let restaurantPath = REAL_RESTAURANT_PATH; // only ever changed by the automated tests
const PROMOTIONS_PATH = path.join(__dirname, '..', 'data', 'promotions.json');
const RECOMMENDATIONS_PATH = path.join(__dirname, '..', 'data', 'recommendations.json');

function loadMenu() {
  const menu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
  if (!menu || !Array.isArray(menu.items) || menu.items.length === 0) {
    throw new Error('invalid menu');
  }
  return menu;
}

// Which menu items go with which (item ids). Only ids that exist on the menu are ever suggested.
function loadRecommendations() {
  const data = JSON.parse(fs.readFileSync(RECOMMENDATIONS_PATH, 'utf8'));
  if (!data || typeof data.pairings !== 'object' || data.pairings === null) {
    throw new Error('invalid recommendations');
  }
  return {
    maxSuggestions: Math.min(Number.isInteger(data.maxSuggestions) && data.maxSuggestions > 0 ? data.maxSuggestions : 2, 2),
    pairings: data.pairings,
    fallback: Array.isArray(data.fallback) ? data.fallback : []
  };
}

function loadPromotions() {
  const data = JSON.parse(fs.readFileSync(PROMOTIONS_PATH, 'utf8'));
  if (!data || !Array.isArray(data.promotions)) {
    throw new Error('invalid promotions');
  }
  return data;
}

// Opening hours, delivery area and fee, tax rate: the facts code needs to validate orders.
function loadRestaurant() {
  const r = JSON.parse(fs.readFileSync(restaurantPath, 'utf8'));
  const okTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (!r || !r.hours || !okTime(r.hours.open) || !okTime(r.hours.close)
    || !r.delivery || !Array.isArray(r.delivery.blocks) || !Number.isInteger(r.delivery.fee)
    || !r.pickup || !Number.isInteger(r.pickup.fee) || typeof r.taxRate !== 'number'
    || typeof r.name !== 'string' || typeof r.area !== 'string' || typeof r.city !== 'string' || typeof r.currency !== 'string'
    || !Array.isArray(r.areaAliases) || !r.payment || typeof r.payment.method !== 'string' || typeof r.payment.timing !== 'string'
    || typeof r.promisePreparationTime !== 'boolean') {
    throw new Error('invalid restaurant data');
  }
  return r;
}

// Test-only: point the restaurant facts at a temporary file (null = back to the real file). Same pattern as orders.js.
function setRestaurantPathForTests(file) {
  if (process.env.NODE_ENV !== 'test') throw new Error('setRestaurantPathForTests is only available when NODE_ENV=test');
  restaurantPath = file === null ? REAL_RESTAURANT_PATH : file;
}

module.exports = { loadMenu, loadRecommendations, loadPromotions, loadRestaurant, setRestaurantPathForTests };

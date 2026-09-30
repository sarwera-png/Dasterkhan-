const ROOT = require('path').join(__dirname, '..', '..');
// Step Y: the restaurant-facts test hook is test-only and never writes the real file
const assert = require('assert'); const fs = require('fs'); require('./lib.js');
const real = ROOT + '/data/restaurant.json'; const before = fs.readFileSync(real);
const data = require(ROOT + '/backend/data'); const tmp = global.__ORDERS_DIR + '/rest-hook.json';
fs.writeFileSync(tmp, JSON.stringify({ ...JSON.parse(before), name: 'Temp Kitchen' })); data.setRestaurantPathForTests(tmp); assert.strictEqual(data.loadRestaurant().name, 'Temp Kitchen');
data.setRestaurantPathForTests(null); assert.strictEqual(data.loadRestaurant().name, 'Karachi Dastarkhwan'); assert.strictEqual(Buffer.compare(before, fs.readFileSync(real)), 0);
process.env.NODE_ENV = 'production'; assert.throws(() => data.setRestaurantPathForTests(tmp), /only available when NODE_ENV=test/); assert.strictEqual(data.loadRestaurant().name, 'Karachi Dastarkhwan'); process.env.NODE_ENV = 'test';
assert(!fs.readFileSync(ROOT + '/tests/unit/t37.js', 'utf8').includes('writeFileSync(realRestFile'), 't37 must not write the real file');
console.log('1) setRestaurantPathForTests redirects the facts to a temp file, null restores the real one, it throws unless NODE_ENV=test, and the real data/restaurant.json is byte-identical: PASS'); console.log('ALL STEP-Y TESTS PASSED');

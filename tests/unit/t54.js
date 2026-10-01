const ROOT = require('path').join(__dirname, '..', '..');
// Step AN: prompt rules from the real diagnostics (store details at once, never re-ask, option answers, reply language, mention tool results)
const assert = require('assert'); const fs = require('fs'); const L = require('./lib.js'); const { sessions, base } = L.boot(3101);
const { renderPrompt } = require(ROOT + '/backend/facts'); const { loadRestaurant } = require(ROOT + '/backend/data');
const prompt = renderPrompt(fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8'), loadRestaurant());
const rules = [
  ['store immediately', ['Store details immediately', 'ANY order detail', 'an item, a quantity, an option, pickup or delivery, a name, a phone number, a block, a house or flat number, a street, or a pickup time', 'in that same turn', 'in whatever order the details arrive', 'even if you had asked for something else', 'Only afterwards ask for what is still missing']],
  ['never re-ask', ['Never ask again for something the customer already said', '"ایک", "ek", "one" and "a" mean quantity 1']],
  ['pending option answer', ['answers a pending option question', 'call addItemToCart right away with that option and the quantity they gave earlier', 'Do not ask the quantity again']],
  ['reply language', ["LATEST message", 'refusals, errors and questions', 'an English message gets an English reply', 'Never switch language because of the earlier conversation']],
  ['mention the tool result', ['After a tool result', 'applyPromotion ok', 'tell the customer that result first', 'only then ask the next question']]
];
for (const [name, parts] of rules) for (const p of parts) assert(prompt.includes(p), `${name}: missing "${p}"`);
// the rules are in the right sections and the older rules are still there
assert(prompt.indexOf('Store details immediately') < prompt.indexOf('## Tools') && prompt.indexOf('Store details immediately') > prompt.indexOf('## Taking orders'));
for (const old of ['Never invent', '4. Agreement words', 'Option words:', 'ONLY when the customer presses that button', 'setCustomerDetails: use it to store']) assert(prompt.includes(old), 'older rule kept: ' + old);
assert(!/\{\{[A-Z_]+\}\}/.test(prompt), 'no unrendered placeholder');
console.log('1) the prompt carries all five rules (store any detail at once in the same turn in any order; never re-ask, "ایک / ek / one / a" = 1; option answer -> addItemToCart with the earlier quantity; reply in the latest message\'s language even for refusals; mention a tool result before the next question), in "Taking orders", and every older rule is still present: PASS');
let sys = ''; global.__STUB = async ({ config }) => { sys = config.systemInstruction; return L.text('ok'); };
(async () => { await new Promise(r => setTimeout(r, 400)); await L.post(base, { message: 'hi' }); assert(sys.includes('Store details immediately') && sys.includes('Never switch language because of the earlier conversation'));
  console.log('2) the rules reach the model with every request: PASS'); console.log('ALL STEP-AN TESTS PASSED'); process.exit(0); })().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); });

const ROOT = require('path').join(__dirname, '..', '..');
// Step AJ: Urdu / Roman Urdu option synonyms are normalised in CODE (whole-phrase match, never a guess)
const assert = require('assert'); const fs = require('fs'); require('./lib.js');
const { executeTool } = require(ROOT + '/backend/tools'); const sessions = require(ROOT + '/backend/sessions'); const words = require(ROOT + '/backend/option-synonyms');
const fresh = () => sessions.getOrCreateSession().state; const add = (st, itemId, name, choice, extra) => executeTool('addItemToCart', { itemId, quantity: 1, options: [{ name, choice }], ...(extra || {}) }, { state: st });
const MILD = ['mild', 'Mild', ' MILD ', 'kam mirch', 'Kam Mirch', 'kam', 'halki', 'halki mirch', 'Halki  Mirch', 'کم مرچ', 'کم', 'ہلکی', 'ہلکی مرچ', 'less spicy', 'Less Spicy', 'not spicy', 'not spicy.', 'کم مرچ۔', '  کم   مرچ  '];
const REGULAR = ['regular', 'Regular', 'normal', 'NORMAL', 'medium', 'aam', 'عام', 'نارمل', 'regular!'];
const WITH = ['with', 'With', 'with chutney', 'chutney ke sath', 'chutney k sath', 'Chutney Ke Sath', 'چٹنی کے ساتھ', 'haan chutney', 'chutney ke saath'];
const WITHOUT = ['without', 'Without', 'no chutney', 'chutney ke baghair', 'chutney k baghair', 'bina chutney', 'Bina Chutney', 'چٹنی کے بغیر', 'chutney nahi', 'chutney nahi.'];
for (const [list, item, name, want] of [[MILD, 'BRY01', 'spice', 'mild'], [REGULAR, 'BRY01', 'spice', 'regular'], [WITH, 'ROL01', 'chutney', 'with'], [WITHOUT, 'ROL01', 'chutney', 'without']]) for (const w of list) { const st = fresh(); const r = add(st, item, name, w); assert.strictEqual(r.ok, true, `${name}: "${w}" ` + JSON.stringify(r)); assert.strictEqual(st.items[0].options[name], want, `"${w}" -> ${want}`); }
console.log(`1) ${MILD.length} mild + ${REGULAR.length} regular spice phrases and ${WITH.length} with + ${WITHOUT.length} without chutney phrases (English, Urdu script, Roman Urdu; case, spacing, punctuation ignored) are stored as the real choice: PASS`);
// not guessed: no hot option, partial phrases, other words
const NO = ['تیز', 'teez', 'Teez', 'extra spicy', 'hot', 'spicy', 'very spicy', 'zyada mirch', 'tez', 'kam mirch wali', 'mild please', 'halki si', 'chutney', 'chutney ke', 'haan', 'nahi', 'no', 'yes', '', '   ', 'عام سی', 'mild or regular'];
for (const [item, name] of [['BRY01', 'spice'], ['ROL01', 'chutney']]) for (const w of NO) { const st = fresh(); const r = add(st, item, name, w); assert.strictEqual(st.items.length, 0, `nothing added for ${name}: "${w}"`); assert.strictEqual(r.ok, false); assert(['invalid_option_choice', 'missing_options'].includes(r.error), r.error); assert(/mild or regular|with or without|choose/i.test(r.customerMessage), r.customerMessage); }
for (const w of ['تیز', 'teez', 'extra spicy', 'hot']) { const st = fresh(); const r = add(st, 'BRY01', 'spice', w); assert.strictEqual(r.error, 'invalid_option_choice'); assert.deepStrictEqual(r.missingOptions, [{ name: 'spice', choices: ['mild', 'regular'] }]); assert(r.customerMessage.includes('mild or regular')); }
const swap = fresh(); assert.strictEqual(add(swap, 'BRY01', 'spice', 'with').ok, false); assert.strictEqual(add(swap, 'ROL01', 'chutney', 'mild').ok, false); assert.strictEqual(add(swap, 'ROL01', 'chutney', 'kam mirch').ok, false, 'a spice word is not a chutney choice');
console.log('2) "تیز", "teez", "extra spicy", "hot", "spicy", partial phrases, empty text and words from the wrong option are NOT mapped: the code rejects with invalid_option_choice (choices mild or regular listed), nothing is added, the customer is asked again: PASS');
// option NAME spellings, missing options, injected extras
for (const nm of ['Spice', 'spice level', 'mirch', 'مرچ', 'مرچی']) { const st = fresh(); assert.strictEqual(add(st, 'BRY01', nm, 'کم مرچ').ok, true, nm); assert.strictEqual(st.items[0].options.spice, 'mild'); }
for (const nm of ['chutney', 'Chutney', 'چٹنی']) { const st = fresh(); assert.strictEqual(add(st, 'ROL01', nm, 'bina chutney').ok, true, nm); assert.strictEqual(st.items[0].options.chutney, 'without'); }
let st = fresh(); let r = executeTool('addItemToCart', { itemId: 'BRY01', quantity: 1 }, { state: st }); assert.strictEqual(r.error, 'missing_options'); assert.strictEqual(st.items.length, 0);
st = fresh(); r = add(st, 'RAI01', 'spice', 'کم مرچ'); assert.strictEqual(r.ok, false, 'an item without that option still refuses it'); assert.strictEqual(r.error, 'invalid_option');
st = fresh(); r = executeTool('addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'کم مرچ' }, { name: 'spice', choice: 'regular' }] }, { state: st }); assert.strictEqual(r.ok, false); assert.strictEqual(st.items.length, 0);
st = fresh(); r = executeTool('addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'کم مرچ' }, { name: 'spice', choice: 'mild' }] }, { state: st }); assert.strictEqual(r.ok, true, 'the same choice twice (in two words) is fine');
console.log('3) option names in other spellings (Spice, spice level, mirch, مرچ, چٹنی) work; missing options and options that the item does not have are still refused; two different choices still conflict: PASS');
// modify and remove with synonyms
st = fresh(); add(st, 'BRY01', 'spice', 'kam mirch'); r = executeTool('modifyItem', { itemId: 'BRY01', options: [{ name: 'spice', choice: 'عام' }] }, { state: st }); assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(st.items.length, 1); assert.strictEqual(st.items[0].options.spice, 'regular');
r = executeTool('modifyItem', { itemId: 'BRY01', options: [{ name: 'spice', choice: 'teez' }] }, { state: st }); assert.strictEqual(r.ok, false); assert.strictEqual(st.items[0].options.spice, 'regular');
st = fresh(); add(st, 'BRY01', 'spice', 'mild'); add(st, 'BRY01', 'spice', 'regular'); assert.strictEqual(st.items.length, 2);
r = executeTool('removeItem', { itemId: 'BRY01', currentOptions: [{ name: 'spice', choice: 'کم مرچ' }] }, { state: st }); assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(st.items.length, 1); assert.strictEqual(st.items[0].options.spice, 'regular');
console.log('4) modifyItem accepts synonyms for the new choice (and still refuses "teez"); removeItem/modifyItem find the right line when currentOptions uses synonyms: PASS');
// prices and totals are untouched by the words; the model-facing text lists the words
st = fresh(); add(st, 'BRY01', 'spice', 'ہلکی مرچ'); executeTool('setOrderType', { orderType: 'pickup' }, { state: st }); assert.strictEqual(st.totals.total, 350);
const prompt = fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8'); for (const w of ['Option words', 'کم مرچ', 'kam mirch', 'halki mirch', 'less spicy', 'not spicy', 'عام', 'نارمل', 'chutney ke sath', 'چٹنی کے ساتھ', 'bina chutney', 'چٹنی کے بغیر', 'chutney nahi', 'تیز', 'teez', 'do not guess']) assert(prompt.includes(w), w);
const decl = require(ROOT + '/backend/tools').TOOL_DECLARATIONS.find(d => d.name === 'addItemToCart'); assert(JSON.stringify(decl).includes('کم مرچ'));
assert.strictEqual(words.canonicalChoice('spice', 'تیز'), null); assert.strictEqual(words.canonicalName('price'), null);
console.log('5) prices are unaffected (350 PKR); the system prompt and the tool description list the Urdu / Roman Urdu words and the "do not guess for تیز / teez / extra spicy" rule: PASS'); console.log('ALL STEP-AJ TESTS PASSED'); process.exit(0);

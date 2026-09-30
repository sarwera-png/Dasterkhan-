const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const fs = require('fs'); const dir = __dirname;
const L = require(dir + '/lib.js'); const { sessions, base } = L.boot(3078); const { executeTool } = require(ROOT + '/backend/tools');
const template = fs.readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8'); const menu = require(ROOT + '/data/menu.json'); const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let sys = ''; global.__STUB = async ({ config }) => { sys = config.systemInstruction; return L.text('ok'); };
(async () => { await sleep(400); await L.post(base, { message: 'hi' });
  const rule = "When you describe a suggested item, use only words from that item's description in the menu data: say its name, its price as returned, and at most the plain description (for example \"Raita - 80 PKR, a side dish\"). Never add your own adjectives or claims about it: no taste (such as delicious or tasty), freshness (such as fresh or freshly made), health (such as healthy or light), temperature (such as hot or cold), popularity (such as popular or a favourite), quality (such as perfect or best), or effect (such as refreshing, filling or goes well with). Do not say that two items belong together.";
  assert(template.includes(rule) && sys.includes(rule));
  for (const kept of ['you may offer at most one or two suggestions from this tool, in one short sentence', "They are only suggestions: never add a suggested item unless the customer clearly says yes, and then use addItemToCart.", 'Never suggest anything the tool did not return.', 'If the customer says no to a suggestion, call getRecommendations again with declinedItemIds to record it, and do not offer another suggestion in that reply.', 'Do not suggest more than once per reply.']) assert(template.includes(kept), kept);
  assert.strictEqual(template.split('When you describe a suggested item').length, 2);
  console.log('1) prompt contains the wording rule (only words from the item\'s menu description; no taste / freshness / health / temperature / popularity / quality / effect claims; "refreshing" named as an example of what not to say; items are not said to belong together) and it reaches the model; all earlier recommendation rules (1-2 max, never add without a yes, record declines, once per reply) are still there: PASS');
  // the example in the rule matches the real menu data, and the words the model may use exist in menu.json
  const raita = menu.items.find(i => i.id === 'RAI01'); assert.strictEqual(raita.description, 'A side dish.'); assert.strictEqual(raita.price, 80);
  assert(menu.items.every(i => typeof i.description === 'string' && i.description.length > 0 && !/refreshing|delicious|tasty|fresh|healthy|popular|favourite|favorite|best|perfect|hot|cold/i.test(i.description)));
  console.log('2) the rule\'s example ("Raita - 80 PKR, a side dish") matches menu.json exactly, and no menu description itself contains a claim word: PASS');
  // existing recommendation behaviour unchanged (tool)
  const st = sessions.getOrCreateSession().state; executeTool('addItemToCart', { itemId: 'BRY01', quantity: 1, options: [{ name: 'spice', choice: 'mild' }] }, { state: st });
  let r = executeTool('getRecommendations', {}, { state: st }); assert.deepStrictEqual(r.suggestions.map(x => x.id), ['RAI01', 'SAL01']); r = executeTool('getRecommendations', { declinedItemIds: ['RAI01'] }, { state: st }); assert(!r.suggestions.some(x => x.id === 'RAI01')); assert.strictEqual(st.items.length, 1);
  console.log('3) recommendation tool unchanged: max 2 real items, a declined item never returns, cart untouched: PASS');
  console.log('ALL STEP-N TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); });

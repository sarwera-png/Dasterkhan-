const ROOT = require('path').join(__dirname, '..', '..');
const assert = require('assert'); const L = require('./lib.js');
const { sessions, base } = L.boot(3056); const fs = require('fs');
const menuFile = ROOT + '/data/menu.json'; const menuBackup = fs.readFileSync(menuFile, 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => { await sleep(500);
  const reqs = []; let realNow = Date.now.bind(Date);
  // 1) "what's on the menu?" -> model calls getMenu -> answers from the tool result
  global.__STUB = async ({ model, contents, config }) => { reqs.push({ model, contents, config });
    const res = L.lastToolResults(contents);
    if (!res) return L.calls([{ name: 'getMenu' }]);
    const items = res[0].response.items; return L.text(items.map(i => `${i.name} - ${i.priceText}`).join('\n')); };
  let r = await L.post(base, { message: "what's on the menu?" });
  assert.strictEqual(r.status, 200); assert.strictEqual(reqs.length, 2);
  const toolResult = L.lastToolResults(reqs[1].contents)[0];
  assert.strictEqual(toolResult.name, 'getMenu'); assert.strictEqual(toolResult.response.ok, true); assert.strictEqual(toolResult.response.items.length, 10);
  assert.deepStrictEqual(Object.keys(toolResult.response.items[0]), ['id', 'name', 'price', 'priceText', 'requiredOptions']);
  assert.deepStrictEqual(toolResult.response.items[0].requiredOptions, [{ name: 'spice', choices: ['mild', 'regular'] }]);
  assert(r.json.reply.includes('Chicken Biryani - 350 PKR') && r.json.reply.includes('Naan - 40 PKR') && r.json.reply.split('\n').length === 10);
  assert(reqs[0].config.tools[0].functionDeclarations.some(f => f.name === 'getMenu'));
  assert(reqs[0].model === 'gemini-3.8-flash' && reqs[1].model === 'gemini-3.8-flash');
  console.log('1) "what\'s on the menu?": model called getMenu -> tool result has 10 available items (id,name,price,priceText,requiredOptions) -> reply shows all 10 as "<n> PKR"; 2 model requests, same model: PASS');
  // the model turn was kept verbatim (incl. thought signature) when sent back
  const modelTurn = reqs[1].contents[reqs[1].contents.length - 2]; assert.strictEqual(modelTurn.role, 'model'); assert.strictEqual(modelTurn.parts[0].thoughtSignature, 'SIG-ORIGINAL');
  console.log('   function-call turn sent back verbatim with its thought signature: PASS');
  // 2) unavailable items are not returned; "Pizza chahiye" -> only real alternatives
  const m = JSON.parse(menuBackup); m.items.find(i => i.id === 'TEA01').available = false; fs.writeFileSync(menuFile, JSON.stringify(m, null, 2));
  reqs.length = 0; global.__STUB = async ({ model, contents }) => { reqs.push({ model, contents }); const res = L.lastToolResults(contents);
    if (!res) return L.calls([{ name: 'getMenu' }]);
    const its = res[0].response.items; return L.text('Sorry, we do not have Pizza. You could try: ' + its.slice(0, 2).map(i => `${i.name} - ${i.priceText}`).join(', ')); };
  r = await L.post(base, { message: 'Pizza chahiye' }); fs.writeFileSync(menuFile, menuBackup);
  const its = L.lastToolResults(reqs[1].contents)[0].response.items;
  assert.strictEqual(its.length, 9); assert(!its.some(i => i.id === 'TEA01')); assert(!its.some(i => /pizza/i.test(i.name)));
  assert(r.json.reply.includes('Chicken Biryani - 350 PKR'));
  console.log('2) menu with Tea marked unavailable -> getMenu returns 9 items, no Tea, no Pizza; alternatives in the reply come only from real items: PASS');
  const sysPrompt = require('fs').readFileSync(ROOT + '/prompts/system-prompt.md', 'utf8');
  assert(sysPrompt.includes('If the customer asks for something that is not on the menu, politely say it is not available'));
  console.log('   system prompt tells the model: not on menu -> polite "not available" + 1-2 real items: PASS');
  // 3) unknown tool name -> tool error, loop continues
  reqs.length = 0; global.__STUB = async ({ model, contents }) => { reqs.push({ model, contents }); const res = L.lastToolResults(contents); return res ? L.text('done') : L.calls([{ name: 'deleteEverything', args: {} }]); };
  r = await L.post(base, { message: 'x' }); const ur = L.lastToolResults(reqs[1].contents)[0].response;
  assert.deepStrictEqual([ur.ok, ur.error], [false, 'unknown_tool']); assert.strictEqual(r.json.reply, 'done');
  console.log('3) unknown tool -> {ok:false, error:"unknown_tool"} returned to the model, no crash: PASS');
  // 4) round limit: 4 rounds executed, 5th request still wants tools -> friendly reply, 5 requests total
  reqs.length = 0; global.__STUB = async ({ model, contents }) => { reqs.push({ model }); return L.calls([{ name: 'getMenu' }]); };
  r = await L.post(base, { message: 'loop forever' });
  assert.strictEqual(r.status, 200); assert.strictEqual(reqs.length, 5); assert(r.json.reply.startsWith("Sorry, I couldn't finish that in one go"));
  console.log('4) endless tool calls -> stops after 4 executed rounds (5 model requests max), friendly reply, no loop: PASS');
  // 5) fallback inside a tool loop: 3.8 asks for getMenu; 3.8 then fails (503) -> 3.7 continues with dummy signature; answers
  reqs.length = 0; let n = 0; global.__STUB = async ({ model, contents }) => { reqs.push({ model, contents: JSON.parse(JSON.stringify(contents)) }); n++;
    if (n === 1) return L.calls([{ name: 'getMenu' }]);
    if (n === 2) throw L.err(503);
    return L.text('answered by ' + model); };
  r = await L.post(base, { message: 'menu?' });
  assert.deepStrictEqual(reqs.map(x => x.model), ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.7-flash']); assert.strictEqual(r.json.reply, 'answered by gemini-3.7-flash');
  assert.strictEqual(reqs[1].contents[1].parts[0].thoughtSignature, 'SIG-ORIGINAL');
  assert.strictEqual(reqs[2].contents[1].parts[0].thoughtSignature, 'skip_thought_signature_validator');
  console.log('5) mid-loop fallback: 3.8 (calls) -> 3.8 503 -> 3.7 answers; same-model resend keeps the signature, other model gets the placeholder: PASS');
  // 6) model index never moves back (no retry of failed model): 3.8 503 at request 1, 3.7 calls tool, then 3.7 answers
  reqs.length = 0; n = 0; global.__STUB = async ({ model, contents }) => { reqs.push({ model }); n++; if (n === 1) throw L.err(429); if (n === 2) return L.calls([{ name: 'getMenu' }]); return L.text('ok ' + model); };
  r = await L.post(base, { message: 'menu?' }); assert.deepStrictEqual(reqs.map(x => x.model), ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.7-flash']);
  console.log('6) 3.8=429 -> 3.7 (tool call) -> 3.7 final; failed model is not retried within the message: PASS');
  // 7) all models fail -> friendly 503; 401 -> stop; sessionId always returned
  reqs.length = 0; global.__STUB = async ({ model }) => { reqs.push({ model }); throw L.err(503); }; r = await L.post(base, { message: 'hi' });
  assert.strictEqual(r.status, 503); assert.strictEqual(r.json.reply, 'Assistant is busy right now, please try again in a minute.'); assert.strictEqual(reqs.length, 3); assert.strictEqual(typeof r.json.sessionId, 'string'); assert(!JSON.stringify(r.json).includes('SHOULD-NEVER-LEAK'));
  reqs.length = 0; global.__STUB = async ({ model }) => { reqs.push({ model }); throw L.err(401); }; r = await L.post(base, { message: 'hi' });
  assert.strictEqual(r.status, 502); assert.strictEqual(reqs.length, 1);
  console.log('7) all fail -> friendly 503 (3 attempts); 401 -> stops after 1 attempt; no raw errors leaked: PASS');
  // 8) overall deadline
  reqs.length = 0; let offset = 0; Date.now = () => realNow() + offset; global.__STUB = async ({ model }) => { reqs.push({ model }); offset += 85000; return L.calls([{ name: 'getMenu' }]); };
  r = await L.post(base, { message: 'slow' }); Date.now = realNow;
  assert.strictEqual(r.status, 503); assert.strictEqual(reqs.length, 1);
  console.log('8) overall time limit (80 s) stops the loop with the friendly busy reply: PASS');
  console.log('ALL STEP-18 TESTS PASSED'); process.exit(0);
})().catch(e => { fs.writeFileSync(menuFile, menuBackup); console.error('TEST FAILED:', e.message); process.exit(1); });

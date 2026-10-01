const fs = require('fs');
const path = require('path');
const express = require('express');
const { GoogleGenAI } = require('@google/genai');
const { getOrCreateSession, getExistingSession } = require('./sessions');
const { loadMenu, loadPromotions, loadRestaurant } = require('./data');
const { buildReview } = require('./review');
const { saveConfirmedOrder } = require('./orders');
const { ordersEnabled, ORDERING_DISABLED_MESSAGE } = require('./config');
const { guardReply } = require('./guard');
const cooldown = require('./cooldown');
const extraAi = require('./extra-ai');
const { renderPrompt, paymentLine, paymentLineUrdu } = require('./facts');
const staff = require('./staff');
const { TOOL_DECLARATIONS, runToolCalls } = require('./tools');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_FALLBACK_MODELS = 'gemini-3.7-flash,gemini-flash-latest';
const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt.md');
const MAX_HISTORY_ITEMS = 10;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_TOOL_ROUNDS = 4; // hard limit of tool-call rounds per customer message (free tier: ~5 requests/minute per model)
const TOTAL_DEADLINE_MS = 80000; // stay under the browser's 90 s timeout
const URDU_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
// Added to the model's instructions for every request while ordering is off (demo mode).
const ORDERING_OFF_NOTE = [
  '## Ordering status: ONLINE ORDERING IS OFF (demo)',
  'Customers can browse the menu, build a cart, see prices and totals and get an order review, but orders cannot be placed right now. There is no "Confirm order" button and nothing can be confirmed or saved.',
  'After showing a review, or whenever the customer wants to place the order, tell them in their own language that this is a demo and orders cannot be placed right now. Never say or imply that an order was placed, confirmed, saved or sent, and never tell the customer to press a button. This overrides the parts of the order review steps that mention the "Confirm order" button.'
].join('\n');
const URDU_SCRIPT_NOTE = "The customer's latest message is written in Urdu script. Reply in Urdu script.";
const FALLBACK_REPLY = 'Please try again or contact staff.';
const BUSY_REPLY = 'Assistant is busy right now, please try again in a minute.';
const SAVE_FAILED_MESSAGE = 'Sorry, we could not save your order, so it has NOT been placed. Please try again, or contact the restaurant.';

// The receipt is written only from a saved order: it always contains the saved order number.
function receiptMessage(order) {
  const restaurant = loadRestaurant();
  const type = order.review.orderType;
  const en = `Your order ${order.id} is confirmed and has been sent to the restaurant. Payment: ${paymentLine(restaurant, type).toLowerCase()}. Thank you!`;
  const ur = `آپ کا آرڈر ${order.id} کنفرم ہو گیا ہے اور ریسٹورنٹ کو بھیج دیا گیا ہے۔ ادائیگی: ${paymentLineUrdu(restaurant, type)}۔ شکریہ!`;
  return `${en}\n${ur}`;
}
const TOOL_LIMIT_REPLY = "Sorry, I couldn't finish that in one go. Please try again with one simple request, or contact staff.";

// Ordered model chain: primary first, then fallbacks. Entries are trimmed; empty ones and duplicates are skipped.
function buildModelChain() {
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallbacks = process.env.GEMINI_FALLBACK_MODELS || DEFAULT_FALLBACK_MODELS;
  const chain = [];
  for (const name of [primary, ...fallbacks.split(',')]) {
    const model = name.trim();
    if (model && !chain.includes(model)) chain.push(model);
  }
  return chain;
}
const MODEL_CHAIN = buildModelChain();

// The key is read only from the environment and is never logged or returned.
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Menu grounding: data/menu.json is the single source of truth for items, prices, options and allergens.
// It is read on every request, so edits to the file apply without a restart. Prices are shown as "<n> PKR".
function buildMenuContext() {
  const menu = loadMenu();
  const currency = menu.currency || 'PKR';
  const lines = menu.items.map((item) => {
    const options = Array.isArray(item.requiredOptions) && item.requiredOptions.length
      ? item.requiredOptions.map((o) => `${o.name} (choose one: ${o.choices.join(' or ')})`).join('; ')
      : 'none';
    return `- ${item.id} | ${item.name} | ${item.price} ${currency} | ${item.description} | required options: ${options} | allergens: ${item.allergens} | ${item.available ? 'available' : 'NOT available'}`;
  });
  return [
    '## Menu data',
    '',
    'This is the complete menu. It is the only source for items, prices, required options, allergens and availability. Items not listed here do not exist, so never offer or promise anything that is not listed.',
    '',
    ...lines
  ].join('\n');
}

// Turn the customer's conversationHistory into Gemini "contents". Nothing is invented:
// only non-empty text from the provided items is used, most recent items only.
function buildContents(conversationHistory, message) {
  const contents = [];
  for (const item of conversationHistory.slice(-MAX_HISTORY_ITEMS)) {
    if (!item || typeof item !== 'object') continue;
    const text = [item.content, item.text, item.message].find((t) => typeof t === 'string' && t.trim() !== '');
    if (!text) continue;
    const role = ['assistant', 'model', 'bot'].includes(item.role) ? 'model' : 'user';
    contents.push({ role, parts: [{ text: text.trim() }] });
  }
  // Gemini expects the conversation to start with a user turn.
  while (contents.length && contents[0].role !== 'user') contents.shift();
  contents.push({ role: 'user', parts: [{ text: message.trim() }] });
  return contents;
}

const TIMEOUT = Symbol('timeout');

// One attempt on one model, limited to REQUEST_TIMEOUT_MS.
// Returns { response } on success, or { failure: <HTTP status number | 'timeout' | 'error'> }.
async function attemptModel(model, contents, systemInstruction) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(TIMEOUT);
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          abortSignal: controller.signal,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }]
        }
      }),
      timeout
    ]);
    const calls = response && response.functionCalls;
    if (Array.isArray(calls) && calls.length > 0) return { response };
    const reply = response && typeof response.text === 'string' ? response.text.trim() : '';
    return reply ? { response } : { failure: 'error' };
  } catch (err) {
    if (err === TIMEOUT) return { failure: 'timeout' };
    const status = Number(err && err.status);
    const failure = Number.isInteger(status) && status > 0 ? status : 'error';
    cooldown.markCooling(model, failure, cooldown.retryAfterSeconds(err)); // 429 / 503: skip this model for a while
    return { failure };
  } finally {
    clearTimeout(timer);
  }
}

// One attempt on any chain entry: a Gemini model name, or "extra:<model>" for the optional OpenAI-compatible provider.
async function attemptEntry(entry, contents, systemInstruction) {
  if (!extraAi.isExtra(entry)) return attemptModel(entry, contents, systemInstruction);
  const result = await extraAi.attempt(entry, contents, systemInstruction, TOOL_DECLARATIONS, REQUEST_TIMEOUT_MS);
  if (!result.response) cooldown.markCooling(entry, result.failure, result.retryAfter); // 429 / 503: skip this model for a while
  return result;
}

// Gemini models first (when a Gemini key is set), then the extra provider's models (when it is configured).
function currentChain() {
  return [...(ai ? MODEL_CHAIN : []), ...extraAi.chainEntries()];
}
const label = (entry) => (extraAi.isExtra(entry) ? 'Extra AI' : 'Gemini');
const shown = (entry) => (extraAi.isExtra(entry) ? extraAi.modelName(entry) : entry);

// Function-call turns written by one model carry that model's thought signatures. If the chain falls back to a
// different model in the middle of a tool loop, use the documented "skip validation" placeholder instead.
const turnAuthors = new WeakMap(); // model turn -> model that wrote it (kept off the objects sent to the API)

function contentsForModel(contents, model) {
  return contents.map((turn) => {
    const author = turnAuthors.get(turn);
    if (!author || author === model) return turn;
    return {
      ...turn,
      parts: turn.parts.map((part) => (part.functionCall ? { ...part, thoughtSignature: 'skip_thought_signature_validator' } : part))
    };
  });
}

// Statuses that mean the request or key is wrong: trying another model will not help.
const STOP_STATUSES = new Set([400, 401, 403]);

function reviewData() {
  return { menu: loadMenu(), promotions: loadPromotions().promotions, restaurant: loadRestaurant() };
}

// The review the customer is looking at right now, if it is still valid: shown to them and the order unchanged since.
// The "Confirm order" button is only offered while this is set. Returns null otherwise.
function validReviewVersion(state) {
  try {
    if (!ordersEnabled() || state.status !== 'draft' || !state.reviewShownVersion) return null; // no button while ordering is off
    const built = buildReview(state, reviewData());
    return built.ok && built.review.reviewVersion === state.reviewShownVersion ? built.review.reviewVersion : null;
  } catch (err) {
    return null;
  }
}

app.post('/api/chat', async (req, res) => {
  const { message, conversationHistory, sessionId: requestedSessionId } = req.body || {};

  if (message === undefined || message === null) {
    return res.status(400).json({
      error: 'Missing "message". Send JSON like {"message": "Hello", "conversationHistory": []}.'
    });
  }
  if (typeof message !== 'string') {
    return res.status(400).json({ error: '"message" must be a string.' });
  }
  if (message.trim() === '') {
    return res.status(400).json({ error: '"message" is empty. Please type something to send.' });
  }
  if (conversationHistory !== undefined && !Array.isArray(conversationHistory)) {
    return res.status(400).json({ error: '"conversationHistory" must be an array when provided.' });
  }

  // Each chat session has its own separate in-memory order state (not used by the model yet).
  const { sessionId, state: sessionState } = getOrCreateSession(requestedSessionId);
  // Sent with every reply: the session id and the review version the "Confirm order" button may use (null = no button).
  const extras = () => ({ sessionId, reviewVersion: validReviewVersion(sessionState) });

  const chain = currentChain(); // fixed for this customer message
  if (chain.length === 0) {
    console.error('Chat unavailable: GEMINI_API_KEY is not set');
    return res.status(503).json({
      error: 'The assistant is not configured on the server.',
      reply: FALLBACK_REPLY,
      ...extras()
    });
  }

  let systemInstruction;
  try {
    systemInstruction = renderPrompt(fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8'), loadRestaurant()); // facts come from data/restaurant.json
  } catch (err) {
    console.error('Chat unavailable: system prompt could not be read');
    return res.status(503).json({
      error: 'The assistant is not configured on the server.',
      reply: FALLBACK_REPLY,
      ...extras()
    });
  }

  try {
    systemInstruction += '\n\n' + buildMenuContext();
  } catch (err) {
    console.error('Chat unavailable: menu data could not be read');
    return res.status(503).json({
      error: 'The assistant is not configured on the server.',
      reply: FALLBACK_REPLY,
      ...extras()
    });
  }

  if (!ordersEnabled()) {
    systemInstruction += '\n\n' + ORDERING_OFF_NOTE;
  }

  // For this request only: remind the model of the script of the latest message (history can pull it the other way).
  if (URDU_SCRIPT.test(message)) {
    systemInstruction += '\n\n' + URDU_SCRIPT_NOTE;
  }

  const contents = buildContents(conversationHistory || [], message);
  const { state } = getOrCreateSession(sessionId); // this session's order state only

  // Tool-call loop. Each model request tries the chain in order (one attempt per model, never the same model twice).
  // The model index only moves forward, so a model that failed is not retried within this customer message.
  const startedAt = Date.now();
  let modelIndex = 0;
  let attempts = 0;
  let toolRounds = 0;
  // If every model is cooling down, start with the one whose cooldown ends first: never fail without a real attempt.
  const soonest = cooldown.earliestIfAllCooling(chain);
  if (soonest) modelIndex = chain.indexOf(soonest);

  while (true) {
    let response = null;
    let usedModel = null;

    while (modelIndex < chain.length && !response) {
      if (Date.now() - startedAt > TOTAL_DEADLINE_MS) {
        console.error('Gemini: time limit reached');
        modelIndex = chain.length;
        break;
      }
      const model = chain[modelIndex];
      const left = cooldown.secondsLeft(model);
      if (left > 0 && !(attempts === 0 && soonest === model)) {
        console.log(`${label(model)} skip: model=${shown(model)} (cooldown ${left}s)`);
        modelIndex += 1;
        continue;
      }
      attempts += 1;
      const result = await attemptEntry(model, contentsForModel(contents, model), systemInstruction);

      if (result.response) {
        console.log(`${label(model)} attempt ${attempts}: model=${shown(model)} ok`);
        cooldown.markOk(model);
        response = result.response;
        usedModel = model;
        break;
      }

      console.error(`${label(model)} attempt ${attempts}: model=${shown(model)} status=${result.failure}`);

      if (!extraAi.isExtra(model) && STOP_STATUSES.has(result.failure)) {
        // Bad request or key problem with Gemini: the other Gemini models will not help. Go on with the extra provider if there is one.
        const firstExtra = chain.findIndex((e) => extraAi.isExtra(e));
        if (firstExtra !== -1) { modelIndex = firstExtra; continue; }
        // Bad request or key problem: stop immediately, do not try more models.
        return res.status(502).json({
          error: 'The assistant could not answer right now.',
          reply: FALLBACK_REPLY,
          ...extras()
        });
      }
      // 503, 500, 504, 429, timeout, 404 (model missing) and anything else: move on to the next model.
      modelIndex += 1;
    }

    if (!response) {
      console.error(chain.some((e) => extraAi.isExtra(e)) ? 'AI: all models failed' : 'Gemini: all models failed');
      return res.status(503).json({
        error: 'The assistant is busy right now.',
        reply: BUSY_REPLY,
        ...extras()
      });
    }

    const calls = response.functionCalls;
    if (!Array.isArray(calls) || calls.length === 0) {
      console.log(`${label(usedModel)} answered: model=${shown(usedModel)}`);
      // A reply that claims the order is placed/confirmed is replaced unless the server really saved this session's order.
      const reply = guardReply(response.text.trim(), state, { customerMessage: message, ordersEnabled: ordersEnabled() });
      return res.json({ reply, ...extras() });
    }

    if (toolRounds >= MAX_TOOL_ROUNDS) {
      console.error('Gemini: tool-call limit reached');
      return res.json({ reply: TOOL_LIMIT_REPLY, ...extras() });
    }
    toolRounds += 1;
    console.log(`Tool round ${toolRounds}: ${calls.map((c) => c.name).join(', ')}`);

    // Keep the model's own function-call turn verbatim, then answer it with the tool results.
    const modelTurn = response.candidates && response.candidates[0] && response.candidates[0].content;
    const turn = modelTurn && Array.isArray(modelTurn.parts)
      ? modelTurn
      : { role: 'model', parts: calls.map((c) => ({ functionCall: c })) };
    turnAuthors.set(turn, usedModel);
    contents.push(turn);
    const results = runToolCalls(calls, { state, latestMessage: message }); // setOrderType first; results stay in the model's call order
    contents.push({
      role: 'user',
      parts: calls.map((call, i) => {
        const part = { name: call.name, response: results[i] };
        if (call.id) part.id = call.id;
        return { functionResponse: part };
      })
    });
  }
});

// The customer presses the "Confirm order" button: the ONLY way an order is confirmed. Chat text never does it.
// The server accepts it only if the reviewVersion is exactly the current one and that review was shown to the customer.
app.post('/api/order/confirm', (req, res) => {
  const { sessionId, reviewVersion } = req.body || {};
  const reject = (status, error, customerMessage) => {
    console.error(`Order confirm: rejected (${error.toUpperCase()})`);
    return res.status(status).json({ ok: false, error, customerMessage });
  };
  // Kill switch, checked first: while ordering is off nothing is confirmed and nothing is written.
  if (!ordersEnabled()) {
    return reject(503, 'ordering_disabled', ORDERING_DISABLED_MESSAGE);
  }
  if (typeof sessionId !== 'string' || typeof reviewVersion !== 'string' || !/^[0-9a-f]{16}$/.test(reviewVersion)) {
    return reject(400, 'bad_request', 'Sorry, something went wrong. Please try again.');
  }
  const session = getExistingSession(sessionId);
  if (!session) return reject(404, 'session_not_found', "Sorry, I couldn't find your order. Please start again in the chat.");
  const state = session.state;

  if (state.status !== 'draft') {
    if (state.confirmedVersion === reviewVersion && state.orderId) {
      // Pressed twice: the same saved order is reported again, nothing new is written.
      return res.json({ ok: true, confirmed: true, saved: true, orderId: state.orderId, customerMessage: state.receipt });
    }
    return reject(409, 'order_locked', 'This order has already been confirmed and cannot be changed here.');
  }

  let built;
  try {
    built = buildReview(state, reviewData());
  } catch (err) {
    return reject(500, 'server_error', 'Sorry, something went wrong. Please try again.');
  }
  if (!built.ok) return reject(409, 'review_not_ready', 'Your order is not ready to confirm yet. Please finish the details in the chat.');
  if (built.review.reviewVersion !== reviewVersion) {
    return reject(409, 'review_outdated', 'Your order changed after the review. Please ask for the review again and check it before confirming.');
  }
  if (state.reviewShownVersion !== reviewVersion) {
    return reject(409, 'review_not_shown', 'Please review your order in the chat before confirming it.');
  }

  // Save first. Only a saved order counts: if the save fails nothing is confirmed and no receipt is shown.
  let saved;
  try {
    saved = saveConfirmedOrder({ sessionId, reviewVersion, review: built.review });
  } catch (err) {
    console.error('Order confirm: save failed');
    return res.status(500).json({ ok: false, error: 'save_failed', customerMessage: SAVE_FAILED_MESSAGE });
  }
  state.confirmed = true;
  state.status = 'confirmed';
  state.confirmedVersion = reviewVersion;
  state.orderId = saved.order.id;
  state.receipt = receiptMessage(saved.order);
  console.log(`Order confirm: ${saved.created ? 'saved' : 'already saved'} ${saved.order.id}`);
  return res.json({ ok: true, confirmed: true, saved: true, orderId: saved.order.id, customerMessage: state.receipt });
});

app.use(staff.router); // /staff and /api/staff/*: fail closed without STAFF_PASSWORD

// Error handling: bad JSON gets a 400, anything else a generic 500 (nothing sensitive is logged or returned).
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  console.error('Unexpected server error');
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// "npm start" listens as before. On Vercel (which sets VERCEL) the platform calls the exported app instead (see api/index.js).
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;

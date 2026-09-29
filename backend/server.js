const fs = require('fs');
const path = require('path');
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_FALLBACK_MODELS = 'gemini-3.7-flash,gemini-flash-latest';
const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt.md');
const MAX_HISTORY_ITEMS = 10;
const REQUEST_TIMEOUT_MS = 20000;
const URDU_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const URDU_SCRIPT_NOTE = "The customer's latest message is written in Urdu script. Reply in Urdu script.";
const FALLBACK_REPLY = 'Please try again or contact staff.';
const BUSY_REPLY = 'Assistant is busy right now, please try again in a minute.';

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
// Returns { reply } on success, or { failure: <HTTP status number | 'timeout' | 'error'> }.
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
        config: { systemInstruction, abortSignal: controller.signal }
      }),
      timeout
    ]);
    const reply = typeof response.text === 'string' ? response.text.trim() : '';
    return reply ? { reply } : { failure: 'error' };
  } catch (err) {
    if (err === TIMEOUT) return { failure: 'timeout' };
    const status = Number(err && err.status);
    return { failure: Number.isInteger(status) && status > 0 ? status : 'error' };
  } finally {
    clearTimeout(timer);
  }
}

// Statuses that mean the request or key is wrong: trying another model will not help.
const STOP_STATUSES = new Set([400, 401, 403]);

app.post('/api/chat', async (req, res) => {
  const { message, conversationHistory } = req.body || {};

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

  if (!ai) {
    console.error('Chat unavailable: GEMINI_API_KEY is not set');
    return res.status(503).json({
      error: 'The assistant is not configured on the server.',
      reply: FALLBACK_REPLY
    });
  }

  let systemInstruction;
  try {
    systemInstruction = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
  } catch (err) {
    console.error('Chat unavailable: system prompt could not be read');
    return res.status(503).json({
      error: 'The assistant is not configured on the server.',
      reply: FALLBACK_REPLY
    });
  }

  // For this request only: remind the model of the script of the latest message (history can pull it the other way).
  if (URDU_SCRIPT.test(message)) {
    systemInstruction += '\n\n' + URDU_SCRIPT_NOTE;
  }

  const contents = buildContents(conversationHistory || [], message);

  // One attempt per model, in order. Each model has its own quota, so never retry the same model.
  for (let i = 0; i < MODEL_CHAIN.length; i++) {
    const model = MODEL_CHAIN[i];
    const result = await attemptModel(model, contents, systemInstruction);

    if (result.reply) {
      console.log(`Gemini attempt ${i + 1}: model=${model} answered`);
      return res.json({ reply: result.reply });
    }

    console.error(`Gemini attempt ${i + 1}: model=${model} status=${result.failure}`);

    if (STOP_STATUSES.has(result.failure)) {
      // Bad request or key problem: stop immediately, do not try more models.
      return res.status(502).json({
        error: 'The assistant could not answer right now.',
        reply: FALLBACK_REPLY
      });
    }
    // 503, 500, 504, 429, timeout, 404 (model missing) and anything else: move on to the next model.
  }

  console.error('Gemini: all models failed');
  return res.status(503).json({
    error: 'The assistant is busy right now.',
    reply: BUSY_REPLY
  });
});

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

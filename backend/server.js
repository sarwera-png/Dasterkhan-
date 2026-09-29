const fs = require('fs');
const path = require('path');
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;

const MODEL = 'gemini-3.8-flash';
const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt.md');
const MAX_HISTORY_ITEMS = 10;
const FALLBACK_REPLY = 'Please try again or contact staff.';

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

  try {
    const systemInstruction = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: buildContents(conversationHistory || [], message),
      config: { systemInstruction }
    });

    const reply = typeof response.text === 'string' ? response.text.trim() : '';
    if (!reply) {
      throw new Error('empty response');
    }
    return res.json({ reply });
  } catch (err) {
    // Do not log or return the raw error: it could contain provider details.
    console.error('Chat request failed');
    return res.status(502).json({
      error: 'The assistant could not answer right now.',
      reply: FALLBACK_REPLY
    });
  }
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

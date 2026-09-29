const path = require('path');
const express = require('express');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Placeholder chat route: no Claude API call yet.
app.post('/api/chat', (req, res) => {
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

  res.json({
    reply: "Hi! I'm Dastarkhwan Assistant. My AI brain isn't connected yet."
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

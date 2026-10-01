// Optional extra AI provider with an OpenAI-compatible Chat Completions API (Groq, OpenRouter, ...), used only AFTER
// the whole Gemini chain. Configured by three environment names: EXTRA_AI_BASE_URL, EXTRA_AI_API_KEY, EXTRA_AI_MODELS.
// If any of them is missing or invalid the provider is off and the app behaves exactly as without it.
// The tools, their validation and every other rule stay in code: this file only translates formats.
const PREFIX = 'extra:'; // chain entries and cooldown keys for extra models look like "extra:<model id>"

function config(env = process.env) {
  const base = String(env.EXTRA_AI_BASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env.EXTRA_AI_API_KEY || '').trim();
  const models = [];
  for (const m of String(env.EXTRA_AI_MODELS || '').split(',')) { const name = m.trim(); if (name && !models.includes(name)) models.push(name); }
  if (!base || !key || models.length === 0) return null;
  let url;
  try { url = new URL(base); } catch (e) { return null; }
  const localTest = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !localTest) return null; // the key is only ever sent over https (or to localhost in tests)
  return { endpoint: base + '/chat/completions', key, models };
}

// Chain entries for the extra models, in the configured order ([] when the provider is off).
function chainEntries(env = process.env) { const c = config(env); return c ? c.models.map((m) => PREFIX + m) : []; }
const isExtra = (entry) => typeof entry === 'string' && entry.startsWith(PREFIX);
const modelName = (entry) => entry.slice(PREFIX.length);

// Gemini declarations use upper-case type names (OBJECT, STRING, ...); OpenAI tools use JSON Schema.
function toJsonSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v);
  return out;
}
function toTools(declarations) {
  return declarations.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters ? toJsonSchema(d.parameters) : { type: 'object', properties: {} } } }));
}

// The app's internal conversation (Gemini-style turns) -> OpenAI messages.
function toMessages(systemInstruction, contents) {
  const messages = [{ role: 'system', content: systemInstruction }];
  let pending = []; let counter = 0;
  for (const turn of contents) {
    const parts = Array.isArray(turn.parts) ? turn.parts : [];
    const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('');
    if (turn.role === 'model') {
      const fcs = parts.filter((p) => p.functionCall);
      if (fcs.length) {
        pending = fcs.map((p) => p.functionCall.id || `call_${(counter += 1)}`);
        messages.push({ role: 'assistant', content: text || null, tool_calls: fcs.map((p, i) => ({ id: pending[i], type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } })) });
      } else if (text) messages.push({ role: 'assistant', content: text });
    } else {
      parts.filter((p) => p.functionResponse).forEach((p, i) => messages.push({ role: 'tool', tool_call_id: p.functionResponse.id || pending[i] || `call_unknown_${i}`, content: JSON.stringify(p.functionResponse.response) }));
      if (text) messages.push({ role: 'user', content: text });
    }
  }
  return messages;
}

// OpenAI response -> the shape the chat loop already understands, or { failure: <reason> }. Anything malformed fails the whole attempt:
// no partial or invalid tool call is ever returned.
function parseResponse(json, toolNames) {
  const message = json && Array.isArray(json.choices) && json.choices[0] && json.choices[0].message;
  if (!message || typeof message !== 'object') return { failure: 'bad_response' };
  const raw = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (raw.length > 0) {
    const calls = [];
    for (const tc of raw) {
      const fn = tc && tc.function;
      if (!tc || tc.type !== 'function' || !fn || typeof fn.name !== 'string') return { failure: 'bad_tool_call' };
      if (!toolNames.has(fn.name)) return { failure: 'unknown_tool' };
      let args;
      if (fn.arguments === undefined || fn.arguments === null || (typeof fn.arguments === 'string' && fn.arguments.trim() === '')) args = {};
      else if (typeof fn.arguments === 'object' && !Array.isArray(fn.arguments)) args = fn.arguments;
      else { try { args = JSON.parse(fn.arguments); } catch (e) { return { failure: 'bad_tool_args' }; } }
      if (!args || typeof args !== 'object' || Array.isArray(args)) return { failure: 'bad_tool_args' };
      calls.push({ id: typeof tc.id === 'string' && tc.id ? tc.id : `call_r${calls.length + 1}`, name: fn.name, args });
    }
    return { response: { functionCalls: calls, text: '', candidates: [{ content: { role: 'model', parts: calls.map((c) => ({ functionCall: c })) } }] } };
  }
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  if (!text) return { failure: 'empty_reply' };
  return { response: { functionCalls: [], text, candidates: [{ content: { role: 'model', parts: [{ text }] } }] } };
}

// One attempt on one extra model. Returns { response } or { failure, retryAfter? }. Never throws.
// failure: HTTP status number, 'timeout', 'error', or a reason keyword (bad_response, bad_tool_call, unknown_tool, bad_tool_args, empty_reply).
async function attempt(entry, contents, systemInstruction, declarations, timeoutMs, env = process.env) {
  const c = config(env);
  if (!c || !isExtra(entry)) return { failure: 'error' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(c.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
      body: JSON.stringify({ model: modelName(entry), messages: toMessages(systemInstruction, contents), tools: toTools(declarations) }),
      signal: controller.signal
    });
    if (!res.ok) {
      const ra = res.headers.get('retry-after');
      return { failure: res.status, retryAfter: ra && /^\d+$/.test(ra.trim()) ? Number(ra.trim()) : null };
    }
    const json = await res.json();
    return parseResponse(json, new Set(declarations.map((d) => d.name)));
  } catch (err) {
    return { failure: controller.signal.aborted ? 'timeout' : 'error' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { config, chainEntries, isExtra, modelName, attempt, toMessages, toTools, parseResponse, PREFIX };

// Test stub (never a real AI call): keeps the real SDK types but replaces the Gemini client with a scripted fake.
const Module = require('module'); const orig = Module._load;
Module._load = function (req, ...rest) {
  const real = orig.call(this, req, ...rest);
  if (req === '@google/genai') return { ...real, GoogleGenAI: class { constructor() { this.models = { generateContent: (args) => global.__STUB(args) }; } } };
  return real;
};

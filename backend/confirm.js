// Decides whether a customer's message is a clear, unambiguous "yes". Software decides this, never the model.
// Only whole messages that are a clear yes count ("yes", "haan sahi hai", "جی ہاں"). Anything else does not:
// "ok", "theek hai", "hmm", "maybe", "let me ask my family", "yes but change the street", ...
const CLEAR_YES = new Set([
  // English
  'yes', 'yes please', 'yes thanks', 'yes thank you', 'yes correct', 'yes it is correct', 'yes that is correct', 'yes thats correct', 'yes its correct',
  'yes right', 'yes that is right', 'yes thats right', 'yes confirm', 'yes confirmed', 'yes i confirm', 'yes it is right', 'yes its right',
  'correct', 'that is correct', 'thats correct', 'it is correct', 'its correct', 'right', 'that is right', 'thats right', 'confirmed', 'confirm', 'yep', 'yup',
  // Roman Urdu
  'haan', 'han', 'haan ji', 'han ji', 'ji haan', 'ji han', 'haan sahi hai', 'han sahi hai', 'haan ji sahi hai', 'ji haan sahi hai', 'haan bilkul', 'han bilkul',
  'bilkul', 'bilkul sahi', 'bilkul sahi hai', 'ji bilkul', 'sahi hai', 'ji sahi hai', 'jee haan', 'haan confirm', 'han confirm',
  // Urdu script
  'ہاں', 'جی ہاں', 'جی ہاں صحیح ہے', 'ہاں صحیح ہے', 'ہاں جی', 'ہاں جی صحیح ہے', 'صحیح ہے', 'جی صحیح ہے', 'بالکل', 'بالکل صحیح', 'بالکل صحیح ہے', 'جی بالکل', 'ہاں بالکل',
  'درست ہے', 'جی درست ہے', 'ہاں درست ہے', 'جی ہاں درست ہے'
]);

function normalizeReply(text) {
  return String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ـً-ٟ]/g, '') // tatweel and Arabic diacritics
    .replace(/['’`]/g, '') // apostrophes: "that's" -> "thats"
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation, emoji, symbols
    .replace(/\s+/g, ' ')
    .trim();
}

function isClearYes(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 80) return false;
  return CLEAR_YES.has(normalizeReply(text));
}

module.exports = { isClearYes };

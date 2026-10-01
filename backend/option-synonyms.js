// Understands the common English, Urdu-script and Roman Urdu ways of naming the menu's option choices, so "کم مرچ" or
// "chutney ke sath" is stored as the real choice ("mild", "with"). Matching is on the WHOLE phrase only (case, spacing and
// punctuation ignored): nothing is guessed. Words that do not name a listed choice (for example "تیز" / "teez" / "extra spicy":
// there is no hot option) match nothing, so the customer is asked again. The result is always checked against the menu's own choices.
const NAME_WORDS = {
  spice: ['spice', 'spice level', 'mirch', 'mirchi', 'مرچ', 'مرچی'],
  chutney: ['chutney', 'چٹنی']
};
const CHOICE_WORDS = {
  spice: {
    mild: ['mild', 'kam mirch', 'kam', 'halki', 'halki mirch', 'کم مرچ', 'کم', 'ہلکی', 'ہلکی مرچ', 'less spicy', 'not spicy'],
    regular: ['regular', 'normal', 'medium', 'aam', 'عام', 'نارمل']
  },
  chutney: {
    with: ['with', 'with chutney', 'chutney ke sath', 'chutney k sath', 'chutney ke saath', 'chutney k saath', 'چٹنی کے ساتھ', 'haan chutney'],
    without: ['without', 'no chutney', 'chutney ke baghair', 'chutney k baghair', 'chutney ke bagair', 'bina chutney', 'چٹنی کے بغیر', 'chutney nahi']
  }
};

// Lower case, Arabic diacritics removed, Arabic letter variants unified, punctuation to spaces, spaces collapsed.
function fold(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFKC').toLowerCase()
    .replace(/[ـً-ٰٟ]/g, '')
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const NAME_INDEX = new Map(); for (const [name, words] of Object.entries(NAME_WORDS)) for (const w of words) NAME_INDEX.set(fold(w), name);
const CHOICE_INDEX = {}; for (const [name, choices] of Object.entries(CHOICE_WORDS)) { CHOICE_INDEX[name] = new Map(); for (const [choice, words] of Object.entries(choices)) for (const w of words) CHOICE_INDEX[name].set(fold(w), choice); }

// The menu option name ("spice", "chutney") that a spelling stands for, or null.
const canonicalName = (raw) => NAME_INDEX.get(fold(raw)) || null;
// The choice ("mild", "with", ...) that a phrase stands for within the given option, or null. optionName: the menu's own option name.
function canonicalChoice(optionName, raw) {
  const map = CHOICE_INDEX[fold(optionName)];
  return map ? (map.get(fold(raw)) || null) : null;
}

module.exports = { canonicalName, canonicalChoice, fold, NAME_WORDS, CHOICE_WORDS };

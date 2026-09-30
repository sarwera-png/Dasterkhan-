// Safety net for assistant replies: the model must never tell the customer that an order is placed, confirmed or sent
// unless the server really saved it. Only the code (the Confirm button + saved order id) can say that.
const { ORDERING_DISABLED_MESSAGE } = require('./config');

const URDU_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const SENTENCE_SPLIT = /[.!?\n۔؟]+/;

// A sentence that negates, asks or only describes a condition is not a claim ("orders cannot be placed", "it is placed only when you press...").
// Kept narrow on purpose: "confirmed and will be ready soon" is still a claim.
const NEGATION_EN = /\b(?:not|never|cannot|until|unless|if|whether|yet|press|button)\b|n't\b|\bonly (?:when|after|once|if)\b|\b(?:will|can|could|would|should|must) be (?:placed|confirmed|submitted|sent)\b|\bto be (?:placed|confirmed)\b/i;
const NEGATION_TOKENS = new Set(['نہیں', 'نہ', 'جب', 'تک', 'صرف', 'اگر', 'بٹن', 'پہلے', 'دبائیں', 'nahi', 'nahin', 'nhi', 'jab', 'tak', 'sirf', 'agar', 'button', 'pehle', 'dabayein', 'dabaein']);

const CLAIM_EN = [
  /\border\b[^.!?\n]{0,30}\b(?:is|has been|was|got|been|now|is now)\s+(?:confirmed|placed|submitted|saved|sent|received|booked|complete|completed|done|processed|registered)\b/i,
  /\border\s+(?:placed|confirmed|submitted|received|booked|complete|completed)\b/i,
  /\b(?:i|we)(?:'ve|\s+have|'ll|\s+will)?\s+(?:placed|confirmed|submitted|sent|saved|booked|received|registered)\s+(?:your|the|this)\s+order\b/i,
  /\b(?:placed|confirmed|submitted|sent|forwarded)\s+(?:your|the)\s+order\b/i,
  /\bsent\s+(?:it\s+|your order\s+)?to\s+(?:the\s+)?(?:kitchen|restaurant)\b/i,
  /\border\b[^.!?\n]{0,30}\b(?:on its way|being prepared|is preparing|is being made)\b/i
];
const CLAIM_UR = [
  /آرڈر[^۔.!?\n]{0,40}(?:کنفرم\s+ہو\s*(?:گیا|گئی|چکا|چکی)|کنفرم\s+ہے|کنفرم\s+کر\s+دیا|تصدیق\s+ہو\s*(?:گئی|چکی)|ہو\s*گیا|ہو\s*چکا|بھیج\s+دیا|موصول|پلیس\s+(?:ہو|کر)|درج\s+ہو|قبول\s+ہو|مکمل\s+ہو|لگ\s+گیا)/,
  /(?:کنفرم\s+ہو\s*(?:گیا|گئی)|کنفرم\s+کر\s+دیا)[^۔.!?\n]{0,25}آرڈر/,
  /آرڈر[^۔.!?\n]{0,30}(?:باورچی\s*خانے|کچن|ریسٹورنٹ)[^۔.!?\n]{0,15}بھیج/
];
const CLAIM_RU = [
  /\border\b[^.!?\n]{0,40}\b(?:ho\s*gaya|ho\s*gayi|ho\s*chuka|confirm\s+ho|confirm\s+hai|confirm\s+kar\s+diya|place\s+ho|place\s+kar\s+diya|submit\s+ho|bhej\s+diya|bhej\s+di|mil\s+gaya|receive\s+ho|lag\s+gaya|book\s+ho)\b/i,
  /\bconfirm\s+ho\s+(?:gaya|gayi)\b[^.!?\n]{0,20}\border\b/i
];

function tokens(sentence) { return sentence.split(/[\s,،:;"'()]+/).filter(Boolean); }

function claimsOrderPlaced(text) {
  if (typeof text !== 'string') return false;
  return text.split(SENTENCE_SPLIT).some((sentence) => {
    if (!sentence.trim()) return false;
    if (URDU_SCRIPT.test(sentence) ? tokens(sentence).some((t) => NEGATION_TOKENS.has(t)) : (NEGATION_EN.test(sentence) || tokens(sentence).some((t) => NEGATION_TOKENS.has(t.toLowerCase())))) return false;
    return [...CLAIM_EN, ...CLAIM_UR, ...CLAIM_RU].some((re) => re.test(sentence));
  });
}

const ROMAN_HINTS = /\b(aap|aapka|aapki|hai|hain|nahi|nahin|kar|karo|karna|karein|chahiye|chahie|mujhe|mera|meri|ji|theek|thik|acha|accha|bhai|dein|dijiye|do|ko|ka|ki|ke|mein|se|kya|ho|gaya|abhi|shukriya|jaldi|bhej|bata|batao)\b/i;

function detectLanguage(customerMessage, reply) {
  if (URDU_SCRIPT.test(customerMessage || '')) return 'ur';
  if (ROMAN_HINTS.test(customerMessage || '')) return 'roman';
  if (URDU_SCRIPT.test(reply || '')) return 'ur';
  if (CLAIM_RU.some((re) => re.test(reply || ''))) return 'roman';
  return 'en';
}

const NOT_PLACED = {
  en: 'Your order has not been placed yet. It is placed only after you check the order review and press the "Confirm order" button below the chat.',
  ur: 'آپ کا آرڈر ابھی تک نہیں دیا گیا۔ آرڈر صرف اس وقت دیا جاتا ہے جب آپ آرڈر کا جائزہ دیکھ کر چیٹ کے نیچے "Confirm order" کا بٹن دبائیں۔',
  roman: 'Aap ka order abhi place nahi hua. Order sirf tab place hota hai jab aap order review check kar ke chat ke neeche "Confirm order" button dabayein.'
};
const DEMO = {
  en: ORDERING_DISABLED_MESSAGE,
  ur: 'یہ ایک ڈیمو ہے، اس لیے ابھی آرڈر نہیں دیے جا سکتے۔',
  roman: 'Yeh ek demo hai, is liye abhi orders place nahi kiye ja sakte.'
};

// Returns the reply to send. A claim that an order is placed is only allowed after the server saved this session's order.
function guardReply(reply, state, { customerMessage, ordersEnabled }) {
  const saved = !!(state && state.orderId && state.confirmedVersion && state.status !== 'draft');
  if (saved || !claimsOrderPlaced(reply)) return reply;
  console.log('Guard: fake-confirmation blocked');
  const lang = detectLanguage(customerMessage, reply);
  return (ordersEnabled ? NOT_PLACED : DEMO)[lang];
}

module.exports = { guardReply, claimsOrderPlaced, detectLanguage, NOT_PLACED, DEMO };

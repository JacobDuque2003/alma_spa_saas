const dictionary = require('./synonyms.json');

function normalizeText(value, { preserveDatePunctuation = false } = {}) {
  let text = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  text = text.replace(/([a-z])\1{2,}/g, '$1');
  text = text.replace(preserveDatePunctuation ? /[^a-z0-9\s:/.-]+/g : /[^a-z0-9\s]+/g, ' ');
  return text.split(/\s+/).filter(Boolean).map((word) => dictionary.words[word] || word).join(' ').trim();
}

function synonymIntent(value) {
  const text = normalizeText(value);
  for (const [intent, phrases] of Object.entries(dictionary.intents)) {
    if (phrases.some((phrase) => text === phrase || text.includes(` ${phrase}`) || text.startsWith(`${phrase} `))) return intent;
  }
  return null;
}
module.exports = { normalizeText, synonymIntent };

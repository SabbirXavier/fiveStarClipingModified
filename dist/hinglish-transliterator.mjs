import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Sanscript = require('@indic-transliteration/sanscript');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICT_PATH = path.join(__dirname, 'hinglish-dict.json');

let dictionary = {};

function loadDictionary() {
  try {
    if (fs.existsSync(DICT_PATH)) {
      const raw = fs.readFileSync(DICT_PATH, 'utf8');
      dictionary = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[Hinglish] Could not load hinglish-dict.json:', err.message);
  }
}

// Initial load
loadDictionary();

export function getDictionary() {
  loadDictionary();
  return dictionary;
}

export function updateDictionary(newDict) {
  dictionary = { ...dictionary, ...newDict };
  fs.writeFileSync(DICT_PATH, JSON.stringify(dictionary, null, 2), 'utf8');
  return dictionary;
}

/**
 * Normalizes academic ITRANS output into natural Roman Hinglish:
 * - Strips retroflex capitals: T -> t, D -> d, N -> n, L -> l
 * - Normalizes double vowels: aa -> a, ii -> i, uu -> u, ee -> e, oo -> o
 * - Handles nuktas: j़ -> z, ph़/f़ -> f, kh़ -> kh, g़ -> gh, k़ -> q
 * - Terminal schwa deletion: strips trailing 'a' on multi-syllable words
 * - Clean nasal consonants: M -> n, ~n -> n
 */
export function normalizeITRANS(s) {
  let res = s
    .replace(/[jJ]a?[\u093c़]/g, 'z')
    .replace(/ph[\u093c़]|फ़/g, 'f')
    .replace(/kh[\u093c़]|ख़/g, 'kh')
    .replace(/g[\u093c़]|ग़/g, 'gh')
    .replace(/k[\u093c़]|क़/g, 'q')
    .replace(/[\u093c़]/g, '')
    .replace(/Ch/g, 'chh')
    .replace(/ch/g, 'ch')
    .replace(/shh|Sh/g, 'sh')
    .replace(/RRi|R\^i/g, 'ri')
    .replace(/T/g, 't')
    .replace(/D/g, 'd')
    .replace(/N/g, 'n')
    .replace(/L/g, 'l')
    .replace(/M(?=[bcdfghjklmnpqrstvwxyz]|$)/gi, 'n')
    .replace(/M/g, 'n')
    .replace(/H/g, 'h')
    .replace(/~n|~N/g, 'n')
    .replace(/aa/g, 'a')
    .replace(/ii/g, 'i')
    .replace(/uu/g, 'u')
    .replace(/ee/g, 'e')
    .replace(/oo/g, 'o')
    .replace(/([bcdfghjklmnpqrstvwxyz])I/gi, '$1i')
    .replace(/([bcdfghjklmnpqrstvwxyz])U/gi, '$1u')
    .replace(/A/g, 'a');

  // Terminal schwa deletion: strip ending 'a' on words longer than 2 characters
  if (res.length > 2 && /[^aeiou]a$/i.test(res)) {
    res = res.slice(0, -1);
  }
  return res.toLowerCase();
}

/**
 * Transliterates a single token or bracketed sound tag.
 */
export function transliterateToken(raw) {
  if (!raw || typeof raw !== 'string') return raw;

  // Preserve bracket sound tags like [चीखने की आवाज़]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    if (dictionary[raw]) return dictionary[raw];
    const inner = raw.slice(1, -1);
    const convertedInner = inner
      .split(/\s+/)
      .map(w => transliterateToken(w))
      .join(' ');
    // Title-case bracketed sound descriptions cleanly
    const titleCased = convertedInner.replace(/\b\w/g, c => c.toUpperCase());
    return '[' + titleCased + ']';
  }

  // Devanagari core letters & marks (excluding dandas \u0964, \u0965 and punctuation)
  const punctMatch = raw.match(
    /^([^a-zA-Z0-9\u0900-\u0963\u0966-\u096F\u0971-\u097F]*)([a-zA-Z0-9\u0900-\u0963\u0966-\u096F\u0971-\u097F\s_-]+?)([^a-zA-Z0-9\u0900-\u0963\u0966-\u096F\u0971-\u097F]*)$/
  );
  if (!punctMatch) return raw;

  let lead = punctMatch[1].replace(/[\u0964\u0965]/g, '.');
  let core = punctMatch[2];
  let trail = punctMatch[3].replace(/[\u0964\u0965]/g, '.');

  // Also check normalized nukta variant for dict (e.g. लूज़ vs लूज)
  const coreWithoutNukta = core.replace(/[\u093C]/g, '');

  if (dictionary[core]) {
    return lead + dictionary[core] + trail;
  }
  if (dictionary[coreWithoutNukta]) {
    return lead + dictionary[coreWithoutNukta] + trail;
  }

  // If already non-Devanagari, return as is (preserving punctuation fixes)
  if (!/[\u0900-\u097F]/.test(core)) {
    return lead + core + trail;
  }

  // Transliterate with Sanscript (devanagari -> itrans with syncope: true for Hindi schwa deletion)
  const itrans = Sanscript.t(core, 'devanagari', 'itrans', { syncope: true });
  const normalized = normalizeITRANS(itrans);

  return lead + normalized + trail;
}

/**
 * Transliterates a full string of text (e.g., subtitle line).
 */
export function transliterateText(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .split(/(\s+)/)
    .map(token => {
      if (/^\s+$/.test(token)) return token;
      return transliterateToken(token);
    })
    .join('');
}

/**
 * Transliterates an array of word tokens, keeping timestamps and other metadata intact.
 */
export function transliterateWords(words) {
  if (!Array.isArray(words)) return [];
  return words.map(w => {
    if (!w || typeof w !== 'object') return w;
    return {
      ...w,
      text: transliterateToken(w.text || '')
    };
  });
}

/**
 * Checks if words or string contain Devanagari characters.
 */
export function hasDevanagari(input) {
  if (!input) return false;
  if (typeof input === 'string') {
    return /[\u0900-\u097F]/.test(input);
  }
  if (Array.isArray(input)) {
    return input.some(w => w && typeof w.text === 'string' && /[\u0900-\u097F]/.test(w.text));
  }
  return false;
}

export default {
  transliterateWords,
  transliterateText,
  transliterateToken,
  normalizeITRANS,
  getDictionary,
  updateDictionary,
  hasDevanagari
};

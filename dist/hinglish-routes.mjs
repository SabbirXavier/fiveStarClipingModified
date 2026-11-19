import {
  transliterateWords,
  transliterateText,
  getDictionary,
  updateDictionary,
  hasDevanagari
} from './hinglish-transliterator.mjs';

export function registerHinglishRoutes(app) {
  // Transliterate words array or texts array to natural Hinglish
  app.post('/api/transliterate/hinglish', (req, res) => {
    try {
      const { words, texts, text } = req.body || {};

      if (Array.isArray(words)) {
        const converted = transliterateWords(words);
        return res.json({
          ok: true,
          words: converted,
          count: converted.length,
          hadDevanagari: hasDevanagari(words)
        });
      }

      if (Array.isArray(texts)) {
        const converted = texts.map(t => transliterateText(t));
        return res.json({
          ok: true,
          texts: converted,
          count: converted.length
        });
      }

      if (typeof text === 'string') {
        const converted = transliterateText(text);
        return res.json({
          ok: true,
          text: converted
        });
      }

      return res.status(400).json({
        ok: false,
        error: 'Missing words, texts, or text in request body'
      });
    } catch (err) {
      console.error('[Hinglish API] Transliteration error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Get current customizable dictionary
  app.get('/api/transliterate/dictionary', (req, res) => {
    try {
      const dict = getDictionary();
      return res.json({ ok: true, dictionary: dict });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Update or add custom dictionary terms
  app.post('/api/transliterate/dictionary', (req, res) => {
    try {
      const newTerms = req.body || {};
      const updated = updateDictionary(newTerms);
      return res.json({
        ok: true,
        count: Object.keys(updated).length,
        dictionary: updated
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
}

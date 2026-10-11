/*
 * Text normalisation shared by keyword terms and YouTube titles.
 * Pure module: runs as a content script (attaches to globalThis.Restrict)
 * and under Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  const R = (root.Restrict = root.Restrict || {});

  // Letters that NFKD does not decompose but that people type both ways.
  const FOLD = {
    'ı': 'i', // Turkish dotless i
    'ł': 'l',
    'đ': 'd',
    'ø': 'o',
    'ß': 'ss',
    'æ': 'ae',
    'œ': 'oe',
    '’': "'", // curly apostrophes, so "O’Brien" equals "O'Brien"
    '‘': "'",
  };
  const FOLD_RE = new RegExp('[' + Object.keys(FOLD).join('') + ']', 'g');

  // Zero-width and soft-hyphen characters used to break up words.
  const INVISIBLE_RE = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g;

  /**
   * NFKD (also folds "fancy" Unicode letters such as 𝐂𝐀𝐒𝐈𝐍𝐎 to ASCII),
   * strip combining marks, lowercase, fold special letters, collapse whitespace.
   * Cyrillic and other scripts are kept.
   */
  function normalize(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .replace(INVISIBLE_RE, '')
      .toLowerCase()
      .replace(FOLD_RE, (ch) => FOLD[ch])
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Channel handle in canonical form: lowercase, leading "@", URL-decoded. */
  function normalizeHandle(handle) {
    if (!handle) return '';
    let h = String(handle).trim();
    try {
      h = decodeURIComponent(h);
    } catch (e) {
      /* keep raw value */
    }
    h = h.replace(/^https?:\/\/[^/]+\//i, '').replace(/^\/+/, '');
    h = h.split(/[/?#]/)[0];
    if (!h) return '';
    if (!h.startsWith('@')) h = '@' + h;
    return h.toLowerCase();
  }

  R.normalize = normalize;
  R.normalizeHandle = normalizeHandle;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalize, normalizeHandle };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

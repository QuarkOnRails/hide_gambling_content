/*
 * Keyword scoring + channel lookup. Pure module (no DOM, no extension APIs).
 *
 * Keyword entry syntax (used in data/keywords/*.json and user keywords):
 *   "bonus buy"            phrase; spaces/hyphens also match "bonus-buy", "bonusbuy"
 *   "slot|slots"           alternates of ONE concept, counted once per title
 *   "лудоман*"             trailing * allows any word ending (inflection, suffixes)
 *
 * Scoring: every distinct strong concept = 2, every distinct weak concept = 1.
 * A video is hidden when score >= threshold (default 2).
 */
(function (root) {
  'use strict';

  const R = (root.Restrict = root.Restrict || {});
  const norm =
    typeof require === 'function' && typeof module !== 'undefined' && module.exports
      ? require('./normalize.js')
      : { normalize: R.normalize, normalizeHandle: R.normalizeHandle };

  const STRONG_POINTS = 2;
  const WEAK_POINTS = 1;
  const DEFAULT_THRESHOLD = 2;

  const WORD = '[\\p{L}\\p{N}]';
  const GAP = '[\\s\\p{P}]{0,3}'; // what may stand where a term has a space or hyphen
  const BEFORE = '(?<!' + WORD + ')';
  const AFTER = '(?!' + WORD + ')';

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  }

  /** One alternate ("free spins", "лудоман*") -> regex source without boundaries. */
  function altToSource(alt) {
    let a = alt;
    const wildcard = a.endsWith('*');
    if (wildcard) a = a.slice(0, -1);
    const parts = a
      .split(/[\s-]+/)
      .filter(Boolean)
      .map(escapeRe);
    if (!parts.length) return null;
    let src = parts.join(GAP);
    if (wildcard) src += WORD + '*';
    return src;
  }

  /** Split an entry into normalised alternates. */
  function parseEntry(entry) {
    if (typeof entry !== 'string') return [];
    return entry
      .split('|')
      .map((s) => norm.normalize(s))
      .filter(Boolean);
  }

  /**
   * Compile a list of entries into one global regex plus a way to map a
   * matched string back to its concept (so "slot" and "slots" count once,
   * also across languages that share a word).
   */
  function compileTier(entries) {
    const altConcept = new Map(); // alt -> concept key
    const complex = []; // alternates that cannot be looked up literally

    for (const entry of entries || []) {
      const alts = parseEntry(entry);
      if (!alts.length) continue;
      let concept = null;
      for (const alt of alts) {
        if (altConcept.has(alt)) {
          concept = altConcept.get(alt);
          break;
        }
      }
      if (!concept) concept = alts[0];
      for (const alt of alts) {
        if (!altConcept.has(alt)) altConcept.set(alt, concept);
      }
    }

    const alts = Array.from(altConcept.keys()).sort((a, b) => b.length - a.length);
    const sources = [];
    for (const alt of alts) {
      const src = altToSource(alt);
      if (!src) continue;
      sources.push(src);
      if (/[\s*-]/.test(alt)) {
        complex.push({ re: new RegExp('^' + src + '$', 'u'), concept: altConcept.get(alt) });
      }
    }
    if (!sources.length) return null;

    const re = new RegExp(BEFORE + '(?:' + sources.join('|') + ')' + AFTER, 'gu');

    function conceptOf(matched) {
      if (altConcept.has(matched)) return altConcept.get(matched);
      for (const c of complex) if (c.re.test(matched)) return c.concept;
      return matched;
    }

    /**
     * Distinct concepts found in an already normalised text, reported as the
     * text that actually matched (clearer to a reader than the concept key).
     */
    function find(text) {
      const found = new Map(); // concept -> first matched text
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const concept = conceptOf(m[0]);
        if (!found.has(concept)) found.set(concept, m[0]);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return Array.from(found.values());
    }

    return { re, find };
  }

  /** "Mr. Hand Pay", "@MrHandPay" and "mrhandpay" all become "mrhandpay". */
  function compact(text) {
    return norm.normalize(text).replace(/[^\p{L}\p{N}]+/gu, '');
  }

  const MIN_KEY = 3; // shorter compact keys are too ambiguous to match on

  /**
   * Channels are matched by id, or by a compact key built from BOTH the handle
   * and the display name. A list entry may only say "MrHandPay" while the page
   * shows "Mr. Hand Pay" with the link /@mrhandpay: all of these meet in one key.
   * YouTube cards expose an id only rarely, so this is what matches in practice.
   */
  function channelIndex(list) {
    const idx = { ids: new Map(), keys: new Map() }; // -> the list entry
    for (const ch of list || []) {
      if (!ch) continue;
      const id = ch.id ? String(ch.id).trim() : '';
      if (id && !idx.ids.has(id)) idx.ids.set(id, ch);
      for (const k of [compact(norm.normalizeHandle(ch.handle)), compact(ch.name)]) {
        if (k.length >= MIN_KEY && !idx.keys.has(k)) idx.keys.set(k, ch);
      }
    }
    return idx;
  }

  /** -> { term: what matched on the item, entry: the list entry } or null */
  function inIndex(idx, item) {
    if (item.id && idx.ids.has(item.id)) return { term: item.id, entry: idx.ids.get(item.id) };
    if (item.handleKey.length >= MIN_KEY && idx.keys.has(item.handleKey)) return { term: item.handle, entry: idx.keys.get(item.handleKey) };
    if (item.nameKey.length >= MIN_KEY && idx.keys.has(item.nameKey)) return { term: item.name, entry: idx.keys.get(item.nameKey) };
    return null;
  }

  /**
   * Terms that block a channel when they appear ANYWHERE in its name or handle,
   * also glued to other words ("TheCasinoKing", "@jackpotjudo").
   */
  function compileChannelTerms(entries) {
    const terms = new Set();
    for (const entry of entries || []) {
      for (const alt of parseEntry(entry)) {
        const k = compact(alt);
        if (k.length >= MIN_KEY) terms.add(k);
      }
    }
    return Array.from(terms);
  }

  /**
   * config = {
   *   keywordSets:   [{ strong: [], weak: [], exceptions: [], channel: [] }, ...],
   *   channels:      [{ handle, id, name }]   blocked (bundled + user)
   *   allowChannels: [{ handle, id, name }]   never hidden
   *   threshold:     number (default 2)
   * }
   * evaluate() -> { hide, reason, score, hits, channel? }; channel is the
   * blocklist entry (same object as in config.channels) when reason is "channel".
   */
  function createMatcher(config) {
    const cfg = config || {};
    const sets = cfg.keywordSets || [];
    const threshold = Number(cfg.threshold) > 0 ? Number(cfg.threshold) : DEFAULT_THRESHOLD;

    const strong = compileTier(sets.flatMap((s) => (s && s.strong) || []));
    const weak = compileTier(sets.flatMap((s) => (s && s.weak) || []));
    const exceptions = compileTier(sets.flatMap((s) => (s && s.exceptions) || []));

    const channelTerms = compileChannelTerms(sets.flatMap((s) => (s && s.channel) || []));

    const blocked = channelIndex(cfg.channels);
    const allowed = channelIndex(cfg.allowChannels);

    function channelTermIn(ch) {
      for (const term of channelTerms) {
        if (ch.nameKey.includes(term) || ch.handleKey.includes(term)) return term;
      }
      return null;
    }

    function scoreText(rawText) {
      let text = norm.normalize(rawText);
      if (exceptions) {
        exceptions.re.lastIndex = 0;
        text = text.replace(exceptions.re, ' ');
      }
      const hits = [];
      let score = 0;
      if (strong) {
        for (const term of strong.find(text)) {
          hits.push({ term, tier: 'strong' });
          score += STRONG_POINTS;
        }
      }
      if (weak) {
        for (const term of weak.find(text)) {
          hits.push({ term, tier: 'weak' });
          score += WEAK_POINTS;
        }
      }
      return { score, hits };
    }

    /** item = { title, channelName, description, handle, channelId } */
    function evaluate(item) {
      const it = item || {};
      const ch = {
        id: it.channelId ? String(it.channelId).trim() : '',
        handle: norm.normalizeHandle(it.handle),
        name: norm.normalize(it.channelName),
      };
      ch.handleKey = compact(ch.handle);
      ch.nameKey = compact(ch.name);

      if (inIndex(allowed, ch)) {
        return { hide: false, reason: 'allowlist', score: 0, hits: [] };
      }
      const blockedBy = inIndex(blocked, ch);
      if (blockedBy) {
        return { hide: true, reason: 'channel', score: 0, hits: [{ term: blockedBy.term, tier: 'channel' }], channel: blockedBy.entry };
      }
      const nameTerm = channelTermIn(ch);
      if (nameTerm) {
        return { hide: true, reason: 'channel-name', score: 0, hits: [{ term: nameTerm, tier: 'channel-name' }] };
      }

      // " | " keeps phrases from matching across the title/channel/description borders.
      const text = [it.title, it.channelName, it.description].filter(Boolean).join(' | ');
      const { score, hits } = scoreText(text);
      const hide = score >= threshold;
      return { hide, reason: hide ? 'keywords' : 'none', score, hits };
    }

    return { evaluate, scoreText, threshold };
  }

  R.createMatcher = createMatcher;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createMatcher, parseEntry, DEFAULT_THRESHOLD };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

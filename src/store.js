/*
 * Settings, user lists and the "suspect channel" log in storage.local,
 * plus loading of the bundled JSON lists. Shared by content script,
 * popup and options page (there is no background script).
 */
(function (root) {
  'use strict';
  const R = (root.Restrict = root.Restrict || {});
  const api = R.api;

  const LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'cs', name: 'Čeština' },
    { code: 'sk', name: 'Slovenčina' },
    { code: 'de', name: 'Deutsch' },
    { code: 'pl', name: 'Polski' },
    { code: 'ru', name: 'Русский' },
    { code: 'es', name: 'Español' },
    { code: 'pt', name: 'Português' },
    { code: 'tr', name: 'Türkçe' },
  ];

  const SUGGEST_AFTER = 3; // distinct keyword-hidden videos before a channel is suggested
  const MAX_SUSPECTS = 300;
  const MAX_VIDEOS_PER_SUSPECT = 10;

  const REPORTS_PER_DAY = 30; // reports to YouTube, across all tabs
  const MAX_REPORTED_CHANNELS = 1000;
  const MAX_REPORTED_VIDEOS = 500;

  function emptyReports() {
    return { channels: {}, videos: {}, day: '', today: 0, lastError: null };
  }

  function defaults() {
    const languages = {};
    for (const l of LANGUAGES) languages[l.code] = true;
    return {
      settings: { enabled: true, guard: true, tellYoutube: false, threshold: 2, languages },
      userKeywords: { strong: [], weak: [], exceptions: [], channel: [] },
      userChannels: [],
      allowChannels: [],
      suspects: {},
      ytReports: emptyReports(),
    };
  }

  const CONFIG_KEYS = ['settings', 'userKeywords', 'userChannels', 'allowChannels'];
  const STATE_KEYS = [...CONFIG_KEYS, 'suspects', 'ytReports'];
  const LOOKUP_KEY = 'lookupCache'; // Shorts channel answers, see loadLookups()
  const MAX_LOOKUPS = 3000;

  function sanitize(raw) {
    const d = defaults();
    const out = d;
    const s = (raw && raw.settings) || {};
    out.settings = {
      enabled: s.enabled !== false,
      guard: s.guard !== false,
      tellYoutube: s.tellYoutube === true,
      threshold: Number(s.threshold) >= 1 && Number(s.threshold) <= 10 ? Math.round(Number(s.threshold)) : 2,
      languages: Object.assign({}, d.settings.languages, s.languages || {}),
    };
    const k = (raw && raw.userKeywords) || {};
    const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
    out.userKeywords = {
      strong: strList(k.strong),
      weak: strList(k.weak),
      exceptions: strList(k.exceptions),
      channel: strList(k.channel),
    };
    out.userChannels = cleanChannels(raw && raw.userChannels);
    out.allowChannels = cleanChannels(raw && raw.allowChannels);
    out.suspects = cleanSuspects(raw && raw.suspects);
    out.ytReports = cleanReports(raw && raw.ytReports);
    return out;
  }

  function cleanReports(raw) {
    const out = emptyReports();
    if (!raw || typeof raw !== 'object') return out;
    const str = (v) => (typeof v === 'string' ? v : '');
    const entry = (r) => ({
      handle: str(r.handle),
      id: str(r.id),
      name: str(r.name),
      videoId: str(r.videoId),
      title: str(r.title),
      why: str(r.why),
      at: Number(r.at) || 0,
    });
    for (const kind of ['channels', 'videos']) {
      const src = raw[kind] && typeof raw[kind] === 'object' ? raw[kind] : {};
      for (const key of Object.keys(src)) {
        if (src[key] && typeof src[key] === 'object') out[kind][key] = entry(src[key]);
      }
    }
    out.day = str(raw.day);
    out.today = Number(raw.today) > 0 ? Math.floor(Number(raw.today)) : 0;
    const e = raw.lastError;
    out.lastError = e && typeof e === 'object' && typeof e.message === 'string' ? { message: e.message, at: Number(e.at) || 0 } : null;
    return out;
  }

  function cleanSuspects(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    const str = (v) => (typeof v === 'string' ? v : '');
    for (const key of Object.keys(raw)) {
      const s = raw[key];
      if (!s || typeof s !== 'object') continue;
      out[key] = {
        handle: str(s.handle),
        id: str(s.id),
        name: str(s.name),
        videos: Array.isArray(s.videos) ? s.videos.filter((v) => typeof v === 'string') : [],
        hits: Number(s.hits) > 0 ? Math.floor(Number(s.hits)) : 0,
        lastTitle: str(s.lastTitle),
        lastSeen: Number(s.lastSeen) || 0,
        ignored: s.ignored === true,
      };
    }
    return out;
  }

  function cleanChannel(ch) {
    if (!ch || typeof ch !== 'object') return null;
    const c = {
      handle: R.normalizeHandle(ch.handle),
      id: typeof ch.id === 'string' ? ch.id.trim() : '',
      name: typeof ch.name === 'string' ? ch.name.trim() : '',
      added: typeof ch.added === 'string' ? ch.added : new Date().toISOString().slice(0, 10),
    };
    return c.handle || c.id || c.name ? c : null;
  }

  function cleanChannels(list) {
    const out = [];
    const seen = new Set();
    for (const ch of Array.isArray(list) ? list : []) {
      const c = cleanChannel(ch);
      if (!c) continue;
      const key = channelKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }

  /** Stable key for a channel: id, else handle, else normalised name. */
  function channelKey(ch) {
    if (!ch) return '';
    const id = (ch.id || ch.channelId || '').trim();
    if (id) return id;
    const h = R.normalizeHandle(ch.handle);
    if (h) return h;
    const n = R.normalize(ch.name || ch.channelName);
    return n ? 'name:' + n : '';
  }

  function sameChannel(a, b) {
    if (a.id && b.id) return a.id === b.id;
    if (a.handle && b.handle) return a.handle === b.handle;
    return channelKey(a) === channelKey(b);
  }

  /**
   * "@handle", "youtube.com/@handle", "youtube.com/channel/UC...", "UC..." or a
   * plain channel name -> channel object.
   */
  function parseChannelInput(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const idMatch = raw.match(/(?:^|\/channel\/)(UC[\w-]{20,})/);
    if (idMatch) return cleanChannel({ id: idMatch[1] });
    const handleMatch = raw.match(/(?:^|\/)(@[^\s/?#]+)/);
    if (handleMatch) return cleanChannel({ handle: handleMatch[1] });
    return cleanChannel({ name: raw });
  }

  async function load() {
    const raw = await api.storage.local.get(STATE_KEYS);
    return sanitize(raw);
  }

  async function save(partial) {
    await api.storage.local.set(partial);
  }

  async function updateSettings(patch) {
    const state = await load();
    const settings = Object.assign({}, state.settings, patch);
    if (patch && patch.languages) {
      settings.languages = Object.assign({}, state.settings.languages, patch.languages);
    }
    await save({ settings });
    return settings;
  }

  /** cb(changedKeys, configChanged). Writes to the lookup cache alone are not reported. */
  function onChange(cb) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const keys = Object.keys(changes).filter((k) => k !== LOOKUP_KEY);
      if (keys.length) cb(keys, keys.some((k) => CONFIG_KEYS.includes(k)));
    });
  }

  // ---- Shorts channel lookups ---------------------------------------------

  /** Who posted which video, as answered by YouTube: Map videoId -> { handle, name, title }. */
  async function loadLookups() {
    const raw = await api.storage.local.get(LOOKUP_KEY);
    const out = new Map();
    for (const row of (raw && raw[LOOKUP_KEY]) || []) {
      if (Array.isArray(row) && typeof row[0] === 'string' && row[0]) {
        out.set(row[0], { handle: row[1] || '', name: row[2] || '', title: row[3] || '' });
      }
    }
    return out;
  }

  /** Adds answers to the stored cache. Other tabs write to it too, so merge, newest last. */
  async function saveLookups(fresh) {
    const merged = await loadLookups();
    for (const [id, v] of fresh) {
      merged.delete(id);
      merged.set(id, v);
    }
    const rows = Array.from(merged, ([id, v]) => [id, v.handle, v.name, v.title]).slice(-MAX_LOOKUPS);
    await save({ [LOOKUP_KEY]: rows });
  }

  // ---- bundled data -------------------------------------------------------

  const jsonCache = new Map();

  async function fetchJson(relPath) {
    if (jsonCache.has(relPath)) return jsonCache.get(relPath);
    const res = await fetch(api.runtime.getURL(relPath));
    if (!res.ok) throw new Error('Restrict: cannot load ' + relPath);
    const json = await res.json();
    jsonCache.set(relPath, json);
    return json;
  }

  async function safeJson(relPath, fallback) {
    try {
      return await fetchJson(relPath);
    } catch (e) {
      console.warn('[Restrict]', e && e.message ? e.message : e);
      return fallback;
    }
  }

  async function loadBundled(settings) {
    const empty = { strong: [], weak: [], exceptions: [] };
    const langs = LANGUAGES.filter((l) => settings.languages[l.code] !== false);
    const [brands, channels, ...sets] = await Promise.all([
      safeJson('data/brands.json', empty),
      safeJson('data/channels.json', { channels: [] }),
      ...langs.map((l) => safeJson('data/keywords/' + l.code + '.json', empty)),
    ]);
    return { keywordSets: [brands, ...sets], channels: (channels && channels.channels) || [] };
  }

  function matcherConfig(state, bundled) {
    return {
      keywordSets: [...bundled.keywordSets, state.userKeywords],
      channels: [...bundled.channels, ...state.userChannels],
      allowChannels: state.allowChannels,
      threshold: state.settings.threshold,
    };
  }

  // ---- channel lists ------------------------------------------------------

  async function addTo(listKey, channel) {
    const c = cleanChannel(channel);
    if (!c) return false;
    const state = await load();
    const list = state[listKey];
    if (list.some((x) => sameChannel(x, c))) return false;
    list.push(c);
    const patch = { [listKey]: list };
    // A channel lives in one list only.
    const other = listKey === 'userChannels' ? 'allowChannels' : 'userChannels';
    const filtered = state[other].filter((x) => !sameChannel(x, c));
    if (filtered.length !== state[other].length) patch[other] = filtered;
    // No longer a suspect once the user decided.
    const suspects = state.suspects;
    let touched = false;
    for (const key of Object.keys(suspects)) {
      const s = suspects[key];
      if (sameChannel({ id: s.id || '', handle: s.handle || '', name: s.name || '' }, c)) {
        delete suspects[key];
        touched = true;
      }
    }
    if (touched) patch.suspects = suspects;
    await save(patch);
    return true;
  }

  async function removeFrom(listKey, key) {
    const state = await load();
    const list = state[listKey].filter((x) => channelKey(x) !== key);
    await save({ [listKey]: list });
  }

  const blockChannel = (ch) => addTo('userChannels', ch);
  const allowChannel = (ch) => addTo('allowChannels', ch);
  const unblockChannel = (key) => removeFrom('userChannels', key);
  const unallowChannel = (key) => removeFrom('allowChannels', key);

  // ---- feedback loop ------------------------------------------------------

  /** batch = [{ handle, channelId, channelName, videoId, title }] */
  async function recordSuspects(batch) {
    if (!batch || !batch.length) return;
    const state = await load();
    const suspects = state.suspects;
    let changed = false;
    for (const b of batch) {
      const key = channelKey({ id: b.channelId, handle: b.handle });
      if (!key || !b.videoId) continue;
      const s = suspects[key] || { handle: '', id: '', name: '', videos: [], lastTitle: '', lastSeen: 0, ignored: false };
      if (s.videos.includes(b.videoId)) continue;
      s.handle = R.normalizeHandle(b.handle) || s.handle;
      s.id = b.channelId || s.id;
      s.name = b.channelName || s.name;
      s.videos = [...s.videos, b.videoId].slice(-MAX_VIDEOS_PER_SUSPECT);
      s.hits = (s.hits || 0) + 1;
      s.lastTitle = b.title || s.lastTitle;
      s.lastSeen = Date.now();
      suspects[key] = s;
      changed = true;
    }
    if (!changed) return;
    const keys = Object.keys(suspects);
    if (keys.length > MAX_SUSPECTS) {
      keys
        .sort((a, b) => (suspects[a].lastSeen || 0) - (suspects[b].lastSeen || 0))
        .slice(0, keys.length - MAX_SUSPECTS)
        .forEach((k) => delete suspects[k]);
    }
    await save({ suspects });
  }

  async function ignoreSuspect(key) {
    const state = await load();
    if (!state.suspects[key]) return;
    state.suspects[key].ignored = true;
    await save({ suspects: state.suspects });
  }

  /** Channels caught by keywords often enough, not yet blocked/allowed/ignored. */
  function suggestions(state) {
    const decided = [...state.userChannels, ...state.allowChannels];
    return Object.keys(state.suspects)
      .map((key) => Object.assign({ key }, state.suspects[key]))
      .filter((s) => !s.ignored && (s.hits || (s.videos || []).length) >= SUGGEST_AFTER)
      .filter((s) => !decided.some((d) => sameChannel(d, { id: s.id || '', handle: s.handle || '', name: '' })))
      .sort((a, b) => (b.hits || 0) - (a.hits || 0));
  }

  // ---- reports to YouTube ("Don't recommend channel" / "Not interested") ---

  function localDay(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function reportsLeftToday(reports, now) {
    const used = reports.day === localDay(now === undefined ? Date.now() : now) ? reports.today : 0;
    return Math.max(0, REPORTS_PER_DAY - used);
  }

  /** The report already sent for a channel ({ id, handle, name }), matched by id, handle or name. */
  function findChannelReport(reports, ch) {
    const id = (ch.id || '').trim();
    const handle = R.normalizeHandle(ch.handle);
    const name = R.normalize(ch.name);
    const direct = reports.channels[channelKey({ id, handle, name: ch.name })];
    if (direct) return direct;
    for (const r of Object.values(reports.channels)) {
      if ((id && r.id === id) || (handle && r.handle === handle) || (name && R.normalize(r.name) === name)) return r;
    }
    return null;
  }

  /** Channels the user blocked that YouTube has not been told about yet. */
  function pendingReports(state) {
    return state.userChannels.filter((c) => !findChannelReport(state.ytReports, c));
  }

  /** Everything reported, newest first: [{ kind: 'channel' | 'video', ...entry }] */
  function reportList(state) {
    const r = state.ytReports;
    return [
      ...Object.values(r.channels).map((e) => Object.assign({ kind: 'channel' }, e)),
      ...Object.values(r.videos).map((e) => Object.assign({ kind: 'video' }, e)),
    ].sort((a, b) => b.at - a.at);
  }

  function trimOldest(map, max) {
    const keys = Object.keys(map);
    if (keys.length <= max) return;
    keys
      .sort((a, b) => map[a].at - map[b].at)
      .slice(0, keys.length - max)
      .forEach((k) => delete map[k]);
  }

  /** job = { action: 'channel' | 'video', key, handle, id, name, videoId, title, why } */
  async function recordReport(job) {
    const state = await load();
    const r = state.ytReports;
    const now = Date.now();
    const day = localDay(now);
    if (r.day !== day) {
      r.day = day;
      r.today = 0;
    }
    r.today++;
    r.lastError = null;
    const entry = {
      handle: R.normalizeHandle(job.handle),
      id: job.id || '',
      name: job.name || '',
      videoId: job.videoId || '',
      title: job.title || '',
      why: job.why || '',
      at: now,
    };
    if (job.action === 'channel') r.channels[job.key] = entry;
    else r.videos[job.videoId] = entry;
    trimOldest(r.channels, MAX_REPORTED_CHANNELS);
    trimOldest(r.videos, MAX_REPORTED_VIDEOS);
    await save({ ytReports: r });
  }

  async function noteReportError(message) {
    const state = await load();
    state.ytReports.lastError = { message: String(message), at: Date.now() };
    await save({ ytReports: state.ytReports });
  }

  // ---- import / export ----------------------------------------------------

  async function exportAll() {
    const state = await load();
    return {
      app: 'restrict', // internal tag, kept so older backups still import
      version: 1,
      exported: new Date().toISOString(),
      settings: state.settings,
      userKeywords: state.userKeywords,
      userChannels: state.userChannels,
      allowChannels: state.allowChannels,
      suspects: state.suspects,
      ytReports: state.ytReports, // what YouTube already knows, so it is not told twice
    };
  }

  /** mode: "merge" (default) keeps existing entries, "replace" overwrites. */
  async function importAll(data, mode) {
    if (!data || typeof data !== 'object' || data.app !== 'restrict') {
      throw new Error('Not a backup file of Hide Gambling Content');
    }
    const incoming = sanitize(data);
    if (mode === 'replace') {
      await save(incoming);
      return incoming;
    }
    const state = await load();
    const uniq = (a, b) => Array.from(new Set([...a, ...b]));
    const merged = {
      settings: state.settings,
      userKeywords: {
        strong: uniq(state.userKeywords.strong, incoming.userKeywords.strong),
        weak: uniq(state.userKeywords.weak, incoming.userKeywords.weak),
        exceptions: uniq(state.userKeywords.exceptions, incoming.userKeywords.exceptions),
        channel: uniq(state.userKeywords.channel, incoming.userKeywords.channel),
      },
      userChannels: cleanChannels([...state.userChannels, ...incoming.userChannels]),
      allowChannels: cleanChannels([...state.allowChannels, ...incoming.allowChannels]),
      suspects: Object.assign({}, incoming.suspects, state.suspects),
      ytReports: Object.assign({}, state.ytReports, {
        channels: Object.assign({}, incoming.ytReports.channels, state.ytReports.channels),
        videos: Object.assign({}, incoming.ytReports.videos, state.ytReports.videos),
      }),
    };
    await save(merged);
    return merged;
  }

  R.store = {
    LANGUAGES,
    SUGGEST_AFTER,
    REPORTS_PER_DAY,
    defaults,
    load,
    save,
    updateSettings,
    onChange,
    loadLookups,
    saveLookups,
    loadBundled,
    matcherConfig,
    channelKey,
    parseChannelInput,
    blockChannel,
    unblockChannel,
    allowChannel,
    unallowChannel,
    recordSuspects,
    ignoreSuspect,
    suggestions,
    reportsLeftToday,
    findChannelReport,
    pendingReports,
    reportList,
    recordReport,
    noteReportError,
    exportAll,
    importAll,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

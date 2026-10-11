/*
 * Runs inside YouTube's own page (manifest "world": "MAIN"): only there is the
 * data YouTube attaches to its elements visible. It does one thing: when the
 * content script asks, it takes the "Not interested" or "Don't recommend
 * channel" code from one video card and sends it to YouTube, the same request
 * the card's ⋮ menu sends. No extension APIs here; it talks to content.js
 * through DOM events carrying JSON strings.
 *
 * The data layout below is YouTube's internal one (checked against real
 * home-feed data, 2026-10). It is checked strictly: each menu entry names the
 * video it is about (feedbackEndpoint.contentId), and a code is only used when
 * that is exactly the expected video, so a recycled card can never report the
 * wrong one.
 */
(function (root) {
  'use strict';

  // How YouTube marks the two menu entries, independent of the UI language.
  const ACTION_ICONS = {
    video: ['HIDE', 'NOT_INTERESTED'], // "Not interested" (HIDE in the 2026 card menus)
    channel: ['REMOVE'], // "Don't recommend channel"
  };
  const MAX_NODES = 20000; // card data is a few thousand nodes

  function iconOf(o) {
    if (o.icon && typeof o.icon.iconType === 'string') return o.icon.iconType;
    const sources = o.leadingImage && o.leadingImage.sources;
    const res = Array.isArray(sources) && sources[0] && sources[0].clientResource;
    return res && typeof res.imageName === 'string' ? res.imageName : '';
  }

  function actionOf(icon) {
    for (const action of Object.keys(ACTION_ICONS)) {
      if (ACTION_ICONS[action].includes(icon)) return action;
    }
    return '';
  }

  /** The feedback endpoint of one menu entry -> { token, contentId }. Undo codes nested in it are not looked at. */
  function endpointIn(entry) {
    const stack = [entry];
    const seen = new Set();
    while (stack.length && seen.size < MAX_NODES) {
      const o = stack.pop();
      if (!o || typeof o !== 'object' || seen.has(o)) continue;
      seen.add(o);
      const fe = o.feedbackEndpoint;
      if (fe && typeof fe.feedbackToken === 'string') {
        return { token: fe.feedbackToken, contentId: typeof fe.contentId === 'string' ? fe.contentId : '' };
      }
      for (const k of Object.keys(o)) if (k !== 'feedbackEndpoint') stack.push(o[k]);
    }
    return null;
  }

  /** One element's data -> { videoIds: Set, entries: [{ action, token, contentId }] } */
  function scanData(data) {
    const videoIds = new Set();
    const entries = [];
    const stack = [data];
    const seen = new Set();
    while (stack.length && seen.size < MAX_NODES) {
      const o = stack.pop();
      if (!o || typeof o !== 'object' || seen.has(o)) continue;
      seen.add(o);
      for (const k of ['videoId', 'contentId']) if (typeof o[k] === 'string' && o[k]) videoIds.add(o[k]);
      const action = actionOf(iconOf(o));
      if (action) {
        const e = endpointIn(o);
        if (e) entries.push(Object.assign({ action }, e));
        continue;
      }
      if (o.feedbackEndpoint) continue; // a code outside a recognised menu entry is never used
      for (const k of Object.keys(o)) stack.push(o[k]);
    }
    return { videoIds, entries };
  }

  /**
   * The code for action about videoId. An entry that names its video must name
   * exactly videoId. One that does not (older layouts) is only used when the
   * whole data object is about videoId alone.
   */
  function pickToken(dataList, videoId, action) {
    let sawVideo = false;
    for (const data of dataList) {
      const { videoIds, entries } = scanData(data);
      if (videoIds.has(videoId)) sawVideo = true;
      for (const e of entries) {
        if (e.action !== action) continue;
        if (e.contentId ? e.contentId === videoId : videoIds.size === 1 && videoIds.has(videoId)) return { token: e.token };
      }
    }
    return { error: sawVideo ? 'no-token' : 'mismatch' };
  }

  /** A home-feed card (ytd-rich-item-renderer) keeps its data, menus included, in .data. */
  function cardData(el) {
    return el.data && typeof el.data === 'object' ? [el.data] : [];
  }

  // ---- sending --------------------------------------------------------------

  function cfg(key) {
    const yc = root.ytcfg;
    if (!yc) return undefined;
    if (typeof yc.get === 'function') return yc.get(key);
    return yc.data_ ? yc.data_[key] : undefined;
  }

  function cookie(name) {
    for (const part of root.document.cookie.split('; ')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
    }
    return '';
  }

  async function sha1(text) {
    const buf = await root.crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * The signed-in session header YouTube's own requests carry:
   * "SAPISIDHASH <ts>_<sha1(user ts sid origin)>_u ..." when the page names the
   * user session (current YouTube), the older form without it otherwise.
   */
  async function authHeader(origin) {
    const ts = String(Math.floor(Date.now() / 1000));
    const user = String(cfg('USER_SESSION_ID') || '');
    const parts = [];
    const schemes = [
      ['SAPISIDHASH', cookie('SAPISID') || cookie('__Secure-3PAPISID')],
      ['SAPISID1PHASH', cookie('__Secure-1PAPISID')],
      ['SAPISID3PHASH', cookie('__Secure-3PAPISID')],
    ];
    for (const [scheme, sid] of schemes) {
      if (!sid) continue;
      const hash = await sha1((user ? user + ' ' : '') + ts + ' ' + sid + ' ' + origin);
      parts.push(scheme + ' ' + ts + '_' + hash + (user ? '_u' : ''));
    }
    return parts.join(' ');
  }

  function loggedIn() {
    const v = cfg('LOGGED_IN');
    return v === undefined ? null : v === true;
  }

  async function send(token) {
    const context = cfg('INNERTUBE_CONTEXT');
    if (!context) return { error: 'no-config' };
    const origin = root.location.origin;
    const headers = {
      'content-type': 'application/json',
      'x-origin': origin,
      'x-goog-authuser': String(cfg('SESSION_INDEX') || 0),
      'x-youtube-client-name': String(cfg('INNERTUBE_CONTEXT_CLIENT_NAME') || 1),
      'x-youtube-client-version': String(cfg('INNERTUBE_CLIENT_VERSION') || (context.client && context.client.clientVersion) || ''),
    };
    const visitor = cfg('VISITOR_DATA');
    if (visitor) headers['x-goog-visitor-id'] = visitor;
    const pageId = cfg('DELEGATED_SESSION_ID'); // brand account
    if (pageId) headers['x-goog-pageid'] = pageId;
    const auth = await authHeader(origin);
    if (!auth) return { error: 'logged-out' };
    headers.authorization = auth;

    let res;
    try {
      res = await root.fetch(origin + '/youtubei/v1/feedback?prettyPrint=false', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ context, feedbackTokens: [token], isFeedbackTokenUnencrypted: false, shouldMerge: false }),
      });
    } catch (e) {
      return { error: 'network' };
    }
    if (!res.ok) return { error: 'refused', detail: 'HTTP ' + res.status };
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      /* handled below */
    }
    const answers = json && Array.isArray(json.feedbackResponses) ? json.feedbackResponses : [];
    if (!answers.length || !answers.every((a) => a && a.isProcessed === true)) return { error: 'refused', detail: 'not processed' };
    return { ok: true };
  }

  async function report(req) {
    if (loggedIn() !== true) return { error: 'logged-out' };
    const el = root.document.querySelector('[data-restrict-rid="' + String(req.rid).replace(/[^\w-]/g, '') + '"]');
    if (!el) return { error: 'gone' };
    const picked = pickToken(cardData(el), req.videoId, req.action);
    if (!picked.token) return { error: picked.error };
    return send(picked.token);
  }

  // ---- bridge to the content script -------------------------------------------

  function answer(type, payload) {
    root.document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(payload) }));
  }

  function parse(ev) {
    try {
      return typeof ev.detail === 'string' ? JSON.parse(ev.detail) : null;
    } catch (e) {
      return null;
    }
  }

  if (typeof root.document !== 'undefined' && root.document && root.location) {
    // Answered synchronously: the content script reads it right after dispatching.
    root.document.addEventListener('restrict:ping', () => answer('restrict:pong', { loggedIn: loggedIn() }));
    root.document.addEventListener('restrict:report', (ev) => {
      const req = parse(ev);
      if (!req || !req.rid || !req.videoId || !ACTION_ICONS[req.action]) return;
      report(req)
        .catch(() => ({ error: 'failed' }))
        .then((result) => answer('restrict:report-result', Object.assign({ rid: req.rid }, result)));
    });
  }

  if (typeof module !== 'undefined' && module && module.exports && typeof root.document === 'undefined') {
    module.exports = { scanData, pickToken, ACTION_ICONS };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

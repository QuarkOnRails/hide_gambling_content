/*
 * Content script: finds video cards, asks the matcher, marks the card.
 * Marking is one attribute (data-restrict); content.css does the hiding.
 */
(function (root) {
  'use strict';
  const R = root.Restrict;
  const api = R.api;
  const S = R.selectors;
  const X = R.extract;
  const store = R.store;
  const doc = root.document;

  const CARD_SELECTOR = S.cards.join(',');
  const WATCH_SCOPE = S.watch.metadata + ',title';
  const ATTR = 'data-restrict';
  const ATTR_INFO = 'data-restrict-info';

  let state = null;
  let matcher = null;
  let signatures = new WeakMap(); // card -> last evaluated signature
  const queue = new Set();
  let scheduled = false;
  let needWatchCheck = false;
  let generation = 0; // a newer rebuild() wins over one still loading

  // ---- setup --------------------------------------------------------------

  async function rebuild() {
    const gen = ++generation;
    let nextState, nextMatcher;
    try {
      nextState = await store.load();
      const bundled = await store.loadBundled(nextState.settings);
      nextMatcher = R.createMatcher(store.matcherConfig(nextState, bundled));
    } catch (e) {
      // e.g. "Extension context invalidated" after the extension was reloaded
      console.warn('[Restrict] setup failed:', e && e.message ? e.message : e);
      return;
    }
    if (gen !== generation) return;
    state = nextState;
    matcher = nextMatcher;
    signatures = new WeakMap();
    watchSignature = '';
    scanAll();
  }

  function active() {
    return !!(state && matcher && state.settings.enabled);
  }

  // ---- card handling ------------------------------------------------------

  /** Outermost card container for a node (cards nest: rich-item > lockup). */
  function outermostCard(node) {
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el || !el.closest) return null;
    let card = el.closest(CARD_SELECTOR);
    if (!card) return null;
    for (;;) {
      const parent = card.parentElement && card.parentElement.closest(CARD_SELECTOR);
      if (!parent) return card;
      card = parent;
    }
  }

  function unmark(card) {
    if (card.hasAttribute(ATTR)) {
      card.removeAttribute(ATTR);
      card.removeAttribute(ATTR_INFO);
    }
  }

  function describe(result) {
    const terms = result.hits.map((h) => h.term).join(', ');
    if (result.reason === 'channel') return 'blocked channel: ' + terms;
    if (result.reason === 'channel-name') return 'channel name contains: ' + terms;
    return 'score ' + result.score + ': ' + terms;
  }

  function processCard(card) {
    if (!card.isConnected) return;
    if (!active()) {
      unmark(card);
      return;
    }
    const item = X.extractCard(card);
    if (!item.title && !item.handle && !item.channelId) {
      // not populated yet (or not a video); a later mutation re-queues it
      unmark(card);
      signatures.delete(card);
      return;
    }
    // Shorts cards carry no channel at all. Ask YouTube who posted the video,
    // so the blocklist and the channel-name rule can apply to them too.
    const needsLookup = !!item.videoId && !item.handle && !item.channelId && !item.channelName;
    let known;
    if (needsLookup) {
      known = lookupCache.get(item.videoId);
      if (known) {
        item.handle = known.handle;
        item.channelName = known.name;
        if (known.title && known.title !== item.title) item.description = [item.description, known.title].filter(Boolean).join(' | ');
      }
    }

    const sig = [item.videoId, item.title, item.channelName, item.handle, item.channelId, item.description].join('|');
    if (signatures.get(card) === sig) return;
    signatures.set(card, sig);

    const result = matcher.evaluate(item);
    if (!result.hide) {
      if (needsLookup && known === undefined) {
        // Unknown channel: keep the card invisible (not collapsed) until the
        // answer is in, so a blocked channel never flashes up.
        signatures.delete(card);
        card.setAttribute(ATTR, 'pending');
        card.removeAttribute(ATTR_INFO);
        lookupChannel(item.videoId).then(() => {
          queue.add(card);
          schedule();
        });
        return;
      }
      unmark(card);
      return;
    }
    // data-restrict-info is for whoever inspects the page: which rule fired.
    card.setAttribute(ATTR, 'hidden');
    card.setAttribute(ATTR_INFO, describe(result));
    if (result.reason === 'keywords') noteSuspect(item);
    considerReport(card, item, result);
  }

  // ---- channel lookup (oEmbed) ----------------------------------------------

  const lookupCache = new Map(); // videoId -> { handle, name, title } | null (= could not find out)
  const lookupInFlight = new Map(); // videoId -> Promise
  const lookupWaiting = [];
  let lookupsRunning = 0;
  const MAX_LOOKUPS = 4;
  let unsaved = new Map(); // answers not yet written to storage
  let saveTimer = 0;

  function persistLookup(videoId, value) {
    unsaved.set(videoId, value);
    if (saveTimer) return;
    saveTimer = root.setTimeout(() => {
      saveTimer = 0;
      const batch = unsaved;
      unsaved = new Map();
      store.saveLookups(batch).catch(() => {});
    }, 3000);
  }

  async function fetchChannel(videoId) {
    const target = 'https://www.youtube.com/watch?v=' + videoId;
    const url = root.location.origin + '/oembed?format=json&url=' + encodeURIComponent(target);
    const ctrl = new AbortController();
    const timer = root.setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
      if (!res.ok) return null;
      const data = await res.json();
      const parsed = X.parseChannelHref(data.author_url || '');
      const name = typeof data.author_name === 'string' ? data.author_name : '';
      if (!parsed.handle && !name) return null;
      const title = typeof data.title === 'string' ? data.title : '';
      return { handle: parsed.handle || '', name, title };
    } catch (e) {
      return null;
    } finally {
      root.clearTimeout(timer);
    }
  }

  function pumpLookups() {
    while (lookupsRunning < MAX_LOOKUPS && lookupWaiting.length) {
      const job = lookupWaiting.shift();
      lookupsRunning++;
      fetchChannel(job.videoId).then((value) => {
        lookupsRunning--;
        lookupCache.set(job.videoId, value);
        lookupInFlight.delete(job.videoId);
        if (value) persistLookup(job.videoId, value);
        job.resolve(value);
        pumpLookups();
      });
    }
  }

  /** Resolves (never rejects) once the cache has an answer for videoId. */
  function lookupChannel(videoId) {
    if (lookupCache.has(videoId)) return Promise.resolve(lookupCache.get(videoId));
    if (lookupInFlight.has(videoId)) return lookupInFlight.get(videoId);
    const p = new Promise((resolve) => lookupWaiting.push({ videoId, resolve }));
    lookupInFlight.set(videoId, p);
    pumpLookups();
    return p;
  }

  function enqueue(node) {
    const card = outermostCard(node);
    if (card) queue.add(card);
  }

  function enqueueTree(node) {
    if (!node || node.nodeType !== 1) return;
    enqueue(node);
    if (node.firstElementChild) {
      const inner = node.querySelectorAll(CARD_SELECTOR);
      for (const el of inner) enqueue(el);
    }
  }

  function scanAll() {
    if (!doc.documentElement) return;
    for (const el of doc.querySelectorAll('[' + ATTR + ']')) {
      if (!active()) unmark(el);
    }
    for (const el of doc.querySelectorAll(CARD_SELECTOR)) enqueue(el);
    needWatchCheck = true;
    schedule();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    let ran = false;
    const run = () => {
      if (ran) return;
      ran = true;
      scheduled = false;
      flush();
    };
    // rAF keeps hiding in the same frame as rendering; the timeout covers
    // background tabs where rAF does not fire.
    root.requestAnimationFrame(run);
    root.setTimeout(run, 250);
  }

  function flush() {
    if (!state || !matcher) return; // still loading; scanAll() runs after setup
    const cards = Array.from(queue);
    queue.clear();
    for (const card of cards) {
      try {
        processCard(card);
      } catch (e) {
        console.warn('[Restrict] card failed:', e);
      }
    }
    if (needWatchCheck) {
      needWatchCheck = false;
      try {
        checkWatch();
      } catch (e) {
        console.warn('[Restrict] watch check failed:', e);
      }
    }
  }

  // ---- feedback loop ------------------------------------------------------

  const notedVideos = new Set();
  let pendingSuspects = [];
  let suspectTimer = 0;

  function noteSuspect(item) {
    if (!item.videoId || (!item.handle && !item.channelId)) return;
    if (notedVideos.has(item.videoId)) return;
    notedVideos.add(item.videoId);
    pendingSuspects.push({
      handle: item.handle,
      channelId: item.channelId,
      channelName: item.channelName,
      videoId: item.videoId,
      title: item.title,
    });
    if (suspectTimer) return;
    suspectTimer = root.setTimeout(() => {
      suspectTimer = 0;
      const batch = pendingSuspects;
      pendingSuspects = [];
      store.recordSuspects(batch).catch(() => {});
    }, 2000);
  }

  // ---- telling YouTube: "Don't recommend channel" / "Not interested" ----------
  //
  // A channel the user blocked is always reported; everything else Restrict
  // hides on its own only with settings.tellYoutube. src/page.js does the
  // sending, because only YouTube's own page can see the codes it needs.
  // Reports come from home-feed cards only, so a blocked channel is reported
  // the next time one of its videos shows up in the home feed.

  const REPORT_GAP = 3000; // ms between two reports
  const REPORT_TIMEOUT = 10000;
  const NOT_SENT = ['no-token', 'mismatch', 'gone', 'logged-out', 'no-config']; // page.js gave up before sending
  const reportQueue = [];
  const reportKeys = new Set(); // what is queued or done in this tab
  const triedCards = new Set(); // videoId|action that had nothing to send
  const reportWaiting = new Map(); // rid -> resolve
  let reportBusy = false;
  let lastReportAt = 0;
  let reportSeq = 0;
  let reportsStopped = ''; // set when YouTube refused: no more attempts in this tab

  /** Asks src/page.js whether the user is signed in. true / false / null (unknown, no page script). */
  function pageSignedIn() {
    let answer = null;
    const onPong = (ev) => {
      try {
        answer = JSON.parse(ev.detail).loggedIn;
      } catch (e) {
        /* stays unknown */
      }
    };
    doc.addEventListener('restrict:pong', onPong);
    doc.dispatchEvent(new CustomEvent('restrict:ping'));
    doc.removeEventListener('restrict:pong', onPong);
    return answer;
  }

  doc.addEventListener('restrict:report-result', (ev) => {
    let r;
    try {
      r = JSON.parse(ev.detail);
    } catch (e) {
      return;
    }
    const resolve = r && reportWaiting.get(r.rid);
    if (!resolve) return;
    reportWaiting.delete(r.rid);
    resolve(r);
  });

  /** What to tell YouTube about a hidden video, or null. */
  function reportFor(item, result) {
    const s = state.settings;
    const ch = { id: item.channelId, handle: item.handle, name: item.channelName };
    if (result.reason === 'channel') {
      const mine = state.userChannels.includes(result.channel);
      if (!mine && !s.tellYoutube) return null;
      const entry = result.channel;
      return { action: 'channel', why: mine ? 'blocked' : 'list', key: store.channelKey(entry), ch: { id: entry.id || ch.id, handle: entry.handle || ch.handle, name: entry.name || ch.name } };
    }
    if (!s.tellYoutube) return null;
    if (result.reason === 'channel-name' && (ch.handle || ch.id || ch.name)) {
      return { action: 'channel', why: 'channel-name', key: store.channelKey(ch), ch };
    }
    if (result.reason === 'keywords') return { action: 'video', why: 'keywords', key: 'video:' + item.videoId, ch };
    return null;
  }

  function alreadyReported(reports, job) {
    return job.action === 'channel' ? !!store.findChannelReport(reports, job.ch) : !!reports.videos[job.videoId];
  }

  /** el: the hidden card; only home-feed cards carry the codes. */
  function considerReport(el, item, result) {
    if (!el.matches(S.reportCard) || !item.videoId || reportsStopped) return;
    const plan = reportFor(item, result);
    if (!plan || !plan.key || reportKeys.has(plan.key) || triedCards.has(item.videoId + '|' + plan.action)) return;
    const job = Object.assign(plan, { el, item, videoId: item.videoId, title: item.title });
    if (alreadyReported(state.ytReports, job) || store.reportsLeftToday(state.ytReports) <= 0) return;
    if (pageSignedIn() !== true) return;
    reportKeys.add(job.key);
    reportQueue.push(job);
    pumpReports();
  }

  function pumpReports() {
    if (reportBusy || !reportQueue.length) return;
    const wait = lastReportAt + REPORT_GAP - Date.now();
    if (wait > 0) {
      root.setTimeout(pumpReports, wait);
      return;
    }
    reportBusy = true;
    const job = reportQueue.shift();
    runReport(job)
      .catch(() => {})
      .then(() => {
        reportBusy = false;
        pumpReports();
      });
  }

  /** Still wanted with the latest settings and lists (other tabs and the popup change them)? */
  function stillWanted(job, fresh) {
    if (reportsStopped || !active() || !fresh.settings.enabled) return false;
    if (!job.el.isConnected || !matcher.evaluate(job.item).hide) return false;
    if (store.reportsLeftToday(fresh.ytReports) <= 0) return false;
    if (alreadyReported(fresh.ytReports, job)) return false;
    if (job.why === 'blocked') return fresh.userChannels.some((c) => store.channelKey(c) === job.key);
    return fresh.settings.tellYoutube;
  }

  async function runReport(job) {
    const fresh = await store.load();
    state.ytReports = fresh.ytReports;
    if (!stillWanted(job, fresh)) {
      if (!alreadyReported(fresh.ytReports, job)) reportKeys.delete(job.key);
      return;
    }
    const rid = 'r' + ++reportSeq;
    job.el.setAttribute('data-restrict-rid', rid);
    const res = await new Promise((resolve) => {
      const timer = root.setTimeout(() => {
        reportWaiting.delete(rid);
        resolve({ error: 'timeout' });
      }, REPORT_TIMEOUT);
      reportWaiting.set(rid, (r) => {
        root.clearTimeout(timer);
        resolve(r);
      });
      doc.dispatchEvent(new CustomEvent('restrict:report', { detail: JSON.stringify({ rid, action: job.action, videoId: job.videoId }) }));
    });
    job.el.removeAttribute('data-restrict-rid');
    if (res.ok || !NOT_SENT.includes(res.error)) lastReportAt = Date.now();

    if (res.ok) {
      await store.recordReport({
        action: job.action,
        key: job.key,
        handle: job.ch.handle,
        id: job.ch.id,
        name: job.ch.name,
        videoId: job.videoId,
        title: job.title,
        why: job.why,
      });
      return;
    }
    reportKeys.delete(job.key); // another video of this channel may carry the code
    if (res.error === 'refused' || res.error === 'no-config') {
      reportsStopped = res.detail || res.error;
      await store.noteReportError('YouTube did not accept the report (' + reportsStopped + ')');
    } else if (res.error === 'logged-out') {
      reportsStopped = 'signed out';
    } else {
      triedCards.add(job.videoId + '|' + job.action); // no code on this card, or it changed meanwhile
    }
  }

  // ---- opened video: silent cover, Shorts are skipped ------------------------

  let watchSignature = '';
  let guardEl = null;
  let guardedVideoId = '';
  let pausedByGuard = false;
  const revealed = new Set(); // video ids the user chose to watch anyway
  const shortsOrder = []; // Shorts in the order they were first seen, to know the scroll direction
  let lastShortId = '';
  const noSkip = { id: '', attempts: 0, at: 0 };
  let skip = noSkip; // the Short being skipped right now

  function isShortsPage() {
    return root.location.pathname.startsWith('/shorts/');
  }

  /** The visible player; a player of a page YouTube has left stays in the DOM, hidden. */
  function findPlayer() {
    let fallback = null;
    for (const sel of isShortsPage() ? S.watch.shortsPlayers : S.watch.players) {
      for (const el of doc.querySelectorAll(sel)) {
        if (el.getClientRects().length) return el;
        fallback = fallback || el;
      }
    }
    return fallback;
  }

  function pageVideos() {
    return Array.from(doc.querySelectorAll('video'));
  }

  /**
   * resume: play again what the guard paused. Only for "Show" and for a clean
   * video that took the guarded one's place, never when the user left the page:
   * the paused video may live on in the miniplayer.
   */
  function removeGuard(resume) {
    const player = guardEl && guardEl.parentElement;
    if (guardEl) {
      guardEl.remove();
      guardEl = null;
    }
    if (resume && pausedByGuard && player) {
      const video = player.querySelector('video');
      if (video && video.paused) video.play().catch(() => {});
    }
    pausedByGuard = false;
    guardedVideoId = '';
  }

  function pauseGuarded() {
    for (const video of pageVideos()) {
      if (!video.paused) {
        video.pause();
        pausedByGuard = true;
      }
    }
  }

  /** Plain black cover, no explanation. One small button as the way out of a false positive. */
  function showGuard(info) {
    const player = findPlayer();
    if (!player) return false;
    if (guardEl && guardedVideoId === info.videoId && guardEl.isConnected) {
      pauseGuarded();
      return true;
    }
    removeGuard(false);

    guardedVideoId = info.videoId;
    guardEl = doc.createElement('div');
    guardEl.className = 'restrict-guard';
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel']) {
      guardEl.addEventListener(type, (ev) => ev.stopPropagation());
    }
    const show = doc.createElement('button');
    show.type = 'button';
    show.className = 'restrict-guard__show';
    show.textContent = 'Show';
    show.addEventListener('click', (ev) => {
      ev.stopPropagation();
      revealed.add(info.videoId);
      removeGuard(true);
    });
    guardEl.append(show);

    if (root.getComputedStyle(player).position === 'static') player.style.position = 'relative';
    player.appendChild(guardEl);
    pauseGuarded();
    return true;
  }

  /** Move on to the neighbouring Short, in the direction the user was scrolling. */
  function skipShort(videoId) {
    if (skip.id !== videoId) skip = { id: videoId, attempts: 0, at: 0 };
    const now = Date.now();
    if (now - skip.at < 1200) return true; // give YouTube time to react
    if (skip.attempts >= 3) return false; // cannot move on; the caller covers the player instead
    skip.attempts++;
    skip.at = now;

    const here = shortsOrder.indexOf(videoId);
    const from = shortsOrder.indexOf(lastShortId);
    const goingUp = here !== -1 && from !== -1 && here < from && here > 0;

    pauseGuarded();
    const button = doc.querySelector(goingUp ? S.watch.shortsPrev : S.watch.shortsNext);
    if (button) {
      button.click();
    } else {
      const key = goingUp ? 'ArrowUp' : 'ArrowDown';
      const code = goingUp ? 38 : 40;
      const target = doc.querySelector('#shorts-container, ytd-shorts') || doc.body;
      target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode: code, which: code, bubbles: true }));
    }
    // look again shortly: either we moved on, or another attempt is due
    root.setTimeout(() => {
      needWatchCheck = true;
      schedule();
    }, 1300);
    return true;
  }

  function checkWatch() {
    const videoId = X.currentVideoId();
    if (skip.id && skip.id !== videoId) skip = noSkip; // moved on (or away)
    if (!videoId || !active() || !state.settings.guard) {
      watchSignature = '';
      removeGuard(false);
      return;
    }
    const shorts = isShortsPage();
    if (shorts && !shortsOrder.includes(videoId)) shortsOrder.push(videoId);

    const info = X.extractWatch();
    if (shorts || (!info.handle && !info.channelId)) {
      const known = lookupCache.get(videoId);
      if (known && shorts) {
        // In the Shorts player the page lags behind while scrolling; the
        // looked-up answer belongs to this exact video id.
        info.handle = known.handle || info.handle;
        info.channelName = known.name || info.channelName;
        info.title = known.title || info.title;
        info.settled = true;
      } else if (known) {
        info.handle = known.handle;
        info.channelName = info.channelName || known.name;
      } else if (known === undefined) {
        lookupChannel(videoId).then(() => {
          needWatchCheck = true;
          schedule();
        });
        if (shorts) return; // decide once the answer is in (a few hundred ms)
      }
    }
    if (!info.settled) return; // page still switching videos; a later mutation retries

    const result = matcher.evaluate(info);
    const hidden = result.hide && !revealed.has(videoId);
    if (hidden && result.reason === 'keywords') noteSuspect(info);

    if (hidden && shorts) {
      watchSignature = '';
      if (skipShort(videoId)) return;
      showGuard(info); // skipping did not work: at least cover and pause it
      return;
    }
    if (shorts) lastShortId = videoId;

    const sig = [videoId, info.title, info.handle, info.channelId, info.channelName, info.description].join('|');
    if (sig === watchSignature && (guardEl ? guardEl.isConnected : true)) return;
    watchSignature = sig;
    if (hidden) {
      if (!showGuard(info)) watchSignature = ''; // player not there yet
    } else {
      removeGuard(true);
    }
  }

  // Autoplay or YouTube itself may restart playback under the cover.
  doc.addEventListener(
    'play',
    (ev) => {
      if (!guardEl || !guardEl.isConnected) return;
      ev.target.pause();
      pausedByGuard = true;
    },
    true
  );

  // Scrolling through Shorts changes the URL without any event a content
  // script can see, so the address is polled.
  let lastHref = root.location.href;
  root.setInterval(() => {
    if (root.location.href === lastHref) return;
    lastHref = root.location.href;
    watchSignature = '';
    needWatchCheck = true;
    schedule();
  }, 400);

  // ---- observers ----------------------------------------------------------

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const target = m.target;
      if (m.type === 'childList') {
        for (const node of m.addedNodes) enqueueTree(node);
      }
      // Text / href changes inside an existing (recycled) card.
      enqueue(target);
      const el = target.nodeType === 1 ? target : target.parentElement;
      if (el && el.closest && el.closest(WATCH_SCOPE)) needWatchCheck = true;
    }
    if (queue.size || needWatchCheck) schedule();
  });

  function startObserver() {
    observer.observe(doc.documentElement || doc, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'title', 'is-active'],
    });
  }

  for (const type of ['yt-navigate-finish', 'yt-page-data-updated', 'state-navigateend']) {
    root.addEventListener(type, () => scanAll(), true);
  }
  root.addEventListener('popstate', () => scanAll());

  store.onChange((keys, configChanged) => {
    if (configChanged) rebuild();
  });

  /** For the popup: the channel being looked at. A Short may only be known from the lookup. */
  function pageChannel() {
    const ch = X.extractPageChannel();
    if (ch) return ch;
    const known = lookupCache.get(X.currentVideoId());
    return known && (known.handle || known.name) ? { handle: known.handle, id: '', name: known.name } : null;
  }

  // Popup asks the active tab what is going on.
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'restrict:status') return;
    sendResponse({
      hidden: doc.querySelectorAll('[' + ATTR + '="hidden"]').length,
      guarded: !!(guardEl && guardEl.isConnected),
      pageChannel: pageChannel(),
      signedIn: pageSignedIn(), // true / false / null = cannot tell
      reportsStopped,
    });
  });

  startObserver();
  store
    .loadLookups()
    .then((saved) => {
      for (const [id, v] of saved) if (!lookupCache.has(id)) lookupCache.set(id, v);
    })
    .catch(() => {})
    .then(rebuild);
})(typeof globalThis !== 'undefined' ? globalThis : this);

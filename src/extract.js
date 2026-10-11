/*
 * DOM -> plain data. Nothing here decides what to hide.
 */
(function (root) {
  'use strict';
  const R = (root.Restrict = root.Restrict || {});
  const S = R.selectors;

  function text(el) {
    if (!el) return '';
    const t = (el.getAttribute && el.getAttribute('title')) || el.textContent || '';
    return t.replace(/\s+/g, ' ').trim();
  }

  function firstText(scope, selectorList) {
    for (const sel of selectorList) {
      let nodes;
      try {
        nodes = scope.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (const node of nodes) {
        const t = text(node);
        if (t) return t;
      }
    }
    return '';
  }

  function toUrl(href) {
    try {
      return new URL(href, root.location ? root.location.origin : 'https://www.youtube.com');
    } catch (e) {
      return null;
    }
  }

  function parseVideoId(href) {
    const u = toUrl(href);
    if (!u) return '';
    if (u.pathname === '/watch') return u.searchParams.get('v') || '';
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/);
    return m ? m[1] : '';
  }

  function parseChannelHref(href) {
    const u = toUrl(href);
    if (!u) return {};
    let m = u.pathname.match(/^\/(@[^/]+)/);
    if (m) return { handle: R.normalizeHandle(m[1]) };
    m = u.pathname.match(/^\/channel\/(UC[\w-]{10,})/);
    if (m) return { channelId: m[1] };
    return {};
  }

  function channelFromLinks(scope) {
    const out = { handle: '', channelId: '', linkText: '' };
    if (!scope) return out;
    // The scope itself may be the link (end-screen cards are <a> elements).
    const links = Array.from(scope.querySelectorAll(S.channelLink));
    if (scope.matches && scope.matches(S.channelLink)) links.unshift(scope);
    for (const a of links) {
      const parsed = parseChannelHref(a.getAttribute('href') || '');
      if (parsed.handle && !out.handle) out.handle = parsed.handle;
      if (parsed.channelId && !out.channelId) out.channelId = parsed.channelId;
      if (!out.linkText && (parsed.handle || parsed.channelId)) out.linkText = text(a);
      if (out.handle && out.channelId) break;
    }
    return out;
  }

  const MAX_DESCRIPTION = 1500; // enough for sponsor lines, keeps matching cheap

  function descriptionText(scope, selectorList) {
    // Several parts can exist at once (snippet + AI summary): take them all,
    // but skip a node that sits inside one already taken.
    const taken = [];
    const parts = [];
    for (const sel of selectorList) {
      let nodes;
      try {
        nodes = scope.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (const node of nodes) {
        if (taken.some((t) => t === node || t.contains(node) || node.contains(t))) continue;
        const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        taken.push(node);
        parts.push(t);
      }
    }
    return parts.join(' | ').slice(0, MAX_DESCRIPTION);
  }

  /** card element -> { videoId, title, channelName, description, handle, channelId } */
  function extractCard(card) {
    const item = { videoId: '', title: '', channelName: '', description: '', handle: '', channelId: '' };

    const ownHref = card.matches && card.matches('a[href]') ? card.getAttribute('href') : '';
    const videoLink = ownHref ? card : card.querySelector(S.videoLink);
    if (videoLink) item.videoId = parseVideoId(videoLink.getAttribute('href') || '');

    item.title = firstText(card, S.title);
    if (!item.title && videoLink) {
      item.title = (videoLink.getAttribute('title') || videoLink.getAttribute('aria-label') || '').trim();
    }

    item.description = descriptionText(card, S.description);
    if (item.description === item.title) item.description = '';

    const ch = channelFromLinks(card);
    item.handle = ch.handle;
    item.channelId = ch.channelId;
    item.channelName = firstText(card, S.channelName) || ch.linkText;
    if (item.channelName === item.title && !card.matches('ytd-channel-renderer, ytm-compact-channel-renderer')) {
      // a generic selector picked the same node twice; do not score it twice
      item.channelName = '';
    }
    return item;
  }

  function currentVideoId() {
    if (!root.location) return '';
    return parseVideoId(root.location.href);
  }

  function cleanDocumentTitle() {
    return (root.document.title || '')
      .replace(/^\(\d+\+?\)\s*/, '')
      .replace(/\s*-\s*YouTube\s*$/i, '')
      .trim();
  }

  /** The video that is open right now (watch page or shorts player). */
  function extractWatch() {
    const doc = root.document;
    const info = { videoId: currentVideoId(), title: '', channelName: '', description: '', handle: '', channelId: '', settled: false };
    if (!info.videoId) return info;

    const docTitle = cleanDocumentTitle();
    const isShorts = root.location.pathname.startsWith('/shorts/');
    const h1 = isShorts ? '' : firstText(doc, S.watch.title);

    if (isShorts) {
      info.title = docTitle;
      info.settled = !!docTitle;
    } else {
      info.title = h1 || docTitle;
      // During in-page navigation the old <h1> stays for a moment. Only trust
      // it once the tab title (updated by YouTube on navigation) agrees.
      info.settled = !!h1 && R.normalize(docTitle) === R.normalize(h1);
    }

    if (!isShorts) info.description = descriptionText(doc, S.watch.description);

    for (const sel of isShorts ? S.watch.shortsOwner : S.watch.owner) {
      const owner = doc.querySelector(sel);
      if (!owner) continue;
      const ch = channelFromLinks(owner);
      info.handle = ch.handle;
      info.channelId = ch.channelId;
      info.channelName = firstText(owner, S.watch.ownerName) || ch.linkText;
      break;
    }
    return info;
  }

  /** Channel the user is looking at: owner of the open video, or the open channel page. */
  function extractPageChannel() {
    const loc = root.location;
    if (!loc) return null;
    if (currentVideoId()) {
      const w = extractWatch();
      if (w.handle || w.channelId) {
        return { handle: w.handle, id: w.channelId, name: w.channelName };
      }
      return null;
    }
    const parsed = parseChannelHref(loc.href);
    if (parsed.handle || parsed.channelId) {
      return {
        handle: parsed.handle || '',
        id: parsed.channelId || '',
        name: firstText(root.document, S.channelPageName),
      };
    }
    return null;
  }

  R.extract = { extractCard, extractWatch, extractPageChannel, parseVideoId, parseChannelHref, currentVideoId };
})(typeof globalThis !== 'undefined' ? globalThis : this);

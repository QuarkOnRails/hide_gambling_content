/*
 * Every YouTube selector lives here. YouTube changes its markup often;
 * when hiding stops working on some surface, this is the file to fix.
 * Settings → "Try a title" tells a keyword gap from a markup change.
 */
(function (root) {
  'use strict';
  const R = (root.Restrict = root.Restrict || {});

  R.selectors = {
    // Containers that represent one video / short / channel.
    // The OUTERMOST matching ancestor is the one that gets hidden.
    cards: [
      // desktop
      'ytd-rich-item-renderer', // home, channel pages, shorts shelves
      'ytd-video-renderer', // search results
      'ytd-compact-video-renderer', // watch sidebar (classic)
      'ytd-grid-video-renderer', // older grids
      'ytd-rich-grid-media',
      'ytd-reel-item-renderer', // shorts (classic)
      'ytd-channel-renderer', // channel in search results
      'ytd-playlist-video-renderer',
      'yt-lockup-view-model', // new card used on home, sidebar, search
      'ytm-shorts-lockup-view-model',
      'ytm-shorts-lockup-view-model-v2',
      // player end screen
      '.ytp-videowall-still',
      '.ytp-modern-videowall-still',
      '.ytp-ce-element',
      '.ytp-autonav-endscreen-upnext-container',
      // mobile site
      'ytm-rich-item-renderer',
      'ytm-video-with-context-renderer',
      'ytm-compact-video-renderer',
      'ytm-reel-item-renderer',
      'ytm-compact-channel-renderer',
    ],

    // First element with non-empty text / title attribute wins.
    title: [
      '#video-title',
      '#video-title-link',
      '[class*="lockup-metadata-view-model"][class*="title"]',
      '[class*="shortsLockupViewModelHostMetadataTitle"]',
      '[class*="shortsLockupViewModelHostOutsideMetadataTitle"]',
      '.ytp-videowall-still-info-title',
      '.ytp-modern-videowall-still-info-title',
      '.ytp-ce-video-title',
      '.ytp-autonav-endscreen-upnext-title',
      '.media-item-headline',
      '#channel-title', // ytd-channel-renderer
      'h3',
      'h4',
    ],

    channelName: [
      'ytd-channel-name #text',
      '#channel-name #text',
      '#channel-title',
      '[class*="content-metadata-view-model"][class*="metadata-text"]',
      '.ytp-videowall-still-info-author',
      '.ytp-modern-videowall-still-info-author',
      '.ytp-ce-channel-title',
      '.ytp-autonav-endscreen-upnext-author',
      '.ytm-badge-and-byline-item-byline',
    ],

    // Description snippet. Only some surfaces have one (search results, channel
    // cards); home-feed cards and Shorts do not.
    description: [
      '.metadata-snippet-text',
      '.metadata-snippet-container',
      '#description-text',
      'ytd-channel-renderer #description',
      '[class*="lockup-metadata-view-model"][class*="description"]',
      // AI summary line under search results ("Summary ...")
      'ytd-expandable-metadata-renderer',
      '#expandable-metadata',
      '[class*="video-summary"]',
    ],

    // Home-feed card whose data holds the ⋮ menu codes reported to YouTube.
    reportCard: 'ytd-rich-item-renderer',

    channelLink: 'a[href^="/@"], a[href^="/channel/"], a[href*="youtube.com/@"], a[href*="youtube.com/channel/"]',
    videoLink: 'a[href*="/watch?"], a[href*="/shorts/"], a[href*="/live/"]',

    // Watch page (the video that is currently open).
    watch: {
      metadata: 'ytd-watch-metadata, ytd-text-inline-expander, ytd-reel-video-renderer[is-active], ytm-slim-video-metadata-section-renderer',
      title: [
        'ytd-watch-metadata h1',
        '#title h1',
        'ytm-slim-video-metadata-section-renderer h2',
        '.slim-video-information-title',
      ],
      // YouTube keeps a page it has left in the DOM (hidden), so the watch page
      // and the Shorts player each get their own owner list.
      owner: ['ytd-watch-metadata ytd-video-owner-renderer', 'ytd-video-owner-renderer', 'ytm-slim-owner-renderer'],
      shortsOwner: ['ytd-reel-video-renderer[is-active]'],
      // looked up inside the owner element found above
      ownerName: [
        'ytd-video-owner-renderer ytd-channel-name #text',
        'ytd-reel-video-renderer[is-active] ytd-channel-name #text',
        'ytm-slim-owner-renderer h3',
      ],
      description: [
        'ytd-watch-metadata #description-inline-expander',
        'ytd-watch-metadata #description',
        'ytd-text-inline-expander',
        'ytm-slim-video-metadata-section-renderer .slim-video-metadata-description',
      ],
      shortsNext: '#navigation-button-down button, #navigation-button-down [role="button"], .navigation-button-down button',
      shortsPrev: '#navigation-button-up button, #navigation-button-up [role="button"], .navigation-button-up button',
      players: ['#movie_player', '#player-container-id'],
      shortsPlayers: ['#shorts-player', '#player-container-id', '#movie_player'],
    },

    // Channel page header (for "block this channel" in the popup).
    channelPageName: [
      'yt-page-header-view-model h1',
      'ytd-channel-name#channel-name #text',
      '#channel-header ytd-channel-name #text',
    ],
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

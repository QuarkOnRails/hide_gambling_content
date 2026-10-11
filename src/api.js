/*
 * Cross-browser handle to the extension API.
 * Firefox exposes `browser` (promises); Chrome exposes `chrome`
 * (promises too under Manifest V3). Everything else uses Restrict.api.
 */
(function (root) {
  'use strict';
  const R = (root.Restrict = root.Restrict || {});
  R.api = typeof root.browser !== 'undefined' && root.browser.runtime ? root.browser : root.chrome;
})(typeof globalThis !== 'undefined' ? globalThis : this);

'use strict';
// Test only: replaces storage.local with the state passed as ?state=<json>.
(function () {
  const state = JSON.parse(new URLSearchParams(location.search).get('state') || '{}');
  const local = globalThis.Restrict.api.storage.local;
  local
    .clear()
    .then(() => local.set(state))
    .then(() => document.body.setAttribute('data-seeded', 'yes'));
})();

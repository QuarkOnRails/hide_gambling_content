(function () {
  'use strict';
  const R = globalThis.Restrict;
  const store = R.store;
  const $ = (id) => document.getElementById(id);

  let state = null;
  let bundled = { keywordSets: [], channels: [] };
  let matcher = null;
  let keywordsDirty = false;

  // ---- helpers ------------------------------------------------------------

  const lines = (text) =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  function channelRow(ch, buttons) {
    const li = document.createElement('li');
    li.className = 'row';
    const info = document.createElement('div');
    info.className = 'grow';
    const name = document.createElement('p');
    name.className = 'ellipsis';
    name.textContent = ch.name || ch.handle || ch.id;
    const meta = document.createElement('p');
    meta.className = 'muted small ellipsis';
    meta.textContent = ch.meta || [ch.handle, ch.id].filter(Boolean).join(' · ') || 'matched by name only';
    if (ch.metaTitle) meta.title = ch.metaTitle;
    info.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.primary) el.className = 'primary';
      el.addEventListener('click', b.onClick);
      actions.append(el);
    }
    li.append(info, actions);
    return li;
  }

  function fillList(ul, items, emptyText) {
    ul.textContent = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = emptyText;
      ul.append(li);
      return;
    }
    for (const item of items) ul.append(item);
  }

  // ---- rendering ----------------------------------------------------------

  function renderGeneral() {
    $('enabled').checked = state.settings.enabled;
    $('guard').checked = state.settings.guard;
    $('tellYoutube').checked = state.settings.tellYoutube;
    if (document.activeElement !== $('threshold')) $('threshold').value = state.settings.threshold;
  }

  function renderLanguages() {
    const box = $('languages');
    box.textContent = '';
    for (const lang of store.LANGUAGES) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.settings.languages[lang.code] !== false;
      input.addEventListener('change', () => store.updateSettings({ languages: { [lang.code]: input.checked } }));
      label.append(input, document.createTextNode(lang.name));
      box.append(label);
    }
  }

  function renderKeywords() {
    if (keywordsDirty) return; // do not overwrite what the user is typing
    $('kw-strong').value = state.userKeywords.strong.join('\n');
    $('kw-weak').value = state.userKeywords.weak.join('\n');
    $('kw-exceptions').value = state.userKeywords.exceptions.join('\n');
    $('kw-channel').value = state.userKeywords.channel.join('\n');
  }

  function renderChannels() {
    $('bundled-count').textContent = bundled.channels.length
      ? 'The built-in list adds ' + bundled.channels.length + ' more.'
      : 'The built-in list is empty for now; this list is yours.';

    fillList(
      $('blocked'),
      state.userChannels.map((ch) => {
        const where = [ch.handle, ch.id].filter(Boolean).join(' · ') || 'matched by name only';
        const told = store.findChannelReport(state.ytReports, ch) ? 'reported to YouTube' : 'YouTube not told yet';
        return channelRow(Object.assign({}, ch, { meta: where + ' · ' + told }), [
          { label: 'Remove', onClick: () => store.unblockChannel(store.channelKey(ch)) },
        ]);
      }),
      'No channels blocked yet.'
    );
    fillList(
      $('allowed'),
      state.allowChannels.map((ch) =>
        channelRow(ch, [{ label: 'Remove', onClick: () => store.unallowChannel(store.channelKey(ch)) }])
      ),
      'No channels here yet.'
    );

    $('suggest-after').textContent = String(store.SUGGEST_AFTER);
    fillList(
      $('suggestions'),
      store.suggestions(state).map((s) =>
        channelRow(
          {
            name: s.name,
            handle: s.handle,
            id: s.id,
            meta: (s.hits || s.videos.length) + ' videos · ' + [s.handle, s.lastTitle].filter(Boolean).join(' · '),
            metaTitle: s.lastTitle,
          },
          [
            { label: 'Block', primary: true, onClick: () => store.blockChannel({ handle: s.handle, id: s.id, name: s.name }) },
            { label: 'Never hide', onClick: () => store.allowChannel({ handle: s.handle, id: s.id, name: s.name }) },
            { label: 'Ignore', onClick: () => store.ignoreSuspect(s.key) },
          ]
        )
      ),
      'Nothing yet. Channels appear here as keywords keep catching their videos.'
    );
  }

  const WHY = { blocked: 'you blocked it', list: 'built-in list', 'channel-name': 'channel name', keywords: 'title keywords' };

  function renderReports() {
    const used = store.REPORTS_PER_DAY - store.reportsLeftToday(state.ytReports);
    $('reports-today').textContent = 'Today: ' + used + ' of at most ' + store.REPORTS_PER_DAY + '.';
    const err = state.ytReports.lastError;
    $('reports-error').hidden = !err;
    $('reports-error').textContent = err ? err.message + ' (' + new Date(err.at).toLocaleString() + ').' : '';
    fillList(
      $('reports'),
      store
        .reportList(state)
        .slice(0, 100)
        .map((r) => {
          const channel = r.name || r.handle || r.id;
          const what = r.kind === 'channel' ? 'Don’t recommend channel' : 'Not interested' + (channel ? ' · ' + channel : '');
          return channelRow(
            {
              name: r.kind === 'channel' ? channel : r.title || r.videoId,
              meta: [what, WHY[r.why] || r.why, new Date(r.at).toLocaleDateString()].filter(Boolean).join(' · '),
              metaTitle: r.title,
            },
            []
          );
        }),
      'Nothing reported yet.'
    );
  }

  function renderTry() {
    const title = $('try-title').value.trim();
    const channel = $('try-channel').value.trim();
    const out = $('try-result');
    out.className = 'result muted';
    if (!title && !channel) {
      out.textContent = 'Type a title.';
      return;
    }
    if (!matcher) return;
    const res = matcher.evaluate({ title, channelName: channel });
    const hits = res.hits.map((h) => h.term + ' (' + h.tier + ')').join(', ');
    if (res.hide) {
      out.className = 'result hide';
      out.textContent =
        res.reason === 'channel'
          ? 'Hidden: blocked channel ' + hits
          : res.reason === 'channel-name'
          ? 'Hidden: channel name contains ' + hits
          : 'Hidden: score ' + res.score + ' of ' + matcher.threshold + ' needed. Hits: ' + hits;
    } else {
      out.className = 'result keep';
      out.textContent =
        res.reason === 'allowlist'
          ? 'Shown: channel is on the never-hide list.'
          : 'Shown: score ' + res.score + ' of ' + matcher.threshold + ' needed.' + (hits ? ' Hits: ' + hits : ' No hits.');
    }
  }

  async function refresh() {
    state = await store.load();
    bundled = await store.loadBundled(state.settings);
    matcher = R.createMatcher(store.matcherConfig(state, bundled));
    renderGeneral();
    renderLanguages();
    renderKeywords();
    renderChannels();
    renderReports();
    renderTry();
  }

  // ---- events -------------------------------------------------------------

  for (const id of ['enabled', 'guard', 'tellYoutube']) {
    $(id).addEventListener('change', (ev) => store.updateSettings({ [id]: ev.target.checked }));
  }
  $('threshold').addEventListener('change', (ev) => {
    const n = Math.round(Number(ev.target.value));
    if (n >= 1 && n <= 10) store.updateSettings({ threshold: n });
    else ev.target.value = state.settings.threshold;
  });

  for (const id of ['kw-strong', 'kw-weak', 'kw-exceptions', 'kw-channel']) {
    $(id).addEventListener('input', () => {
      keywordsDirty = true;
      $('kw-status').textContent = 'Unsaved changes';
    });
  }
  $('kw-save').addEventListener('click', async () => {
    const userKeywords = {
      strong: lines($('kw-strong').value),
      weak: lines($('kw-weak').value),
      exceptions: lines($('kw-exceptions').value),
      channel: lines($('kw-channel').value),
    };
    try {
      // compile once so a broken entry is reported instead of silently breaking YouTube tabs
      R.createMatcher({ keywordSets: [userKeywords] });
    } catch (e) {
      $('kw-status').textContent = 'Could not save: ' + e.message;
      return;
    }
    keywordsDirty = false;
    await store.save({ userKeywords });
    $('kw-status').textContent = 'Saved';
  });

  $('try-title').addEventListener('input', renderTry);
  $('try-channel').addEventListener('input', renderTry);

  function bindAdd(formId, inputId, add) {
    $(formId).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = $(inputId);
      const ch = store.parseChannelInput(input.value);
      if (!ch) return;
      await add(ch);
      input.value = '';
    });
  }
  bindAdd('block-form', 'block-input', store.blockChannel);
  bindAdd('allow-form', 'allow-input', store.allowChannel);

  $('export').addEventListener('click', async () => {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hide-gambling-content-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('backup-status').textContent = 'Exported.';
  });

  let importMode = 'merge';
  $('import').addEventListener('click', () => {
    importMode = 'merge';
    $('import-file').click();
  });
  $('import-replace').addEventListener('click', () => {
    importMode = 'replace';
    $('import-file').click();
  });
  $('import-file').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await store.importAll(data, importMode);
      keywordsDirty = false;
      $('backup-status').textContent = importMode === 'replace' ? 'Imported. Previous data was replaced.' : 'Imported and merged.';
      refresh();
    } catch (e) {
      $('backup-status').textContent = 'Import failed: ' + (e && e.message ? e.message : e);
    }
  });

  store.onChange(() => refresh());
  refresh();
})();

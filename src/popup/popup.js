(function () {
  'use strict';
  const R = globalThis.Restrict;
  const api = R.api;
  const store = R.store;
  const $ = (id) => document.getElementById(id);

  let pageChannel = null;

  async function activeTab() {
    try {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      return tabs && tabs[0] ? tabs[0] : null;
    } catch (e) {
      return null;
    }
  }

  async function pageStatus() {
    const tab = await activeTab();
    if (!tab || tab.id === undefined) return null;
    try {
      return (await api.tabs.sendMessage(tab.id, { type: 'restrict:status' })) || null;
    } catch (e) {
      return null; // not a YouTube tab, or the page was open before the extension loaded
    }
  }

  function channelLabel(ch) {
    return ch.name || ch.handle || ch.id || 'Unknown channel';
  }

  function renderPageChannel(state) {
    const box = $('page-channel');
    if (!pageChannel) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    $('pc-name').textContent = channelLabel(pageChannel);
    $('pc-handle').textContent = pageChannel.handle || pageChannel.id || '';
    const key = store.channelKey(pageChannel);
    const has = (list) => list.some((c) => store.channelKey(c) === key || (c.handle && c.handle === pageChannel.handle));
    const blocked = has(state.userChannels);
    const allowed = has(state.allowChannels);
    $('pc-block').hidden = blocked;
    $('pc-allow').hidden = allowed;
    $('pc-hint').hidden = blocked || allowed;
    const note = $('pc-state');
    note.hidden = !(blocked || allowed);
    if (blocked) {
      note.textContent = store.findChannelReport(state.ytReports, pageChannel)
        ? 'Blocked and reported to YouTube.'
        : 'Blocked. YouTube is told the next time this channel shows up in your home feed.';
    } else {
      note.textContent = allowed ? 'Never hidden. Manage the list in Settings.' : '';
    }
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function renderYoutubeState(state, status) {
    const box = $('yt-state');
    box.className = 'small muted';
    const r = state.ytReports;
    if (status && status.reportsStopped) {
      box.className = 'small warn';
      box.textContent = 'Reporting is paused in this tab (' + status.reportsStopped + '). Reload the tab to try again.';
      return;
    }
    if (status && status.signedIn === false) {
      box.textContent = 'Sign in to YouTube in this tab so the extension can report.';
      return;
    }
    if (r.lastError) {
      box.className = 'small warn';
      box.textContent = r.lastError.message + '.';
      return;
    }
    const parts = [];
    const channels = Object.keys(r.channels).length;
    const videos = Object.keys(r.videos).length;
    if (channels || videos) parts.push(plural(channels, 'channel', 'channels') + ' and ' + plural(videos, 'video', 'videos') + ' reported so far.');
    const waiting = store.pendingReports(state).length;
    if (waiting === 1) parts.push('1 blocked channel waits to show up in your home feed.');
    else if (waiting) parts.push(waiting + ' blocked channels wait to show up in your home feed.');
    box.textContent = parts.join(' ');
  }

  async function render() {
    const [state, status] = await Promise.all([store.load(), pageStatus()]);
    $('enabled').checked = state.settings.enabled;
    $('guard').checked = state.settings.guard;
    $('tellYoutube').checked = state.settings.tellYoutube;

    pageChannel = status ? status.pageChannel : null;
    if (!state.settings.enabled) {
      $('status').textContent = 'Paused. Nothing is hidden.';
    } else if (!status) {
      $('status').textContent = 'Open or reload a YouTube tab to see activity.';
    } else {
      const n = status.hidden;
      $('status').textContent = n + (n === 1 ? ' video' : ' videos') + ' hidden on this page';
    }
    $('totals').textContent = state.userChannels.length + ' blocked · ' + state.allowChannels.length + ' never hidden';
    renderPageChannel(state);
    renderYoutubeState(state, status);
  }

  function bindToggle(id) {
    $(id).addEventListener('change', async (ev) => {
      await store.updateSettings({ [id]: ev.target.checked });
      // give the content script a moment to rescan before counting again
      setTimeout(render, 350);
    });
  }

  bindToggle('enabled');
  bindToggle('guard');
  bindToggle('tellYoutube');

  $('pc-block').addEventListener('click', async () => {
    if (pageChannel) await store.blockChannel(pageChannel);
    setTimeout(render, 350);
  });
  $('pc-allow').addEventListener('click', async () => {
    if (pageChannel) await store.allowChannel(pageChannel);
    setTimeout(render, 350);
  });
  $('open-options').addEventListener('click', () => {
    api.runtime.openOptionsPage();
    window.close();
  });

  render();
})();

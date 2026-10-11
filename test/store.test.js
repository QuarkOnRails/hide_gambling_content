'use strict';
const test = require('node:test');
const assert = require('node:assert');

// store.js is written for the browser: give it an in-memory storage.local.
const memory = {};
globalThis.Restrict = {
  api: {
    storage: {
      local: {
        async get(keys) {
          const list = typeof keys === 'string' ? [keys] : keys;
          const out = {};
          for (const k of list) if (k in memory) out[k] = JSON.parse(JSON.stringify(memory[k]));
          return out;
        },
        async set(obj) {
          for (const k of Object.keys(obj)) memory[k] = JSON.parse(JSON.stringify(obj[k]));
        },
      },
      onChanged: { addListener() {} },
    },
    runtime: { getURL: (p) => p },
  },
};
require('../src/normalize.js');
require('../src/store.js');
const store = globalThis.Restrict.store;

function reset() {
  for (const k of Object.keys(memory)) delete memory[k];
}

const job = (over) => Object.assign({ action: 'channel', key: '@casinoking', handle: '@CasinoKing', name: 'Casino King', videoId: 'v1', title: 't', why: 'blocked' }, over);

test('reporting is off by default; old settings without it load fine', async () => {
  reset();
  memory.settings = { enabled: true, debug: true, lookup: false };
  const state = await store.load();
  assert.strictEqual(state.settings.tellYoutube, false);
  assert.strictEqual('debug' in state.settings, false);
  assert.deepStrictEqual(state.ytReports.channels, {});
});

test('a recorded channel is found by handle, id or name', async () => {
  reset();
  await store.recordReport(job({ id: 'UCxxxxxxxxxxxxxxxxxxxxxx' }));
  const r = (await store.load()).ytReports;
  assert.ok(store.findChannelReport(r, { handle: '@casinoking' }));
  assert.ok(store.findChannelReport(r, { id: 'UCxxxxxxxxxxxxxxxxxxxxxx' }));
  assert.ok(store.findChannelReport(r, { name: 'CASINO KING' }));
  assert.strictEqual(store.findChannelReport(r, { handle: '@someoneelse', name: 'Someone' }), null);
});

test('blocked channels wait until reported', async () => {
  reset();
  await store.blockChannel({ handle: '@casinoking', name: 'Casino King' });
  await store.blockChannel({ handle: '@slotqueen' });
  assert.deepStrictEqual(store.pendingReports(await store.load()).map((c) => c.handle), ['@casinoking', '@slotqueen']);
  await store.recordReport(job());
  assert.deepStrictEqual(store.pendingReports(await store.load()).map((c) => c.handle), ['@slotqueen']);
});

test('daily budget counts reports and starts over on a new day', async () => {
  reset();
  for (let i = 0; i < 3; i++) await store.recordReport(job({ action: 'video', videoId: 'v' + i, key: 'video:v' + i }));
  const r = (await store.load()).ytReports;
  assert.strictEqual(store.reportsLeftToday(r), store.REPORTS_PER_DAY - 3);
  assert.strictEqual(store.reportsLeftToday(r, Date.now() + 2 * 86400000), store.REPORTS_PER_DAY);
  assert.strictEqual(store.reportsLeftToday(Object.assign({}, r, { today: 999 })), 0);
});

test('a success clears the last error; reportList is newest first', async () => {
  reset();
  await store.noteReportError('YouTube did not accept the report (HTTP 401)');
  assert.ok((await store.load()).ytReports.lastError);
  await store.recordReport(job({ action: 'video', videoId: 'a', key: 'video:a' }));
  await new Promise((r) => setTimeout(r, 5));
  await store.recordReport(job());
  const state = await store.load();
  assert.strictEqual(state.ytReports.lastError, null);
  assert.deepStrictEqual(store.reportList(state).map((x) => x.kind), ['channel', 'video']);
});

test('garbage in storage does not break loading', async () => {
  reset();
  memory.ytReports = { channels: { a: 5, b: { handle: 7, at: 'x' } }, videos: null, today: -3, lastError: 'boom' };
  const r = (await store.load()).ytReports;
  assert.deepStrictEqual(Object.keys(r.channels), ['b']);
  assert.strictEqual(r.channels.b.handle, '');
  assert.strictEqual(r.today, 0);
  assert.strictEqual(r.lastError, null);
});

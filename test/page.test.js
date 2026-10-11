'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scanData, pickToken } = require('../src/page.js');

// Structure of real home-feed cards (what ytd-rich-item-renderer.data holds),
// with fake ids and placeholder codes; see the note inside the file.
const cards = require('./fixtures/youtube-cards.json');
const clone = (o) => JSON.parse(JSON.stringify(o));

test('real video card: "Don\'t recommend channel" and "Not interested" are found', () => {
  assert.deepStrictEqual(pickToken([cards.video], 'vid0xxxxxxx', 'channel'), { token: 'TOKEN-vid-2' });
  assert.deepStrictEqual(pickToken([cards.video], 'vid0xxxxxxx', 'video'), { token: 'TOKEN-vid-1' });
});

test('real card of a channel that is live: the avatar names a second video, codes are still found', () => {
  assert.strictEqual(scanData(cards.videoOfLiveChannel).videoIds.size, 2);
  assert.deepStrictEqual(pickToken([cards.videoOfLiveChannel], 'liv0xxxxxxx', 'channel'), { token: 'TOKEN-liv-2' });
  // the live stream the avatar points to is not what the menu is about
  assert.deepStrictEqual(pickToken([cards.videoOfLiveChannel], 'liv1xxxxxxx', 'channel'), { error: 'no-token' });
});

test('real Shorts card: only "Not interested" exists', () => {
  assert.deepStrictEqual(pickToken([cards.short], 'sho0xxxxxxx', 'video'), { token: 'TOKEN-sho-1' });
  assert.deepStrictEqual(pickToken([cards.short], 'sho0xxxxxxx', 'channel'), { error: 'no-token' });
});

test('recycled card: the element already holds another video, nothing is used', () => {
  assert.deepStrictEqual(pickToken([cards.video], 'otherxxxxxx', 'channel'), { error: 'mismatch' });
});

test('undo codes nested in an entry are never picked', () => {
  const entries = scanData(cards.video).entries;
  assert.deepStrictEqual(entries.map((e) => e.action).sort(), ['channel', 'video']);
  assert.ok(entries.every((e) => /^TOKEN-vid-[12]$/.test(e.token)));
});

test('a container of several videos yields only the entry naming the asked video', () => {
  const other = clone(cards.video);
  (function retarget(o) {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (o[k] === 'vid0xxxxxxx') o[k] = 'vid9xxxxxxx';
      else if (typeof o[k] === 'string' && o[k].startsWith('TOKEN-vid-')) o[k] = o[k].replace('vid', 'vid9');
      else retarget(o[k]);
    }
  })(other);
  const shelf = { items: [other, cards.video] };
  assert.deepStrictEqual(pickToken([shelf], 'vid0xxxxxxx', 'channel'), { token: 'TOKEN-vid-2' });
  assert.deepStrictEqual(pickToken([shelf], 'vid9xxxxxxx', 'channel'), { token: 'TOKEN-vid9-2' });
});

test('older layout without contentId: only used when the data is about that video alone', () => {
  const card = (ids) => ({
    videoId: ids[0],
    other: ids[1] ? { watchEndpoint: { videoId: ids[1] } } : undefined,
    menu: { menuRenderer: { items: [{ menuServiceItemRenderer: { icon: { iconType: 'REMOVE' }, serviceEndpoint: { feedbackEndpoint: { feedbackToken: 'CH-old' } } } }] } },
  });
  assert.deepStrictEqual(pickToken([card(['oldxxxxxxx1'])], 'oldxxxxxxx1', 'channel'), { token: 'CH-old' });
  assert.deepStrictEqual(pickToken([card(['oldxxxxxxx1', 'oldxxxxxxx2'])], 'oldxxxxxxx1', 'channel'), { error: 'no-token' });
});

test('a code outside a recognised menu entry is never used', () => {
  const data = {
    videoId: 'vvvvvvvvvv6',
    somewhere: { feedbackEndpoint: { feedbackToken: 'STRAY', contentId: 'vvvvvvvvvv6' } },
    report: { icon: { iconType: 'FLAG' }, serviceEndpoint: { feedbackEndpoint: { feedbackToken: 'REPORT', contentId: 'vvvvvvvvvv6' } } },
  };
  assert.deepStrictEqual(scanData(data).entries, []);
});

test('survives cyclic data', () => {
  const data = clone(cards.video);
  data.self = data;
  assert.deepStrictEqual(pickToken([data], 'vid0xxxxxxx', 'channel'), { token: 'TOKEN-vid-2' });
});

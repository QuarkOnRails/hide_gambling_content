'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createMatcher } = require('../src/matcher.js');

const DATA = path.join(__dirname, '..', 'data');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function allKeywordSets() {
  const dir = path.join(DATA, 'keywords');
  const sets = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson(path.join(dir, f)));
  sets.unshift(readJson(path.join(DATA, 'brands.json')));
  return sets;
}

const fixtures = readJson(path.join(__dirname, 'fixtures', 'titles.json'));
const full = createMatcher({ keywordSets: allKeywordSets() });

test('all bundled keyword files have the expected shape', () => {
  for (const set of allKeywordSets()) {
    assert.ok(typeof set.language === 'string' && set.language, 'language missing');
    for (const key of ['strong', 'weak', 'exceptions'].concat(set.channel ? ['channel'] : [])) {
      assert.ok(Array.isArray(set[key]), `${set.language}.${key} must be an array`);
      for (const entry of set[key]) {
        assert.strictEqual(typeof entry, 'string');
        assert.ok(entry.trim(), `${set.language}.${key} has an empty entry`);
        assert.ok(!/\*./.test(entry.replace(/\*\|/g, '|')), `"${entry}": * is only allowed at the end of an alternate`);
      }
    }
  }
});

for (const item of fixtures.hide) {
  test(`hides: ${item.title}${item.channel ? ' [' + item.channel + ']' : ''}`, () => {
    const res = full.evaluate({ title: item.title, channelName: item.channel, description: item.description });
    assert.strictEqual(res.hide, true, JSON.stringify(res));
  });
}

for (const item of fixtures.keep) {
  test(`keeps: ${item.title}`, () => {
    const res = full.evaluate({ title: item.title, channelName: item.channel, description: item.description });
    assert.strictEqual(res.hide, false, JSON.stringify(res));
  });
}

test('word boundaries: no matches inside longer words', () => {
  const m = createMatcher({ keywordSets: [{ strong: ['bet365'], weak: ['bets', 'slot'], exceptions: [] }] });
  assert.strictEqual(m.scoreText('alphabets and slotted spoons').score, 0);
  assert.strictEqual(m.scoreText('my bets, my slot').score, 2);
});

test('alternates of one concept count once', () => {
  const m = createMatcher({ keywordSets: [{ strong: [], weak: ['slot|slots'], exceptions: [] }] });
  const res = m.scoreText('slot slots SLOTS');
  assert.strictEqual(res.score, 1);
  assert.deepStrictEqual(res.hits, [{ term: 'slot', tier: 'weak' }]);
});

test('a word shared by two languages counts once', () => {
  const m = createMatcher({
    keywordSets: [
      { strong: [], weak: ['casino|casinos'], exceptions: [] },
      { strong: [], weak: ['kasino|casino'], exceptions: [] },
    ],
  });
  assert.strictEqual(m.scoreText('kasino casino').score, 1);
});

test('trailing wildcard and flexible gaps', () => {
  const m = createMatcher({ keywordSets: [{ strong: ['bonus buy', 'лудоман*'], weak: [], exceptions: [] }] });
  assert.strictEqual(m.scoreText('BonusBuy').score, 2);
  assert.strictEqual(m.scoreText('bonus-buy').score, 2);
  assert.strictEqual(m.scoreText('bonus, buy').score, 2);
  assert.strictEqual(m.scoreText('лудомания').score, 2);
  assert.strictEqual(m.scoreText('bonus to buy').score, 0);
});

test('threshold is configurable', () => {
  const sets = [{ strong: [], weak: ['casino', 'jackpot', 'poker'], exceptions: [] }];
  assert.strictEqual(createMatcher({ keywordSets: sets, threshold: 3 }).evaluate({ title: 'casino jackpot' }).hide, false);
  assert.strictEqual(createMatcher({ keywordSets: sets, threshold: 3 }).evaluate({ title: 'casino jackpot poker' }).hide, true);
  assert.strictEqual(createMatcher({ keywordSets: sets, threshold: 1 }).evaluate({ title: 'casino' }).hide, true);
});

test('title and channel name are scored together but phrases do not span them', () => {
  const m = createMatcher({ keywordSets: [{ strong: ['bonus buy'], weak: ['casino', 'jackpot'], exceptions: [] }] });
  assert.strictEqual(m.evaluate({ title: 'jackpot', channelName: 'Casino Dan' }).hide, true);
  assert.strictEqual(m.evaluate({ title: 'weekly bonus', channelName: 'Buy Cheap' }).hide, false);
});

test('channel blocklist: id, handle and name meet in one compact key', () => {
  const m = createMatcher({ keywordSets: [], channels: [{ id: 'UC123', handle: '@SlotKing', name: 'Slot King' }] });
  assert.strictEqual(m.evaluate({ title: 'x', channelId: 'UC123' }).reason, 'channel');
  assert.strictEqual(m.evaluate({ title: 'x', handle: '/@slotking' }).reason, 'channel');
  assert.strictEqual(m.evaluate({ title: 'x', channelName: 'SLOT KING' }).reason, 'channel');
  assert.strictEqual(m.evaluate({ title: 'x', channelName: 'Slot King', handle: '@other' }).reason, 'channel');
  assert.strictEqual(m.evaluate({ title: 'x', handle: '@someoneelse', channelName: 'Someone' }).hide, false);
  assert.strictEqual(m.evaluate({ title: 'x', channelName: 'Slot King Fan Club' }).hide, false);
});

test('a channel match reports the blocklist entry that matched', () => {
  const bundled = { name: 'Slot King' };
  const mine = { handle: '@casinodan' };
  const m = createMatcher({ keywordSets: [], channels: [bundled, mine] });
  assert.strictEqual(m.evaluate({ title: 'x', channelName: 'SLOT KING' }).channel, bundled);
  assert.strictEqual(m.evaluate({ title: 'x', handle: '@CasinoDan' }).channel, mine);
  assert.strictEqual(m.evaluate({ title: 'x', handle: '@nobody' }).channel, undefined);
});

test('an entry that only has a name also matches the handle, and the other way round', () => {
  const m = createMatcher({ keywordSets: [], channels: [{ name: 'MrHandPay' }, { name: "Brandon O'Brien" }, { handle: '@dudeluck23' }] });
  assert.strictEqual(m.evaluate({ title: 'x', handle: '@mrhandpay', channelName: 'Whatever' }).reason, 'channel');
  assert.strictEqual(m.evaluate({ title: 'x', channelName: 'Mr. Hand Pay' }).reason, 'channel');
  assert.strictEqual(m.evaluate({ title: 'x', channelName: 'Brandon O\u2019Brien' }).reason, 'channel');
  assert.strictEqual(m.evaluate({ title: 'x', channelName: 'Dude Luck 23' }).reason, 'channel');
});

test('channel-name terms block glued names and handles; allowlist still wins', () => {
  const sets = [{ strong: [], weak: [], exceptions: [], channel: ['casino|kasino', 'jackpot'] }];
  const m = createMatcher({ keywordSets: sets, allowChannels: [{ handle: '@jackpotnews' }] });
  assert.strictEqual(m.evaluate({ title: 'My day', channelName: 'TheCasinoKing' }).reason, 'channel-name');
  assert.strictEqual(m.evaluate({ title: 'My day', handle: '@jackpotjudo', channelName: 'JJ' }).reason, 'channel-name');
  assert.strictEqual(m.evaluate({ title: 'My day', channelName: 'České Kasíno TV' }).reason, 'channel-name');
  assert.strictEqual(m.evaluate({ title: 'My day', handle: '@jackpotnews', channelName: 'Jackpot News' }).reason, 'allowlist');
  assert.strictEqual(m.evaluate({ title: 'jackpot', channelName: 'Cooking Daily' }).hide, false);
});

test('every user-reported channel in the bundled list is blocked by name and by handle', () => {
  const list = readJson(path.join(DATA, 'channels.json')).channels;
  const m = createMatcher({ keywordSets: [], channels: list });
  const reported = list.filter((c) => (c.tags || []).includes('user-reported'));
  assert.strictEqual(reported.length, 17);
  for (const ch of reported) {
    assert.strictEqual(m.evaluate({ title: 'x', channelName: ch.name }).reason, 'channel', ch.name);
    const handle = '@' + ch.name.replace(/[^A-Za-z0-9]/g, '');
    assert.strictEqual(m.evaluate({ title: 'x', handle, channelName: 'Other' }).reason, 'channel', handle);
  }
});

test('bundled channel list is well formed', () => {
  const list = readJson(path.join(DATA, 'channels.json')).channels;
  assert.ok(Array.isArray(list));
  const ids = new Set();
  for (const ch of list) {
    assert.ok(ch.id || ch.handle || ch.name, 'empty channel entry');
    if (ch.id) {
      assert.match(ch.id, /^UC[\w-]{22}$/, 'bad channel id for ' + ch.name);
      assert.ok(!ids.has(ch.id), 'duplicate id ' + ch.id);
      ids.add(ch.id);
    }
    if (ch.handle) assert.match(ch.handle, /^@/, 'handle must start with @');
  }
});

test('allowlist wins over blocklist and keywords', () => {
  const m = createMatcher({
    keywordSets: [{ strong: ['online casino'], weak: [], exceptions: [] }],
    channels: [{ handle: '@news' }],
    allowChannels: [{ handle: '@News' }],
  });
  const res = m.evaluate({ title: 'Online casino regulation explained', handle: '@news' });
  assert.strictEqual(res.hide, false);
  assert.strictEqual(res.reason, 'allowlist');
});

test('empty configuration never hides', () => {
  const m = createMatcher({});
  assert.strictEqual(m.evaluate({ title: 'online casino jackpot' }).hide, false);
  assert.strictEqual(m.evaluate(null).hide, false);
});

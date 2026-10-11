'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalize, normalizeHandle } = require('../src/normalize.js');

test('strips diacritics and lowercases', () => {
  assert.strictEqual(normalize('Výherní AUTOMATY'), 'vyherni automaty');
  assert.strictEqual(normalize('Kasíno  \n voľné'), 'kasino volne');
  assert.strictEqual(normalize('caça-níqueis'), 'caca-niqueis');
});

test('folds letters NFKD leaves alone', () => {
  assert.strictEqual(normalize('zakłady'), 'zaklady');
  assert.strictEqual(normalize('kazandım'), 'kazandim');
  assert.strictEqual(normalize('İDDAA'), 'iddaa');
  assert.strictEqual(normalize('Glücksspiel Spaß'), 'glucksspiel spass');
});

test('folds fancy unicode letters and removes invisible characters', () => {
  assert.strictEqual(normalize('𝐂𝐀𝐒𝐈𝐍𝐎'), 'casino');
  assert.strictEqual(normalize('ＣＡＳＩＮＯ'), 'casino');
  assert.strictEqual(normalize('ca​si­no'), 'casino');
});

test('keeps cyrillic and emoji', () => {
  assert.strictEqual(normalize('КАЗИНО 🎰'), 'казино 🎰');
});

test('handles empty input', () => {
  assert.strictEqual(normalize(null), '');
  assert.strictEqual(normalize(undefined), '');
  assert.strictEqual(normalize(''), '');
});

test('normalizeHandle', () => {
  assert.strictEqual(normalizeHandle('@SomeChannel'), '@somechannel');
  assert.strictEqual(normalizeHandle('SomeChannel'), '@somechannel');
  assert.strictEqual(normalizeHandle('/@SomeChannel/videos'), '@somechannel');
  assert.strictEqual(normalizeHandle('https://www.youtube.com/@Some.Channel?x=1'), '@some.channel');
  assert.strictEqual(normalizeHandle('/@%D0%BA%D0%B0%D0%BD%D0%B0%D0%BB'), '@канал');
  assert.strictEqual(normalizeHandle(''), '');
});

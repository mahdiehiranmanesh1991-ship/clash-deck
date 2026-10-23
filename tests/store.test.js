import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadState, saveState, diffNewCards, exportCollection, importCollection, normalizeTag, mapPlayer, fetchPlayer } from '../js/store.js';

const cat = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
const player = JSON.parse(fs.readFileSync(new URL('./fixtures/player.json', import.meta.url)));
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

test('state roundtrip; API key only stored when opted in', () => {
  const s = mem(); const st = loadState(s);
  st.collection.knight = { level: 14, evo: true, hero: false };
  st.settings.apiKey = 'secret'; saveState(s, st);
  assert.ok(!s.getItem('clashdeck.v1').includes('secret'));
  st.settings.rememberKey = true; saveState(s, st);
  assert.equal(loadState(s).settings.apiKey, 'secret');
  assert.equal(loadState(s).collection.knight.level, 14);
});

test('device-level new-card detection', () => {
  assert.deepEqual(diffNewCards(cat, []), [], 'first run: nothing is "new"');
  const known = cat.cards.map((c) => c.key).filter((k) => k !== 'knight');
  assert.deepEqual(diffNewCards(cat, known), ['knight']);
});

test('export / import', () => {
  const col = { knight: { level: 14, evo: true, hero: false }, 'hog-rider': { level: 12, evo: false, hero: false } };
  const ex = exportCollection(col, cat);
  assert.equal(ex.cards.length, 2);
  assert.deepEqual(importCollection(JSON.stringify(ex), cat), col);
  assert.deepEqual(Object.keys(importCollection(['Knight', 'Hog Rider', 'Nope'], cat)), ['knight', 'hog-rider']);
  assert.throws(() => importCollection('{"x":1}', cat));
});

test('tag normalisation', () => {
  assert.equal(normalizeTag('#2ppggq'), '2PPGGQ');
  assert.equal(normalizeTag(' 2pogg '), '2P0GG');
  assert.equal(normalizeTag('#ABC'), null);
});

test('mapPlayer: levels, evo/hero bitmask, towers, unknown cards', () => {
  const r = mapPlayer(player, cat);
  assert.equal(Object.keys(r.collection).length, player.cards.length - 1);
  assert.deepEqual(r.unknown, ['Future Card']);
  for (const pc of player.cards.filter((c) => c.id < 26999999)) {
    const card = cat.cards.find((c) => c.id === pc.id);
    const o = r.collection[card.key];
    assert.equal(o.level, pc.level + 16 - pc.maxLevel);
    assert.equal(o.evo, !!(pc.evolutionLevel & 1) && card.evo);
    assert.equal(o.hero, !!(pc.evolutionLevel & 2) && card.hero);
  }
  assert.deepEqual(r.towers, [159000001]);
  assert.equal(r.currentDeck.length, 8);
  assert.deepEqual(importCollection(player, cat), r.collection, 'raw API JSON can be pasted too');
});

test('fetchPlayer uses proxy + bearer, or own endpoint without key', async () => {
  const calls = [];
  const f = async (url, o) => { calls.push([url, o.headers.authorization]); return { ok: true, status: 200, json: async () => player }; };
  await fetchPlayer('#2ppggq', { apiKey: 'k' }, f);
  assert.deepEqual(calls[0], ['https://proxy.royaleapi.dev/v1/players/%232PPGGQ', 'Bearer k']);
  await fetchPlayer('2PPGGQ', { endpoint: 'https://w.example/v1/' }, f);
  assert.deepEqual(calls[1], ['https://w.example/v1/players/%232PPGGQ', undefined]);
  await assert.rejects(fetchPlayer('2PPGGQ', {}, f), /no-key/);
  await assert.rejects(fetchPlayer('2PPGGQ', { apiKey: 'k' }, async () => ({ ok: false, status: 403 })), /forbidden/);
});

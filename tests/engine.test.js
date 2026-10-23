import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../js/engine.js';

const cat = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
const meta = JSON.parse(fs.readFileSync(new URL('../data/meta.json', import.meta.url)));
const champ = (k) => cat.cards.find((c) => c.key === k).champion;
function collection(p = 0.8, seed = 7) {
  let s = seed; const r = () => ((s = s * 16807 % 2147483647) / 2147483647);
  const col = {};
  for (const c of cat.cards) if (r() < p) col[c.key] = { level: 10 + Math.floor(r() * 5), evo: c.evo && r() < 0.3, hero: c.hero && r() < 0.3 };
  return col;
}
const LINK = /^https:\/\/link\.clashroyale\.com\/en\/\?clashroyale:\/\/copyDeck\?deck=(\d{8};){7}\d{8}&l=Royals&tt=\d+$/;

test('generates 3–5 valid, diverse, explained decks', () => {
  const ctx = E.makeContext(cat, collection(), meta);
  const { decks } = E.generateDecks(ctx);
  assert.ok(decks.length >= 3 && decks.length <= 5);
  for (const d of decks) {
    assert.equal(new Set(d.keys).size, 8);
    assert.ok(d.keys.every((k) => ctx.owned.has(k)), 'only owned cards');
    assert.ok(d.valid && d.score > 0 && d.score <= 100);
    assert.ok(d.avg > 2 && d.avg < 5.5);
    assert.ok(d.cycle4 > 0 && d.cycle4 < d.avg * 4 + 0.01);
    assert.ok(d.pros.length >= 1);
    assert.match(d.link, LINK);
    assert.ok(d.keys.filter(champ).length <= 1, 'max 1 champion');
    assert.ok(d.keys.some((k) => ctx.cards.get(k).R.has('win')), 'has win condition');
  }
  for (let i = 0; i < decks.length; i++) for (let j = i + 1; j < decks.length; j++) assert.ok(decks[i].keys.filter((k) => decks[j].keys.includes(k)).length <= 5);
  assert.ok(new Set(decks.map((d) => d.arch)).size >= 3, 'archetype variety');
});

test('not enough cards → clear error', () => {
  const ctx = E.makeContext(cat, { knight: { level: 11 }, archers: { level: 11 } }, meta);
  assert.equal(E.generateDecks(ctx).error, 'not-enough-cards');
});

test('slot rules: champions only in Hero/Wild slot, limited by unlocked slots', () => {
  const col = collection(1, 3);
  const champs = cat.cards.filter((c) => c.champion).map((c) => c.key);
  const ctx1 = E.makeContext(cat, col, meta, { specialSlots: 1 }); // only Evo slot → no champion allowed
  for (const d of E.generateDecks(ctx1).decks) assert.ok(!d.keys.some((k) => champs.includes(k)));
  const ctx3 = E.makeContext(cat, col, meta, { specialSlots: 3 });
  const deck = [champs[0], champs[1], 'knight', 'archers', 'fireball', 'the-log', 'hog-rider', 'musketeer'];
  assert.equal(E.scoreDeck(deck, ctx3, 'cycle').valid, false, 'two champions invalid by default');
  const ctx2c = E.makeContext(cat, col, meta, { specialSlots: 3, rules: { maxChampions: 2 } });
  assert.equal(E.scoreDeck(deck, ctx2c, 'cycle').valid, true, 'event rule allows 2');
  const s = E.assignSlots(deck, ctx2c);
  assert.ok(s.slots.filter((x) => x.form === 'champion').every((x) => x.slot !== 'evo'));
});

test('evo/hero only used when owned', () => {
  const col = collection(0.9, 11);
  for (const k of Object.keys(col)) { col[k].evo = false; col[k].hero = false; }
  const ctx = E.makeContext(cat, col, meta);
  for (const d of E.generateDecks(ctx).decks) assert.ok(d.slots.every((s) => s.form === 'champion'));
});

test('complete-my-deck keeps locked cards', () => {
  const ctx = E.makeContext(cat, collection(), meta);
  const { decks } = E.generateDecks(ctx, { locked: ['hog-rider', 'fireball'], count: 3 });
  assert.ok(decks.length >= 1);
  for (const d of decks) assert.ok(d.keys.includes('hog-rider') && d.keys.includes('fireball'));
});

test('archetype filter', () => {
  const ctx = E.makeContext(cat, collection(), meta);
  const { decks } = E.generateDecks(ctx, { archetypes: ['cycle'] });
  assert.ok(decks.length >= 1 && decks.every((d) => d.arch === 'cycle'));
});

test('swap suggestions improve a weak deck; upgrade priority', () => {
  const ctx = E.makeContext(cat, collection(1, 5), meta);
  const weak = ['golem', 'pekka', 'mega-knight', 'electro-giant', 'royal-giant', 'giant', 'lava-hound', 'goblin-giant'];
  const sw = E.swapSuggestions(weak, ctx);
  assert.ok(sw.length >= 1 && sw.every((s) => s.delta > 0 && weak.includes(s.out) && !weak.includes(s.in)));
  const an = E.analyzeDeck(weak, ctx);
  assert.ok(an.cons.length >= 1);
  const { decks } = E.generateDecks(ctx);
  const up = E.upgradePriority(decks, ctx);
  assert.ok(up.length >= 1 && up.every((u) => ctx.owned.has(u.key)));
});

test('similar meta deck & link', () => {
  const ctx = E.makeContext(cat, collection(1, 9), meta);
  const m = meta.decks.find((d) => d.ladder);
  const keys = m.cards.map((c) => c.key);
  const sim = E.similarMeta(keys, ctx);
  assert.ok(sim && sim.overlap === 8);
  assert.match(E.deckLink(keys, ctx, 159000001), /tt=159000001$/);
});

test('a brand-new card with only estimated roles can be used', () => {
  const cat2 = structuredClone(cat);
  cat2.cards.push({ id: 26000999, key: 'test-titan', name: 'Test Titan', elixir: 5, rarity: 'epic', type: 'troop', maxLevel: 11, evo: false, hero: false, champion: false, roles: ['tank', 'win'], rolesEstimated: true, added: cat.updated });
  const col = collection(0.5, 13); col['test-titan'] = { level: 16 };
  const ctx = E.makeContext(cat2, col, meta);
  assert.deepEqual(E.winArchetypes(ctx.cards.get('test-titan'), ctx.cards.get('test-titan').R), ['beatdown']);
  const { decks } = E.generateDecks(ctx, { archetypes: ['beatdown'] });
  assert.ok(decks.length >= 1);
});

test('performance: generation under 3 s', () => {
  const ctx = E.makeContext(cat, collection(1, 2), meta);
  const t = Date.now(); E.generateDecks(ctx); assert.ok(Date.now() - t < 3000);
});

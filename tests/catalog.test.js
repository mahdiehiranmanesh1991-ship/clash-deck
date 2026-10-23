import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeFromId, slugify, displayLevel, rolesFromDeckShop, normalizeOfficial, mergeCatalog, isRecent, parseDeckShopList, parseDeckShopDetail, parseDeckShopMeta, NON_LADDER } from '../js/catalog.js';
import fs from 'node:fs';

const cat = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
const meta = JSON.parse(fs.readFileSync(new URL('../data/meta.json', import.meta.url)));

test('type from official id prefix', () => {
  assert.equal(typeFromId(26000000), 'troop');
  assert.equal(typeFromId(27000000), 'building');
  assert.equal(typeFromId(28000000), 'spell');
  assert.equal(typeFromId(159000000), 'tower');
});

test('slugify matches Deck Shop slugs', () => {
  assert.equal(slugify('P.E.K.K.A'), 'pekka');
  assert.equal(slugify('Mini P.E.K.K.A'), 'mini-pekka');
  assert.equal(slugify('X-Bow'), 'x-bow');
  assert.equal(slugify('The Log'), 'the-log');
});

test('displayLevel converts rarity-relative API levels to 1..16', () => {
  assert.equal(displayLevel(16, 16), 16);
  assert.equal(displayLevel(8, 8), 16);   // max legendary
  assert.equal(displayLevel(1, 6), 11);   // fresh champion
  assert.equal(displayLevel(9, 11), 14);  // epic
});

test('rolesFromDeckShop maps role strings', () => {
  const r = rolesFromDeckShop(['Win condition', 'Building targeting', 'Ground troop'], 4, 'troop');
  assert.ok(r.includes('win'));
  assert.ok(rolesFromDeckShop(['Spell', 'High-damage spell'], 4, 'spell').includes('spellB'));
  assert.ok(rolesFromDeckShop(['Spell', 'Low-damage spell'], 2, 'spell').includes('spellS'));
  assert.ok(rolesFromDeckShop(['Anti-air troop'], 4, 'troop').includes('air'));
});

test('normalizeOfficial reads evo/hero bitmask', () => {
  const c = normalizeOfficial({ id: 26000000, name: 'Knight', elixirCost: 3, rarity: 'common', maxLevel: 16, maxEvolutionLevel: 3, iconUrls: { medium: 'x' } });
  assert.deepEqual([c.key, c.type, c.evo, c.hero, c.champion], ['knight', 'troop', true, true, false]);
  const d = normalizeOfficial({ id: 26000001, name: 'Archers', elixirCost: 3, rarity: 'common', maxEvolutionLevel: 1 });
  assert.deepEqual([d.evo, d.hero], [true, false]);
});

test('mergeCatalog detects new cards and new forms, never deletes', () => {
  const prev = [{ id: 1, key: 'a', name: 'A', roles: ['win'], fa: 'آ', evo: false, hero: false }, { id: 2, key: 'b', name: 'B', roles: ['tank'] }];
  const inc = [{ id: 1, key: 'a', name: 'A', evo: true, hero: false, type: 'troop' }, { id: 3, key: 'c', name: 'C', elixir: 4, type: 'troop' }];
  const m = mergeCatalog(prev, inc, '2026-11-01');
  assert.deepEqual(m.added, ['C']);
  assert.deepEqual(m.newForms, ['Evo A']);
  assert.equal(m.cards.length, 3, 'B kept although missing in incoming');
  const a = m.cards.find((c) => c.key === 'a');
  assert.equal(a.fa, 'آ'); assert.equal(a.evoAdded, '2026-11-01');
  const c = m.cards.find((x) => x.key === 'c');
  assert.equal(c.added, '2026-11-01'); assert.ok(c.rolesEstimated && c.roles.length);
  // second merge is stable
  const m2 = mergeCatalog(m.cards, inc, '2026-11-02');
  assert.deepEqual([m2.added, m2.newForms], [[], []]);
});

test('isRecent', () => {
  assert.ok(isRecent('2026-10-01', '2026-10-23', 60));
  assert.ok(!isRecent('2026-07-01', '2026-10-23', 60));
  assert.ok(!isRecent(null, '2026-10-23'));
});

test('Deck Shop parsers on small fixtures', () => {
  const list = parseDeckShopList(`<h4>Common cards</h4><a href="/card/detail/knight"><div><img src="/img/k.png" alt="Knight"></div></a>
    <h4>Rare</h4><a href="/card/detail/evo-valkyrie"><img src="/img/v.png" alt="Evo Valkyrie"></a><a href="/card/detail/hero-giant"><img src="/img/g.png" alt="Hero Giant"></a>`);
  assert.deepEqual(list.map((x) => [x.name, x.form, x.rarity]), [['Knight', 'base', 'common'], ['Valkyrie', 'evo', 'rare'], ['Giant', 'hero', 'rare']]);
  const det = parseDeckShopDetail('<div>Epic</div><div>4 elixir</div><h3>Deck-building roles</h3><p>x</p><li>Win condition</li><li>Ground troop</li><p>Support Deck Shop</p>');
  assert.deepEqual(det.roles, ['Win condition', 'Ground troop']);
  assert.equal(det.elixir, 4); assert.equal(det.rarity, 'epic');
  const m = parseDeckShopMeta('<h2>Ladder</h2><h5 title="Hog 2.6">x</h5><a href="/deck/detail/hog-rider,musketeer,ice-golem,skeletons,ice-spirit,cannon,fireball,the-log?tt=159000000">d</a><h2>2v2</h2><a href="/deck/detail/a,b,c">short</a>');
  assert.equal(m.length, 1); assert.equal(m[0].name, 'Hog 2.6'); assert.equal(m[0].tt, 159000000);
  assert.ok(NON_LADDER.test('2v2 Showdown') && !NON_LADDER.test('Path of Legends'));
});

test('bundled snapshot is consistent', () => {
  assert.ok(cat.cards.length >= 120);
  const keys = new Set(cat.cards.map((c) => c.key));
  assert.equal(keys.size, cat.cards.length, 'unique keys');
  for (const c of cat.cards) {
    assert.ok(c.fa, 'Persian name for ' + c.name);
    assert.ok(c.roles?.length || c.rolesEstimated, 'roles for ' + c.name);
    assert.ok(['troop', 'spell', 'building'].includes(c.type), 'type ' + c.name);
    if (c.img?.base) assert.ok(fs.existsSync(new URL('../' + c.img.base, import.meta.url)), 'image ' + c.img.base);
  }
  assert.ok(cat.towerTroops.length >= 4);
  assert.ok(meta.decks.length >= 10 && meta.decks.every((d) => d.cards.length === 8 && d.cards.every((x) => keys.has(x.key))));
  assert.equal(cat.cards.filter((c) => c.champion).length >= 8, true);
});

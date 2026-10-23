// Integration test for scripts/update-data.mjs with offline fixtures (no network):
// a new card + a new Hero form appear in the sources → they are added with today's date,
// nothing is deleted, and a second identical run changes nothing (cron commits only on change).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cards.json')));
const cacheName = (url) => url.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]+/gi, '_');
const MIRROR = 'https://mirror.test/cards.json';
const DS = 'https://ds.test';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-'));
  const data = path.join(dir, 'data'); const cache = path.join(dir, 'cache');
  fs.mkdirSync(data); fs.mkdirSync(cache);
  for (const f of ['cards.json', 'meta.json', 'fa-names.json']) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(data, f));
  return { dir, data, cache };
}
function writeSources(cache) {
  const known = cat.cards.filter((c) => c.id);
  const target = known.find((c) => !c.hero && !c.champion && c.type === 'troop');
  const items = known.map((c) => ({ id: c.id, name: c.name, elixirCost: c.elixir, rarity: c.rarity, maxLevel: c.maxLevel, maxEvolutionLevel: (c.evo ? 1 : 0) | (c.hero ? 2 : 0), iconUrls: { medium: c.remote?.base || undefined } }));
  items.push({ id: 26000999, name: 'Test Titan', elixirCost: 7, rarity: 'legendary', maxLevel: 8, iconUrls: {} });
  fs.writeFileSync(path.join(cache, cacheName(MIRROR)), JSON.stringify({ items, supportItems: cat.towerTroops.map((t) => ({ id: t.id, name: t.name })) }));
  const a = (slug, alt) => `<a href="/card/detail/${slug}"><img src="/img/${slug}.png" alt="${alt}"></a>`;
  const list = '<h4>Cards</h4>' + cat.cards.map((c) => a(c.key, c.name)).join('') + a('test-titan', 'Test Titan') + a('hero-' + target.key, 'Hero ' + target.name);
  fs.writeFileSync(path.join(cache, cacheName(DS + '/card/list')), list);
  fs.writeFileSync(path.join(cache, cacheName(DS + '/card/detail/test-titan')), '<div>Legendary</div><div>7 elixir</div><h3>Deck-building roles</h3><p>-</p><li>Win condition</li><li>Big tank</li><li>Building targeting</li><p>Support Deck Shop</p>');
  return target;
}
function run(env) {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/update-data.mjs')], { env: { PATH: process.env.PATH, CACHE_ONLY: '1', SKIP_IMAGES: '1', CARDS_MIRROR_URL: MIRROR, DECKSHOP_BASE: DS, ...env }, encoding: 'utf8' });
  const m = out.match(/\[update\] done (.*)/);
  return { log: out, res: JSON.parse(m[1]) };
}

test('no source reachable → existing data kept untouched', () => {
  const { data, cache } = setup();
  const before = fs.readFileSync(path.join(data, 'cards.json'), 'utf8');
  const { res } = run({ DATA_DIR: data, CACHE_DIR: cache, TODAY: '2027-01-01' });
  assert.equal(res.changed, false);
  assert.equal(fs.readFileSync(path.join(data, 'cards.json'), 'utf8'), before);
});

test('new card + new hero form detected, then idempotent', () => {
  const { data, cache } = setup();
  const target = writeSources(cache);
  const r1 = run({ DATA_DIR: data, CACHE_DIR: cache, TODAY: '2027-01-01' });
  assert.equal(r1.res.changed, true);
  assert.deepEqual(r1.res.added, ['Test Titan']);
  assert.deepEqual(r1.res.newForms, ['Hero ' + target.name]);
  const out = JSON.parse(fs.readFileSync(path.join(data, 'cards.json')));
  assert.equal(out.updated, '2027-01-01');
  assert.ok(out.cards.length === cat.cards.length + 1, 'nothing deleted');
  const tt = out.cards.find((c) => c.key === 'test-titan');
  assert.equal(tt.added, '2027-01-01'); assert.equal(tt.id, 26000999); assert.equal(tt.elixir, 7);
  assert.ok(tt.roles.includes('win') && tt.roles.includes('tank') && !tt.rolesEstimated, 'roles from Deck Shop detail');
  const h = out.cards.find((c) => c.key === target.key);
  assert.ok(h.hero && h.heroAdded === '2027-01-01');
  // second run, next day, same sources → nothing written (cron would not commit)
  const before = fs.readFileSync(path.join(data, 'cards.json'), 'utf8');
  const r2 = run({ DATA_DIR: data, CACHE_DIR: cache, TODAY: '2027-01-02' });
  assert.equal(r2.res.changed, false);
  assert.deepEqual([r2.res.added, r2.res.newForms], [[], []]);
  assert.equal(fs.readFileSync(path.join(data, 'cards.json'), 'utf8'), before);
});

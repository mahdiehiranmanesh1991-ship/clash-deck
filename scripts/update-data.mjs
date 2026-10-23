#!/usr/bin/env node
// Daily data refresh for «دک‌ساز کلش رویال».
// Sources, in order of authority:
//   1. Official Clash Royale API /v1/cards through the RoyaleAPI proxy — only if CR_API_TOKEN is set
//      (key must whitelist 45.79.218.79, see https://docs.royaleapi.com/proxy.html).
//   2. A public mirror of the official /v1/cards JSON (CARDS_MIRROR_URL) — ids, elixir, evo/hero flags.
//   3. Deck Shop /card/list (robots.txt allows it, 1 request) — detects brand-new cards and new Evo/Hero forms
//      even when 1 and 2 lag behind; detail pages (1 per NEW card, max 15/run) give deck-building roles.
//   4. Deck Shop homepage — current meta decks for the "similar to meta deck" feature.
// Nothing is ever deleted; new cards get `added: <date>` so the app can badge them «کارت جدید».
// Writes data/cards.json and data/meta.json only when their content actually changed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  normalizeOfficial, mergeCatalog, parseDeckShopList, parseDeckShopDetail, parseDeckShopMeta,
  rolesFromDeckShop, typeFromDeckShop, slugify, NON_LADDER, TOWER_TROOPS, RARITY_MAX,
} from '../js/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data'); // DATA_DIR: tests
const UA = 'clash-deck-pwa/1.0 (+https://github.com; daily data refresh, 1 req/s)';
const TOKEN = process.env.CR_API_TOKEN || '';
const PROXY = process.env.CR_API_BASE || 'https://proxy.royaleapi.dev/v1';
const MIRROR = process.env.CARDS_MIRROR_URL ?? 'https://raw.githubusercontent.com/outlierSlug/immaculate-grid-engine/HEAD/ingestion/clashroyale/raw/clashroyale_cards_raw.json';
const DS = process.env.DECKSHOP_BASE || 'https://www.deckshop.pro';
const CACHE_DIR = process.env.CACHE_DIR || ''; // optional: read pages from local files (tests / offline snapshot build)
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const MAX_DETAIL = +(process.env.MAX_DETAIL || 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[update]', ...a);

async function get(url, { json = false, headers = {} } = {}) {
  if (CACHE_DIR) {
    const f = path.join(CACHE_DIR, url.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]+/gi, '_'));
    try { const t = await fs.readFile(f, 'utf8'); return json ? JSON.parse(t) : t; } catch { /* fall through to network */ }
    if (process.env.CACHE_ONLY) throw new Error('not cached: ' + url);
  }
  const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return json ? res.json() : res.text();
}

async function readJson(f, fallback) {
  try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return fallback; }
}

async function writeIfChanged(f, obj, compareKeys) {
  const prev = await readJson(f, null);
  const strip = (o) => o && JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => compareKeys.includes(k))));
  if (prev && strip(prev) === strip(obj)) { log('unchanged', path.basename(f)); return false; }
  await fs.writeFile(f, JSON.stringify(obj, null, 1) + '\n');
  log('wrote', path.basename(f));
  return true;
}

export async function run() {
  const prev = await readJson(path.join(DATA, 'cards.json'), { cards: [], towerTroops: TOWER_TROOPS });
  const faNames = await readJson(path.join(DATA, 'fa-names.json'), {});
  const sources = [];
  let incoming = [];
  let towers = prev.towerTroops || TOWER_TROOPS;

  // 1+2: official card list (authoritative ids)
  try {
    let body;
    if (TOKEN) {
      body = await get(`${PROXY}/cards`, { json: true, headers: { authorization: `Bearer ${TOKEN}` } });
      sources.push('official-api');
    } else if (MIRROR) {
      body = await get(MIRROR, { json: true });
      sources.push('official-mirror');
    }
    const items = Array.isArray(body) ? body : body?.items;
    if (items && items.length >= 100) {
      incoming = items.map(normalizeOfficial);
      const sup = body?.supportItems;
      if (Array.isArray(sup) && sup.length) towers = sup.map((s) => ({ id: s.id, name: s.name }));
    } else if (body) log('official list looked invalid, ignored');
  } catch (e) { log('official source failed:', e.message); }

  // 3: Deck Shop card list — new names / new forms
  let dsList = [];
  try {
    dsList = parseDeckShopList(await get(`${DS}/card/list`));
    if (dsList.filter((x) => x.form === 'base').length >= 100) sources.push('deckshop-list'); else dsList = [];
  } catch (e) { log('deckshop list failed:', e.message); }

  const byKey = new Map(incoming.map((c) => [c.key, c]));
  const prevKeys = new Set(prev.cards.map((c) => c.key));
  for (const d of dsList) {
    const key = slugify(d.name);
    if (d.form === 'base' && !byKey.has(key)) {
      const pc = prev.cards.find((c) => c.key === key);
      byKey.set(key, pc ? { ...pc } : { id: null, key, name: d.name, elixir: null, rarity: d.rarity, type: null, maxLevel: RARITY_MAX[d.rarity] || 16, evo: false, hero: false, champion: d.rarity === 'champion', remote: {} });
    }
    const c = byKey.get(key);
    if (!c) continue;
    if (d.form === 'evo') c.evo = true;
    if (d.form === 'hero') c.hero = true;
    if (d.form === 'base' && !c.remote?.base && d.img) c.remote = { ...(c.remote || {}), base: DS + d.img };
  }
  incoming = [...byKey.values()];

  // roles for cards we have never seen (or only estimated) — 1 detail page each, politely
  let budget = MAX_DETAIL;
  for (const c of incoming) {
    const old = prev.cards.find((p) => p.key === c.key);
    if (old && old.roles?.length && !old.rolesEstimated) continue;
    if (!dsList.length || budget-- <= 0) continue;
    try {
      const det = parseDeckShopDetail(await get(`${DS}/card/detail/${c.key}`));
      if (det.roles.length) {
        c.dsRoles = det.roles;
        if (!c.type || c.type === 'troop' || c.type === 'spell') c.type = typeFromDeckShop(det.roles, c.id);
        if (c.elixir == null && det.elixir != null) c.elixir = det.elixir;
        c.roles = rolesFromDeckShop(det.roles, c.elixir, c.type);
      }
      if (!CACHE_DIR) await sleep(1200);
    } catch (e) { log('detail failed', c.key, e.message); }
  }

  if (!incoming.length) { log('no source reachable — keeping existing data'); return { changed: false }; }

  const merged = mergeCatalog(prev.cards, incoming, TODAY);
  for (const c of merged.cards) {
    if (!c.fa && faNames[c.name]) c.fa = faNames[c.name];
    if (!c.type) c.type = typeFromDeckShop(c.dsRoles || [], c.id) || 'troop';
    // Graveyard, Goblin Barrel etc. are spells in game even though the API id is 28xxxxxx -> already spell; keep.
  }
  if (merged.added.length) log('NEW CARDS:', merged.added.join(', '));
  if (merged.newForms.length) log('NEW FORMS:', merged.newForms.join(', '));

  if (!process.env.SKIP_IMAGES) await ensureImages(merged.cards);

  const out = {
    schema: 1,
    updated: TODAY,
    sources: [...new Set([...(prev.sources || []), ...sources])].filter((s) => sources.includes(s)),
    rules: prev.rules || { evoSlots: 1, heroSlots: 1, wildSlots: 1, maxChampions: 1, maxLevel: 16 },
    towerTroops: towers.map((t) => ({ ...t, fa: faNames[t.name] || t.name })),
    cards: merged.cards,
  };
  const cardsChanged = await writeIfChanged(path.join(DATA, 'cards.json'), out, ['cards', 'towerTroops', 'rules']);

  // 4: meta decks
  let metaChanged = false;
  try {
    const decks = parseDeckShopMeta(await get(`${DS}/`));
    if (decks.length >= 10) {
      const known = new Set(out.cards.map((c) => c.key));
      const mapped = decks.map((d) => ({
        name: d.name,
        section: d.section,
        ladder: !NON_LADDER.test(d.section),
        tt: d.tt,
        cards: d.cards.map((s) => {
          const form = s.startsWith('evo-') ? 'evo' : s.startsWith('hero-') ? 'hero' : null;
          const key = s.replace(/^(evo|hero)-/, '');
          return form ? { key, form } : { key };
        }),
      })).filter((d) => d.cards.every((c) => known.has(c.key)));
      metaChanged = await writeIfChanged(path.join(DATA, 'meta.json'), { updated: TODAY, source: 'deckshop.pro', decks: mapped }, ['decks']);
    }
  } catch (e) { log('meta failed:', e.message); }

  return { changed: cardsChanged || metaChanged, added: merged.added, newForms: merged.newForms };
}

// Download thumbnails for cards/forms that have no local image yet (new cards). Converted to 120px WebP
// when ImageMagick is available on the runner, otherwise the original PNG is stored.
async function ensureImages(cards) {
  let budget = 30;
  const im = ['magick', 'convert'].find((b) => { try { execFileSync(b, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } });
  for (const c of cards) {
    c.img = c.img || {};
    for (const [form, suf] of [['base', ''], ['evo', '_evo'], ['hero', '_hero']]) {
      if (form !== 'base' && !c[form]) continue;
      const url = c.remote?.[form];
      if (c.img[form] || !url || budget <= 0) continue;
      budget--;
      try {
        const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        const base = `img/cards/${c.id || c.key}${suf}`;
        const png = path.join(ROOT, base + '.png');
        await fs.writeFile(png, buf);
        if (im) {
          execFileSync(im, [png, '-resize', '120x', '-quality', '72', path.join(ROOT, base + '.webp')]);
          await fs.unlink(png);
          c.img[form] = base + '.webp';
        } else c.img[form] = base + '.png';
        log('image', c.img[form]);
      } catch (e) { log('image failed', c.key, form, e.message); }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((r) => { log('done', JSON.stringify(r)); }).catch((e) => { console.error(e); process.exit(1); });
}

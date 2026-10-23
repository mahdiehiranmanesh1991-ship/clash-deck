// Collection storage, import/export and player-tag import. No DOM — unit-testable.
import { slugify, displayLevel } from './catalog.js';

export const STORE_KEY = 'clashdeck.v1';
export const DEFAULT_SETTINGS = { tag: '', apiKey: '', rememberKey: false, endpoint: '', tower: 159000000, specialSlots: 3, maxChampions: 1, defaultLevel: 11 };

export function loadState(storage) {
  let s = {};
  try { s = JSON.parse(storage.getItem(STORE_KEY) || '{}'); } catch { s = {}; }
  return { collection: s.collection || {}, settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) }, knownKeys: s.knownKeys || [], seenAt: s.seenAt || null };
}

export function saveState(storage, state) {
  const settings = { ...state.settings };
  if (!settings.rememberKey) settings.apiKey = '';
  storage.setItem(STORE_KEY, JSON.stringify({ ...state, settings }));
}

/** Cards that appeared since the last visit on this device. */
export function diffNewCards(catalog, knownKeys) {
  if (!knownKeys || !knownKeys.length) return [];
  const known = new Set(knownKeys);
  return catalog.cards.filter((c) => !known.has(c.key)).map((c) => c.key);
}

export function exportCollection(collection, catalog) {
  const byKey = new Map(catalog.cards.map((c) => [c.key, c]));
  return {
    app: 'clash-deck', version: 1, exported: new Date().toISOString(),
    cards: Object.entries(collection).filter(([k]) => byKey.has(k)).map(([k, v]) => ({ key: k, id: byKey.get(k).id, name: byKey.get(k).name, level: v.level || 0, evo: !!v.evo, hero: !!v.hero })),
  };
}

/** Accepts our own export, a plain list of names, or a raw official /players response. */
export function importCollection(input, catalog) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (data && Array.isArray(data.cards) && data.cards.length && data.cards[0] && 'maxLevel' in data.cards[0] && !('key' in data.cards[0])) return mapPlayer(data, catalog).collection;
  const list = Array.isArray(data) ? data : data?.cards;
  if (!Array.isArray(list)) throw new Error('bad-format');
  const byKey = new Map(catalog.cards.map((c) => [c.key, c]));
  const byId = new Map(catalog.cards.filter((c) => c.id).map((c) => [c.id, c]));
  const out = {};
  for (const it of list) {
    const obj = typeof it === 'string' ? { name: it } : it;
    const card = (obj.key && byKey.get(obj.key)) || (obj.id && byId.get(obj.id)) || (obj.name && byKey.get(slugify(obj.name)));
    if (!card) continue;
    const lv = Math.max(0, Math.min(16, Math.round(+obj.level || 0)));
    out[card.key] = { level: lv, evo: !!obj.evo && card.evo, hero: !!obj.hero && card.hero };
  }
  return out;
}

export function normalizeTag(tag) {
  const t = String(tag || '').trim().toUpperCase().replace(/^#/, '').replace(/O/g, '0').replace(/\s+/g, '');
  return /^[0289PYLQGRJCUV]{3,14}$/.test(t) ? t : null;
}

/**
 * Map an official /v1/players/{tag} response to our collection.
 * card.level is rarity-relative (1..maxLevel) -> unified 1..16. evolutionLevel bitmask: 1 = Evo unlocked, 2 = Hero unlocked.
 */
export function mapPlayer(player, catalog) {
  const byId = new Map(catalog.cards.filter((c) => c.id).map((c) => [c.id, c]));
  const byKey = new Map(catalog.cards.map((c) => [c.key, c]));
  const collection = {};
  const unknown = [];
  for (const pc of player.cards || []) {
    const card = byId.get(pc.id) || byKey.get(slugify(pc.name || ''));
    if (!card) { unknown.push(pc.name); continue; }
    const ev = pc.evolutionLevel || 0;
    collection[card.key] = { level: displayLevel(pc.level, pc.maxLevel || card.maxLevel), evo: !!(ev & 1) && card.evo, hero: !!(ev & 2) && card.hero };
  }
  const towers = (player.supportCards || []).map((s) => s.id);
  const current = (player.currentDeck || []).map((c) => (byId.get(c.id) || byKey.get(slugify(c.name || '')) || {}).key).filter(Boolean);
  return { collection, unknown, towers, currentDeck: current, name: player.name, arena: player.arena?.name, trophies: player.trophies };
}

/** Fetch a player either through a personal API key (RoyaleAPI proxy, CORS-enabled) or a self-hosted endpoint. */
export async function fetchPlayer(tag, { apiKey = '', endpoint = '' } = {}, fetchFn = fetch) {
  const t = normalizeTag(tag);
  if (!t) throw new Error('bad-tag');
  let url; const headers = { accept: 'application/json' };
  if (endpoint) url = endpoint.replace(/\/+$/, '') + '/players/%23' + t;
  else if (apiKey) { url = 'https://proxy.royaleapi.dev/v1/players/%23' + t; headers.authorization = 'Bearer ' + apiKey.trim(); }
  else throw new Error('no-key');
  const res = await fetchFn(url, { headers });
  if (res.status === 403) throw new Error('forbidden');
  if (res.status === 404) throw new Error('not-found');
  if (!res.ok) throw new Error('http-' + res.status);
  return res.json();
}

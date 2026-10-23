// Card catalog helpers — shared by the browser app and the Node update script (no DOM, no deps).
export const TYPE_BY_PREFIX = { 26: 'troop', 27: 'building', 28: 'spell', 159: 'tower' };
export const RARITY_MAX = { common: 16, rare: 14, epic: 11, legendary: 8, champion: 6 };
export const RARITY_FA = { common: 'معمولی', rare: 'کمیاب', epic: 'حماسی', legendary: 'افسانه‌ای', champion: 'قهرمان' };
export const TOWER_TROOPS = [
  { id: 159000000, name: 'Tower Princess' },
  { id: 159000001, name: 'Cannoneer' },
  { id: 159000002, name: 'Dagger Duchess' },
  { id: 159000004, name: 'Royal Chef' },
];

export function typeFromId(id) {
  if (id == null) return null;
  const s = String(id);
  if (s.startsWith('159')) return 'tower';
  return TYPE_BY_PREFIX[s.slice(0, 2)] || null;
}

/** "P.E.K.K.A" -> "pekka", "X-Bow" -> "x-bow", "The Log" -> "the-log" (same scheme as Deck Shop slugs) */
export function slugify(name) {
  return String(name).toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Convert a rarity-relative API level to the unified 1..16 level shown in game. */
export function displayLevel(level, maxLevel) {
  if (!level) return 0;
  if (!maxLevel || maxLevel >= 16) return level;
  return Math.min(16, level + (16 - maxLevel));
}

/** Map Deck Shop "Deck-building roles" strings to the app's compact role codes. */
export function rolesFromDeckShop(ds = [], elixir = null, type = null) {
  const has = (s) => ds.includes(s);
  const r = new Set();
  if (has('Win condition')) r.add('win');
  if (has('Big tank')) r.add('tank');
  if (has('Mini tank')) r.add('minitank');
  if (has('Spell')) {
    if (has('High-damage spell') || (has('Medium-damage spell') && !has('Low-damage spell')) || (elixir >= 4 && !has('Low-damage spell'))) r.add('spellB');
    else if (has('Low-damage spell') || has('Medium-damage spell')) r.add('spellS');
  }
  if (has('Anti-air troop') || has('Air tank killer') || (has('Air-attacking splash') && type !== 'spell' && (elixir ?? 3) >= 3)) r.add('air');
  if (has('Ground tank killer') || has('Air tank killer')) r.add('tk');
  if (has('Ground-attacking splash') || has('Air-attacking splash')) r.add('splash');
  if (has('Defensive building') || has('Defensive tower') || has('Building')) r.add('bld');
  if (has('Siege tower')) r.add('siege');
  if (has('Low-elixir cycle card') || (elixir != null && elixir <= 2 && type !== 'spell')) r.add('cycle');
  if (has('Swarm troop')) r.add('swarm');
  if (has('Has reset attack') || has('Resets charge attack')) r.add('reset');
  if (has('Building chaser')) r.add('chaser');
  if (has('Air troop')) r.add('flying');
  if (has('Spawner building') || has('Spawner troop')) r.add('spawner');
  if (has('Pump response')) r.add('pumpResp');
  return [...r];
}

/** Fallback roles for a brand-new card when no role source is reachable. Marked as estimated. */
export function guessRoles(type, elixir) {
  const r = [];
  if (type === 'spell') r.push(elixir >= 4 ? 'spellB' : 'spellS', 'splash');
  else if (type === 'building') r.push('bld');
  else {
    if (elixir >= 6) r.push('tank');
    else if (elixir >= 4) r.push('minitank');
    if (elixir <= 2) r.push('cycle');
  }
  return r;
}

export function typeFromDeckShop(ds = [], id = null) {
  if (ds.includes('Spell') && !ds.includes('Swarm troop') || ds.includes('Spell') && ds.includes('Win condition') && !ds.includes('Air troop')) {
    // Graveyard / Goblin Barrel are spells in-game
    return 'spell';
  }
  if (ds.includes('Building')) return 'building';
  return typeFromId(id) === 'tower' ? 'tower' : (ds.length ? 'troop' : typeFromId(id));
}

/**
 * Normalize one item of the official /v1/cards response.
 * maxEvolutionLevel bitmask: 1 = Evolution, 2 = Hero, 3 = both.
 */
export function normalizeOfficial(item) {
  const mev = item.maxEvolutionLevel || 0;
  const icons = item.iconUrls || {};
  const rarity = String(item.rarity || '').toLowerCase();
  return {
    id: item.id,
    key: slugify(item.name),
    name: item.name,
    elixir: item.elixirCost ?? null,
    rarity,
    type: typeFromId(item.id),
    maxLevel: item.maxLevel || RARITY_MAX[rarity] || 16,
    evo: !!(mev & 1) || !!icons.evolutionMedium,
    hero: !!(mev & 2) || !!icons.heroMedium,
    champion: rarity === 'champion',
    remote: { base: icons.medium || null, evo: icons.evolutionMedium || null, hero: icons.heroMedium || null },
  };
}

/**
 * Merge freshly fetched cards into the previous catalog.
 * - never deletes cards (a non-authoritative source may be incomplete)
 * - stamps `added` (first seen date) on new cards and `evoAdded`/`heroAdded` on new forms
 * - keeps hand-curated fields (fa, roles, arch) from the previous catalog
 */
export function mergeCatalog(prevCards, incoming, today) {
  const byKey = new Map(prevCards.map((c) => [c.key, { ...c }]));
  const byId = new Map(prevCards.filter((c) => c.id).map((c) => [c.id, c.key]));
  const added = [];
  const newForms = [];
  for (const inc of incoming) {
    const key = (inc.id && byId.get(inc.id)) || inc.key;
    const old = byKey.get(key);
    if (!old) {
      const c = { ...inc, added: today };
      if (!c.roles || !c.roles.length) { c.roles = guessRoles(c.type, c.elixir); c.rolesEstimated = true; }
      byKey.set(key, c);
      added.push(c.name);
      continue;
    }
    const m = { ...old };
    for (const f of ['id', 'elixir', 'rarity', 'maxLevel', 'name']) if (inc[f] != null && inc[f] !== '') m[f] = inc[f];
    if (inc.type && !old.type) m.type = inc.type;
    if (inc.evo && !old.evo) { m.evo = true; m.evoAdded = today; newForms.push('Evo ' + m.name); }
    if (inc.hero && !old.hero) { m.hero = true; m.heroAdded = today; newForms.push('Hero ' + m.name); }
    if (inc.remote) m.remote = { ...(old.remote || {}), ...Object.fromEntries(Object.entries(inc.remote).filter(([, v]) => v)) };
    if (inc.roles && inc.roles.length && old.rolesEstimated) { m.roles = inc.roles; delete m.rolesEstimated; }
    if (inc.dsRoles && inc.dsRoles.length) m.dsRoles = inc.dsRoles;
    byKey.set(key, m);
  }
  const cards = [...byKey.values()].sort((a, b) => (a.id || 9e9) - (b.id || 9e9) || a.name.localeCompare(b.name));
  return { cards, added, newForms };
}

/** Is a date (YYYY-MM-DD) within `days` of reference date? */
export function isRecent(date, ref, days = 60) {
  if (!date || !ref) return false;
  const d = (Date.parse(ref) - Date.parse(date)) / 864e5;
  return d >= 0 && d <= days;
}

/** Parse Deck Shop /card/list HTML -> [{slug, name, form:'base'|'evo'|'hero', img, rarity}] */
export function parseDeckShopList(html) {
  const out = [];
  const seen = new Set();
  // rarity section headings come before their card grids
  const heads = [...html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)].map((m) => ({ pos: m.index, text: m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() }));
  const re = /href="\/card\/detail\/([^"?#]+)"[\s\S]{0,400}?<img[^>]*?src="([^"]+)"[^>]*?alt="([^"]+)"/g;
  for (const m of html.matchAll(re)) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const alt = decodeEntities(m[3]);
    const form = slug.startsWith('evo-') ? 'evo' : slug.startsWith('hero-') ? 'hero' : 'base';
    const name = form === 'base' ? alt : alt.replace(/^(Evo|Hero)\s+/, '');
    const h = heads.filter((x) => x.pos < m.index).pop();
    const rarity = h && ['common', 'rare', 'epic', 'legendary', 'champion'].find((r) => h.text.includes(r));
    out.push({ slug, name, form, img: m[2], rarity: rarity || null });
  }
  return out;
}

/** Parse a Deck Shop card detail page: roles list, elixir and rarity. */
export function parseDeckShopDetail(html) {
  const text = decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' | ')).replace(/\s+/g, ' ');
  const parts = text.split('|').map((s) => s.trim()).filter(Boolean);
  const roles = [];
  const i = parts.indexOf('Deck-building roles');
  if (i >= 0) {
    for (const p of parts.slice(i + 2)) {
      if (/^(Support Deck Shop|Do you like)/.test(p)) break;
      roles.push(p);
    }
  }
  const em = text.match(/\| (\d+) elixir \|/);
  const rm = text.match(/\| (Common|Rare|Epic|Legendary|Champion) [| ]*\d+ elixir/);
  return { roles, elixir: em ? +em[1] : null, rarity: rm ? rm[1].toLowerCase() : null };
}

/** Parse Deck Shop homepage meta decks: [{name, section, cards:[slugs], tt}] */
export function parseDeckShopMeta(html) {
  const heads = [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)].map((m) => ({ pos: m.index, text: m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));
  const titles = [...html.matchAll(/<h5[^>]*title="([^"]+)"/g)].map((m) => ({ pos: m.index, text: decodeEntities(m[1]) }));
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/href="\/deck\/detail\/([^"]+)"/g)) {
    let tt = null;
    const cards = decodeEntities(m[1]).split(',').map((s) => {
      const [slug, q] = s.split('?');
      const t = q && q.match(/tt=(\d+)/);
      if (t) tt = +t[1];
      return slug;
    });
    if (cards.length !== 8) continue;
    const k = [...cards].sort().join(',');
    if (seen.has(k)) continue;
    seen.add(k);
    const sec = heads.filter((x) => x.pos < m.index).pop();
    const ti = titles.filter((x) => x.pos < m.index).pop();
    out.push({ name: ti ? ti.text : '', section: sec ? sec.text : '', cards, tt });
  }
  return out;
}

/** Game modes whose decks are not representative for ladder / path of legends. */
export const NON_LADDER = /(Double|Triple|Infinite|Ramp Up|Rage|2v2|Sudden Death|Boosted)/i;

export function decodeEntities(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

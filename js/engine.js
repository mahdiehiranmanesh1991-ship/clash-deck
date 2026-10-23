// Rule-based, explainable deck engine. Pure functions — runs in the browser and under `node --test`.
import { ARCHETYPES, WIN_ARCH, ROLE_FIX, UTILITY, SYNERGY } from './knowledge.js';
import { isRecent } from './catalog.js';

// win 14 + spells 10 + air 9 + tk 7 + splash 5 + arch 4 + elixir 15 + level 20 + synergy 12 + meta 5 + forms 8
const MAX_POINTS = 109;
const fmt = (n) => Math.round(n * 10) / 10;
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const faNum = (v) => String(v).replace(/\d/g, (d) => FA_DIGITS[d]).replace('.', '٫');

/** Effective roles of a card: data roles + curated fixes. */
export function effectiveRoles(card) {
  const r = new Set(card.roles || []);
  for (const x of ROLE_FIX.add[card.key] || []) r.add(x);
  for (const x of ROLE_FIX.remove[card.key] || []) r.delete(x);
  if (r.has('spellB')) r.delete('spellS');
  return r;
}

/** Archetypes a win-condition card supports (curated, else inferred from cost/roles for new cards). */
export function winArchetypes(card, roles) {
  if (WIN_ARCH[card.key]) return WIN_ARCH[card.key];
  if (!roles.has('win')) return [];
  if (roles.has('siege')) return ['siege'];
  if (roles.has('tank') || (card.elixir ?? 0) >= 6) return ['beatdown'];
  if (card.type === 'spell' || (card.elixir ?? 4) <= 3) return ['bait', 'cycle'];
  return ['cycle', 'bridgespam'];
}

/**
 * Build the engine context.
 * collection: { [key]: { level: 1..16 (0 = unknown), evo: bool, hero: bool } }
 */
export function makeContext(catalog, collection, meta = { decks: [] }, opts = {}) {
  const rules = { ...(catalog.rules || {}), ...(opts.rules || {}) };
  const cards = new Map();
  for (const c of catalog.cards) {
    const roles = effectiveRoles(c);
    cards.set(c.key, { ...c, R: roles, wins: winArchetypes(c, roles), cost: c.elixir ?? 3.5 });
  }
  const owned = new Map();
  for (const [k, v] of Object.entries(collection || {})) if (cards.has(k) && v) owned.set(k, { level: +v.level || 0, evo: !!v.evo, hero: !!v.hero });

  // pair synergy: curated pairs (1.0) + co-occurrence in ladder meta decks (up to 1.0)
  const pairW = new Map();
  const pk = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  for (const [a, b] of SYNERGY) pairW.set(pk(a, b), 1);
  const metaFreq = new Map();
  const ladder = (meta.decks || []).filter((d) => d.ladder !== false);
  const co = new Map();
  for (const d of ladder) {
    const ks = [...new Set(d.cards.map((c) => c.key))];
    ks.forEach((k) => metaFreq.set(k, (metaFreq.get(k) || 0) + 1));
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) co.set(pk(ks[i], ks[j]), (co.get(pk(ks[i], ks[j])) || 0) + 1);
  }
  for (const [p, n] of co) pairW.set(p, Math.min(1.5, (pairW.get(p) || 0) + Math.min(1, n / 3)));
  const maxFreq = Math.max(1, ...metaFreq.values());

  const levels = [...owned.values()].map((o) => o.level).filter(Boolean).sort((a, b) => b - a);
  const topLevel = levels.length ? levels.slice(0, 8).reduce((s, x) => s + x, 0) / Math.min(8, levels.length) : 0;
  return {
    cards, owned, pairW, pk, metaFreq, maxFreq, metaDecks: ladder, allMeta: meta.decks || [],
    rules: { evoSlots: 1, heroSlots: 1, wildSlots: 1, maxChampions: 1, ...rules },
    specialSlots: opts.specialSlots ?? 3, // 0..3 unlocked (Evo@Arena3, Hero@Arena5, Wild@Arena10)
    topLevel, updated: catalog.updated,
  };
}

/** Choose evo / hero / wild slot holders. Champions must sit in the Hero or Wild slot. */
export function assignSlots(keys, ctx) {
  const n = ctx.specialSlots;
  const slotDefs = [
    { id: 'evo', fa: 'اسلات تکامل', allow: ['evo'] },
    { id: 'hero', fa: 'اسلات هیرو/قهرمان', allow: ['hero', 'champion'] },
    { id: 'wild', fa: 'اسلات آزاد', allow: ['evo', 'hero', 'champion'] },
  ].slice(0, n);
  const forms = (k) => {
    const c = ctx.cards.get(k); const o = ctx.owned.get(k) || {};
    const f = [];
    if (c.champion) f.push('champion');
    if (c.evo && o.evo) f.push('evo');
    if (c.hero && o.hero) f.push('hero');
    return f;
  };
  const champs = keys.filter((k) => ctx.cards.get(k).champion);
  let best = null;
  const rec = (i, used, acc, val) => {
    if (i === slotDefs.length) {
      const placedChamps = acc.filter((a) => a && a.form === 'champion').length;
      if (placedChamps !== champs.length) return;
      if (!best || val > best.val) best = { val, acc: [...acc] };
      return;
    }
    rec(i + 1, used, [...acc, null], val);
    for (const k of keys) {
      if (used.has(k)) continue;
      for (const f of forms(k)) {
        if (!slotDefs[i].allow.includes(f)) continue;
        const lv = (ctx.owned.get(k)?.level || 10) / 16;
        const v = (f === 'champion' ? 1.6 : 1.2) + lv * 0.3 + (ctx.metaFreq.get(k) || 0) / ctx.maxFreq * 0.2;
        used.add(k); rec(i + 1, used, [...acc, { key: k, form: f, slot: slotDefs[i].id, slotFa: slotDefs[i].fa }], val + v); used.delete(k);
      }
    }
  };
  rec(0, new Set(), [], 0);
  if (!best) return { valid: false, slots: [], reason: champs.length ? 'champion-slot' : 'none' };
  return { valid: true, slots: best.acc.filter(Boolean), filled: best.acc.filter(Boolean).length };
}

/** Score a (possibly partial) deck for an archetype. Returns breakdown for explanations. */
export function scoreDeck(keys, ctx, arch) {
  const cs = keys.map((k) => ctx.cards.get(k));
  const cnt = (role) => cs.filter((c) => c.R.has(role)).length;
  const A = ARCHETYPES[arch] || ARCHETYPES.cycle;
  const b = {};
  // win condition
  const wins = cs.filter((c) => c.R.has('win'));
  const fitWins = wins.filter((c) => c.wins.includes(arch));
  b.win = fitWins.length ? 14 : wins.length ? 8 : 0;
  if (wins.length >= 3) b.win -= 4;
  if (wins.length >= 2 && fitWins.length < wins.length) b.win -= 3;
  // spells
  const sS = cnt('spellS'); const sB = cnt('spellB');
  b.spells = (sS ? 5 : 0) + (sB ? 5 : 0) + (!sS && sB >= 2 ? 1 : 0) + (!sB && sS >= 2 ? 2 : 0);
  const spellCount = cs.filter((c) => c.type === 'spell' && !c.R.has('win')).length;
  if (spellCount > 3) b.spells -= 4 * (spellCount - 3);
  // air defence
  const air = cnt('air');
  b.air = air >= 3 ? 9 : air === 2 ? 7 : air === 1 ? 3 : 0;
  // tank killer / splash
  const tk = cnt('tk');
  b.tk = tk >= 2 ? 7 : tk === 1 ? 5 : 0;
  const splashTroops = cs.filter((c) => c.R.has('splash') && c.type !== 'spell').length;
  const splashSpells = cs.filter((c) => c.R.has('splash') && c.type === 'spell').length;
  b.splash = splashTroops ? 5 : splashSpells ? 2.5 : 0;
  // archetype specifics
  b.arch = 0;
  const bld = cnt('bld');
  if ((arch === 'siege' || arch === 'control') && bld) b.arch += 3;
  if (arch === 'beatdown' && !cnt('tank')) b.arch -= 6;
  if (arch === 'cycle' && cnt('cycle') >= 2) b.arch += 3;
  if (arch === 'bait') { const bait = cs.filter((c) => c.R.has('swarm') || (c.R.has('win') && c.cost <= 3)).length; b.arch += Math.min(4, bait * 1.5); }
  if (arch === 'bridgespam') b.arch += Math.min(3, cs.filter((c) => c.R.has('minitank') && c.cost >= 3).length);
  if (bld > 2) b.arch -= 4;
  if (cs.filter((c) => c.R.has('tank')).length > 2) b.arch -= 4;
  // elixir
  const avg = cs.reduce((s, c) => s + c.cost, 0) / Math.max(1, cs.length);
  const [lo, hi] = A.elixir;
  const dist = avg < lo ? lo - avg : avg > hi ? avg - hi : 0;
  b.elixir = keys.length < 8 ? 15 - 6 * dist : Math.max(0, 15 - 12 * dist);
  // levels
  const lv = keys.map((k) => ctx.owned.get(k)?.level || 0);
  const known = lv.filter(Boolean);
  const avgLv = known.length ? known.reduce((s, x) => s + x, 0) / known.length : 0;
  b.level = ctx.topLevel ? 20 * Math.max(0, Math.min(1, 1 - (ctx.topLevel - avgLv) / 4)) : 14;
  // synergy
  let syn = 0;
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) syn += ctx.pairW.get(ctx.pk(keys[i], keys[j])) || 0;
  b.synergy = 12 * Math.min(1, syn / 10);
  b.meta = 5 * (keys.reduce((s, k) => s + (ctx.metaFreq.get(k) || 0), 0) / Math.max(1, keys.length)) / ctx.maxFreq;
  // special slots
  const champs = cs.filter((c) => c.champion).length;
  let valid = champs <= Math.min(ctx.rules.maxChampions, Math.max(0, ctx.specialSlots - 1));
  let slots = { slots: [], filled: 0, valid: true };
  if (valid && keys.length === 8) { slots = assignSlots(keys, ctx); valid = slots.valid; }
  b.forms = keys.length === 8 ? Math.min(8, (slots.slots || []).length * (8 / 3)) : 0;
  const total = Object.values(b).reduce((s, x) => s + x, 0) * (100 / MAX_POINTS);
  return { score: valid ? Math.max(0, Math.min(100, total)) : -1, valid, breakdown: b, avg, slots, counts: { win: wins.length, sS, sB, air, tk, splash: splashTroops, bld, spellCount } };
}

function pool(ctx, locked = []) {
  return [...ctx.owned.keys()].filter((k) => !UTILITY.has(k) || locked.includes(k)).filter((k) => ctx.cards.get(k).type !== 'tower');
}

/** Greedy build + hill-climb from a seed. */
function buildFrom(seed, arch, ctx, P) {
  const deck = [...new Set(seed)];
  const fixed = new Set(seed);
  while (deck.length < 8) {
    let best = null; let bs = -Infinity;
    for (const k of P) {
      if (deck.includes(k)) continue;
      const s = scoreDeck([...deck, k], ctx, arch).score;
      if (s > bs) { bs = s; best = k; }
    }
    if (!best) break;
    deck.push(best);
  }
  if (deck.length < 8) return null;
  let cur = scoreDeck(deck, ctx, arch).score;
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let i = 0; i < 8; i++) {
      if (fixed.has(deck[i])) continue;
      let bestK = null; let bs = cur;
      for (const k of P) {
        if (deck.includes(k)) continue;
        const d2 = deck.slice(); d2[i] = k;
        const s = scoreDeck(d2, ctx, arch).score;
        if (s > bs + 0.01) { bs = s; bestK = k; }
      }
      if (bestK) { deck[i] = bestK; cur = bs; improved = true; }
    }
    if (!improved) break;
  }
  return deck;
}

/** Deck-level explanation in Persian. */
export function explain(keys, ctx, arch, sc) {
  const s = sc || scoreDeck(keys, ctx, arch);
  const cs = keys.map((k) => ctx.cards.get(k));
  const c = s.counts;
  const pros = []; const cons = [];
  const win = cs.filter((x) => x.R.has('win')).map((x) => x.fa || x.name);
  if (win.length) pros.push(`وین‌کاندیشن: ${win.join(' + ')}`);
  else cons.push('وین‌کاندیشن مشخص ندارد؛ تخریب برج سخت می‌شود');
  if (c.air >= 3) pros.push('دفاع هوایی قوی (بالن، سگ گدازه و مینیون‌ها مشکلی نیستند)');
  else if (c.air <= 1) cons.push('ضدهوایی کم — در برابر بالن/سگ گدازه/بچه‌اژدها آسیب‌پذیر');
  if (c.tk >= 2) pros.push('تانک‌کش کافی برای گولم، غول و مگا نایت');
  else if (c.tk === 0) cons.push('تانک‌کش ندارد — جلوی تانک‌های سنگین سخت است');
  if (c.sS && c.sB) pros.push('هم اسپل سبک هم اسپل سنگین دارد');
  else if (!c.sS) cons.push('اسپل سبک ندارد — ارتش اسکلت و گابلین‌ها اذیتت می‌کنند');
  else cons.push('اسپل سنگین ندارد — تموم‌کردن برج و جواب جادوگر سخت‌تر است');
  if (c.splash) pros.push('ضربه پخش برای گروه‌ها');
  else cons.push('ضربه پخش ندارد — ضعیف در برابر گروه‌ها');
  if (c.bld) pros.push('ساختمان دفاعی برای کشیدن هاگ/غول');
  const cyc = cycleCost(keys, ctx);
  if (s.avg <= 3.0) pros.push(`چرخش خیلی سریع (چهار کارت ارزان = ${faNum(cyc)} اکسیر)`);
  if (s.avg >= 4.2) cons.push('سنگین؛ اوایل بازی باید صبور باشی و اکسیر جمع کنی');
  const lv = keys.map((k) => ctx.owned.get(k)?.level || 0).filter(Boolean);
  if (lv.length && ctx.topLevel && Math.min(...lv) <= ctx.topLevel - 3) {
    const weak = keys.filter((k) => (ctx.owned.get(k)?.level || 99) <= ctx.topLevel - 3).map((k) => ctx.cards.get(k).fa || k);
    cons.push(`سطح پایین: ${weak.join('، ')}`);
  }
  if (s.slots?.slots?.length) pros.push(`از ${faNum(s.slots.slots.length)} اسلات ویژه استفاده می‌کند`);
  return { pros, cons };
}

export function cycleCost(keys, ctx) {
  return keys.map((k) => ctx.cards.get(k).cost).sort((a, b) => a - b).slice(0, 4).reduce((s, x) => s + x, 0);
}

/** Closest meta deck by shared base cards. */
export function similarMeta(keys, ctx) {
  let best = null;
  const set = new Set(keys);
  for (const d of ctx.allMeta) {
    const n = new Set(d.cards.map((c) => c.key).filter((k) => set.has(k))).size;
    if (!best || n > best.overlap || (n === best.overlap && d.ladder && !best.ladder)) best = { name: d.name, section: d.section, overlap: n, ladder: d.ladder };
  }
  return best && best.overlap >= 4 ? best : null;
}

/** Official copy-deck deep link. Evo/Hero forms are NOT carried by the link — they are set in game. */
export function deckLink(keys, ctx, towerId = 159000000) {
  const ids = keys.map((k) => ctx.cards.get(k).id);
  if (ids.some((x) => !x)) return null;
  return `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${ids.join(';')}&l=Royals&tt=${towerId}`;
}

/** Order: special-slot cards first (slot 1..3), then by elixir. */
export function orderDeck(keys, sc, ctx) {
  const slotKeys = (sc.slots?.slots || []).map((s) => s.key);
  const rest = keys.filter((k) => !slotKeys.includes(k)).sort((a, b) => ctx.cards.get(a).cost - ctx.cards.get(b).cost);
  return [...slotKeys, ...rest];
}

function finalize(keys, arch, ctx, towerId) {
  const sc = scoreDeck(keys, ctx, arch);
  const ordered = orderDeck(keys, sc, ctx);
  return {
    arch, archFa: ARCHETYPES[arch].fa, keys: ordered, score: Math.round(sc.score), breakdown: sc.breakdown,
    avg: fmt(sc.avg), cycle4: fmt(cycleCost(keys, ctx)), slots: sc.slots.slots || [], valid: sc.valid,
    ...explain(keys, ctx, arch, sc), similar: similarMeta(keys, ctx), link: deckLink(ordered, ctx, towerId),
    newCards: keys.filter((k) => isRecent(ctx.cards.get(k).added, ctx.updated, 90)),
  };
}

/**
 * Generate up to `count` diverse decks from the owned cards.
 * opts: { archetypes?: string[], locked?: string[], count?: number, towerId?: number }
 */
export function generateDecks(ctx, opts = {}) {
  const locked = (opts.locked || []).filter((k) => ctx.cards.has(k));
  const P = pool(ctx, locked);
  if (P.length + locked.filter((k) => !P.includes(k)).length < 8) return { decks: [], error: 'not-enough-cards', owned: P.length };
  const archs = opts.archetypes?.length ? opts.archetypes : Object.keys(ARCHETYPES);
  const P2 = [...new Set([...P, ...locked])];
  const cands = [];
  for (const arch of archs) {
    const lockedWins = locked.filter((k) => ctx.cards.get(k).R.has('win'));
    let wins = lockedWins.length ? [null] : P2.filter((k) => ctx.cards.get(k).wins.includes(arch));
    wins = wins.sort((a, b) => rank(b) - rank(a)).slice(0, 3);
    if (!wins.length) wins = [null];
    for (const w of wins) {
      const deck = buildFrom(w ? [...locked, w] : locked, arch, ctx, P2);
      if (!deck) continue;
      const sc = scoreDeck(deck, ctx, arch);
      if (sc.valid) cands.push({ deck, arch, score: sc.score });
    }
  }
  function rank(k) { return (ctx.owned.get(k)?.level || 10) + 3 * (ctx.metaFreq.get(k) || 0) / ctx.maxFreq; }
  cands.sort((a, b) => b.score - a.score);
  const chosen = [];
  const want = opts.count || 5;
  const maxOverlap = locked.length >= 5 ? 7 : 5;
  const ok = (c) => !chosen.includes(c) && !chosen.some((x) => x.deck.filter((k) => c.deck.includes(k)).length > maxOverlap);
  // round 1: best deck of each archetype (variety), round 2: fill by score
  for (const c of cands) { if (chosen.length >= want) break; if (!chosen.some((x) => x.arch === c.arch) && ok(c)) chosen.push(c); }
  for (const c of cands) { if (chosen.length >= want) break; if (ok(c)) chosen.push(c); }
  chosen.sort((a, b) => b.score - a.score);
  return { decks: chosen.map((c) => finalize(c.deck, c.arch, ctx, opts.towerId)) };
}

/** Best archetype for a given 8-card deck. */
export function bestArch(keys, ctx) {
  let best = null;
  for (const a of Object.keys(ARCHETYPES)) { const s = scoreDeck(keys, ctx, a).score; if (!best || s > best.s) best = { a, s }; }
  return best.a;
}

export function analyzeDeck(keys, ctx, towerId) { return finalize(keys, bestArch(keys, ctx), ctx, towerId); }

/** Single-card swaps that raise the score, best first. */
export function swapSuggestions(keys, ctx, arch = bestArch(keys, ctx), limit = 5) {
  const base = scoreDeck(keys, ctx, arch).score;
  const P = pool(ctx);
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    let best = null;
    for (const k of P) {
      if (keys.includes(k)) continue;
      const d2 = keys.slice(); d2[i] = k;
      const s = scoreDeck(d2, ctx, arch).score;
      if (s > base + 1.5 && (!best || s > best.score)) best = { out: keys[i], in: k, score: s };
    }
    if (best) out.push({ ...best, delta: Math.round(best.score - base) });
  }
  return out.sort((a, b) => b.delta - a.delta).slice(0, limit);
}

/** Which owned cards to upgrade first: used a lot in the recommended/meta decks but under-levelled. */
export function upgradePriority(decks, ctx, limit = 8) {
  const use = new Map();
  decks.forEach((d, i) => d.keys.forEach((k) => use.set(k, (use.get(k) || 0) + (decks.length - i) / decks.length)));
  const rows = [];
  for (const [k, u] of use) {
    const lv = ctx.owned.get(k)?.level || 0;
    if (!lv || lv >= (ctx.rules.maxLevel || 16)) continue;
    const gap = Math.max(0, ctx.topLevel - lv);
    const meta = (ctx.metaFreq.get(k) || 0) / ctx.maxFreq;
    const p = u * (1 + gap * 0.6) + meta * 0.8 + (ctx.cards.get(k).R.has('win') ? 0.6 : 0);
    rows.push({ key: k, level: lv, gap: fmt(gap), usage: fmt(u), priority: fmt(p) });
  }
  return rows.sort((a, b) => b.priority - a.priority).slice(0, limit);
}

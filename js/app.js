// UI layer. All logic lives in engine.js / store.js / catalog.js (unit-tested).
import * as E from './engine.js';
import { isRecent, RARITY_FA } from './catalog.js';
import { ARCHETYPES, ROLE_FA, TYPE_FA } from './knowledge.js';
import { loadState, saveState, diffNewCards, exportCollection, importCollection, mapPlayer, fetchPlayer, normalizeTag, BUILTIN_ENDPOINT } from './store.js';
import { g2d, formatShort, fa } from './jalali.js';

const VERSION = '1.0.1';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const jdate = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return formatShort(g2d(y, m, d)); };
const num = (v) => E.faNum(v);
// Persian search normalisation (Arabic ي/ك, ZWNJ, spaces)
const norm = (s) => String(s || '').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\s\-.]+/g, '');
const matches = (c, q) => !q || norm(c.name).includes(norm(q)) || norm(c.fa).includes(norm(q));

const state = loadState(localStorage);
let catalog = null; let meta = { decks: [] }; let byKey = new Map();
const ui = { tab: 'build', archs: [], decks: null, upg: [], q: '', own: 'all', kind: 'all', editMode: false, locked: [], complete: null, qc: '', busy: false, freshKeys: [], player: null };

const save = () => saveState(localStorage, state);
const toast = (msg, ms = 2600) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); };
const owned = () => Object.keys(state.collection).filter((k) => byKey.has(k));
const isNew = (c) => isRecent(c.added, todayISO(), 60) || ui.freshKeys.includes(c.key);
const isNewForm = (c) => isRecent(c.evoAdded, todayISO(), 60) || isRecent(c.heroAdded, todayISO(), 60);
const ctx = () => E.makeContext(catalog, state.collection, meta, { specialSlots: +state.settings.specialSlots, rules: { maxChampions: +state.settings.maxChampions } });

// ---------- card tile ----------
function tile(c, { form = null, slot = null, off = false, tick = false, action = '', level = true } = {}) {
  const o = state.collection[c.key];
  const f = form === 'champion' ? 'base' : form || 'base';
  const src = (c.img && (c.img[f] || c.img.base)) || '';
  const remote = (c.remote && (c.remote[f] || c.remote.base)) || '';
  const lv = level && o && o.level ? `<span class="lvl">سطح ${num(o.level)}</span>` : '';
  const forms = (c.evo || c.hero) && !form ? `<span class="forms">${c.evo ? `<i class="${o?.evo ? 'on' : ''}">E</i>` : ''}${c.hero ? `<i class="hero ${o?.hero ? 'on' : ''}">H</i>` : ''}</span>` : '';
  const badge = isNew(c) ? '<span class="badge">کارت جدید</span>' : isNewForm(c) ? '<span class="badge" style="background:var(--pink)">فرم جدید</span>' : '';
  const slotB = slot ? `<span class="slot ${slot.form}">${slot.form === 'evo' ? 'تکامل' : slot.form === 'hero' ? 'هیرو' : 'قهرمان'}</span>` : '';
  return `<button class="tile r-${c.rarity} ${off ? 'off' : ''} ${form ? 'form-' + form : ''}" data-key="${c.key}" ${action ? `data-act="${action}"` : ''} title="${esc(c.name)}">
    ${slotB}<span class="elx">${c.elixir == null ? '?' : num(c.elixir)}</span>${tick ? '<span class="tick">✓</span>' : ''}${badge}
    <span class="art"><span class="fallback">${esc(c.fa || c.name)}<br>${c.elixir == null ? '' : num(c.elixir) + '💧'}</span>${src || remote ? `<img loading="lazy" alt="${esc(c.fa || c.name)}" src="${src || remote}" data-remote="${src ? remote : ''}">` : ''}${forms}${lv}</span>
    <span class="nm">${esc(c.fa || c.name)}<span class="en">${esc(c.name)}</span></span></button>`;
}
// image fallback: local -> official CDN -> name/elixir tile
document.addEventListener('error', (e) => {
  const img = e.target; if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.remote) { const r = img.dataset.remote; img.dataset.remote = ''; img.src = r; } else img.remove();
}, true);

// ---------- header / status ----------
function renderHeader() {
  $('#dataBadge').textContent = `داده کارت‌ها: ${jdate(catalog.updated)} · ${num(catalog.cards.length)} کارت · نسخه ${fa(VERSION)}`;
}

// ---------- build view ----------
function renderBuild() {
  const el = $('#view-build'); const n = owned().length;
  const newCards = catalog.cards.filter(isNew);
  let h = `<h2 class="page-title">ساخت خودکار دک</h2><p class="lead">از روی کارت‌هایی که داری، بهترین دک‌ها را با توضیح می‌سازد.</p>
    <div class="status"><div class="stat"><b id="ownedCount">${num(n)}</b><span>کارت من</span></div><div class="stat"><b>${num(catalog.cards.length)}</b><span>کل کارت‌ها</span></div><div class="stat"><b>${num(meta.decks.length)}</b><span>دک متا</span></div></div>`;
  if (newCards.length) h += `<div class="notice new" id="newNotice">✨ <b>کارت جدید:</b> ${newCards.map((c) => esc(c.fa || c.name)).join('، ')} — اگر داری‌اش در «کارت‌های من» روشنش کن.</div>`;
  if (n < 8) {
    h += `<div class="card empty"><b>🃏</b>برای ساخت دک حداقل ۸ کارت لازم است.<br>کارت‌هایت را انتخاب کن یا با تگ بازیکن وارد کن.
      <div class="actions"><button class="btn primary" data-go="cards">انتخاب کارت‌ها</button><button class="btn blue" data-go="settings">وارد کردن با تگ</button></div></div>`;
    el.innerHTML = h; return;
  }
  h += `<div class="section-title">سبک بازی</div><div class="chips" id="archChips"><button class="chip ${ui.archs.length ? '' : 'on'}" data-arch="">همه سبک‌ها</button>${Object.entries(ARCHETYPES).map(([k, a]) => `<button class="chip ${ui.archs.includes(k) ? 'on' : ''}" data-arch="${k}">${a.fa}</button>`).join('')}</div>
    <button class="btn primary block" id="buildBtn" ${ui.busy ? 'disabled' : ''}>${ui.decks ? '🔄 ساخت دوباره' : '⚡ بساز!'}</button>`;
  if (ui.busy) h += '<div class="spinner"></div>';
  if (ui.decks) {
    if (!ui.decks.decks.length) h += `<div class="card empty"><b>🤔</b>با این ترکیب دک معتبری پیدا نشد. سبک دیگری انتخاب کن یا کارت بیشتری اضافه کن.</div>`;
    h += `<div id="decks">${ui.decks.decks.map((d, i) => deckCard(d, i)).join('')}</div>`;
    if (ui.upg.length) h += upgradeCard(ui.upg);
  }
  el.innerHTML = h;
}

function deckCard(d, i, { showSwaps = true } = {}) {
  const slotOf = new Map(d.slots.map((s) => [s.key, s]));
  const b = d.breakdown;
  const parts = [['وین‌کاندیشن', b.win, 14], ['اسپل‌ها', b.spells, 10], ['ضدهوایی', b.air, 9], ['تانک‌کش', b.tk, 7], ['ضربه پخش', b.splash, 5], ['اکسیر هدف سبک', b.elixir, 15], ['سطح کارت‌ها', b.level, 20], ['هماهنگی کارت‌ها', b.synergy, 12], ['محبوبیت در متا', b.meta, 5], ['اسلات‌های ویژه', b.forms, 8]];
  const sim = d.similar ? `<div class="similar">🔗 شبیه دک متا: <b class="ltr" style="display:inline">${esc(d.similar.name)}</b> <span class="muted">(${num(d.similar.overlap)} کارت مشترک${d.similar.ladder === false ? ' · حالت ویژه' : ''})</span></div>` : '';
  return `<article class="card deck" data-deck="${i}">
    <div class="head"><div class="ring" style="--p:${d.score}"><b>${num(d.score)}</b></div>
      <div class="grow"><h3>${i === 0 ? '🏆 ' : ''}${esc(d.archFa)}</h3><div class="meta">امتیاز از ۱۰۰ · ${esc(ARCHETYPES[d.arch].en)}</div></div></div>
    <div class="grid">${d.keys.map((k) => { const s = slotOf.get(k); return tile(byKey.get(k), { form: s?.form, slot: s, action: 'info' }); }).join('')}</div>
    <div class="kv"><span class="drop">💧 میانگین اکسیر ${num(d.avg)}</span><span>🔁 چرخه ۴ کارت ${num(d.cycle4)}</span>${d.slots.length ? `<span>✨ ${num(d.slots.length)} اسلات ویژه</span>` : ''}</div>
    ${sim}
    <ul class="pc pro">${d.pros.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${d.cons.length ? `<ul class="pc con">${d.cons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="actions">${d.link ? `<button class="btn blue small" data-copy="${i}">📋 کپی لینک دک</button><a class="btn small" href="${esc(d.link)}" target="_blank" rel="noopener">▶️ باز کردن در بازی</a>` : '<span class="muted small">لینک کپی برای کارت‌های تازه هنوز ساخته نمی‌شود (شناسه رسمی ندارند).</span>'}
      <button class="btn small" data-tocomplete="${i}">🧩 ویرایش</button></div>
    ${d.slots.length ? '<p class="muted small" style="margin:6px 0 0">نکته: لینک کپی فقط کارت‌ها را منتقل می‌کند؛ تکامل/هیرو را داخل بازی روی همان اسلات‌ها بگذار.</p>' : ''}
    <details class="more"><summary>چرا این امتیاز؟</summary><div class="bars">${parts.map(([n, v, m]) => `<span>${n}</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, (v / m) * 100))}%"></i></span><span>${num(Math.round(v * 10) / 10)}/${num(m)}</span>`).join('')}</div></details>
    ${showSwaps ? `<details class="more" data-swaps="${i}"><summary>پیشنهاد جایگزینی</summary><div class="swaps muted">در حال محاسبه…</div></details>` : ''}
  </article>`;
}

function swapsHtml(list) {
  if (!list.length) return '<p class="muted">جایگزینی که امتیاز را محسوس بالا ببرد پیدا نشد 👌</p>';
  return list.map((s) => { const a = byKey.get(s.out); const b = byKey.get(s.in); return `<div class="swap">➖ ${esc(a.fa || a.name)} <span class="en">${esc(a.name)}</span> ← ➕ <b>${esc(b.fa || b.name)}</b> <span class="en">${esc(b.name)}</span> <span class="grow"></span><b style="color:var(--ok)">+${num(s.delta)}</b></div>`; }).join('');
}

function upgradeCard(rows) {
  return `<div class="section-title">⬆️ اولویت ارتقا</div><div class="card" id="upgrade"><p class="muted small" style="margin-top:0">کارت‌هایی که در دک‌های پیشنهادی زیاد هستند ولی سطحشان از بقیه پایین‌تر است:</p>
    ${rows.map((r, i) => { const c = byKey.get(r.key); return `<div class="upg"><b>${num(i + 1)}</b>${tile(c, { action: 'info', level: false })}<div class="grow"><b>${esc(c.fa || c.name)}</b> <span class="en">${esc(c.name)}</span><div class="muted small">سطح فعلی ${num(r.level)}${r.gap > 0 ? ` · ${num(Math.round(r.gap))} سطح پایین‌تر از کارت‌های اصلی‌ات` : ''}</div></div></div>`; }).join('')}</div>`;
}

function runBuild() {
  ui.busy = true; renderBuild();
  setTimeout(() => {
    const c = ctx();
    ui.decks = E.generateDecks(c, { archetypes: ui.archs, count: 5, towerId: +state.settings.tower });
    ui.upg = ui.decks.decks.length ? E.upgradePriority(ui.decks.decks, c) : [];
    ui.busy = false; renderBuild();
    document.getElementById('decks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 30);
}

// ---------- cards view ----------
const OWN_F = [['all', 'همه'], ['own', 'دارم'], ['not', 'ندارم'], ['new', 'جدید'], ['evo', 'تکامل‌دار'], ['hero', 'هیرودار']];
const KIND_F = [['all', 'همه'], ['troop', 'نیرو'], ['spell', 'اسپل'], ['building', 'ساختمان'], ['common', 'معمولی'], ['rare', 'کمیاب'], ['epic', 'حماسی'], ['legendary', 'افسانه‌ای'], ['champion', 'قهرمان']];
function filtered() {
  return catalog.cards.filter((c) => {
    if (!matches(c, ui.q)) return false;
    const o = state.collection[c.key];
    if (ui.own === 'own' && !o) return false; if (ui.own === 'not' && o) return false;
    if (ui.own === 'new' && !isNew(c) && !isNewForm(c)) return false;
    if (ui.own === 'evo' && !c.evo) return false; if (ui.own === 'hero' && !c.hero) return false;
    if (ui.kind !== 'all' && c.type !== ui.kind && c.rarity !== ui.kind) return false;
    return true;
  }).sort((a, b) => (a.elixir ?? 9) - (b.elixir ?? 9) || a.name.localeCompare(b.name));
}
function renderCards() {
  const el = $('#view-cards');
  if (!$('#cardsGrid', el)) {
    el.innerHTML = `<h2 class="page-title">کارت‌های من</h2><p class="lead">روی هر کارتی که داری بزن تا روشن شود. برای سطح و تکامل/هیرو، حالت «✎ سطح» را بزن یا کارت را نگه دار.</p>
      <div class="sticky-tools collection"><input class="search" id="search" type="search" placeholder="جستجو: فارسی یا English" value="${esc(ui.q)}" autocomplete="off">
      <div class="chips" id="ownChips">${OWN_F.map(([k, t]) => `<button class="chip" data-own="${k}">${t}</button>`).join('')}</div>
      <div class="chips" id="kindChips">${KIND_F.map(([k, t]) => `<button class="chip" data-kind="${k}">${t}</button>`).join('')}</div></div>
      <div class="toolbar"><button class="btn small" id="selAll">✅ انتخاب همه</button><button class="btn small" id="selNone">⬜ پاک کردن</button>
        <button class="btn small" id="editMode">✎ سطح</button>
        <label class="btn small">سطح پیش‌فرض <select id="defLevel" style="background:none;border:0">${Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}" ${+state.settings.defaultLevel === i + 1 ? 'selected' : ''}>${num(i + 1)}</option>`).join('')}</select></label></div>
      <p class="muted small" id="cardsInfo"></p><div class="grid" id="cardsGrid"></div>`;
  }
  el.querySelectorAll('[data-own]').forEach((b) => b.classList.toggle('on', b.dataset.own === ui.own));
  el.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === ui.kind));
  $('#editMode').classList.toggle('primary', ui.editMode);
  const list = filtered();
  $('#cardsInfo').textContent = `${num(owned().length)} از ${num(catalog.cards.length)} کارت انتخاب شده · ${num(list.length)} کارت در این فیلتر`;
  $('#cardsGrid').innerHTML = list.map((c) => tile(c, { off: !state.collection[c.key], tick: !!state.collection[c.key], action: 'toggle' })).join('') || '<p class="empty grow">کارتی پیدا نشد</p>';
}
function toggleOwned(key) {
  if (state.collection[key]) delete state.collection[key];
  else state.collection[key] = { level: +state.settings.defaultLevel || 11, evo: false, hero: false };
  ui.decks = null; save();
}

// ---------- card sheet ----------
function openSheet(key) {
  const c = byKey.get(key); const o = state.collection[key];
  const roles = [...E.effectiveRoles(c)].map((r) => ROLE_FA[r]).filter(Boolean);
  const sh = $('#sheet');
  sh.innerHTML = `<div class="grab"></div><div class="row gap"><div style="width:84px;flex:none">${tile(c, { level: false })}</div>
    <div class="grow"><h3 style="margin:0">${esc(c.fa || c.name)}</h3><div class="en">${esc(c.name)}</div>
    <div class="muted small">${RARITY_FA[c.rarity] || c.rarity} · ${TYPE_FA[c.type] || c.type} · ${c.elixir == null ? 'اکسیر نامشخص' : num(c.elixir) + ' اکسیر'}${c.added ? ` · اضافه‌شده ${jdate(c.added)}` : ''}</div>
    <div class="chips" style="flex-wrap:wrap">${roles.map((r) => `<span class="chip">${r}</span>`).join('')}</div></div></div>
    <label class="switch">این کارت را دارم <input type="checkbox" id="shOwn" ${o ? 'checked' : ''}></label>
    <div id="shMore" ${o ? '' : 'hidden'}>
      <div class="lvl-row"><button class="btn small" id="lvM">−</button><input type="range" min="1" max="16" id="shLvl" value="${o?.level || state.settings.defaultLevel}"><button class="btn small" id="lvP">+</button><b id="shLvlV">${num(o?.level || state.settings.defaultLevel)}</b></div>
      ${c.evo ? `<label class="switch">تکامل (Evolution) باز شده ${c.evoAdded ? `<span class="muted small">از ${jdate(c.evoAdded)}</span>` : ''}<input type="checkbox" id="shEvo" ${o?.evo ? 'checked' : ''}></label>` : ''}
      ${c.hero ? `<label class="switch">هیرو (Hero) باز شده ${c.heroAdded ? `<span class="muted small">از ${jdate(c.heroAdded)}</span>` : ''}<input type="checkbox" id="shHero" ${o?.hero ? 'checked' : ''}></label>` : ''}
    </div><button class="btn primary block" id="shClose">تمام</button>`;
  sh.hidden = false; $('#sheetBg').hidden = false;
  const sync = () => {
    const own = $('#shOwn').checked; $('#shMore').hidden = !own;
    if (!own) delete state.collection[key];
    else state.collection[key] = { level: +$('#shLvl').value, evo: !!$('#shEvo')?.checked, hero: !!$('#shHero')?.checked };
    $('#shLvlV').textContent = num($('#shLvl').value); ui.decks = null; save();
  };
  sh.oninput = sync; sh.onchange = sync;
  $('#lvM').onclick = () => { $('#shLvl').value = +$('#shLvl').value - 1; sync(); };
  $('#lvP').onclick = () => { $('#shLvl').value = +$('#shLvl').value + 1; sync(); };
  $('#shClose').onclick = closeSheet;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBg').hidden = true; refresh(); }

// ---------- complete view ----------
function renderComplete() {
  const el = $('#view-complete');
  const L = ui.locked.filter((k) => byKey.has(k));
  const pool = owned().map((k) => byKey.get(k)).filter((c) => matches(c, ui.qc)).sort((a, b) => (a.elixir ?? 9) - (b.elixir ?? 9));
  let h = `<h2 class="page-title">تکمیل دک / تحلیل دک</h2><p class="lead">کارت‌هایی که حتماً می‌خواهی را قفل کن (۱ تا ۷ کارت) تا بقیه را از کلکسیونت کامل کند؛ یا ۸ کارت بگذار تا دکت تحلیل شود و جایگزین پیشنهاد بدهد.</p>
    <div class="section-title">کارت‌های قفل‌شده <span class="muted small">${num(L.length)}/۸</span></div>
    <div class="locked-strip" id="lockedStrip">${L.map((k) => tile(byKey.get(k), { action: 'unlock' })).join('') || '<span class="muted small" style="grid-column:1/-1;text-align:center">از پایین کارت انتخاب کن 👇</span>'}</div>
    <div class="actions"><button class="btn primary" id="completeBtn" ${L.length && L.length < 8 && owned().length >= 8 ? '' : 'hidden'}>🧩 تکمیل دک</button>
      <button class="btn primary" id="analyzeBtn" ${L.length === 8 ? '' : 'hidden'}>🔍 تحلیل این دک</button>
      ${ui.player?.currentDeck?.length === 8 ? '<button class="btn blue small" id="curDeck">دک فعلی‌ام در بازی</button>' : ''}
      <button class="btn small" id="clearLocked" ${L.length ? '' : 'hidden'}>پاک کردن</button></div>
    <div id="completeOut">${ui.complete ? ui.complete : ''}</div>
    <div class="section-title">کارت‌های من</div><input class="search" id="searchC" type="search" placeholder="جستجو" value="${esc(ui.qc)}" autocomplete="off">
    <div class="grid" style="margin-top:12px" id="completeGrid">${pool.map((c) => tile(c, { action: 'lock', off: L.includes(c.key), tick: L.includes(c.key) })).join('') || '<p class="empty" style="grid-column:1/-1">اول در «کارت‌های من» کارت انتخاب کن.</p>'}</div>`;
  el.innerHTML = h;
}
function runComplete(analyze) {
  const c = ctx(); const L = ui.locked.slice();
  if (analyze) {
    const d = E.analyzeDeck(L, c, +state.settings.tower);
    ui.lastComplete = [d];
    ui.complete = d.valid ? deckCard(d, 0, { showSwaps: false }) + `<div class="card"><b>پیشنهاد جایگزینی</b>${swapsHtml(E.swapSuggestions(d.keys, c, d.arch))}</div>` : '<div class="notice warn">این دک با قوانین اسلات‌ها معتبر نیست (مثلاً دو قهرمان یا قهرمان بدون اسلات آزاد). تنظیمات اسلات‌ها را بررسی کن.</div>';
  } else {
    const r = E.generateDecks(c, { locked: L, count: 3, towerId: +state.settings.tower });
    ui.lastComplete = r.decks;
    ui.complete = r.decks.length ? r.decks.map((d, i) => deckCard(d, i, { showSwaps: false })).join('') : '<div class="notice warn">با این کارت‌های قفل‌شده دک معتبری ساخته نشد (مثلاً بیش از یک قهرمان).</div>';
  }
  renderComplete(); $('#completeOut')?.scrollIntoView({ behavior: 'smooth' });
}

// ---------- settings ----------
function renderSettings() {
  const s = state.settings; const el = $('#view-settings');
  el.innerHTML = `<h2 class="page-title">تنظیمات</h2>
  <div class="card"><h3 style="margin-top:0">📥 وارد کردن کارت‌ها با تگ بازیکن</h3>
    <p class="muted small">کلید API همین اپ روی سرور است؛ برای وارد کردن با تگ چیزی لازم نیست بنویسی. اگر کلید شخصی خودت را داری، در قسمت IP عدد <code>45.79.218.79</code> را بگذار و پایین وارد کن. بدون تگ هم می‌توانی کارت‌ها را دستی انتخاب کنی.</p>
    <label class="field"><span>تگ بازیکن</span><input id="tag" class="ltr" placeholder="#2PP" value="${esc(s.tag)}" autocomplete="off" autocapitalize="characters"></label>
    <label class="field"><span>کلید API (اختیاری)</span><input id="apiKey" class="ltr" type="password" value="${esc(s.apiKey)}" autocomplete="off"></label>
    <label class="switch">کلید روی این دستگاه ذخیره شود <input type="checkbox" id="rememberKey" ${s.rememberKey ? 'checked' : ''}></label>
    <details class="more"><summary>پیشرفته: سرور شخصی</summary><label class="field" style="margin-top:8px"><span>آدرس سرور (مثل Cloudflare Worker خودت)</span><input id="endpoint" class="ltr" placeholder="https://my-worker.example.workers.dev/v1" value="${esc(s.endpoint)}"><span class="hint">اگر پر باشد، کلید لازم نیست؛ کلید روی سرور خودت می‌ماند (نمونه در workers/player-proxy.js).</span></label></details>
    <button class="btn blue block" id="fetchTag">دریافت کارت‌ها از بازی</button><p class="small" id="tagMsg"></p></div>

  <div class="card"><h3 style="margin-top:0">🎮 قوانین بازی</h3>
    <label class="field"><span>نیروی برج</span><select id="tower">${catalog.towerTroops.map((t) => `<option value="${t.id}" ${+s.tower === t.id ? 'selected' : ''}>${esc(t.fa)} — ${esc(t.name)}</option>`).join('')}</select></label>
    <label class="field"><span>اسلات‌های ویژه باز شده</span><select id="specialSlots">
      <option value="0" ${+s.specialSlots === 0 ? 'selected' : ''}>هیچ (زیر آرنا ۳)</option><option value="1" ${+s.specialSlots === 1 ? 'selected' : ''}>۱ — تکامل (آرنا ۳)</option>
      <option value="2" ${+s.specialSlots === 2 ? 'selected' : ''}>۲ — تکامل + هیرو/قهرمان (آرنا ۵)</option><option value="3" ${+s.specialSlots === 3 ? 'selected' : ''}>۳ — به‌علاوه اسلات آزاد (آرنا ۱۰)</option></select></label>
    <label class="field"><span>حداکثر قهرمان در دک</span><select id="maxChampions"><option value="1" ${+s.maxChampions === 1 ? 'selected' : ''}>۱ (لدر و نبرد عادی)</option><option value="2" ${+s.maxChampions === 2 ? 'selected' : ''}>۲ (فقط بعضی ایونت‌ها)</option></select></label></div>

  <div class="card"><h3 style="margin-top:0">💾 پشتیبان کلکسیون</h3><p class="muted small">کارت‌ها فقط روی همین دستگاه ذخیره می‌شوند. برای انتقال به گوشی دیگر خروجی بگیر.</p>
    <div class="actions"><button class="btn small" id="exportBtn">⬇️ خروجی فایل</button><button class="btn small" id="copyExport">📋 کپی متن</button><label class="btn small">⬆️ ورود از فایل<input type="file" id="importFile" accept=".json,application/json" hidden></label></div>
    <label class="field" style="margin-top:10px"><span>یا متن JSON را اینجا بچسبان</span><textarea id="importText" rows="3" class="search ltr" placeholder='{"cards":[...]}'></textarea></label>
    <div class="actions"><button class="btn small" id="importBtn">ورود متن</button><button class="btn small" id="resetBtn" style="color:var(--bad)">حذف همه کارت‌ها</button></div></div>

  <div class="card small"><h3 style="margin-top:0">🔄 به‌روز بودن اطلاعات</h3>
    <p>داده کارت‌ها: <b>${jdate(catalog.updated)}</b> · دک‌های متا: <b>${jdate(meta.updated)}</b>. هر روز یک کار خودکار در GitHub فهرست رسمی کارت‌ها و Deck Shop را بررسی می‌کند و اگر کارت/تکامل/هیروی تازه‌ای بیاید، داده را به‌روز می‌کند. برنامه هر بار باز شود نسخه جدید را می‌گیرد و کارت‌های تازه را با «کارت جدید» نشان می‌دهد.</p>
    <button class="btn small" id="refreshData">بررسی به‌روزرسانی</button>
    <p class="muted">منابع: فهرست رسمی کارت‌ها (Clash Royale API، از طریق آینه عمومی)، نقش کارت‌ها و دک‌های متا از <span class="en">Deck Shop (deckshop.pro)</span>. این برنامه غیررسمی است و وابسته به Supercell نیست؛ طبق <a href="https://supercell.com/en/fan-content-policy/" target="_blank" rel="noopener">Fan Content Policy</a> سوپرسل ساخته شده. نسخه ${fa(VERSION)}.</p></div>`;
}

async function doFetchTag() {
  const s = state.settings; const msg = $('#tagMsg');
  s.tag = $('#tag').value; s.apiKey = $('#apiKey').value; s.rememberKey = $('#rememberKey').checked; s.endpoint = $('#endpoint').value.trim(); save();
  if (!normalizeTag(s.tag)) { msg.textContent = '❌ تگ معتبر نیست (فقط حروف 0289PYLQGRJCUV).'; return; }
  msg.textContent = '⏳ در حال دریافت…';
  const opts = s.endpoint ? { endpoint: s.endpoint } : (s.apiKey ? { apiKey: s.apiKey } : { endpoint: BUILTIN_ENDPOINT });
  try {
    const p = await fetchPlayer(s.tag, opts);
    const r = mapPlayer(p, catalog);
    state.collection = r.collection; ui.player = r; ui.decks = null;
    if (r.towers?.length && !r.towers.includes(+s.tower)) s.tower = r.towers[0];
    save();
    msg.textContent = `✅ ${r.name || ''}: ${fa(Object.keys(r.collection).length)} کارت وارد شد${r.unknown.length ? ` (${fa(r.unknown.length)} کارت ناشناخته: ${r.unknown.join(', ')})` : ''}.`;
    toast('کارت‌ها از بازی وارد شدند ✅');
  } catch (e) {
    const m = { 'forbidden': 'کلید رد شد؛ IP ‎45.79.218.79‎ را به کلید اضافه کن.', 'not-found': 'بازیکنی با این تگ پیدا نشد.', 'bad-tag': 'تگ معتبر نیست.' }[e.message];
    msg.textContent = '❌ ' + (m || 'اتصال برقرار نشد (شاید اینترنت یا فیلترینگ). می‌توانی کارت‌ها را دستی انتخاب کنی.');
  }
}

function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}
function doImport(text) {
  try {
    const col = importCollection(text, catalog);
    const n = Object.keys(col).length; if (!n) throw new Error('empty');
    state.collection = col; ui.decks = null; save(); toast(`${fa(n)} کارت وارد شد ✅`); refresh();
  } catch { toast('❌ فایل/متن قابل خواندن نیست'); }
}

// ---------- routing & events ----------
function refresh() {
  ({ build: renderBuild, cards: renderCards, complete: renderComplete, settings: renderSettings })[ui.tab]();
}
function go(tab) {
  ui.tab = tab;
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.view !== tab));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  refresh(); scrollTo(0, 0);
}

let pressT = null; let pressed = false;
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('[data-act="toggle"]'); if (!t) return;
  pressed = false; clearTimeout(pressT); pressT = setTimeout(() => { pressed = true; openSheet(t.dataset.key); }, 520);
});
['pointerup', 'pointercancel', 'pointermove'].forEach((ev) => document.addEventListener(ev, (e) => { if (ev !== 'pointermove' || Math.abs(e.movementY) > 4) clearTimeout(pressT); }));
document.addEventListener('contextmenu', (e) => { if (e.target.closest('.tile')) e.preventDefault(); });

document.addEventListener('click', async (e) => {
  const t = e.target;
  const tab = t.closest('[data-tab]'); if (tab) return go(tab.dataset.tab);
  const g = t.closest('[data-go]'); if (g) return go(g.dataset.go);
  if (t.closest('#sheetBg')) return closeSheet();
  const a = t.closest('[data-arch]');
  if (a) { const k = a.dataset.arch; ui.archs = !k ? [] : ui.archs.includes(k) ? ui.archs.filter((x) => x !== k) : [...ui.archs, k]; renderBuild(); return; }
  if (t.closest('#buildBtn')) return runBuild();
  const cp = t.closest('[data-copy]');
  if (cp) { const list = cp.closest('#view-complete') ? ui.lastComplete : ui.decks.decks; const d = list[+cp.dataset.copy]; if (await copy(d.link)) toast('لینک کپی شد؛ در مرورگر/تلگرام بازش کن تا دک در بازی کپی شود 📋'); return; }
  const tc = t.closest('[data-tocomplete]');
  if (tc) { const list = tc.closest('#view-complete') ? ui.lastComplete : ui.decks.decks; ui.locked = list[+tc.dataset.tocomplete].keys.slice(); ui.complete = null; return go('complete'); }
  const tl = t.closest('.tile[data-act]');
  if (tl) {
    const k = tl.dataset.key; const act = tl.dataset.act;
    if (act === 'toggle') { if (pressed) { pressed = false; return; } if (ui.editMode) return openSheet(k); toggleOwned(k); renderCards(); return; }
    if (act === 'info') return openSheet(k);
    if (act === 'lock') { if (ui.locked.includes(k)) ui.locked = ui.locked.filter((x) => x !== k); else if (ui.locked.length < 8) ui.locked.push(k); else toast('دک حداکثر ۸ کارت دارد'); ui.complete = null; return renderComplete(); }
    if (act === 'unlock') { ui.locked = ui.locked.filter((x) => x !== k); ui.complete = null; return renderComplete(); }
  }
  const o = t.closest('[data-own]'); if (o) { ui.own = o.dataset.own; return renderCards(); }
  const kd = t.closest('[data-kind]'); if (kd) { ui.kind = kd.dataset.kind; return renderCards(); }
  if (t.closest('#selAll')) { for (const c of filtered()) if (!state.collection[c.key]) state.collection[c.key] = { level: +state.settings.defaultLevel, evo: false, hero: false }; ui.decks = null; save(); return renderCards(); }
  if (t.closest('#selNone')) { for (const c of filtered()) delete state.collection[c.key]; ui.decks = null; save(); return renderCards(); }
  if (t.closest('#editMode')) { ui.editMode = !ui.editMode; toast(ui.editMode ? 'حالا با زدن روی کارت، سطح و تکامل/هیرو را تنظیم کن' : 'حالت انتخاب سریع'); return renderCards(); }
  if (t.closest('#completeBtn')) return runComplete(false);
  if (t.closest('#analyzeBtn')) return runComplete(true);
  if (t.closest('#clearLocked')) { ui.locked = []; ui.complete = null; return renderComplete(); }
  if (t.closest('#curDeck')) { ui.locked = ui.player.currentDeck.slice(); return runComplete(true); }
  if (t.closest('#fetchTag')) return doFetchTag();
  if (t.closest('#exportBtn')) return download(`clash-deck-cards-${todayISO()}.json`, JSON.stringify(exportCollection(state.collection, catalog), null, 1));
  if (t.closest('#copyExport')) { if (await copy(JSON.stringify(exportCollection(state.collection, catalog)))) toast('کپی شد 📋'); return; }
  if (t.closest('#importBtn')) return doImport($('#importText').value);
  if (t.closest('#resetBtn')) { if (confirm('همه کارت‌های انتخاب‌شده پاک شوند؟')) { state.collection = {}; ui.decks = null; save(); toast('پاک شد'); } return; }
  if (t.closest('#refreshData')) { await loadData(true); toast(`داده بررسی شد: ${jdate(catalog.updated)}`); return refresh(); }
});
document.addEventListener('toggle', (e) => {
  const d = e.target; if (!d.matches?.('details[data-swaps]') || !d.open || d.dataset.done) return;
  d.dataset.done = 1; const deck = ui.decks.decks[+d.dataset.swaps];
  setTimeout(() => { d.querySelector('.swaps').innerHTML = swapsHtml(E.swapSuggestions(deck.keys, ctx(), deck.arch)); }, 10);
}, true);
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { ui.q = e.target.value; renderCards(); }
  if (e.target.id === 'searchC') { ui.qc = e.target.value; const pos = e.target.selectionStart; renderComplete(); const s = $('#searchC'); s.focus(); s.setSelectionRange(pos, pos); }
});
document.addEventListener('change', (e) => {
  const id = e.target.id; const s = state.settings;
  if (id === 'defLevel') { s.defaultLevel = +e.target.value; save(); }
  if (['tower', 'specialSlots', 'maxChampions'].includes(id)) { s[id] = +e.target.value; ui.decks = null; save(); toast('ذخیره شد'); }
  if (id === 'rememberKey') { s.rememberKey = e.target.checked; s.apiKey = $('#apiKey').value; save(); }
  if (id === 'importFile' && e.target.files[0]) e.target.files[0].text().then(doImport);
});

// ---------- data ----------
async function loadData(bust = false) {
  const opt = bust ? { cache: 'reload' } : {};
  const [c, m] = await Promise.all([fetch('data/cards.json', opt).then((r) => r.json()), fetch('data/meta.json', opt).then((r) => r.json()).catch(() => ({ decks: [] }))]);
  catalog = c; meta = m; byKey = new Map(c.cards.map((x) => [x.key, x]));
  // device-level new-card detection: anything not seen on this device before
  const fresh = diffNewCards(catalog, state.knownKeys);
  if (fresh.length) { ui.freshKeys = fresh; setTimeout(() => toast(`✨ ${fa(fresh.length)} کارت جدید به بازی اضافه شد: ${fresh.map((k) => byKey.get(k).fa || byKey.get(k).name).join('، ')}`, 5000), 400); }
  state.knownKeys = catalog.cards.map((x) => x.key); state.seenAt = catalog.updated; save();
  renderHeader();
}

(async () => {
  try { await loadData(); } catch (e) { $('#view-build').innerHTML = '<div class="notice warn">بارگذاری داده کارت‌ها ناموفق بود. اینترنت را بررسی کن و دوباره باز کن.</div>'; return; }
  go('build');
  document.body.dataset.ready = '1';
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('nosw')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e)));
}
window.__deck = { state, ui, get catalog() { return catalog; }, VERSION };

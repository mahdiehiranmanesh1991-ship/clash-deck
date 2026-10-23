// Headless end-to-end test at iPhone size (390x844). No real network: the player API is mocked with page.route.
// Run: python3 -m http.server 8765 &  then  PW_DIR=/tmp/pw node tests/e2e.mjs http://127.0.0.1:8765/
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire((process.env.PW_DIR || '/tmp/pw') + '/');
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const SHOTS = new URL('../screenshots/', import.meta.url).pathname;
const PLAYER = JSON.parse(fs.readFileSync(new URL('./fixtures/player.json', import.meta.url)));
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fa-IR', timezoneId: 'Asia/Tehran',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
const errors = []; const external = []; let authHeader = null;
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !/^(data|blob):/.test(u)) external.push(u); });
// mocked official API (through RoyaleAPI proxy)
await ctx.route('https://proxy.royaleapi.dev/**', (route) => {
  authHeader = route.request().headers().authorization;
  if (!route.request().url().includes('%232PPGGQ')) return route.fulfill({ status: 404, body: '{}', headers: { 'access-control-allow-origin': '*' } });
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(PLAYER) });
});
await ctx.route('https://api-assets.clashroyale.com/**', (route) => route.abort());

const shot = async (name, full = false) => {
  await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + name + '.png', fullPage: full });
};
const tab = (t) => page.click(`.tabbar [data-tab="${t}"]`);
const ready = () => page.waitForSelector('body[data-ready="1"]', { timeout: 15000 });

// 1. first launch
await page.goto(BASE); await ready();
check('RTL + Persian', await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'fa'));
check('Vazirmatn (local font) loaded', await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px Vazirmatn'); }));
const badge = await page.textContent('#dataBadge');
check('data date shown (Jalali)', /داده کارت‌ها: ۱۴۰۵\/\d|۱۴۰۵/.test(badge), badge);
check('empty state asks for 8 cards', (await page.textContent('#view-build')).includes('حداقل ۸ کارت'));
check('recent card badged «کارت جدید»', (await page.textContent('#view-build')).includes('کارت جدید'));
await shot('01-start');

// 2. manual picker
await tab('cards');
await page.waitForSelector('#cardsGrid .tile');
const total = await page.locator('#cardsGrid .tile').count();
check('all cards listed in picker', total >= 120, String(total));
check('English names next to Persian', (await page.textContent('#cardsGrid .tile[data-key="hog-rider"]')).includes('Hog Rider'));
await page.fill('#search', 'hog'); await page.waitForTimeout(100);
check('search filters (English)', (await page.locator('#cardsGrid .tile').count()) <= 3);
await page.fill('#search', 'هاگ'); await page.waitForTimeout(100);
check('search filters (Persian)', (await page.locator('#cardsGrid .tile[data-key="hog-rider"]').count()) === 1);
await page.fill('#search', ''); await page.waitForTimeout(100);
await page.click('#selAll');
check('select all', (await page.evaluate(() => Object.keys(window.__deck.state.collection).length)) === total);
await page.click('[data-kind="champion"]');
await page.click('#selNone');
await page.click('[data-kind="all"]');
const afterNone = await page.evaluate(() => Object.keys(window.__deck.state.collection).length);
check('clear filtered (champions off)', afterNone < total && afterNone > 100, String(afterNone));
await page.click('#cardsGrid .tile[data-key="golem"]');
check('tap toggles owned', !(await page.evaluate(() => 'golem' in window.__deck.state.collection)));
await page.click('#cardsGrid .tile[data-key="golem"]');
await page.click('[data-kind="spell"]');
await shot('02-cards');
await page.click('[data-kind="all"]');
// edit sheet: level + evo
await page.click('#editMode');
await page.click('#cardsGrid .tile[data-key="musketeer"]');
await page.waitForSelector('#sheet:not([hidden]) #shLvl');
await page.fill('#shLvl', '15'); await page.dispatchEvent('#shLvl', 'input');
if (await page.locator('#shEvo').count()) await page.check('#shEvo');
await shot('03-card-sheet');
await page.click('#shClose');
await page.click('#editMode');
const mus = await page.evaluate(() => window.__deck.state.collection.musketeer);
check('level + evo saved', mus.level === 15 && mus.evo === true, JSON.stringify(mus));

// 3. build decks
await tab('build');
await page.click('#buildBtn');
await page.waitForSelector('#decks .deck', { timeout: 20000 });
const decks = await page.evaluate(() => window.__deck.ui.decks.decks);
check('3–5 decks generated', decks.length >= 3 && decks.length <= 5, String(decks.length));
check('each deck has 8 unique cards', decks.every((d) => new Set(d.keys).size === 8));
check('each deck ≤ 1 champion', await page.evaluate(() => window.__deck.ui.decks.decks.every((d) => d.keys.filter((k) => window.__deck.catalog.cards.find((c) => c.key === k).champion).length <= 1)));
check('score / avg / cycle shown', (await page.textContent('#decks .deck')).match(/میانگین اکسیر .+چرخه ۴ کارت/) !== null);
check('archetype variety', new Set(decks.map((d) => d.arch)).size >= 3, decks.map((d) => d.arch).join(','));
check('pros/cons in Persian', decks.every((d) => d.pros.length >= 1));
check('deck link format', decks.every((d) => /^https:\/\/link\.clashroyale\.com\/en\/\?clashroyale:\/\/copyDeck\?deck=(\d{8};){7}\d{8}&l=Royals&tt=159000000$/.test(d.link)), decks[0].link);
check('slot badges rendered', (await page.locator('#decks .deck .slot').count()) >= 1);
check('similar meta deck shown', (await page.locator('#decks .similar').count()) >= 1);
check('upgrade priority section', (await page.locator('#upgrade .upg').count()) >= 1);
await shot('04-decks');
await page.click('#decks .deck:first-child [data-copy]');
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('copy link to clipboard', clip === decks[0].link);
await page.click('#decks .deck:first-child details[data-swaps] summary');
await page.waitForFunction(() => !document.querySelector('#decks .deck details[data-swaps] .swaps').textContent.includes('محاسبه'));
await page.click('#decks .deck:first-child details:not([data-swaps]) summary');
await page.evaluate(() => { document.getElementById('toast').hidden = true; });
await page.addStyleTag({ content: '.topbar,.tabbar{visibility:hidden!important}', }).then((h) => h.evaluate((el) => el.id = 'shotfix'));
await page.locator('#decks .deck:first-child').screenshot({ path: SHOTS + '05-deck-detail.png' });
await page.evaluate(() => document.getElementById('shotfix').remove());
check('score breakdown + swaps open', (await page.textContent('#decks .deck:first-child')).includes('سطح کارت‌ها'));
// archetype filter
await page.click('[data-arch="beatdown"]'); await page.click('#buildBtn');
await page.waitForFunction(() => !window.__deck.ui.busy && window.__deck.ui.decks);
check('archetype filter (beatdown only)', await page.evaluate(() => window.__deck.ui.decks.decks.length > 0 && window.__deck.ui.decks.decks.every((d) => d.arch === 'beatdown')));
await page.click('[data-arch=""]');

// 4. complete my deck
await tab('complete');
await page.click('#completeGrid .tile[data-key="hog-rider"]');
await page.click('#completeGrid .tile[data-key="fireball"]');
await page.click('#completeBtn');
await page.waitForSelector('#completeOut .deck');
const comp = await page.evaluate(() => window.__deck.ui.lastComplete);
check('complete-my-deck keeps locked cards', comp.length >= 1 && comp.every((d) => d.keys.includes('hog-rider') && d.keys.includes('fireball')));
await shot('06-complete');
await page.click('#completeOut .deck [data-tocomplete="0"]');
await page.click('#analyzeBtn');
await page.waitForSelector('#completeOut .deck');
check('analyse 8-card deck + swaps', (await page.textContent('#completeOut')).includes('پیشنهاد جایگزینی'));

// 5. settings: tag import (mocked API), tower troop
await tab('settings');
await page.fill('#tag', '#2ppggq');
await page.click('#fetchTag');
await page.waitForFunction(() => document.getElementById('tagMsg').textContent.includes('🔑'));
check('no key → clear manual fallback message', true);
await page.fill('#apiKey', 'test-key-123');
await page.click('#fetchTag');
await page.waitForFunction(() => /✅|❌/.test(document.getElementById('tagMsg').textContent));
const tagMsg = await page.textContent('#tagMsg');
const imported = await page.evaluate(() => window.__deck.state.collection);
check('player tag import', tagMsg.includes('✅') && Object.keys(imported).length === PLAYER.cards.length - 1, tagMsg);
check('unknown future card reported, not crashing', tagMsg.includes('Future Card'));
check('Authorization header sent to proxy', authHeader === 'Bearer test-key-123');
const kn = PLAYER.cards.find((c) => c.name === 'Knight');
const evoHog = PLAYER.cards.find((c) => c.evolutionLevel);
check('levels mapped to unified 1–16', imported.knight ? imported.knight.level === kn.level + (16 - kn.maxLevel) : true);
check('evo/hero bitmask mapped', (() => { const k = evoHog.name.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, '-'); const o = imported[k]; return o && o.evo === !!(evoHog.evolutionLevel & 1) && o.hero === !!(evoHog.evolutionLevel & 2); })());
check('tower troop from player', await page.evaluate(() => window.__deck.state.settings.tower === 159000001));
check('API key not stored unless opted in', await page.evaluate(() => !localStorage.getItem('clashdeck.v1').includes('test-key-123')));
await shot('07-settings');
// export / import roundtrip
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
const exp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
check('export file', exp.app === 'clash-deck' && exp.cards.length === Object.keys(imported).length);
await page.evaluate(() => { localStorage.clear(); });
await page.fill('#importText', JSON.stringify(exp));
await page.click('#importBtn');
check('import restores collection', (await page.evaluate(() => Object.keys(window.__deck.state.collection).length)) === exp.cards.length);

// 6. a brand-new card appears in the daily data → recognised automatically
await ctx.route('**/data/cards.json', async (route) => {
  const res = await route.fetch({ headers: { 'cache-control': 'no-cache' } });
  const j = await res.json();
  const today = new Date().toISOString().slice(0, 10);
  j.cards.push({ id: 26000999, key: 'test-titan', name: 'Test Titan', elixir: 5, rarity: 'epic', type: 'troop', maxLevel: 11, evo: false, hero: false, champion: false, roles: ['tank', 'win'], dsRoles: [], fa: 'تایتان آزمایشی', img: {}, remote: {}, added: today });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
});
await page.goto(BASE + '?nosw'); await ready();
await page.waitForSelector('#toast:not([hidden])');
const t = await page.textContent('#toast');
check('toast announces new card on this device', t.includes('تایتان آزمایشی'), t);
check('new card in «کارت جدید» notice', (await page.textContent('#view-build')).includes('تایتان آزمایشی'));
await tab('cards'); await page.click('[data-own="new"]');
check('«جدید» filter shows it with badge + fallback tile', (await page.textContent('#cardsGrid .tile[data-key="test-titan"]')).includes('کارت جدید') && (await page.locator('#cardsGrid .tile[data-key="test-titan"] img').count()) === 0);
await shot('08-new-card');
await ctx.unroute('**/data/cards.json');

// 7. offline (service worker)
await page.goto(BASE); await ready();
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(1500);
await page.reload(); await ready();
await ctx.setOffline(true);
await page.reload(); await ready();
check('works offline (service worker)', (await page.textContent('#dataBadge')).includes('داده کارت‌ها'));
check('card images cached offline', await page.evaluate(async () => !!(await caches.match('./img/cards/26000000.webp'))));
await ctx.setOffline(false);

const ext = external.filter((u) => !u.startsWith('https://proxy.royaleapi.dev/'));
check('no unexpected external requests', ext.length === 0, ext.slice(0, 3).join(' '));
check('no console errors', errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(e)).length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

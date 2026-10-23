// Jalali (Solar Hijri) calendar math — algorithm from jalaali-js (MIT, Behrang Noruzi Niya),
// re-implemented inline so the app has no dependencies. Internal day representation: Julian Day Number (JDN).
const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const div = (a, b) => ~~(a / b);
const mod = (a, b) => a - ~~(a / b) * b;

function jalCal(jy, withoutLeap) {
  const bl = breaks.length, gy = jy + 621;
  let leapJ = -14, jp = breaks[0], jm, jump = 0, n, i;
  if (jy < jp || jy >= breaks[bl - 1]) throw new Error('Invalid Jalali year ' + jy);
  for (i = 1; i < bl; i += 1) {
    jm = breaks[i]; jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (withoutLeap) return { gy, march };
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

export function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
export function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
export function j2d(jy, jm, jd) {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
export function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy, false);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1; k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}
export const isLeapJalali = (jy) => jalCal(jy, false).leap === 0;
export const monthLength = (jy, jm) => (jm <= 6 ? 31 : jm <= 11 ? 30 : isLeapJalali(jy) ? 30 : 29);
export const isValidJalali = (jy, jm, jd) => Number.isInteger(jy) && jm >= 1 && jm <= 12 && jd >= 1 && jd <= monthLength(jy, jm);

/** 0 = Saturday ... 6 = Friday (Iranian week). */
export const weekdayIndex = (jdn) => mod(jdn + 2, 7);
export const isFriday = (jdn) => weekdayIndex(jdn) === 6;
export const isThursday = (jdn) => weekdayIndex(jdn) === 5;

export const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
export const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

const pad = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' (Jalali) <-> JDN */
export const keyFromJdn = (jdn) => { const j = d2j(jdn); return `${j.jy}-${pad(j.jm)}-${pad(j.jd)}`; };
export function jdnFromKey(key) {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(key).trim());
  if (!m) throw new Error('Bad Jalali date: ' + key);
  const [jy, jm, jd] = [+m[1], +m[2], +m[3]];
  if (!isValidJalali(jy, jm, jd)) throw new Error('Invalid Jalali date: ' + key);
  return j2d(jy, jm, jd);
}
export const jdnFromDate = (date) => g2d(date.getFullYear(), date.getMonth() + 1, date.getDate());
export const todayJdn = () => jdnFromDate(new Date());

const FA = '۰۱۲۳۴۵۶۷۸۹';
export const fa = (v) => String(v).replace(/\d/g, (d) => FA[d]);
export const toLatinDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
export function formatLong(jdn) {
  const j = d2j(jdn);
  return `${WEEKDAYS[weekdayIndex(jdn)]} ${fa(j.jd)} ${MONTHS[j.jm - 1]} ${fa(j.jy)}`;
}
export const formatShort = (jdn) => fa(keyFromJdn(jdn).replace(/-/g, '/'));

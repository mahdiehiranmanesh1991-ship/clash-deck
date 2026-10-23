// Hand-curated deck-building knowledge. Everything here is keyed by card slug and is OPTIONAL:
// a brand-new card that is not listed still works through its data roles + elixir heuristics.

export const ARCHETYPES = {
  beatdown:   { fa: 'بیت‌داون (تانک سنگین)', en: 'Beatdown', elixir: [3.6, 4.4] },
  cycle:      { fa: 'سایکل (چرخش سریع)', en: 'Cycle', elixir: [2.6, 3.2] },
  control:    { fa: 'کنترل', en: 'Control', elixir: [3.1, 3.9] },
  bridgespam: { fa: 'بریج اسپم (فشار پل)', en: 'Bridge Spam', elixir: [3.4, 4.1] },
  siege:      { fa: 'محاصره (ایکس‌بو/خمپاره)', en: 'Siege', elixir: [2.9, 3.6] },
  bait:       { fa: 'بِیت (طعمه اسپل)', en: 'Spell Bait', elixir: [2.7, 3.4] },
};

/** Which archetypes a win condition fits. */
export const WIN_ARCH = {
  golem: ['beatdown'], giant: ['beatdown', 'control'], 'electro-giant': ['beatdown'], 'lava-hound': ['beatdown'],
  'goblin-giant': ['beatdown'], 'royal-giant': ['beatdown', 'cycle'], 'elixir-golem': ['beatdown'],
  'three-musketeers': ['beatdown'], 'rune-giant': ['beatdown'], goblinstein: ['beatdown', 'bridgespam'],
  'minion-giant': ['beatdown', 'cycle'], balloon: ['beatdown', 'cycle'],
  'hog-rider': ['cycle', 'bridgespam'], miner: ['control', 'cycle', 'bait'], 'wall-breakers': ['cycle', 'bait'],
  'royal-hogs': ['cycle', 'bridgespam'], 'goblin-drill': ['bait', 'control', 'cycle'],
  'battle-ram': ['bridgespam'], 'ram-rider': ['bridgespam'], pekka: ['bridgespam', 'control'],
  'mega-knight': ['bridgespam', 'control'], 'elite-barbarians': ['bridgespam'], 'boss-bandit': ['bridgespam'],
  'x-bow': ['siege'], mortar: ['siege', 'bait'], 'goblin-barrel': ['bait'], 'skeleton-barrel': ['bait', 'cycle'],
  'suspicious-bush': ['bait', 'cycle'], graveyard: ['control'],
};

/** Role corrections on top of the data roles. */
export const ROLE_FIX = {
  add: {
    pekka: ['win'], 'mega-knight': ['win'], 'elite-barbarians': ['win'], 'rune-giant': ['win'], goblinstein: ['win'],
    'suspicious-bush': ['win'], 'boss-bandit': ['win'], 'goblin-barrel': ['win'], graveyard: ['win'],
    rocket: ['spellB'], lightning: ['spellB'], fireball: ['spellB'], poison: ['spellB'], void: ['spellB'],
  },
  remove: {
    'ice-golem': ['air', 'splash'], rage: ['spellS', 'splash'], freeze: ['spellS', 'splash'], tornado: ['splash'],
    'heal-spirit': ['cycle'],
  },
};

/** Utility cards that are only used when the player locks them. */
export const UTILITY = new Set(['mirror', 'clone', 'rage', 'elixir-collector']);

/** Classic pairings (weight 1). Meta-deck co-occurrence adds more automatically. */
export const SYNERGY = [
  ['hog-rider', 'earthquake'], ['hog-rider', 'ice-golem'], ['hog-rider', 'cannon'], ['miner', 'poison'], ['miner', 'wall-breakers'],
  ['golem', 'night-witch'], ['golem', 'baby-dragon'], ['golem', 'lumberjack'], ['lava-hound', 'balloon'], ['lava-hound', 'mega-minion'],
  ['lava-hound', 'fireball'], ['giant', 'graveyard'], ['giant', 'prince'], ['x-bow', 'tesla'], ['x-bow', 'ice-golem'], ['mortar', 'goblin-gang'],
  ['goblin-barrel', 'princess'], ['goblin-barrel', 'goblin-gang'], ['goblin-barrel', 'the-log'], ['balloon', 'lumberjack'], ['balloon', 'freeze'],
  ['royal-giant', 'fisherman'], ['royal-giant', 'lightning'], ['pekka', 'battle-ram'], ['pekka', 'electro-wizard'], ['pekka', 'bandit'],
  ['electro-giant', 'tornado'], ['electro-giant', 'lightning'], ['graveyard', 'poison'], ['graveyard', 'freeze'], ['royal-hogs', 'earthquake'],
  ['battle-ram', 'bandit'], ['ram-rider', 'bandit'], ['three-musketeers', 'elixir-collector'], ['goblin-giant', 'sparky'],
  ['elixir-golem', 'battle-healer'], ['mega-knight', 'skeleton-barrel'], ['mega-knight', 'miner'], ['goblin-drill', 'bomber'],
  ['skeleton-barrel', 'goblin-barrel'], ['wall-breakers', 'magic-archer'], ['goblinstein', 'cannon-cart'], ['balloon', 'giant-snowball'],
];

export const ROLE_FA = {
  win: 'وین‌کاندیشن', tank: 'تانک', minitank: 'مینی‌تانک', spellS: 'اسپل سبک', spellB: 'اسپل سنگین', air: 'ضدهوایی',
  tk: 'تانک‌کش', splash: 'ضربه پخش', bld: 'ساختمان', siege: 'محاصره', cycle: 'ارزان', swarm: 'گروهی', reset: 'ریست',
  chaser: 'هدفش ساختمان', flying: 'پرنده', spawner: 'تولیدکننده', pumpResp: 'جواب پمپ',
};
export const TYPE_FA = { troop: 'نیرو', spell: 'اسپل', building: 'ساختمان', tower: 'نیروی برج' };

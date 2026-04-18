export const BULLET_TYPES = {
  basic:       { name: 'BÁSICA',      color: 0xffff00, speed: 60, baseDamage: 1, unlockCost:   0, special: null },
  explosive: { name: 'EXPLOSIVA', color: 0xff6600, speed: 45, baseDamage: 2, unlockCost: 150, special: 'aoe', aoeRadius: 2.5, aoeDamage: 1 },
  penetrating: { name: 'PENETRANTE',  color: 0x00ccff, speed: 70, baseDamage: 1, unlockCost: 100, special: 'pierce' },
  slowing:     { name: 'LENTIZANTE',  color: 0x4488ff, speed: 50, baseDamage: 1, unlockCost: 120, special: 'slow',   slowFactor: 0.35, slowTime: 2.5 },
  burning:     { name: 'QUEMANTE',    color: 0xff4400, speed: 55, baseDamage: 1, unlockCost: 130, special: 'burn',   burnDPS: 0.8,     burnTime: 3.0 },
};

export const BULLET_POKE_TYPE = {
  basic:       'normal',
  explosive:   'rock',
  penetrating: 'steel',
  slowing:     'ice',
  burning:     'fire',
};

export const TYPE_CHART = {
  normal:  { rock:0.5, steel:0.5, ghost:0 },
  rock:    { flying:2, bug:2, fire:2, ice:2,  fighting:0.5, ground:0.5, steel:0.5 },
  steel:   { ice:2, rock:2, fairy:2,          steel:0.5, fire:0.5, water:0.5, electric:0.5 },
  ice:     { flying:2, ground:2, grass:2, dragon:2,  water:0.5, ice:0.5, steel:0.5, fire:0.5 },
  fire:    { grass:2, ice:2, bug:2, steel:2,   fire:0.5, water:0.5, rock:0.5, dragon:0.5 },
};

export const UPGRADE_DEFS = {
  autoRate: { label: 'Cadencia Auto', costs: [80,  160, 280],  values: [2.5, 1.8, 1.2, 0.8] },
  damage:   { label: 'Daño',          costs: [100, 200, 350],  values: [1,   1.5, 2,   3  ] },
  burst:    { label: 'Ráfaga',        costs: [120, 240],       values: [2,   3,   4       ] },
};

export const TURRET_POSITIONS = [
  { x: -8, z: -10, yaw: Math.PI + Math.PI / 8 },
  { x:  0, z: -10, yaw: Math.PI             },
  { x:  8, z: -10, yaw: Math.PI - Math.PI / 8 },
  { x: -8, z:  10, yaw: Math.PI / 8     },
  { x:  0, z:  10, yaw: 0               },
  { x:  8, z:  10, yaw: -Math.PI / 8    },
];

export const TURRET_MAP_POSITIONS = [
  { cx: -30, cy: -30 }, { cx:   0, cy: -30 }, { cx:  30, cy: -30 },
  { cx: -30, cy:  30 }, { cx:   0, cy:  30 }, { cx:  30, cy:  30 },
];

export const ENEMY_BASE_STATS = [
  { speed:3.5, hp:1, size:.5,  score:10, color:0xff2200, growthRate:'fast'    },
  { speed:2.0, hp:3, size:.8,  score:25, color:0xff6600, growthRate:'medium'  },
  { speed:5.0, hp:1, size:.35, score:20, color:0xcc00ff, growthRate:'fast'    },
  { speed:1.2, hp:6, size:1.1, score:50, color:0xff0077, growthRate:'slow'    },
  { speed:4.0, hp:1, size:.6,  score:15, color:0x00ff00, growthRate:'erratic' },
  { speed:2.5, hp:4, size:.9,  score:30, color:0x0000ff, growthRate:'medium'  },
  { speed:3.0, hp:2, size:.7,  score:20, color:0xffff00, growthRate:'slow'    },
];

export const ENEMY_SIZE_TIERS = [
    { sizeMult: 1.0, speedMult: 1.0, hpMult: 1.0, rarity: 0.5 },
    { sizeMult: 2.0, speedMult: 0.8, hpMult: 2.0, rarity: 0.4 },
    { sizeMult: 4.0, speedMult: 0.6, hpMult: 4.0, rarity: 0.1 },
];

export const POKEMON_GROWTH = {
  fast:    w => 1 + w * 0.28 + w * w * 0.010,
  medium:  w => 1 + w * 0.16 + w * w * 0.005,
  slow:    w => 1 + w * 0.09 + w * w * 0.002,
  erratic: w => w < 5 ? 1 + w * 0.05 : 1 + (w - 4) * 0.38,
};

export const POKE_TYPE_COLORS = {
  normal:0xA8A878, fire:0xF08030, water:0x6890F0, electric:0xF8D030,
  grass:0x78C850,  ice:0x98D8D8,  fighting:0xC03028, poison:0xA040A0,
  ground:0xE0C068, flying:0xA890F0, psychic:0xF85888, bug:0xA8B820,
  rock:0xB8A038,   ghost:0x705898, dragon:0x7038F8,  dark:0x705848,
  steel:0xB8B8D0,  fairy:0xEE99AC,
};

export const POKE_WAVE_POOLS = [
  [
    {name:'charmander', speed:3.25,hp:3,size:0.43,score:12,color:0xF08030,growthRate:'medium',pokeTypes:['fire']},
    {name:'squirtle',   speed:2.15,hp:3,size:0.36,score:13,color:0x6890F0,growthRate:'medium',pokeTypes:['water']},
    {name:'pikachu',    speed:4.50,hp:2,size:0.30,score:22,color:0xF8D030,growthRate:'fast',  pokeTypes:['electric']},
    {name:'jigglypuff', speed:1.00,hp:7,size:0.36,score:19,color:0xA8A878,growthRate:'slow',  pokeTypes:['normal','fairy']},
    {name:'meowth',     speed:4.50,hp:3,size:0.30,score:12,color:0xA8A878,growthRate:'fast',  pokeTypes:['normal']},
    {name:'abra',       speed:4.50,hp:2,size:0.64,score:12,color:0xF85888,growthRate:'fast',  pokeTypes:['psychic']},
    {name:'geodude',    speed:1.00,hp:3,size:0.30,score:12,color:0xB8A038,growthRate:'medium',pokeTypes:['rock','ground']},
    {name:'gastly',     speed:4.00,hp:2,size:0.93,score:12,color:0x705898,growthRate:'fast',  pokeTypes:['ghost','poison']},
  ],
  [
    {name:'mankey',     speed:3.50,hp:3,size:0.36,score:12,color:0xC03028,growthRate:'medium',pokeTypes:['fighting']},
    {name:'growlithe',  speed:3.00,hp:4,size:0.50,score:14,color:0xF08030,growthRate:'medium',pokeTypes:['fire']},
    {name:'machop',     speed:1.75,hp:4,size:0.57,score:12,color:0xC03028,growthRate:'medium',pokeTypes:['fighting']},
    {name:'ponyta',     speed:4.50,hp:3,size:0.71,score:16,color:0xF08030,growthRate:'fast',  pokeTypes:['fire']},
    {name:'grimer',     speed:1.25,hp:5,size:0.64,score:13,color:0xA040A0,growthRate:'slow',  pokeTypes:['poison']},
    {name:'rhyhorn',    speed:1.25,hp:5,size:0.71,score:14,color:0xE0C068,growthRate:'slow',  pokeTypes:['ground','rock']},
    {name:'eevee',      speed:2.75,hp:4,size:0.30,score:13,color:0xA8A878,growthRate:'medium',pokeTypes:['normal']},
    {name:'dragonite',  speed:4.00,hp:6,size:1.40,score:54,color:0x7038F8,growthRate:'fast',  pokeTypes:['dragon','flying']},
  ],
  [
    {name:'hitmonlee',  speed:4.35,hp:3,size:1.07,score:32,color:0xC03028,growthRate:'fast',  pokeTypes:['fighting']},
    {name:'tangela',    speed:3.00,hp:4,size:0.71,score:17,color:0x78C850,growthRate:'medium',pokeTypes:['grass']},
    {name:'pinsir',     speed:4.25,hp:4,size:1.07,score:35,color:0xA8B820,growthRate:'fast',  pokeTypes:['bug']},
    {name:'lapras',     speed:3.00,hp:8,size:1.40,score:37,color:0x6890F0,growthRate:'slow',  pokeTypes:['water','ice']},
    {name:'snorlax',    speed:1.50,hp:9,size:1.40,score:38,color:0xA8A878,growthRate:'slow',  pokeTypes:['normal']},
    {name:'dratini',    speed:2.50,hp:3,size:1.29,score:12,color:0x7038F8,growthRate:'medium',pokeTypes:['dragon']},
    {name:'omanyte',    speed:1.75,hp:2,size:0.30,score:14,color:0xB8A038,growthRate:'medium',pokeTypes:['rock','water']},
    {name:'kabuto',     speed:2.75,hp:2,size:0.36,score:14,color:0xB8A038,growthRate:'medium',pokeTypes:['rock','water']},
  ],
  [
    {name:'chikorita',  speed:2.25,hp:3,size:0.64,score:13,color:0x78C850,growthRate:'medium',pokeTypes:['grass']},
    {name:'togepi',     speed:1.00,hp:2,size:0.30,score:10,color:0xEE99AC,growthRate:'medium',pokeTypes:['fairy']},
    {name:'marill',     speed:2.00,hp:4,size:0.30,score:18,color:0x6890F0,growthRate:'medium',pokeTypes:['water','fairy']},
    {name:'wooper',     speed:1.00,hp:4,size:0.30,score:10,color:0x6890F0,growthRate:'erratic',pokeTypes:['water','ground']},
    {name:'slugma',     speed:1.00,hp:3,size:0.50,score:10,color:0xF08030,growthRate:'medium',pokeTypes:['fire']},
    {name:'larvitar',   speed:2.05,hp:3,size:0.43,score:12,color:0xB8A038,growthRate:'medium',pokeTypes:['rock','ground']},
    {name:'hoothoot',   speed:2.50,hp:4,size:0.50,score:10,color:0xA890F0,growthRate:'medium',pokeTypes:['normal','flying']},
    {name:'umbreon',    speed:3.25,hp:6,size:0.71,score:37,color:0x705848,growthRate:'slow',  pokeTypes:['dark']},
  ],
  [
    {name:'treecko',    speed:3.50,hp:3,size:0.36,score:12,color:0x78C850,growthRate:'medium',pokeTypes:['grass']},
    {name:'ralts',      speed:2.00,hp:2,size:0.30,score:10,color:0xF85888,growthRate:'medium',pokeTypes:['psychic','fairy']},
    {name:'aron',       speed:1.50,hp:3,size:0.30,score:13,color:0xB8B8D0,growthRate:'medium',pokeTypes:['steel','rock']},
    {name:'gulpin',     speed:2.00,hp:4,size:0.30,score:12,color:0xA040A0,growthRate:'medium',pokeTypes:['poison']},
    {name:'spoink',     speed:3.00,hp:4,size:0.50,score:13,color:0xF85888,growthRate:'medium',pokeTypes:['psychic']},
    {name:'feebas',     speed:4.00,hp:2,size:0.43,score:10,color:0x6890F0,growthRate:'fast',  pokeTypes:['water']},
    {name:'buneary',    speed:4.25,hp:4,size:0.30,score:14,color:0xA8A878,growthRate:'fast',  pokeTypes:['normal']},
    {name:'gible',      speed:2.10,hp:4,size:0.50,score:12,color:0x7038F8,growthRate:'medium',pokeTypes:['dragon','ground']},
    {name:'rotom',      speed:4.55,hp:3,size:0.30,score:31,color:0xF8D030,growthRate:'fast',  pokeTypes:['electric','ghost']},
    {name:'whismur',    speed:1.40,hp:4,size:0.43,score:10,color:0xA8A878,growthRate:'erratic',pokeTypes:['normal']},
  ],
];

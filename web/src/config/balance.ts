// All gameplay numbers live here. No magic numbers in systems — tweak this file to rebalance.

export const BALANCE = {
  start: {
    money: 0,
    wood: 0,
    meat: 0,
    gold: 0,
    heat: 70,
    population: 4,
    populationCap: 4,
  },

  camera: {
    fov: 34,
    distance: 33,
    height: 42,
    yawDeg: 45,
    followDamping: 6,
    lookAhead: 1.2,
  },

  player: {
    speed: 6.2,
    radius: 0.45,
    stackCap: 10,
    hp: 100,
    regenDelay: 3,
    regenPerSec: 6,
    axeDamageTree: 1,
    axeDamageEnemy: 10,
    attackInterval: 0.3, // per-target cooldown between axe hits
    orbitAxes: 2,
    orbitRadius: 1.7,
    orbitSpeed: 9, // rad/s
    attackRangeTree: 1.9,
    attackRangeEnemy: 2.3,
    attackWhileMovingMult: 0.35, // attack speed multiplier while moving (enemies only)
    chopWhileMoving: false,
    knockoutSeconds: 3,
    respawn: { x: 0, z: 4 },
    transferInterval: 0.07, // seconds between items flying in/out of the stack
    pickupRadius: 1.6,
  },

  tree: {
    hits: 3,
    logsMin: 1,
    logsMax: 3,
    regrowMin: 20,
    regrowMax: 30,
    radius: 0.55,
  },

  goldRock: { hits: 4, regrow: 2 },

  economy: {
    logPrice: 5,
    mealPrice: 12,
    customerWantMin: 1,
    customerWantMax: 3,
    serveInterval: 0.35,
    cashVisualCap: 40,
    zonePayRateStart: 4, // $ per tick at start of paying
    zonePayAccel: 2.2, // multiplies pay rate per second spent in a zone
    zonePayTick: 0.05,
    offlineCapHours: 3,
    offlineMinSeconds: 60,
    offlineEfficiency: 0.5, // workers earn at half speed while the app is closed
  },

  furnace: {
    maxHeat: 100,
    decayPerSec: 0.9,
    heatPerLog: 9,
    reserveCap: 6,
    autoBurnBelow: 85,
    warmRadius: 7,
  },

  counter: { stockCap: 40, queueSlots: 7, queuePerHouse: 2, serveRadius: 2.4, visitorInterval: 1.6 },

  kitchen: { inputCap: 12, outputCap: 12, cookSeconds: 3.5, tendRadius: 3.2 },
  diner: { seats: 4, foodCap: 16, eatSeconds: 3 },

  survivors: {
    woodNeedMin: 10,
    woodNeedMax: 22,
    firstWoodNeed: 4,
    hungerMin: 40,
    hungerMax: 65,
    hungryPatience: 25,
    moodLossNoFood: 0.15,
    moodRegenFed: 0.25,
    frozenLeaveSeconds: 20,
    arrivalInterval: 10,
    housePopulation: 3,
    speed: 2.6,
    hp: 30,
    maxVisible: 24,
  },

  workers: {
    speed: 3.6,
    capacity: 4,
    chopInterval: 0.7,
    lumberjackDamage: 1,
    hunterDamage: 8,
    hunterInterval: 0.8,
    hunterRange: 2.2,
    guardHp: 80,
    guardDamage: 8,
    guardInterval: 0.8,
    guardAggroRadius: 9,
    guardRespawn: 20,
    minerInterval: 0.8,
  },

  wagon: { speed: 4.5, capacity: 16, loadInterval: 0.1 },

  storage: { lumberHutCap: 40, mineStationCap: 20, smelterOutputCap: 40 },

  mine: { cartCapacity: 5, cartSpeed: 4.5, cartLoadInterval: 0.3, smeltSeconds: 2.5, goldPerOre: 1 },

  palisade: { segmentHp: 120, stoneHp: 400, repairPerLog: 30, repairRadius: 2.6, gateWidth: 3 },

  towers: {
    ballista: { damage: 12, interval: 1.2, range: 11, boltSpeed: 30 },
    cannon: { damage: 26, interval: 2.4, range: 12, splash: 2.6, shellSpeed: 16 },
    fireTrap: { dps: 14, radius: 2.6 },
  },

  enemies: {
    bear: { hp: 30, damage: 8, speed: 1.9, attackInterval: 1.4, radius: 0.8, meat: 2, gold: 0, scale: 1 },
    mother: { hp: 42, damage: 8, speed: 2.7, attackInterval: 1.1, radius: 0.85, meat: 2, gold: 0, scale: 1.05 },
    cub: { hp: 10, damage: 3, speed: 3.3, attackInterval: 0.9, radius: 0.45, meat: 1, gold: 0, scale: 0.55 },
    alpha: { hp: 300, damage: 18, speed: 1.7, attackInterval: 1.6, radius: 1.3, meat: 8, gold: 5, scale: 1.7 },
    wolf: { hp: 18, damage: 5, speed: 4.2, attackInterval: 0.8, radius: 0.5, meat: 1, gold: 0, scale: 0.8 },
    alphaCharge: { telegraph: 1.0, range: 7, dashSpeed: 14, dashTime: 0.55, radius: 2.4, cooldown: 4.5 },
    aggroPlayerRadius: 2.2,
    hpScalePerWave: 0.07,
    meatDespawn: 90,
  },

  waves: {
    firstWaveAt: 60,
    intervalMin: 45,
    intervalMax: 60,
    warningSeconds: 6,
    easyWaves: [1, 2, 3], // bear counts for the first waves
    bossEvery: 5,
    familyFromWave: 4,
    wolvesFromStage: 3,
    stageMultiplier: [1, 1, 1.3, 1.7, 2.2, 3],
    spawnSpread: 6,
  },

  wildBears: { respawn: 12, roamRadius: 6, herdMin: 2, herdMax: 3 },

  monetization: {
    enabled: true,
    noAdsFirstSeconds: 300,
    doubleIncomeSeconds: 300,
    adStubSeconds: 2,
  },

  save: { autosaveSeconds: 10, key: 'frostwood-camp-save-v1' },

  upgradeGrowth: 1.15,
};

export type Balance = typeof BALANCE;

import type { ZoneDef } from '../config/layout';
import { Building } from './building';
import { Furnace, Stall, Diner, LumberHut, Home, Monument, LumberCrew } from './camp';
import { Producer, Warehouse } from './producer';
import { Wagon } from './wagon';
import { Trader } from './lake';
import { Tower, FireTrap } from './defense';
import { MineStation, Rail, Cart, MineLevel, Lantern } from './mine';
import { Geo, buildingGeo } from '../world/models';
import { PRODUCERS } from '../config/content';
import type { Game } from '../game';

/**
 * Building factory: ZoneDef.kind -> behaviour. New zones of existing kinds need no code,
 * only an entry in data/zones.json (production buildings: data/producers.json).
 */
export function createBuilding(game: Game, def: ZoneDef): Building {
  switch (def.kind) {
    case 'furnace': return new Furnace(game, def);
    case 'stall': return new Stall(game, def);
    case 'wagon': return new Wagon(game, def);
    case 'campside': {
      game.expandCamp(def.params?.dir ?? 'east', def.params?.reach ?? 25);
      return new Building(game, def, null);
    }
    case 'campwall': {
      game.setWallLevel(def.params?.level ?? 2);
      return new Building(game, def, null);
    }
    case 'producer': return new Producer(game, def);
    case 'warehouse': return new Warehouse(game, def);
    case 'trader': return new Trader(game, def);
    case 'lumbercrew': return new LumberCrew(game, def);
    case 'diner': return new Diner(game, def);
    case 'lumberhut': {
      const b = new LumberHut(game, def);
      game.hireWorker('lumberjack', def.x - 1.5, def.z + 2, undefined, def.id);
      return b;
    }
    case 'tent':
    case 'house': return new Home(game, def);
    case 'tower':
    case 'cannon': return new Tower(game, def);
    case 'firetrap': return new FireTrap(game, def);
    case 'minestation': return new MineStation(game, def);
    case 'rail': return new Rail(game, def);
    case 'cart': return new Cart(game, def);
    case 'minelevel': return new MineLevel(game, def);
    case 'lantern': return new Lantern(game, def);
    case 'monument': return new Monument(game, def);
    case 'worker': {
      // a little work bench marks where the worker was hired
      const b = new Building(game, def, Geo.workerBench());
      game.hireWorker(def.params!.worker!, def.x, def.z + 1, undefined, def.id);
      return b;
    }
    case 'expansion': {
      game.world.openRegion(def.params!.opens!, game.loading);
      return new Building(game, def, null);
    }
    case 'perk': {
      game.up.grant(def.params!.upgrade!, def.params!.levels ?? 1);
      return new Building(game, def, null);
    }
    case 'stonewall': {
      game.palisade.makeStone();
      game.palisade.setHpMult(game.up.wallHpMult);
      return new Building(game, def, Geo.stoneWallKit());
    }
  }
}

/** Ghost silhouette geometry shown above an unbought zone. */
export function ghostGeo(def: ZoneDef) {
  switch (def.kind) {
    case 'producer': return buildingGeo(PRODUCERS[def.params?.producer ?? '']?.model ?? 'workshop');
    case 'warehouse': return Geo.warehouse();
    case 'stall': return Geo.counter(0xe0a020);
    case 'trader': return Geo.counter(0x3a7bd5);
    case 'wagon': return Geo.cart();
    case 'diner': return Geo.diner();
    case 'lumberhut':
    case 'lumbercrew': return Geo.lumberhut();
    case 'house': return Geo.house();
    case 'tower': return Geo.tower();
    case 'cannon': return Geo.tower();
    case 'firetrap': return Geo.firetrap();
    case 'cart': return Geo.cart();
    case 'minelevel': return Geo.mineEntrance();
    case 'lantern': return Geo.lantern();
    case 'monument': return Geo.monument();
    case 'rail': {
      const [ax, az] = def.params!.from!, [bx, bz] = def.params!.to!;
      return Geo.rail(Math.hypot(bx - ax, bz - az));
    }
    default: return null;
  }
}

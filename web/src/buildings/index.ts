import type { ZoneDef } from '../config/layout';
import { Building } from './building';
import { Furnace, Counter, Kitchen, Diner, LumberHut, Home, Monument } from './camp';
import { Tower, FireTrap } from './defense';
import { MineStation, Rail, Smelter, Cart } from './mine';
import { Geo } from '../world/models';
import type { Game } from '../game';

/**
 * Building factory: ZoneDef.kind -> behaviour. New zones of existing kinds need no code,
 * only an entry in config/layout.ts.
 */
export function createBuilding(game: Game, def: ZoneDef): Building {
  switch (def.kind) {
    case 'furnace': return new Furnace(game, def);
    case 'counter': return new Counter(game, def);
    case 'kitchen': return new Kitchen(game, def);
    case 'diner': return new Diner(game, def);
    case 'lumberhut': {
      const b = new LumberHut(game, def);
      game.hireWorker('lumberjack', def.x - 1.5, def.z + 2);
      return b;
    }
    case 'tent':
    case 'house': return new Home(game, def);
    case 'tower':
    case 'cannon': return new Tower(game, def);
    case 'firetrap': return new FireTrap(game, def);
    case 'minestation': return new MineStation(game, def);
    case 'rail': return new Rail(game, def);
    case 'smelter': return new Smelter(game, def);
    case 'cart': return new Cart(game, def);
    case 'monument': return new Monument(game, def);
    case 'worker': {
      // a little work bench marks where the worker was hired
      const b = new Building(game, def, Geo.workerBench());
      game.hireWorker(def.params!.worker!, def.x, def.z + 1);
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
    case 'kitchen': return Geo.kitchen();
    case 'diner': return Geo.diner();
    case 'lumberhut': return Geo.lumberhut();
    case 'house': return Geo.house();
    case 'tower': return Geo.tower();
    case 'cannon': return Geo.tower();
    case 'firetrap': return Geo.firetrap();
    case 'smelter': return Geo.smelter();
    case 'cart': return Geo.cart();
    case 'monument': return Geo.monument();
    case 'rail': {
      const [ax, az] = def.params!.from!, [bx, bz] = def.params!.to!;
      return Geo.rail(Math.hypot(bx - ax, bz - az));
    }
    default: return null;
  }
}

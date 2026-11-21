import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Ai, Armed, Transform } from '../src/game/components';
import { BUILDING_DEFS } from '../src/game/buildings';
import { FROZEN } from '../src/game/frost';
import { Game } from '../src/game/game';
import { MOUNTS } from '../src/game/mounts';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { createModel, getRig } from '../src/render/models';
import '../src/render/models/buildings';

const DT = 1 / 30;

describe("Rime's frost tower", () => {
  it('lobs frost onto enemies coming at it', () => {
    const game = new Game(11, { populate: false, autoSpawn: false });
    const base = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.frostTower, 0, base.x, base.z, 0, false);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, base.x + 12, base.z);
    game.world.remove(tank, Ai);
    game.world.req(tank, Armed).cooldown = Infinity;
    for (let i = 0; i < 10 / DT; i++) game.step(DT);
    const t = game.world.req(tank, Transform);
    expect(game.ctx.frost.at(t.x, t.z)).toBeGreaterThan(FROZEN);
  });

  it("its roof mortar sits where its mount says", () => {
    const obj = createModel('bld:frostTower', 0);
    obj.updateMatrixWorld(true);
    const rig = getRig(obj)!;
    const mount = MOUNTS['frostTower#mortar'];
    expect(rig.mounts?.length).toBe(1);
    const at = rig.mounts![0].turret!.getWorldPosition(new THREE.Vector3());
    expect(at.toArray().map((v) => +v.toFixed(3))).toEqual(mount.turret.map((v) => +v.toFixed(3)));
    const muzzles: THREE.Object3D[] = [];
    rig.mounts![0].turret!.traverse((o) => o.name === 'muzzle' && muzzles.push(o));
    expect(muzzles.length).toBe(mount.muzzles.length);
  });
});

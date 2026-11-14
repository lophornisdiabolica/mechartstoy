import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createModel, getRig } from '../src/render/models';
import '../src/render/models/buildings';
import '../src/render/models/units';
import { hullMatrix, MOUNTS, muzzleWorld, turretYaw } from '../src/game/mounts';
import { UNIT_DEFS } from '../src/game/units';
import { BUILDING_DEFS, BuildingDef } from '../src/game/buildings';
import { Rng } from '../src/core/rng';

/** Soldiers are sprites: their shots leave from in front of them at the weapon's height. */
const SPRITES = new Set(['trooper', 'atTrooper', 'mortar', 'flameTrooper', 'engineer']);

/** Pose a model as the entity view does: heading, pitch and roll on the hull, the turret turned on it, the barrels pitched on the turret. */
function pose(obj: THREE.Object3D, heading: number, pitch: number, roll: number, aim: number, elev: number): void {
  const rig = getRig(obj)!;
  obj.rotation.order = 'YZX';
  obj.rotation.set(roll, heading, pitch);
  if (rig.turret) rig.turret.rotation.y = turretYaw(hullMatrix(heading, pitch, roll), aim);
  for (const b of rig.barrels ?? []) b.rotation.z = elev;
  obj.updateMatrixWorld(true);
}

describe('weapon mounts', () => {
  it('every armed unit and building model has one', () => {
    const models = [
      ...Object.values(UNIT_DEFS).filter((d) => !SPRITES.has(d.model)).map((d) => d.model),
      ...(Object.values(BUILDING_DEFS) as BuildingDef[]).filter((d) => d.weapon).map((d) => d.model),
    ];
    expect(models.filter((m) => !MOUNTS[m])).toEqual([]);
  });

  for (const [key, mount] of Object.entries(MOUNTS)) {
    it(`${key}: the model's turret, barrels and muzzles are where the sim shoots from`, () => {
      const obj = createModel(key, 0);
      const rig = getRig(obj)!;
      expect(rig.muzzles?.length).toBe(mount.muzzles.length);
      expect(!!rig.barrels).toBe(!!mount.pivot);
      pose(obj, 0, 0, 0, 0, 0);
      if (!mount.hull) {
        const at = rig.turret!.getWorldPosition(new THREE.Vector3());
        expect(at.toArray().map((v) => +v.toFixed(3))).toEqual(mount.turret.map((v) => +v.toFixed(3)));
      }
      const rng = new Rng(7);
      for (let n = 0; n < 6; n++) {
        const heading = rng.range(-3, 3);
        const pitch = rng.range(-0.5, 0.5);
        const roll = rng.range(-0.5, 0.5);
        const aim = heading + rng.range(-2, 2);
        const elev = mount.pivot ? rng.range(-0.3, 1) : 0;
        pose(obj, heading, pitch, roll, aim, elev);
        rig.muzzles!.forEach((m, i) => {
          const got = m.getWorldPosition(new THREE.Vector3());
          const want = muzzleWorld(mount, { x: 0, y: 0, z: 0, heading, pitch, roll }, aim, elev, i);
          expect(got.distanceTo(new THREE.Vector3(want.x, want.y, want.z))).toBeLessThan(2e-3);
        });
      }
    });

    if (key !== 'bomber') {
      it(`${key}: each muzzle is at the end of a barrel`, () => {
        const obj = createModel(key, 0);
        const rig = getRig(obj)!;
        pose(obj, 0, 0, 0, 0, 0);
        const boxes: THREE.Box3[] = [];
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.computeBoundingBox();
          boxes.push(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
        });
        for (const m of rig.muzzles!) {
          const p = m.getWorldPosition(new THREE.Vector3());
          const end = boxes.some((b) => b.clone().expandByScalar(0.04).containsPoint(p) && Math.abs(b.max.x - p.x) < 0.05);
          expect(end, `muzzle at ${p.toArray().map((v) => v.toFixed(2))}`).toBe(true);
        }
      });
    }
  }
});

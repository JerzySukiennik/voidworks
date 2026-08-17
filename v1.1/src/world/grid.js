// Voidworks — grid math: directions, footprint rotation, occupancy and pointer picking on the virtual build plane.

import * as THREE from 'three';
import { GRID, BUILD } from '../config.js';

export const DIRS = [[1, 0], [0, -1], [-1, 0], [0, 1]];

export function dirVec(d) { return DIRS[((d % 4) + 4) % 4]; }
export function opposite(d) { return (d + 2) & 3; }
export function turnRight(d) { return (d + 3) & 3; }
export function turnLeft(d) { return (d + 1) & 3; }

export function dirBetween(ax, az, bx, bz) {
  if (bx > ax) return 0;
  if (bz < az) return 1;
  if (bx < ax) return 2;
  if (bz > az) return 3;
  return -1;
}

export function rotOffset(ox, oz, rot, out) {
  const r = rot & 3;
  let x = ox;
  let z = oz;
  if (r === 1) { x = oz; z = -ox; }
  else if (r === 2) { x = -ox; z = -oz; }
  else if (r === 3) { x = -oz; z = ox; }
  if (out) { out[0] = x; out[1] = z; return out; }
  return [x, z];
}

export function cellKey(x, z, level) {
  return (((x + 512) << 21) | ((z + 512) << 3) | (level & 7)) >>> 0;
}

export function inBounds(x, z) {
  return Math.abs(x) <= BUILD.extent && Math.abs(z) <= BUILD.extent;
}

export function cellCenter(x, z, out) {
  out.set(x * GRID.cell, 0, z * GRID.cell);
  return out;
}

export function createGrid() {
  const occ = new Map();
  const scratch = [0, 0];

  function footprint(def, cx, cz, rot, out) {
    const cells = def.cells;
    out.length = 0;
    for (let i = 0; i < cells.length; i += 1) {
      rotOffset(cells[i][0], cells[i][1], rot, scratch);
      out.push(cx + scratch[0], cz + scratch[1]);
    }
    return out;
  }

  const tmpCells = [];

  return {
    occ,
    footprint,

    at(x, z, level) { return occ.get(cellKey(x, z, level)) ?? null; },

    anyAt(x, z) {
      return occ.get(cellKey(x, z, 0)) ?? occ.get(cellKey(x, z, 1)) ?? null;
    },

    fits(def, cx, cz, rot) {
      footprint(def, cx, cz, rot, tmpCells);
      for (let i = 0; i < tmpCells.length; i += 2) {
        const x = tmpCells[i];
        const z = tmpCells[i + 1];
        if (!inBounds(x, z)) return false;
        for (let l = 0; l < def.levels.length; l += 1) {
          if (occ.has(cellKey(x, z, def.levels[l]))) return false;
        }
      }
      return true;
    },

    occupy(building) {
      const def = building.def;
      footprint(def, building.cx, building.cz, building.rot, tmpCells);
      for (let i = 0; i < tmpCells.length; i += 2) {
        for (let l = 0; l < def.levels.length; l += 1) {
          occ.set(cellKey(tmpCells[i], tmpCells[i + 1], def.levels[l]), building);
        }
      }
    },

    release(building) {
      const def = building.def;
      footprint(def, building.cx, building.cz, building.rot, tmpCells);
      for (let i = 0; i < tmpCells.length; i += 2) {
        for (let l = 0; l < def.levels.length; l += 1) {
          const k = cellKey(tmpCells[i], tmpCells[i + 1], def.levels[l]);
          if (occ.get(k) === building) occ.delete(k);
        }
      }
    },

    clear() { occ.clear(); },
  };
}

export function createPicker(camera) {
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();

  return {
    pick(clientX, clientY, out, level) {
      ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.constant = -(level ? BUILD.levelRise : 0);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      out.x = Math.round(hit.x / GRID.cell);
      out.z = Math.round(hit.z / GRID.cell);
      out.wx = hit.x;
      out.wz = hit.z;
      return inBounds(out.x, out.z) ? out : null;
    },
  };
}

// Voidworks — the build hologram: the real model, the real orientation, and an arrow along the real path.

import * as THREE from 'three';
import { BUILD } from '../config.js';
import { buildGhost } from '../world/buildings.js';

const HALF_TURN = Math.PI * 0.5;

// The arrow is drawn from the lane's own polyline, so a curve's arrow curves and a ramp's arrow climbs.
// Nothing here is authored per building: if the path changes, the hologram follows it for free.
function lanePath(def) {
  const lanes = def.lanes;
  if (!lanes || !lanes.length) return null;
  let best = null;
  for (const l of lanes) {
    if (!l || !l.pts || l.pts.length < 6) continue;
    if (!best || l.pts.length > best.pts.length) best = l;
  }
  return best;
}

function arrowFor(def, material) {
  const lane = lanePath(def);
  const group = new THREE.Group();
  const pts = [];

  if (lane) {
    for (let i = 0; i < lane.pts.length; i += 3) {
      pts.push(new THREE.Vector3(lane.pts[i], lane.pts[i + 1], lane.pts[i + 2]));
    }
  } else {
    // A machine with no lane of its own still faces somewhere: rot 0 is +X by contract.
    pts.push(new THREE.Vector3(-0.34, 0, 0), new THREE.Vector3(0.34, 0, 0));
  }
  if (pts.length < 2) return group;

  for (const p of pts) p.y += BUILD.arrowLift;

  // A row of chevrons riding the path reads as motion; a single long arrow reads as a label. This is
  // the same cue the belt itself uses, which is the point — the hologram should look like the thing
  // it is about to become, already running.
  const up = new THREE.Vector3(0, 1, 0);
  const n = BUILD.arrowChevrons;
  for (let i = 0; i < n; i += 1) {
    const u = (i + 1) / (n + 1);
    const at = u * (pts.length - 1);
    const i0 = Math.min(pts.length - 2, Math.floor(at));
    const t = at - i0;
    const a = pts[i0];
    const b = pts[i0 + 1];
    const pos = a.clone().lerp(b, t);
    const dir = b.clone().sub(a).normalize();

    const chev = new THREE.Mesh(headGeometry(), material.head);
    chev.position.copy(pos);
    chev.quaternion.setFromUnitVectors(up, dir);
    chev.userData.ghostRole = 'head';
    chev.renderOrder = 6;
    group.add(chev);
  }

  return group;
}

let HEAD = null;
function headGeometry() {
  if (!HEAD) HEAD = new THREE.ConeGeometry(BUILD.arrowHead, BUILD.arrowHead * 1.7, 4);
  return HEAD;
}

// A hologram is only honest if it is the thing that will actually be built: the same .glb, carrying the
// same extra quarter turn the placed model gets, at the same height. Anything else teaches a lie.
export function makeGhost(def, world, materials) {
  const outer = new THREE.Group();
  const model = world.getModel?.(def.model);
  const body = new THREE.Group();

  if (model) {
    const clone = model.clone(true);
    clone.traverse((o) => {
      if (!o.isMesh) return;
      o.material = materials.body;
      o.castShadow = false;
      o.receiveShadow = false;
    });
    body.add(clone);
  } else {
    body.add(buildGhost(def, materials.body));
  }

  const off = def.modelOffset || [0, 0];
  body.position.set(off[0], def.modelY || 0, off[1]);
  body.rotation.y = ((def.modelRot || 0) & 3) * HALF_TURN;
  outer.add(body);

  if (def.family !== 'terminal' || def.lanes) outer.add(arrowFor(def, materials));

  outer.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  return outer;
}

// The whole tree, not just the first level of children — a cloned .glb nests meshes several deep,
// and a one-level loop silently leaves most of the hologram in the wrong colour.
export function paintGhost(group, materials, ok) {
  group.traverse((o) => {
    if (!o.isMesh && !o.isLine) return;
    if (o.userData.ghostRole === 'head') o.material = ok ? materials.head : materials.headBad;
    else if (o.isLine) o.material = ok ? materials.line : materials.lineBad;
    else o.material = ok ? materials.body : materials.bodyBad;
  });
}

export function ghostMaterials() {
  const body = new THREE.MeshBasicMaterial({
    color: BUILD.ghostValid, transparent: true, opacity: BUILD.ghostOpacity, depthWrite: false,
  });
  const bodyBad = new THREE.MeshBasicMaterial({
    color: BUILD.ghostInvalid, transparent: true, opacity: BUILD.ghostOpacity, depthWrite: false,
  });
  const line = new THREE.LineBasicMaterial({
    color: BUILD.arrowColor, transparent: true, opacity: BUILD.arrowOpacity, depthTest: false,
  });
  const lineBad = new THREE.LineBasicMaterial({
    color: BUILD.ghostInvalid, transparent: true, opacity: BUILD.arrowOpacity, depthTest: false,
  });
  const head = new THREE.MeshBasicMaterial({
    color: BUILD.arrowColor, transparent: true, opacity: BUILD.arrowOpacity, depthTest: false,
  });
  const headBad = new THREE.MeshBasicMaterial({
    color: BUILD.ghostInvalid, transparent: true, opacity: BUILD.arrowOpacity, depthTest: false,
  });
  return { body, bodyBad, line, lineBad, head, headBad };
}

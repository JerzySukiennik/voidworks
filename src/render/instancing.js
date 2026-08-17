// Voidworks — InstancedMesh pools: one pool per item tier and one per static building part kind.

import * as THREE from 'three';
import { TIERS, tierGeometry, tierMaterial } from '../world/items.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

// `authored` optionally supplies {geometry, material, yOffset} per tier from the glb items, whose
// origin sits at the bottom of the mesh rather than its centre.
export function createItemInstancer(parent, capacity, authored) {
  const meshes = [];
  const counts = new Int32Array(TIERS.length);
  const lift = new Float32Array(TIERS.length);
  // A bottom-origin mesh must not be tilted: it would swing off the belt instead of turning on it.
  const tiltMul = new Float32Array(TIERS.length).fill(1);

  for (let i = 0; i < TIERS.length; i += 1) {
    const model = authored && authored[i];
    if (model) { lift[i] = model.yOffset || 0; tiltMul[i] = 0; }
    const mesh = new THREE.InstancedMesh(
      model ? model.geometry : tierGeometry(i),
      model ? model.material : tierMaterial(i),
      capacity,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.count = 0;
    mesh.name = `items-${TIERS[i].id}`;
    parent.add(mesh);
    meshes.push(mesh);
  }

  return {
    meshes,
    begin() { counts.fill(0); },
    push(t, x, y, z, spin, tilt, scale) {
      const n = counts[t];
      if (n >= capacity) return;
      const tl = tilt * tiltMul[t];
      _e.set(tl, spin, tl * 0.6);
      _q.setFromEuler(_e);
      _p.set(x, y + lift[t], z);
      _s.set(scale, scale, scale);
      _m.compose(_p, _q, _s);
      meshes[t].setMatrixAt(n, _m);
      counts[t] = n + 1;
    },
    end() {
      for (let i = 0; i < meshes.length; i += 1) {
        const mesh = meshes[i];
        const n = counts[i];
        mesh.count = n;
        const attr = mesh.instanceMatrix;
        if (attr.clearUpdateRanges) {
          attr.clearUpdateRanges();
          if (n > 0) attr.addUpdateRange(0, n * 16);
        }
        attr.needsUpdate = n > 0;
      }
    },
    dispose() {
      for (const mesh of meshes) { parent.remove(mesh); mesh.dispose(); }
      meshes.length = 0;
    },
  };
}

// Pooled world-space "+$N" labels. Fixed pool, fixed canvases, coalesced per machine: nothing
// is allocated when a label fires, and at most `size` are ever live.
// Billboarded quads rather than THREE.Sprite: the ambient-occlusion g-buffer skips see-through
// *meshes*, and a sprite slips through that net and gets drawn into it as an un-billboarded black
// card. A mesh we turn ourselves is excluded correctly and costs the same.
export function createLabelPool(parent, size, camera) {
  const slots = [];
  const geometry = new THREE.PlaneGeometry(1.5, 0.375);
  for (let i = 0; i < size; i += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx2d = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
    });
    const sprite = new THREE.Mesh(geometry, material);
    sprite.visible = false;
    sprite.renderOrder = 6;
    sprite.castShadow = false;
    sprite.receiveShadow = false;
    sprite.frustumCulled = false;
    parent.add(sprite);
    slots.push({ canvas, ctx2d, tex, material, sprite, life: 0, value: 0, owner: null, x: 0, y: 0, z: 0, color: '#17c964', redraw: 0 });
  }

  let cursor = 0;

  function paint(s) {
    const c = s.ctx2d;
    c.clearRect(0, 0, 256, 64);
    c.font = '600 44px ui-rounded, -apple-system, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 7;
    c.strokeStyle = 'rgba(255,255,255,.92)';
    const text = s.text;
    c.strokeText(text, 128, 34);
    c.fillStyle = s.color;
    c.fillText(text, 128, 34);
    s.tex.needsUpdate = true;
    s.redraw = 0;
  }

  return {
    slots,
    emit(owner, value, x, y, z, color, prefix) {
      for (let i = 0; i < slots.length; i += 1) {
        const s = slots[i];
        if (s.life > 0 && s.owner === owner) {
          s.value += value;
          s.life = Math.max(s.life, 0.7);
          s.redraw = 1;
          return;
        }
      }
      let best = -1;
      let bestLife = Infinity;
      for (let k = 0; k < slots.length; k += 1) {
        const i = (cursor + k) % slots.length;
        if (slots[i].life <= 0) { best = i; break; }
        if (slots[i].life < bestLife) { bestLife = slots[i].life; best = i; }
      }
      cursor = (best + 1) % slots.length;
      const s = slots[best];
      s.owner = owner;
      s.value = value;
      s.color = color;
      s.prefix = prefix;
      s.life = 1;
      s.x = x; s.y = y; s.z = z;
      s.redraw = 1;
    },
    update(dt, life, rise) {
      for (let i = 0; i < slots.length; i += 1) {
        const s = slots[i];
        if (s.life <= 0) { if (s.sprite.visible) s.sprite.visible = false; continue; }
        s.life -= dt / life;
        if (s.life <= 0) { s.sprite.visible = false; s.owner = null; continue; }
        if (s.redraw) {
          s.text = `${s.prefix}${s.value >= 1000 ? `${(s.value / 1000).toFixed(1)}k` : Math.round(s.value)}`;
          paint(s);
        }
        const u = 1 - s.life;
        s.sprite.visible = true;
        s.sprite.position.set(s.x, s.y + u * rise, s.z);
        if (camera) s.sprite.quaternion.copy(camera.quaternion);
        s.material.opacity = s.life > 0.7 ? (1 - s.life) / 0.3 : Math.min(1, s.life / 0.5);
      }
    },
    dispose() {
      for (const s of slots) { parent.remove(s.sprite); s.tex.dispose(); s.material.dispose(); }
      geometry.dispose();
      slots.length = 0;
    },
  };
}

export function createPartInstancer(parent, geometries, materials, markTransparent) {
  const pools = new Map();

  function pool(geoName, matName) {
    const key = `${geoName}|${matName}`;
    let p = pools.get(key);
    if (!p) {
      p = { key, geoName, matName, capacity: 64, count: 0, mesh: null };
      pools.set(key, p);
    }
    return p;
  }

  function ensure(p) {
    if (p.mesh && p.mesh.instanceMatrix.count >= p.capacity) return;
    if (p.mesh) { parent.remove(p.mesh); p.mesh.dispose(); }
    const material = materials[p.matName];
    const mesh = new THREE.InstancedMesh(geometries[p.geoName], material, p.capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = !material.transparent;
    mesh.receiveShadow = !material.transparent;
    mesh.name = `part-${p.key}`;
    mesh.count = 0;
    // Transparent pools (the upgrader panes) must stay out of the occlusion g-buffer.
    if (material.transparent && markTransparent) markTransparent(mesh);
    parent.add(mesh);
    p.mesh = mesh;
  }

  return {
    pools,
    begin() { for (const p of pools.values()) p.count = 0; },
    push(geoName, matName, matrix) {
      const p = pool(geoName, matName);
      if (p.count >= p.capacity) p.capacity = Math.max(p.capacity * 2, p.count + 8);
      p.count += 1;
      if (!p.pending) p.pending = [];
      p.pending.push(matrix.clone());
    },
    end() {
      for (const p of pools.values()) {
        ensure(p);
        const list = p.pending || [];
        for (let i = 0; i < list.length; i += 1) p.mesh.setMatrixAt(i, list[i]);
        p.mesh.count = list.length;
        p.mesh.instanceMatrix.needsUpdate = true;
        p.pending = null;
      }
    },
    dispose() {
      for (const p of pools.values()) if (p.mesh) { parent.remove(p.mesh); p.mesh.dispose(); }
      pools.clear();
    },
  };
}

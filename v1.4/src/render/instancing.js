// Voidworks — InstancedMesh pools: one pool per item tier and one per static building part kind.

import * as THREE from 'three';
import { FX } from '../config.js';
import { TIERS, tierGeometry, tierMaterial } from '../world/items.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

// The cargo is the thing the player is actually watching, and it was measured — blind — as too dark
// and too small to find on a dark belt. All three fixes live here rather than in the meshes, because
// the item pools are seven InstancedMeshes: size, lift and brightness are free, and stay free at 900
// items. Each tier keeps BOTH tunings in userData, so setEnabled() can swap between the authored
// glb look and the tuned one in place — which is what lets work/tools/fxtest.mjs A/B legibility
// inside a single page load rather than across two launches.
function brightenItemMaterial(source, i) {
  const m = source.clone();
  const gain = (FX.item.colorGain && FX.item.colorGain[i]) || 1;
  m.color.multiplyScalar(gain);
  m.color.r = Math.min(1, m.color.r);
  m.color.g = Math.min(1, m.color.g);
  m.color.b = Math.min(1, m.color.b);
  const e = (FX.item.emissive && FX.item.emissive[i]) || 0;
  if (m.emissive) {
    m.emissive.copy(m.color);
    m.emissiveIntensity = e;
  }
  m.userData.vwBase = { color: source.color.clone(), emissive: m.emissive ? source.emissive.clone() : null, emissiveIntensity: source.emissiveIntensity };
  m.userData.vwLit = { color: m.color.clone(), emissive: m.emissive ? m.emissive.clone() : null, emissiveIntensity: e };
  return m;
}

// `authored` optionally supplies {geometry, material, yOffset} per tier from the glb items, whose
// origin sits at the bottom of the mesh rather than its centre.
export function createItemInstancer(parent, capacity, authored) {
  const meshes = [];
  const counts = new Int32Array(TIERS.length);
  const lift = new Float32Array(TIERS.length);
  const baseLift = new Float32Array(TIERS.length);
  // A bottom-origin mesh must not be tilted: it would swing off the belt instead of turning on it.
  const tiltMul = new Float32Array(TIERS.length).fill(1);
  let sizeMul = FX.enabled ? FX.item.scale : 1;

  for (let i = 0; i < TIERS.length; i += 1) {
    const model = authored && authored[i];
    if (model) { baseLift[i] = model.yOffset || 0; tiltMul[i] = 0; }
    lift[i] = baseLift[i] + (FX.enabled ? FX.item.lift : 0);
    const mesh = new THREE.InstancedMesh(
      model ? model.geometry : tierGeometry(i),
      model ? brightenItemMaterial(model.material, i) : tierMaterial(i),
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

  // Flips the whole legibility pass on or off in place — same meshes, same pools, same draw calls,
  // only the size, the height off the belt and the material tuning change.
  function setEnabled(on) {
    sizeMul = on ? FX.item.scale : 1;
    for (let i = 0; i < TIERS.length; i += 1) {
      lift[i] = baseLift[i] + (on ? FX.item.lift : 0);
      const m = meshes[i] && meshes[i].material;
      const tune = m && m.userData && (on ? m.userData.vwLit : m.userData.vwBase);
      if (!tune) continue;
      m.color.copy(tune.color);
      if (m.emissive && tune.emissive) m.emissive.copy(tune.emissive);
      if (tune.emissiveIntensity !== undefined) m.emissiveIntensity = tune.emissiveIntensity;
    }
  }

  return {
    meshes,
    setEnabled,
    begin() { counts.fill(0); },
    push(t, x, y, z, spin, tilt, scale) {
      const n = counts[t];
      if (n >= capacity) return;
      const tl = tilt * tiltMul[t];
      _e.set(tl, spin, tl * 0.6);
      _q.setFromEuler(_e);
      _p.set(x, y + lift[t], z);
      const sc = scale * sizeMul;
      _s.set(sc, sc, sc);
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

// The part instancer is now rebuilt EVERY frame on which something is reacting (a sell pad taking a
// sale, a furnace fusing), not only when the factory changes shape, because that is what lets a
// primitive-parts building animate without owning a mesh of its own. Two consequences drove the
// rewrite below:
//
//   1. It must not allocate. The old push() did `matrix.clone()` into a per-frame array, which at
//      60 Hz and ~850 parts is a garbage firehose. Each pool now owns one Float32Array that IS the
//      InstancedBufferAttribute's storage, and `matrix.toArray(data, offset)` writes straight into
//      it — zero objects per frame.
//   2. It must be able to make ONE instance brighter without splitting the pool. A second material
//      would be a second draw call; `instanceColor` is a per-instance vertex attribute on the same
//      draw call. Every instance carries a scalar glow (1 = untouched), so the sell pad can flare
//      while the identical accent strip on a vault next to it does not.
export function createPartInstancer(parent, geometries, materials, markTransparent) {
  const pools = new Map();

  function alloc(p, capacity) {
    p.capacity = capacity;
    p.data = new Float32Array(capacity * 16);
    p.tint = new Float32Array(capacity * 3).fill(1);
  }

  function pool(geoName, matName) {
    const key = `${geoName}|${matName}`;
    let p = pools.get(key);
    if (!p) {
      p = { key, geoName, matName, capacity: 0, count: 0, mesh: null, data: null, tint: null };
      alloc(p, 64);
      pools.set(key, p);
    }
    return p;
  }

  function ensure(p) {
    if (p.mesh && p.mesh.instanceMatrix.array === p.data) return;
    if (p.mesh) { parent.remove(p.mesh); p.mesh.dispose(); }
    const material = materials[p.matName];
    const mesh = new THREE.InstancedMesh(geometries[p.geoName], material, p.capacity);
    // Hand the pool's own arrays to the attributes rather than copying into three's: the rebuild
    // then writes directly at the storage the renderer uploads from.
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(p.data, 16);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(p.tint, 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
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

  function grow(p, want) {
    const capacity = Math.max(p.capacity * 2, want + 8);
    const data = p.data;
    const tint = p.tint;
    alloc(p, capacity);
    p.data.set(data);
    p.tint.set(tint);
  }

  return {
    pools,
    begin() { for (const p of pools.values()) p.count = 0; },
    // `glow` multiplies this instance's albedo. Undefined means 1, i.e. exactly what the material says.
    push(geoName, matName, matrix, glow) {
      const p = pool(geoName, matName);
      if (p.count + 1 > p.capacity) grow(p, p.count + 1);
      const n = p.count;
      matrix.toArray(p.data, n * 16);
      const g = glow === undefined ? 1 : glow;
      const c = n * 3;
      p.tint[c] = g;
      p.tint[c + 1] = g;
      p.tint[c + 2] = g;
      p.count = n + 1;
    },
    end() {
      for (const p of pools.values()) {
        ensure(p);
        p.mesh.count = p.count;
        p.mesh.instanceMatrix.needsUpdate = true;
        p.mesh.instanceColor.needsUpdate = true;
      }
    },
    dispose() {
      for (const p of pools.values()) if (p.mesh) { parent.remove(p.mesh); p.mesh.dispose(); }
      pools.clear();
    },
  };
}

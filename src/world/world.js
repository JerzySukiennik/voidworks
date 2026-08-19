// Voidworks — world assembly: owns the building graph, the flow sim, the economy and the starter factory.

import * as THREE from 'three';
import { GRID, FLOW, ECONOMY, AUDIO, FX } from '../config.js';
import { createGrid, dirBetween, turnLeft, turnRight } from './grid.js';
import { BUILDINGS, ITEM_MODELS, GEOMETRIES, MATERIALS, PANE_MATERIALS, LIGHT_MATERIALS, getDef, paneColorFor, isBeltLike, isSwitch, hasFilter } from './buildings.js';
import { TIERS } from './items.js';
import { createFlow } from './belt.js';
import { createItemInstancer, createPartInstancer, createLabelPool } from '../render/instancing.js';
import { createEconomy } from '../sim/economy.js';
import { createTicker } from '../sim/tick.js';
import { createPlacement } from '../build/placement.js';
import { createOrders } from '../sim/orders.js';
import { applyUpgradeSave, carryUpgrade, upgradeRefund, onUpgradeApplied, setUpgradeLevel, upgradeLevels } from '../sim/upgrades.js';

const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _axis = new THREE.Vector3(0, 1, 0);

// assets/models/manifest.json lists the glb basenames that actually exist, so a missing model never
// costs a 404. Anything not listed silently falls back to the primitive parts.
async function loadModels(wanted) {
  const cache = new Map();
  let found = [];
  try {
    const res = await fetch('assets/models/manifest.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      found = (data.models || []).map((n) => String(n).replace(/\.glb$/, '')).filter((n) => wanted.has(n));
    }
  } catch { /* no manifest: primitives everywhere */ }
  if (!found.length) return cache;
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    await Promise.all(found.map(async (id) => {
      try {
        const gltf = await loader.loadAsync(`assets/models/${id}.glb`);
        // Only the pieces cargo actually rides get a running surface. A dropper's rubber trim is
        // the same material NAME but a different material instance per glb, so this cannot leak.
        const runs = id.startsWith('belt') || id.startsWith('upgrader');
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          if (runs) patchBeltMaterial(o.material);
        });
        cache.set(id, gltf.scene);
      } catch { /* keep the primitive */ }
    }));
  } catch { /* loader unavailable, keep primitives */ }
  return cache;
}

// --- the belts actually run ---------------------------------------------------
// The single hardest constraint on "make it look alive" here is that the factory already costs
// ~2000 draw calls from 1146 meshes (work/PERF-PROTOCOL.md), so a running belt may not be a new
// object, a new material or a per-belt update. It is one shader patch on the SHARED glb band
// material plus four uniform objects that every patched material holds BY REFERENCE — so a
// thousand belts scroll for the price of one float write per frame, and zero draw calls.
const beltTime = { value: 0 };
const beltGain = { value: FX.enabled ? FX.belt.gain : 0 };
const beltFreq = { value: FX.belt.frequency };
const beltSpeed = { value: FX.belt.speed };
const beltSharp = { value: FX.belt.sharpness };

const BAND_GLSL = `
	float vwPhase = (vwLocal.x * vwFreq - vwTime * vwSpeed) * 6.2831853;
	float vwBand = pow(0.5 + 0.5 * sin(vwPhase), vwSharp);
	gl_FragColor.rgb += vwBand * vwGain;
`;

function patchBeltMaterial(m) {
  if (!m || !m.name || m.userData.vwScroll) return;
  if (FX.belt.materials.indexOf(m.name) < 0) return;
  m.userData.vwScroll = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.vwTime = beltTime;
    shader.uniforms.vwGain = beltGain;
    shader.uniforms.vwFreq = beltFreq;
    shader.uniforms.vwSpeed = beltSpeed;
    shader.uniforms.vwSharp = beltSharp;
    // The stripe travels along the mesh's LOCAL +X, which the model contract fixes as "forward",
    // so one patch is correct for every rotation of every belt without any per-instance data.
    shader.vertexShader = `varying vec3 vwLocal;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\tvwLocal = position;',
    );
    let frag = `uniform float vwTime;\nuniform float vwGain;\nuniform float vwFreq;\nuniform float vwSpeed;\nuniform float vwSharp;\nvarying vec3 vwLocal;\n${shader.fragmentShader}`;
    // Added after tone mapping and the transfer function on purpose: the band is lin 0.031, so a
    // change large enough to READ in the display image is tiny in scene-linear and would be eaten.
    if (frag.indexOf('#include <dithering_fragment>') >= 0) {
      frag = frag.replace('#include <dithering_fragment>', `${BAND_GLSL}\n\t#include <dithering_fragment>`);
    } else {
      // three moved the chunk: append rather than silently render an unpatched belt.
      const cut = frag.lastIndexOf('}');
      frag = `${frag.slice(0, cut)}${BAND_GLSL}\n}`;
    }
    shader.fragmentShader = frag;
  };
  // three's default cache key is onBeforeCompile.toString(), which already separates patched from
  // unpatched materials, so the patched belts get their own program and nothing else is disturbed.
  m.needsUpdate = true;
}

// One mesh + one material per item tier, lifted straight out of the glb for InstancedMesh.
// The authored origin sits at the bottom of the mesh, so it rests on the belt at GRID.beltY.
function itemModelTable(models) {
  const table = [];
  for (let i = 0; i < ITEM_MODELS.length; i += 1) {
    const scene = models.get(ITEM_MODELS[i]);
    if (!scene) continue;
    let mesh = null;
    scene.traverse((o) => { if (!mesh && o.isMesh && o.geometry) mesh = o; });
    if (!mesh) continue;
    table[i] = { geometry: mesh.geometry, material: mesh.material, yOffset: -FLOW.itemLift };
  }
  return table;
}

export async function createWorld(view, orbit) {
  const root = new THREE.Group();
  root.name = 'world';
  view.scene.add(root);

  const partsGroup = new THREE.Group();
  const modelGroup = new THREE.Group();
  const fxGroup = new THREE.Group();
  const itemGroup = new THREE.Group();
  root.add(partsGroup, modelGroup, fxGroup, itemGroup);

  const grid = createGrid();
  const economy = createEconomy();
  const orders = createOrders({ economy });

  const wanted = new Set(ITEM_MODELS);
  for (const d of BUILDINGS) if (d.model) wanted.add(d.model);
  const models = await loadModels(wanted);

  const instancer = createItemInstancer(itemGroup, ECONOMY.capacityMax, itemModelTable(models));

  // ITEMS.tiers[].color had drifted well away from what the glb materials actually are — slag and
  // iron in particular were listed several stops lighter than they render, which is how iron ended
  // up reading as a missing asset while the config insisted it was near-white. The meshes are what
  // the player sees, so the meshes win: the tier table is written back from the instancer's own
  // materials at load. The config literals carry the same values, so this is a guard against future
  // drift rather than a hidden override, and a tier with no glb keeps its configured colour.
  function syncTierColours() {
    if (!FX.syncTierColours) return;
    for (let i = 0; i < TIERS.length; i += 1) {
      const mesh = instancer.meshes[i];
      const tune = mesh && mesh.material && mesh.material.userData && mesh.material.userData.vwLit;
      if (!tune) continue;
      TIERS[i].color = `#${tune.color.getHexString()}`;
    }
  }
  syncTierColours();
  const partInst = createPartInstancer(partsGroup, GEOMETRIES, MATERIALS, view.markTransparent);
  const labels = createLabelPool(fxGroup, FLOW.labelPool, view.camera);
  // The renderer keeps see-through objects out of its occlusion g-buffer; opt ours in explicitly.
  view.markTransparent?.(fxGroup);
  const buildings = new Map();

  const flow = createFlow({
    grid,
    economy,
    instancer,
    buildings,
    capacity: () => economy.capacity,
    onUpgrade,
    onDrop,
    onSell,
  });

  // The Delivery Pad needs BOTH channels: the credit hook and the live "what is wanted" set. Handing
// setDeliverHook the orders object wires both; the arrow form only wired the credit, which left the
// pad accepting everything at the plain rate — inert, not broken, and easy to miss.
flow.setDeliverHook(orders);

  const lightGeo = new THREE.BoxGeometry(1, 1, 1);

  let uid = 0;
  let partsDirty = true;
  // True while any primitive-parts building is mid-reaction, i.e. while the part instancer has to be
  // rebuilt on this frame as well as on build changes. An idle factory leaves it false and the whole
  // FX system costs one loop over the building map.
  let fxLoud = false;
  // The FX master switch. Declared here rather than beside setFxEnabled() because rebuildParts()
  // reads it and runs during construction, before that point in the file.
  let fxOn = FX.enabled;
  let saveTimer = 0;
  let time = 0;
  let benchBuilt = false;
  let showcase = false;
  const paneOwners = new Map();
  const lightOwners = [];

  // --- sound: fired from the sim hot loop, so one scratch options object, never a new one -----
  // The audio module does its own voice limiting and coalescing; everything here is optional-chained
  // so the game still boots and plays with the audio piece or its files absent.

  const _sfx = { pos: { x: 0, y: 0, z: 0 }, tier: 0 };

  function sfx(id, x, y, z, tier) {
    const a = api.audio;
    if (!a) return;
    if (a.at) { a.at(id, x, y, z, tier || 0); return; }
    if (!a.play) return;
    _sfx.pos.x = x;
    _sfx.pos.y = y;
    _sfx.pos.z = z;
    _sfx.tier = tier || 0;
    a.play(id, _sfx);
  }

  // Strength maps onto whatever rungs the upgrade family currently has, so the ladder can grow
  // past a/b/c without this needing to know the ids.
  const UPGRADE_LADDER = Object.keys(AUDIO.sounds).filter((k) => k.startsWith('upgrade-')).sort();

  function upgradeSound(def) {
    const n = UPGRADE_LADDER.length;
    if (!n) return null;
    const s = def.sfxStrength === undefined ? 0.5 : def.sfxStrength;
    return UPGRADE_LADDER[Math.max(0, Math.min(n - 1, Math.floor(s * n)))];
  }

  function onDrop(b, tierIdx) {
    sfx('dropper', b.cx, GRID.beltY + 0.5, b.cz, tierIdx);
  }

  // --- the sell pad reacts in proportion to what landed on it ------------------
  // This fires many times a second at 200+ items, so it must not allocate and must not queue: it
  // writes two numbers on the building the sim already handed us. Intensity is a LOG map of value,
  // because sale values span 10 (slag) to tens of thousands (an upgraded singularite) and a linear
  // map would make everything below the top tier a flat nothing. Repeat sales coalesce naturally —
  // the envelope is simply re-armed, and the louder of the two amplitudes wins for what is left of
  // the first one's decay, so a slag landing can never stamp on a singularite's flare.
  const SELL_LO = Math.log(Math.max(1, FX.sell.lo));
  const SELL_SPAN = Math.log(Math.max(FX.sell.lo + 1, FX.sell.hi)) - SELL_LO;

  function sellIntensity(value) {
    const u = (Math.log(Math.max(1, value)) - SELL_LO) / SELL_SPAN;
    return FX.sell.base + FX.sell.gain * Math.max(0, Math.min(1, u));
  }

  function onSell(b, value, tierIdx) {
    sfx(economy.isBigSale(value) ? 'sell-big' : 'sell', b.cx + 0.5, GRID.beltY, b.cz + 0.5, tierIdx);
    const amp = sellIntensity(value);
    // The pad's envelope is `fxSell`, owned here, NOT the sim's `flash`. It has to be: the sim
    // re-arms flash to 1 immediately before calling this, so by the time we are asked "is a louder
    // flare still running?" the evidence has already been overwritten. `fxAmp * fxSell` is what the
    // pad is displaying at this instant, read before re-arming — so a slag landing during a
    // singularite's flare is absorbed by it, and the same slag landing on a pad at rest gets its
    // own (small) reaction instead of being silently swallowed.
    if (amp >= b.fxAmp * b.fxSell) b.fxAmp = amp;
    b.fxSell = 1;
    fxLoud = true;
  }

  // --- labels: pooled, coalesced, and only for gains worth reading -------------

  function onUpgrade(b, gain, destroyed) {
    if (destroyed) {
      sfx('destroy', b.cx, GRID.beltY + 0.4, b.cz, 0);
      return;
    }
    const id = upgradeSound(b.def);
    // the ladder takes a strength, not a tier: a stronger gate rings higher on the same scale
    if (id) sfx(id, b.cx, GRID.beltY + 0.6, b.cz, Math.round((b.def.sfxStrength || 0) * 6));
    if (gain < ECONOMY.labelMinGain) return;
    labels.emit(b, gain, b.cx + 0.1, GRID.beltY + 1.0, b.cz, paneColorFor(b.def.upg), '+$');
  }

  // --- authored meshes: two upgrader bodies, tinted per definition -------------
  // The glb ships a `pane` slot with its blending already right, so we clone it once per definition
  // and only write colour and emissive, exactly as the model contract asks.
  const paneMats = new Map(PANE_MATERIALS);
  let tintDef = null;

  function tintPane(o) {
    if (!o.isMesh || !o.material || o.material.name !== 'pane') return;
    let m = paneMats.get(tintDef.id);
    if (!m || m.userData.primitivePane) {
      m = o.material.clone();
      m.name = 'pane';
      // Colour and emissive only: alpha, blending and side belong to the exported material.
      const c = new THREE.Color(paneColorFor(tintDef.upg));
      m.color.copy(c);
      if (m.emissive) m.emissive.copy(c);
      paneMats.set(tintDef.id, m);
    }
    o.material = m;
    o.castShadow = false;
    // A see-through sheet written into the occlusion g-buffer as solid depth becomes a black smear.
    view.markTransparent?.(o);
  }

  for (const m of PANE_MATERIALS.values()) m.userData.primitivePane = true;

  // --- building lifecycle -----------------------------------------------------

  function place(defId, cx, cz, rot, opts) {
    const def = typeof defId === 'string' ? getDef(defId) : defId;
    if (!def) return null;
    const r = def.rotatable ? (rot | 0) & 3 : 0;
    if (!grid.fits(def, cx, cz, r)) return null;
    const free = opts && opts.free;
    if (free) economy.free(def);
    else if (!economy.charge(def)) return null;

    const b = {
      uid: ++uid, def, cx, cz, rot: r, lanes: [], flash: 0, timer: 0,
      store: null, outLane: null, model: null, light: null, stalled: false,
      // --- scene life. `flash` is the envelope: the sim spikes it to 1 (or 0.5) on every event and
      // animateFx is the only thing that decays it. `fxAmp` scales how loud that event is allowed
      // to be — the sell pad sets it from the item's value, everything else leaves it at 1.
      // `fxMoved` remembers whether this building's transform is currently displaced, so an idle
      // factory writes no transforms at all, and so a reaction can be undone exactly once.
      fxAmp: 1, fxSell: 0, fxMoved: false, modelY0: def.modelY || 0,
    };
    if (def.model && models.has(def.model)) {
      const m = models.get(def.model).clone(true);
      const off = def.modelOffset;
      const c0 = Math.cos(r * Math.PI * 0.5);
      const s0 = Math.sin(r * Math.PI * 0.5);
      m.position.set(cx + off[0] * c0 + off[1] * s0, def.modelY || 0, cz - off[0] * s0 + off[1] * c0);
      m.rotation.y = ((r + (def.modelRot || 0)) & 3) * Math.PI * 0.5;
      if (def.pane) { tintDef = def; m.traverse(tintPane); }
      modelGroup.add(m);
      b.model = m;
    }
    if (def.pane) {
      let list = paneOwners.get(def.id);
      if (!list) { list = []; paneOwners.set(def.id, list); }
      list.push(b);
    }
    if (def.light) {
      const mesh = new THREE.Mesh(lightGeo, LIGHT_MATERIALS.ok);
      const cos = Math.cos(r * Math.PI * 0.5);
      const sin = Math.sin(r * Math.PI * 0.5);
      const lx = def.light.p[0];
      const lz = def.light.p[2];
      mesh.position.set(cx + lx * cos + lz * sin, def.light.p[1], cz - lx * sin + lz * cos);
      mesh.scale.set(def.light.s[0], def.light.s[1], def.light.s[2]);
      fxGroup.add(mesh);
      b.light = mesh;
      lightOwners.push(b);
    }
    buildings.set(b.uid, b);
    grid.occupy(b);
    flow.add(b);
    partsDirty = true;
    boundsDirty = true;
    return b;
  }

  function remove(b, opts) {
    if (!b || !buildings.has(b.uid)) return false;
    grid.release(b);
    flow.remove(b);
    buildings.delete(b.uid);
    if (b.model) modelGroup.remove(b.model);
    if (b.light) {
      fxGroup.remove(b.light);
      const i = lightOwners.indexOf(b);
      if (i >= 0) lightOwners.splice(i, 1);
    }
    if (b.def.pane) {
      const list = paneOwners.get(b.def.id);
      const i = list ? list.indexOf(b) : -1;
      if (i >= 0) list.splice(i, 1);
    }
    if (!opts || !opts.free) { economy.refund(b.def); economy.money += upgradeRefund(b, economy); }
    partsDirty = true;
    boundsDirty = true;
    return true;
  }

  // --- swap in place -----------------------------------------------------------
  // Dropping an upgrader into a belt run has to Just Work. A single-cell belt-family piece landing
  // on another single-cell belt-family piece on the same deck swaps: the run's connections come back
  // from the relink, the items riding that tile are carried over rather than binned, and the player
  // pays exactly what delete-then-place would have cost.

  function replaceTarget(def, cx, cz, rot) {
    if (!def || !isBeltLike(def) || def.cells.length !== 1 || def.levels.length !== 1) return null;
    const old = grid.at(cx, cz, def.levels[0]);
    if (!old || !isBeltLike(old.def)) return null;
    if (old.def.cells.length !== 1 || old.def.levels.length !== 1) return null;
    if (old.def.levels[0] !== def.levels[0]) return null;
    const r = def.rotatable ? (rot | 0) & 3 : 0;
    if (old.def.id === def.id && old.rot === r) return null;
    return old;
  }

  function canReplace(def, cx, cz, rot) {
    const old = replaceTarget(def, cx, cz, rot);
    if (!old) return false;
    return economy.money + economy.refundValue(old.def) >= economy.priceOf(def);
  }

  function replace(def, cx, cz, rot) {
    const old = replaceTarget(def, cx, cz, rot);
    if (!old) return null;
    if (economy.money + economy.refundValue(old.def) < economy.priceOf(def)) return null;
    const carried = flow.detach(old);
    const prev = { def: old.def, cx: old.cx, cz: old.cz, rot: old.rot };
    const purse = economy.money;
    remove(old);
    const b = place(def, cx, cz, rot);
    if (!b) {
      // Put the run back exactly as it was — same piece, same items, same bank balance. A swap that
      // did not happen must leave no trace, or it becomes a way to print money by failing.
      const back = place(prev.def, prev.cx, prev.cz, prev.rot, { free: true });
      economy.money = purse;
      if (back) flow.attach(back, carried);
      return null;
    }
    // `remove(old)` above ran the paid path, so it has ALREADY handed back half the upgrade spend.
    // That is right for a genuine swap to a different machine, and wrong for a rotate-in-place: the
    // levels ride along to the new piece, so keeping the refund as well would pay the player for
    // upgrades they still own — a rotate would print money. carryUpgrade returns 0 when the
    // definition ids differ, so it selects the branch, and the same-def branch takes the refund back.
    const refunded = upgradeRefund(old, economy);
    if (carryUpgrade(old, b)) economy.money -= refunded;
    flow.attach(b, carried);
    return b;
  }

  function removeAt(x, z, level) {
    const b = level === undefined ? grid.anyAt(x, z) : grid.at(x, z, level);
    return b ? remove(b) : false;
  }

  function clearAll() {
    for (const b of Array.from(buildings.values())) remove(b, { free: true });
    grid.clear();
    flow.clear();
    economy.reset();
    orders.reset();
    benchBuilt = false;
    partsDirty = true;
    boundsDirty = true;
  }

  // --- path laying ------------------------------------------------------------

  // One curve tile, four rotations. A corner joins two faces and does not care which way items run
  // through it, so a right turn is the same tile as a left turn — just rotated onto the other pair.
  function pieceFor(inDir, outDir, base, sky) {
    const turn = sky ? 'belt_sky_turn' : 'belt_turn';
    if (outDir === inDir || outDir < 0) return { id: base, rot: inDir };
    if (outDir === turnLeft(inDir)) return { id: turn, rot: inDir };
    if (outDir === turnRight(inDir)) return { id: turn, rot: turnRight(inDir) };
    return { id: base, rot: inDir };
  }

  function planRun(cells, straightId) {
    const base = straightId && getDef(straightId) && getDef(straightId).family === 'belt' ? straightId : 'belt';
    const plan = [];
    for (let i = 0; i < cells.length; i += 1) {
      const cur = cells[i];
      const prev = cells[i - 1];
      const next = cells[i + 1];
      let inDir = prev
        ? dirBetween(prev[0], prev[1], cur[0], cur[1])
        : (next ? dirBetween(cur[0], cur[1], next[0], next[1]) : 0);
      if (inDir < 0) inDir = 0;
      const outDir = next ? dirBetween(cur[0], cur[1], next[0], next[1]) : inDir;
      const sky = (getDef(base).levels || [0])[0] === 1;
      const piece = pieceFor(inDir, outDir, base, sky);
      plan.push({ id: piece.id, cx: cur[0], cz: cur[1], rot: piece.rot });
    }
    return plan;
  }

  function layRun(cells, opts) {
    const plan = planRun(cells, opts && opts.straightId);
    let n = 0;
    for (const step of plan) if (place(step.id, step.cx, step.cz, step.rot, opts)) n += 1;
    return n;
  }

  function layPath(cells, specials, opts) {
    let i = 0;
    while (i < cells.length) {
      const cur = cells[i];
      const next = cells[i + 1];
      const prev = cells[i - 1];
      let inDir = prev
        ? dirBetween(prev[0], prev[1], cur[0], cur[1])
        : dirBetween(cur[0], cur[1], next[0], next[1]);
      if (inDir < 0) inDir = 0;
      const spec = specials && specials.get(i);
      if (spec) {
        const d = getDef(spec);
        if (d && place(d, cur[0], cur[1], inDir, opts)) {
          i += d.cells.length > 1 ? 2 : 1;
          continue;
        }
      }
      const outDir = next ? dirBetween(cur[0], cur[1], next[0], next[1]) : inDir;
      const piece = pieceFor(inDir, outDir, 'belt');
      place(piece.id, cur[0], cur[1], piece.rot, opts);
      i += 1;
    }
  }

  // --- parts instancing -------------------------------------------------------

  // The sell pad, the furnace and the vault have no glb of their own: they are primitive parts in
  // the shared instancer. That is exactly why they can react for free — a reaction is a different
  // matrix and a different per-instance tint in a pool that was being submitted anyway. `_fx` is a
  // module-level scratch object so reading a building's reaction allocates nothing.
  const _fx = { s: 1, dy: 0, glow: 1 };
  const FX_IDLE = { s: 1, dy: 0, glow: 1 };

  function partFx(b) {
    if (!fxOn) return FX_IDLE;
    if (b.def.family === 'sell') {
      if (b.fxSell <= 0) return FX_IDLE;
      const a = b.fxAmp * b.fxSell;
      _fx.s = 1 + FX.sell.swell * a;
      _fx.dy = -FX.sell.dip * a;
      // Pushed past 1 deliberately: above roughly 2.6x the pad's green clears the bloom threshold,
      // which is the difference between "a pad lit up" and "something valuable just landed".
      _fx.glow = 1 + FX.sell.glow * a;
      return _fx;
    }
    const e = b.flash;
    if (e > 0 && b.def.fuse) {
      _fx.s = 1 + FX.furnace.swell * e;
      _fx.dy = -FX.furnace.dip * e;
      _fx.glow = 1 + FX.furnace.glow * e;
      return _fx;
    }
    return FX_IDLE;
  }

  function rebuildParts() {
    partInst.begin();
    for (const b of buildings.values()) {
      const list = b.model ? b.def.modelExtras : b.def.parts;
      if (!list || !list.length) continue;
      const ang = (b.rot & 3) * Math.PI * 0.5;
      _qy.setFromAxisAngle(_axis, ang);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const fx = partFx(b);
      const k = fx.s;
      for (const p of list) {
        const lx = p.p[0];
        const lz = p.p[2];
        // Scaled about the building's own base centre, so a reacting pad grows off the deck it
        // sits on rather than sinking through where a floor would be if this game had one.
        _p.set(b.cx + (lx * cos + lz * sin) * k, p.p[1] * k + fx.dy, b.cz + (-lx * sin + lz * cos) * k);
        _e.set(p.r[0], p.r[1], p.r[2]);
        _q.setFromEuler(_e).premultiply(_qy);
        _s.set(p.s[0] * k, p.s[1] * k, p.s[2] * k);
        _m.compose(_p, _q, _s);
        partInst.push(p.g, p.m, _m, fx.glow);
      }
    }
    partInst.end();
    partsDirty = false;
  }

  // --- starter factory ---------------------------------------------------------
  // There isn't one. The player builds the first loop with their own hands.

  // The menu needs something to look at, and an empty void is not a hero shot. This is scenery, not a
  // head start: `start()` wipes it before the player ever touches it, so nobody is handed a factory.
  function buildShowcase() {
    const free = { free: true };
    const rows = [-2, 0, 2];
    rows.forEach((z, i) => {
      place(i === 1 ? 'dropper_ore' : 'dropper_scrap', -7, z, 0, free);
      for (let x = -6; x <= -3; x += 1) place('belt', x, z, 0, free);
      place(i === 1 ? 'mul_15' : 'add_stamp', -2, z, 0, free);
      place('belt', -1, z, 0, free);
      layRun([[0, z], [0, z + (z < 0 ? 1 : -1)]], { straightId: 'belt', free: true });
    });
    for (let x = 1; x <= 3; x += 1) place('belt', x, 0, 0, free);
    place('sellpad', 4, 0, 0, free);
    showcase = true;
  }

  function buildStarter() {
    // Deliberately empty. Jurek's call: the player starts with nothing but the void and just enough
    // money to buy the first loop themselves — two conveyors, a sell pad and a dropper. Handing
    // someone a finished factory teaches them nothing and hands them the interesting decisions
    // already made. `startMoney` is derived from those four prices so the two can never drift apart.
  }


  // Bench-only expansion: debugSpawn(n) needs real belt to put n items on.
  function buildBench(target) {
    if (benchBuilt) return;
    benchBuilt = true;
    const free = { free: true };
    const path = [];
    const x0 = -15;
    const x1 = 11;
    const rows = 6;
    for (let r = 0; r < rows; r += 1) {
      const z = 5 + r * 2;
      if (r % 2 === 0) {
        for (let x = x0; x <= x1; x += 1) path.push([x, z]);
        if (r < rows - 1) path.push([x1, z + 1]);
      } else {
        for (let x = x1; x >= x0; x -= 1) path.push([x, z]);
        if (r < rows - 1) path.push([x0, z + 1]);
      }
    }
    const w = x1 - x0 + 1;
    const specials = new Map([
      [5, 'add_tack'], [12, 'add_stamp'], [19, 'mul_125'],
      [w + 8, 'add_plate'], [w * 2 + 10, 'mul_15'], [w * 3 + 12, 'mul_2'],
    ]);
    place('dropper_deep', -18, 4, 0, free);
    place('belt_turn', -16, 4, 3, free);
    place('belt_turn', -16, 5, 3, free);
    layPath(path, specials, free);
    place('sellpad', -17, 15, 0, free);
    flow.relink();
    economy.grantCapacity(Math.min(ECONOMY.capacityMax, target));
  }

  // Cached floating bounds for the camera's framing control; invalidated on every build change.
  const _box = new THREE.Box3();
  const _boxOut = new THREE.Box3();
  const _cells = [];
  let boundsDirty = true;

  function defHeight(d) {
    if (d.height === undefined) {
      let h = 0.5;
      for (const p of d.parts) h = Math.max(h, p.p[1] + Math.abs(p.s[1]) * 0.5);
      d.height = h;
    }
    return d.height;
  }

  // Always hands back a fresh copy: the camera re-frames several times a second, and if it padded
  // the cached box in place the factory would appear to shrink a little on every tick.
  function bounds() {
    if (!boundsDirty) return _boxOut.copy(_box);
    boundsDirty = false;
    if (!buildings.size) {
      _box.min.set(-2, 0, -2);
      _box.max.set(2, 1.2, 2);
      return _boxOut.copy(_box);
    }
    _box.makeEmpty();
    for (const b of buildings.values()) {
      grid.footprint(b.def, b.cx, b.cz, b.rot, _cells);
      const top = defHeight(b.def);
      for (let i = 0; i < _cells.length; i += 2) {
        _box.expandByPoint(_p.set(_cells[i] - 0.5, 0, _cells[i + 1] - 0.5));
        _box.expandByPoint(_p.set(_cells[i] + 0.5, top, _cells[i + 1] + 0.5));
      }
    }
    return _boxOut.copy(_box);
  }

  function laneCapacity() {
    let total = 0;
    for (const l of flow.lanes()) total += l.len;
    return Math.floor(total / FLOW.itemSpacing);
  }

  // Buildings that no longer exist under the name a save used. `belt_turn_l` / `belt_turn_r` were
  // merged into one rotating `belt_turn`: the left variant WAS the base mesh, so it keeps its
  // rotation, while the right variant is the same corner turned one quarter on (turnRight is d+3).
  // Without this a pre-merge save hit the unknown id below, the WHOLE save was discarded, and the
  // player was silently handed the menu showcase instead of their own factory.
  const LEGACY = {
    belt_turn_l: { id: 'belt_turn', turn: 0 },
    belt_turn_r: { id: 'belt_turn', turn: 3 },
    belt_sky_turn_l: { id: 'belt_sky_turn', turn: 0 },
    belt_sky_turn_r: { id: 'belt_sky_turn', turn: 3 },
  };

  function migrate(id, rot) {
    const m = LEGACY[id];
    if (!m) return { id, rot };
    return { id: m.id, rot: (((rot | 0) + m.turn) & 3) };
  }

  function restore(data) {
    let skipped = 0;
    for (const entry of data.b) {
      const [rawId, cx, cz, rawRot, state] = entry;
      const { id, rot } = migrate(rawId, rawRot);
      // One unrecognised building must never cost the player everything else they built.
      if (!getDef(id)) { skipped += 1; continue; }
      const b = place(id, cx, cz, rot, { free: true });
      // Hand-set state (a Switch's arm, a pad's material) is restored through the sim's own setters
      // rather than by assigning the field, so the lane bookkeeping that depends on it is rebuilt too.
      if (b && state !== undefined) {
        if (isSwitch(b.def)) flow.setSwitch(b, state | 0);
        else if (hasFilter(b.def)) flow.setFilter(b, state | 0);
      }
    }
    if (skipped) console.warn(`[voidworks] save restored with ${skipped} unknown building(s) skipped`);
    applyUpgradeSave(data.u, buildings.values());
    economy.applyLoaded(data);
    flow.relink();
    return buildings.size > 0;
  }

  const fresh = new URLSearchParams(location.search).has('fresh');
  const saved = fresh ? null : economy.load();
  let restored = false;
  if (saved) {
    try { restored = restore(saved); } catch { restored = false; }
    if (!restored) clearAll();
  }
  // A brand-new player meets scenery, not an empty page; `start()` wipes it before play.
  if (!restored) buildShowcase();

  // --- simulation -------------------------------------------------------------

  function step(dt) {
    flow.update(dt);
    economy.tick(dt, flow.count >= economy.capacity);
    orders.update(dt);
  }

  const ticker = createTicker(1 / ECONOMY.tickRate, step);

  // --- scene life: one pass, no objects, no draw calls -------------------------
  // Every machine in the game reacts through an envelope that decays here and NOWHERE else, so
  // there is exactly one place where "how long does a reaction last" is decided. For most machines
  // that envelope is the sim's own `b.flash`, which it re-arms on every event (drop, upgrade, fuse,
  // filter change). The sell pad is the exception and owns `b.fxSell` instead — see onSell for why
  // sharing `flash` made value-scaling impossible.
  //
  // What a reaction is allowed to be, in order of preference and cost:
  //   1. a shared uniform            — the belt band, one write for the whole factory
  //   2. a shared material property  — the upgrader panes, one write per definition
  //   3. an instance attribute       — the sell pad and furnace, inside a pool already submitted
  //   4. a transform on a mesh that already exists — droppers and upgrader bodies
  // None of the four adds an object or a draw call, which matters because the measured wall in
  // this game is draw-call submission, not geometry (work/PERF-PROTOCOL.md).

  function decayFor(def) {
    if (def.family === 'dropper') return FX.dropper.decay;
    if (def.family === 'upgrader') return FX.upgrader.decay;
    if (def.family === 'sell') return FX.sell.decay;
    if (def.fuse) return FX.furnace.decay;
    return FX.upgrader.decay;
  }

  // Puts one building's mesh back exactly where the build system placed it. Called when its
  // envelope reaches zero and when the whole FX system is switched off, so a disabled or idle
  // factory is bit-identical to the pre-FX one rather than merely close to it.
  function restModel(b) {
    if (!b.model) return;
    b.model.position.y = b.modelY0;
    b.model.scale.set(1, 1, 1);
    b.fxMoved = false;
  }

  function animateMachine(b, e) {
    const m = b.model;
    if (!m) return;
    const fam = b.def.family;
    if (fam === 'dropper') {
      // A stamp press: it punches down on the frame it emits and springs back out of it.
      const q = FX.dropper.squash * e;
      m.position.y = b.modelY0 - FX.dropper.dip * e;
      m.scale.set(1 + q * 0.5, 1 - q, 1 + q * 0.5);
      b.fxMoved = true;
    } else if (fam === 'upgrader') {
      // The pane already flares; this makes the body flex with it so a fired gate MOVES as well as
      // glows, which is what reads at the distance the camera actually sits at.
      const k = 1 + FX.upgrader.swell * e;
      m.scale.set(k, k, k);
      b.fxMoved = true;
    }
  }

  function animateFx(dt) {
    beltTime.value += dt;
    // Kept bounded: a session measured in hours would otherwise walk the phase into float ranges
    // where the stripe visibly quantises. The period is 1/frequency world units of travel.
    if (beltTime.value > 4096) beltTime.value -= 4096;

    fxLoud = false;
    for (const b of buildings.values()) {
      if (b.fxSell > 0) {
        b.fxSell -= dt * FX.sell.decay;
        // One extra rebuild AT zero so the pad lands back on its exact resting matrix and tint
        // rather than a frame short of it.
        if (b.fxSell <= 0) { b.fxSell = 0; b.fxAmp = 1; }
        fxLoud = true;
      }
      if (b.flash > 0) {
        b.flash -= dt * decayFor(b.def);
        if (b.flash <= 0) {
          b.flash = 0;
          b.fxAmp = 1;
          if (b.fxMoved) restModel(b);
          // One last rebuild so the pad lands back at its exact resting matrix and tint.
          if (!b.model) fxLoud = true;
          continue;
        }
        if (fxOn) {
          animateMachine(b, b.flash);
          if (!b.model) fxLoud = true;
        }
      }
    }

    for (const [id, list] of paneOwners) {
      const m = paneMats.get(id);
      if (!m) continue;
      let peak = 0;
      for (let i = 0; i < list.length; i += 1) {
        const f = list[i].flash;
        if (f > peak) peak = f;
      }
      if (!fxOn) peak = 0;
      m.emissiveIntensity = FX.upgrader.emissiveBase + peak * FX.upgrader.emissiveGain;
      m.opacity = FX.upgrader.opacityBase + peak * FX.upgrader.opacityGain;
    }

    for (let i = 0; i < lightOwners.length; i += 1) {
      const b = lightOwners[i];
      const want = b.stalled ? LIGHT_MATERIALS.stalled : LIGHT_MATERIALS.ok;
      if (b.light.material !== want) b.light.material = want;
    }
    labels.update(dt, FLOW.labelLife, FLOW.labelRise);
  }

  // --- the master switch -------------------------------------------------------
  // Exists so the A/B in work/tools/fxtest.mjs happens inside ONE page load against ONE scene,
  // rather than across two launches of a machine whose GPU clock drifts by 3x (PERF-PROTOCOL rule 3).
  function setFxEnabled(on) {
    fxOn = !!on;
    beltGain.value = fxOn ? FX.belt.gain : 0;
    instancer.setEnabled(fxOn);
    for (const b of buildings.values()) {
      if (b.fxMoved) restModel(b);
      if (!fxOn) { b.fxSell = 0; b.fxAmp = 1; }
    }
    partsDirty = true;
    return fxOn;
  }

  // --- what co-op has to mirror -----------------------------------------------
  // The network layer imports nothing from here on purpose (it also runs headless), so the three
  // calls it needs live on this side, where the upgrade ladder and the building flags already are.
  function netState(b) {
    if (isSwitch(b.def)) return flow.switchOf(b);
    if (hasFilter(b.def)) return b.filterTier;
    return undefined;
  }

  function applyNetState(b, state, level) {
    if (state !== undefined) {
      if (isSwitch(b.def)) flow.setSwitch(b, state);
      else if (hasFilter(b.def)) flow.setFilter(b, state);
    }
    if (level !== undefined && upgradeLevels(b) !== level) setUpgradeLevel(b, level);
  }

  const api = {
    root,
    grid,
    netState,
    applyNetState,
    netLevel: upgradeLevels,
    onUpgradeApplied,
    economy,
    flow,
    buildings,
    catalogue: BUILDINGS,
    view,
    orbit,

    get money() { return economy.money; },
    set money(v) { economy.money = v; },
    get income() { return economy.rate; },
    get moneyPerSecond() { return economy.rate; },
    get itemCount() { return flow.count; },
    get itemCap() { return economy.capacity; },
    get itemCapMax() { return ECONOMY.capacityMax; },
    get stalled() { return flow.count >= economy.capacity; },
    get belts() { return flow.lanes(); },
    get time() { return time; },

    bounds,
    getModel: (name) => (name && models.has(name) ? models.get(name) : null),
    place,
    replace,
    canReplace,
    remove,
    removeAt,
    planRun,
    layRun,
    clearAll,
    priceOf: (d) => economy.priceOf(typeof d === 'string' ? getDef(d) : d),
    orders,
    prestige() {
      // Jurek's call: singleplayer only. In a room the shared bank overwrites local money every
      // snapshot, so one client resetting is undefined — it would either desync the bank or hand this
      // player a multiplier paid for by income other people's sales are mixed into.
      if (api.net && api.net.active) return { refused: 'coop' };
      const res = economy.prestige();
      if (!res) return null;
      clearAll();
      economy.save(Array.from(buildings.values()));
      return res;
    },
    capacityPrice: () => economy.capacityPrice(),
    buyCapacity: () => economy.buyCapacity(),

    start(kind) {
      // Scenery is not a save: whatever the menu was showing is wiped before play begins, on
      // 'continue' as well as 'new', or the player would inherit a factory they never built.
      if (showcase) { clearAll(); showcase = false; }
      if (kind === 'new') {
        economy.wipe();
        clearAll();
        buildStarter();
        placement.clearUndo?.();
      }
      return true;
    },

    buildShowcase,
    get isShowcase() { return showcase; },

    // Scene life, exposed for the harness: setEnabled(false) restores the pre-FX look in place.
    fx: {
      setEnabled: setFxEnabled,
      get enabled() { return fxOn; },
      get loud() { return fxLoud; },
      sellIntensity,
      beltPhase: () => beltTime.value,
      // The very function reference the flow sim is handed as its onSell callback — not a copy and
      // not a test-only path. work/tools/fxtest.mjs fires the pad through this with an explicit
      // value so the reaction can be measured at a chosen point on the value curve, which watching
      // real sales cannot do.
      onSell,
    },

    debugSpawn(n) {
      const want = n | 0 || 1;
      const need = flow.count + want;
      if (laneCapacity() < need + 20) buildBench(need + 60);
      economy.grantCapacity(Math.min(ECONOMY.capacityMax, need + 20));
      return flow.spawnBurst(want);
    },

    save() { return economy.save(Array.from(buildings.values())); },

    update(dt) {
      time += dt;
      ticker.update(dt);
      // animateFx runs BEFORE the parts rebuild because it is what decides whether a rebuild is
      // needed this frame: a pad mid-reaction sets fxLoud, an idle factory leaves it false and the
      // instancer is not touched at all.
      animateFx(dt);
      if (partsDirty || fxLoud) rebuildParts();
      flow.draw(time);
      // The belt bed follows how many belts are actually carrying. audio.belts() is idempotent, so
      // this just states the current count every frame.
      api.audio?.belts?.(flow.runningLanes);
      placement.update(dt);
      saveTimer += dt;
      if (!benchBuilt && saveTimer >= ECONOMY.autosaveSeconds) {
        saveTimer = 0;
        economy.save(Array.from(buildings.values()));
      }
    },

    dispose() {
      placement.dispose();
      labels.dispose();
      instancer.dispose();
      partInst.dispose();
      view.scene.remove(root);
    },
  };

  const placement = createPlacement({ world: api, view, orbit, grid, economy });
  api.select = placement.select;
  api.selected = () => placement.selected();
  api.rotate = placement.rotate;
  api.setDelete = placement.setDelete;
  api.placement = placement;

  rebuildParts();

  return api;
}

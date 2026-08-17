// Voidworks — world assembly: owns the building graph, the flow sim, the economy and the starter factory.

import * as THREE from 'three';
import { GRID, FLOW, ECONOMY, AUDIO } from '../config.js';
import { createGrid, dirBetween, turnLeft, turnRight } from './grid.js';
import { BUILDINGS, ITEM_MODELS, GEOMETRIES, MATERIALS, PANE_MATERIALS, LIGHT_MATERIALS, getDef, paneColorFor, isBeltLike } from './buildings.js';
import { createFlow } from './belt.js';
import { createItemInstancer, createPartInstancer, createLabelPool } from '../render/instancing.js';
import { createEconomy } from '../sim/economy.js';
import { createTicker } from '../sim/tick.js';
import { createPlacement } from '../build/placement.js';

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
        gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        cache.set(id, gltf.scene);
      } catch { /* keep the primitive */ }
    }));
  } catch { /* loader unavailable, keep primitives */ }
  return cache;
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

  const wanted = new Set(ITEM_MODELS);
  for (const d of BUILDINGS) if (d.model) wanted.add(d.model);
  const models = await loadModels(wanted);

  const instancer = createItemInstancer(itemGroup, ECONOMY.capacityMax, itemModelTable(models));
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

  const lightGeo = new THREE.BoxGeometry(1, 1, 1);

  let uid = 0;
  let partsDirty = true;
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

  function onSell(b, value, tierIdx) {
    sfx(economy.isBigSale(value) ? 'sell-big' : 'sell', b.cx + 0.5, GRID.beltY, b.cz + 0.5, tierIdx);
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
    if (!opts || !opts.free) economy.refund(b.def);
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

  function rebuildParts() {
    partInst.begin();
    for (const b of buildings.values()) {
      const list = b.model ? b.def.modelExtras : b.def.parts;
      if (!list || !list.length) continue;
      const ang = (b.rot & 3) * Math.PI * 0.5;
      _qy.setFromAxisAngle(_axis, ang);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      for (const p of list) {
        const lx = p.p[0];
        const lz = p.p[2];
        _p.set(b.cx + lx * cos + lz * sin, p.p[1], b.cz - lx * sin + lz * cos);
        _e.set(p.r[0], p.r[1], p.r[2]);
        _q.setFromEuler(_e).premultiply(_qy);
        _s.set(p.s[0], p.s[1], p.s[2]);
        _m.compose(_p, _q, _s);
        partInst.push(p.g, p.m, _m);
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

  function restore(data) {
    for (const entry of data.b) {
      const [id, cx, cz, rot] = entry;
      if (!getDef(id)) return false;
      place(id, cx, cz, rot, { free: true });
    }
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
    economy.tick(dt);
  }

  const ticker = createTicker(1 / ECONOMY.tickRate, step);

  function animateFx(dt) {
    for (const [id, list] of paneOwners) {
      const m = paneMats.get(id);
      if (!m) continue;
      let peak = 0;
      for (let i = 0; i < list.length; i += 1) {
        const b = list[i];
        if (b.flash > 0) { b.flash = Math.max(0, b.flash - dt * 3.4); if (b.flash > peak) peak = b.flash; }
      }
      m.emissiveIntensity = 0.55 + peak * 2.1;
      m.opacity = 0.5 + peak * 0.28;
    }
    for (let i = 0; i < lightOwners.length; i += 1) {
      const b = lightOwners[i];
      const want = b.stalled ? LIGHT_MATERIALS.stalled : LIGHT_MATERIALS.ok;
      if (b.light.material !== want) b.light.material = want;
    }
    labels.update(dt, FLOW.labelLife, FLOW.labelRise);
  }

  const api = {
    root,
    grid,
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
      }
      return true;
    },

    buildShowcase,
    get isShowcase() { return showcase; },

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
      if (partsDirty) rebuildParts();
      flow.draw(time);
      animateFx(dt);
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

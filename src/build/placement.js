// Voidworks — placement UX: ghost preview, validity, rotate, click-drag belt runs, delete with refund.

import * as THREE from 'three';
import { BUILD, GRID } from '../config.js';
import { createPicker, dirBetween, inBounds } from '../world/grid.js';
import { getDef, paneColorFor } from '../world/buildings.js';
import { makeGhost, paintGhost, ghostMaterials } from './ghost.js';

const MAX_RUN = 64;

export function createPlacement(ctx) {
  const { world, view, orbit, grid, economy } = ctx;
  const dom = view.renderer.domElement;
  const picker = createPicker(view.camera);

  const layer = new THREE.Group();
  layer.name = 'placement';
  world.root.add(layer);

  const _hit = new THREE.Vector3();

  // Positional build feedback goes through the allocation-free path; a refusal is flat, so it has
  // no position at all. All optional-chained: the build tools work with the audio piece absent.
  const _sfx = { pos: { x: 0, y: GRID.beltY, z: 0 } };

  function sfx(id, x, z) {
    const a = world.audio;
    if (!a) return;
    if (id === 'denied') { a.play?.('denied'); return; }
    if (a.at) { a.at(id, x, GRID.beltY, z); return; }
    if (!a.play) return;
    _sfx.pos.x = x;
    _sfx.pos.z = z;
    a.play(id, _sfx);
  }

  function pickCell(clientX, clientY, out, lvl) {
    if (orbit && orbit.screenToGround) {
      const p = orbit.screenToGround(clientX, clientY, lvl ? BUILD.levelRise : 0, _hit);
      if (!p) return null;
      out.x = Math.round(p.x);
      out.z = Math.round(p.z);
      out.wx = p.x;
      out.wz = p.z;
      return inBounds(out.x, out.z) ? out : null;
    }
    return picker.pick(clientX, clientY, out, lvl);
  }

  const ghostMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(BUILD.ghostValid),
    transparent: true,
    opacity: BUILD.ghostOpacity,
    depthWrite: false,
    roughness: 0.5,
    emissive: new THREE.Color(BUILD.ghostValid),
    emissiveIntensity: 0.25,
  });
  const badMat = ghostMat.clone();
  badMat.color.set(BUILD.ghostInvalid);
  badMat.emissive.set(BUILD.ghostInvalid);

  const gmats = ghostMaterials();

  const markerGeo = new THREE.BoxGeometry(0.86, 0.1, 0.86);
  const markers = [];
  for (let i = 0; i < MAX_RUN; i += 1) {
    const m = new THREE.Mesh(markerGeo, ghostMat);
    m.visible = false;
    m.castShadow = false;
    layer.add(m);
    markers.push(m);
  }

  const helper = makeHelper();
  helper.visible = false;
  layer.add(helper);

  // Everything in here is see-through; keep the whole layer out of the occlusion g-buffer so a
  // ghost never smears black across the factory it is hovering over.
  const noAO = (o) => view.markTransparent?.(o);
  noAO(layer);

  const ghostCache = new Map();
  let ghost = null;
  let def = null;
  let rot = 0;
  let deleteMode = false;
  let valid = false;
  const cell = { x: 0, z: 0, wx: 0, wz: 0 };
  const upCell = { x: 0, z: 0, wx: 0, wz: 0 };
  const ptr = { x: 0, y: 0 };
  let hasCell = false;
  let dragging = false;
  let dragFrom = null;
  const runCells = [];
  const listeners = [];

  function makeHelper() {
    const r = BUILD.helperRadius;
    const pts = [];
    for (let i = -r; i <= r; i += 1) {
      pts.push(-r, 0, i, r, 0, i);
      pts.push(i, 0, -r, i, 0, r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({ color: 0x1a1d22, transparent: true, opacity: BUILD.helperFade, depthWrite: false });
    const lines = new THREE.LineSegments(g, m);
    lines.renderOrder = -1;
    return lines;
  }

  function ghostFor(d) {
    let g = ghostCache.get(d.id);
    if (!g) {
      g = makeGhost(d, world, gmats);
      g.visible = false;
      layer.add(g);
      noAO(g);
      ghostCache.set(d.id, g);
    }
    return g;
  }

  function level() { return def ? def.levels[0] : 0; }

  function select(id) {
    if (id === 'delete') { deleteMode = true; def = null; }
    else {
      deleteMode = false;
      const d = typeof id === 'string' ? getDef(id) : id;
      def = d || null;
      if (def && !def.rotatable) rot = 0;
    }
    if (ghost) ghost.visible = false;
    ghost = def ? ghostFor(def) : null;
    hideRun();
    return def ? def.id : (deleteMode ? 'delete' : null);
  }

  function hideRun() {
    for (let i = 0; i < markers.length; i += 1) markers[i].visible = false;
    runCells.length = 0;
  }

  function refreshValidity() {
    if (!def || !hasCell) { valid = false; return; }
    if (grid.fits(def, cell.x, cell.z, rot)) { valid = economy.canAfford(def); return; }
    // Not empty is not the same as not allowed: a belt-family piece landing on a belt swaps in.
    valid = world.canReplace(def, cell.x, cell.z, rot);
  }

  function updateGhost() {
    if (!ghost || !hasCell) { if (ghost) ghost.visible = false; helper.visible = false; return; }
    ghost.visible = !dragging;
    ghost.position.set(cell.x, level() * BUILD.levelRise, cell.z);
    ghost.rotation.y = rot * Math.PI * 0.5;
    paintGhost(ghost, gmats, valid);
    helper.visible = true;
    helper.position.set(cell.x, level() * BUILD.levelRise + 0.002, cell.z);
  }

  function planPath(a, b) {
    const cells = [];
    let x = a.x;
    let z = a.z;
    cells.push([x, z]);
    while (x !== b.x && cells.length < MAX_RUN) { x += Math.sign(b.x - x); cells.push([x, z]); }
    while (z !== b.z && cells.length < MAX_RUN) { z += Math.sign(b.z - z); cells.push([x, z]); }
    return cells;
  }

  // Dragging back over a tile that is already the piece you asked for is a no-op, not a refusal —
  // it stays green, and the commit simply leaves it alone.
  function alreadyIs(b, want, rot) {
    return !!b && b.def === want && b.rot === (want.rotatable ? (rot | 0) & 3 : 0);
  }

  function showRun(cells) {
    const plan = world.planRun(cells, def ? def.id : 'belt');
    runCells.length = 0;
    for (let i = 0; i < markers.length; i += 1) {
      const m = markers[i];
      if (i >= plan.length) { m.visible = false; continue; }
      const step = plan[i];
      const occupied = grid.at(step.cx, step.cz, level());
      // Green means this tile WILL change: empty, or a belt this run is going to swap. A tile the
      // run would silently skip has to look refused, or the preview is lying about the gesture.
      const want = getDef(step.id);
      const ok = !occupied ? true : (alreadyIs(occupied, want, step.rot) || world.canReplace(want, step.cx, step.cz, step.rot));
      m.visible = true;
      m.material = ok && inBounds(step.cx, step.cz) ? ghostMat : badMat;
      m.position.set(step.cx, GRID.beltY + level() * BUILD.levelRise + 0.06, step.cz);
      runCells.push(step);
    }
  }

  function commitRun() {
    if (!runCells.length) return 0;
    let n = 0;
    let last = null;
    for (const step of runCells) {
      const occupied = grid.at(step.cx, step.cz, level());
      if (occupied) {
        if (alreadyIs(occupied, getDef(step.id), step.rot)) continue;
        if (world.replace(getDef(step.id), step.cx, step.cz, step.rot)) { n += 1; last = step; }
        continue;
      }
      if (world.place(step.id, step.cx, step.cz, step.rot)) { n += 1; last = step; }
    }
    // One run is one gesture: a single confirmation, not one per tile.
    if (n) sfx('place', last.cx, last.cz);
    else sfx('denied', cell.x, cell.z);
    hideRun();
    return n;
  }

  function placeHere() {
    if (!def || !hasCell) return null;
    // One click, one result: onto empty ground it places, onto a belt of the same family it swaps.
    const b = world.place(def, cell.x, cell.z, rot) || world.replace(def, cell.x, cell.z, rot);
    sfx(b ? 'place' : 'denied', cell.x, cell.z);
    return b;
  }

  // Anything placed can be removed. The upper deck is a second occupancy level that the ground plane
  // pick knows nothing about, so a delete probes the deck first — it is drawn on top, so it is what
  // the pointer looks like it is over — and falls through to the ground cell underneath.
  function deleteTarget() {
    const up = pickCell(ptr.x, ptr.y, upCell, 1);
    if (up) {
      const above = grid.at(up.x, up.z, 1);
      if (above) return above;
    }
    return grid.at(cell.x, cell.z, 0) || grid.at(cell.x, cell.z, 1);
  }

  function deleteHere() {
    if (!hasCell) return false;
    const target = deleteTarget();
    const gone = target ? world.remove(target) : false;
    sfx(gone ? 'remove' : 'denied', cell.x, cell.z);
    return gone;
  }

  function rotate(dir) {
    rot = (rot + (dir || 1) + 4) & 3;
    if (def && !def.rotatable) rot = 0;
    if (def) sfx('rotate', cell.x, cell.z);
    refreshValidity();
    updateGhost();
    return rot;
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  const active = () => !!def || deleteMode;

  // The camera owns left-drag; it hands it over while a build tool is up rather than us fighting it.
  if (orbit && orbit.setDragBlocker) orbit.setDragBlocker((e) => active() && (!e || e.button === 0 || e.button === 2));

  on(window, 'pointermove', (e) => {
    if (!active()) return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    const hit = pickCell(e.clientX, e.clientY, cell, level());
    hasCell = !!hit;
    refreshValidity();
    if (dragging && dragFrom && def && def.family === 'belt') showRun(planPath(dragFrom, cell));
    updateGhost();
  }, true);

  on(window, 'pointerdown', (e) => {
    if (!active()) return;
    if (e.target !== dom) return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    hasCell = !!pickCell(e.clientX, e.clientY, cell, level());
    if (!hasCell) return;
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      deleteHere();
      return;
    }
    if (e.button !== 0) return;
    e.stopPropagation();
    if (deleteMode) { deleteHere(); return; }
    if (BUILD.dragLay && def.family === 'belt') {
      dragging = true;
      dragFrom = { x: cell.x, z: cell.z };
      showRun([[cell.x, cell.z]]);
      updateGhost();
      return;
    }
    refreshValidity();
    if (valid) placeHere();
    else sfx('denied', cell.x, cell.z);
    refreshValidity();
    updateGhost();
  }, true);

  on(window, 'pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    dragFrom = null;
    e.stopPropagation();
    commitRun();
    refreshValidity();
    updateGhost();
  }, true);

  on(dom, 'contextmenu', (e) => { if (active()) e.preventDefault(); });

  on(window, 'keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') { rotate(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Escape') { select(null); return; }
    if (e.key === 'x' || e.key === 'Delete') select(deleteMode ? null : 'delete');
  });

  return {
    layer,
    select,
    rotate,
    selected: () => (deleteMode ? 'delete' : (def ? def.id : null)),
    setDelete(on2) { select(on2 ? 'delete' : null); },
    get rot() { return rot; },
    get valid() { return valid; },
    get cell() { return cell; },
    paneColorFor,
    update() {
      if (!active()) { if (ghost) ghost.visible = false; helper.visible = false; hideRun(); return; }
      refreshValidity();
      updateGhost();
    },
    dispose() {
      for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
      listeners.length = 0;
      world.root.remove(layer);
    },
  };
}

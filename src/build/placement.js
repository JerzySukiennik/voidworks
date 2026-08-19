// Voidworks — placement UX: ghost preview, validity, rotate, click-drag belt runs, delete with
// refund, and the undo stack.

import * as THREE from 'three';
import { BUILD, GRID, UNDO } from '../config.js';
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

  // A wireframe box, not a filled ghost: it has to read as "this is going away", not "this is landing".
  const delBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: BUILD.ghostInvalid, transparent: true, opacity: 0.9, depthTest: false }),
  );
  delBox.visible = false;
  delBox.renderOrder = 7;
  layer.add(delBox);

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
  // Three separate things, deliberately not one flag:
  //   pendingLay — the left button is down with a belt tool, but the pointer has not left the cell it
  //                pressed on, so this gesture is still a CLICK and lays exactly one tile.
  //   dragging   — the pointer has crossed into another cell: now it is a run, and the run planner
  //                owns the facing of every tile so corners can auto-curve.
  //   rightDown  — the right button is down; it becomes a camera pan the moment it moves, and an
  //                inspect only if it never does.
  let pendingLay = false;
  let dragging = false;
  let dragFrom = null;
  let rightDown = false;
  let rightMoved = false;
  let pressX = 0;
  let pressY = 0;
  const runCells = [];
  const listeners = [];
  const inspectCbs = [];

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

  // Delete is the one build action with no preview of its own: you point at a factory and something
  // vanishes. The outline says exactly which thing, before you commit to losing it.
  function updateDeleteOutline() {
    const target = deleteMode && hasCell ? deleteTarget() : null;
    if (!target) { delBox.visible = false; return; }
    const d = target.def;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const ang = (target.rot & 3) * Math.PI * 0.5;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    for (const c of d.cells) {
      const x = target.cx + c[0] * cos + c[1] * sin;
      const z = target.cz - c[0] * sin + c[1] * cos;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const y = (d.levels[0] || 0) * BUILD.levelRise;
    delBox.position.set((minX + maxX) * 0.5, y + BUILD.deleteBoxY, (minZ + maxZ) * 0.5);
    delBox.scale.set(maxX - minX + 1.02, BUILD.deleteBoxH, maxZ - minZ + 1.02);
    delBox.visible = true;
  }

  function updateGhost() {
    updateDeleteOutline();
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
    // planRun derives facing from the PATH, which is right for a run and wrong for a single tile: with
    // no previous and no next cell it has nothing to derive from and falls back to rot 0, silently
    // throwing away the rotation the player picked with R. A one-tile run is a click, and a click's
    // only source of facing is the ghost.
    if (plan.length === 1 && def) {
      plan[0].id = def.id;
      plan[0].rot = def.rotatable ? (rot & 3) : 0;
    }
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

  // --- undo -------------------------------------------------------------------
  // One entry per PLAYER GESTURE, not per grid cell: a dragged run of twenty belts is one action and
  // comes back out in one keystroke. Each entry is a list of primitive ops plus the exact money the
  // gesture moved.
  //
  // Money is restored as a DELTA, never as a snapshot. Setting the purse back to what it held before
  // the click would also erase every dollar the factory earned in between — an idle game where undo
  // rewinds your income is worse than no undo at all. Subtracting what the gesture itself cost or
  // refunded restores the gesture exactly and leaves the sim's earnings alone. With no time passing
  // between a place and its undo, the two are identical, which is what G10 measures.
  //
  // CO-OP: undo is refused outright. The two things it must restore are both shared — the bank is a
  // single balance settled by transactions against a remote node, and the grid is claimed cell by
  // cell by every client at once. A local rewind of the purse would either desync the bank or hand
  // this player money that another player's income has already been mixed into, and a cell you
  // cleared may already have someone else's building standing on it. Scoping to "actions I own and
  // still hold" fixes the grid half and does nothing for the money half, so it would be an undo that
  // silently only half works. A clear refusal is the honest version. (UNDO.coop in config.js.)

  const undoStack = [];
  let recording = null;
  let lastRefusal = null;

  function coopBlocked() {
    return !UNDO.coop && !!(world.net && world.net.active);
  }

  // world.remove(b, {free:true}) deliberately skips economy.refund(), which is also the only thing
  // that walks the price curve back down. An undo settles money itself, so it has to do that half by
  // hand or every undone placement would leave the next copy of that building permanently dearer.
  function countsDown(defId) {
    const c = economy.counts;
    const n = c.get(defId) || 0;
    if (n > 0) c.set(defId, n - 1);
  }

  function opPlaced(b) {
    return { k: 'place', uid: b.uid, defId: b.def.id, cx: b.cx, cz: b.cz, rot: b.rot };
  }

  // Everything needed to stand this piece back up byte for byte, including its filter setting — a
  // Sorter or Contract Pad that came back pointed at the wrong material would be a grid restored in
  // shape but not in state.
  function opRemoved(b) {
    return { k: 'delete', defId: b.def.id, cx: b.cx, cz: b.cz, rot: b.rot, filter: b.filterTier };
  }

  function beginAction() {
    recording = { ops: [], money0: economy.money };
  }

  function record(op) { if (recording) recording.ops.push(op); }

  function endAction() {
    const a = recording;
    recording = null;
    if (!a || !a.ops.length) return null;
    a.moneyDelta = economy.money - a.money0;
    undoStack.push(a);
    while (undoStack.length > UNDO.depth) undoStack.shift();
    return a;
  }

  function restorePiece(op) {
    const b = world.place(op.defId, op.cx, op.cz, op.rot, { free: true });
    if (b && op.filter !== undefined) b.filterTier = op.filter;
    return b;
  }

  function undo() {
    if (coopBlocked()) {
      lastRefusal = 'Undo is off in co-op: the bank and the grid are shared, so one client cannot rewind them.';
      return { ok: false, reason: lastRefusal };
    }
    const a = undoStack.pop();
    if (!a) {
      lastRefusal = 'Nothing to undo.';
      return { ok: false, reason: lastRefusal };
    }
    const ops = a.ops;

    // Phase 0 — everything this gesture BUILT must still be standing, and still be the same piece.
    // Anything else (a later swap, a delete, a network mirror) means the world has moved on and this
    // entry no longer describes a reversible step.
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i];
      if (op.k !== 'place') continue;
      const b = world.buildings.get(op.uid);
      if (!b || b.def.id !== op.defId) {
        undoStack.push(a);
        lastRefusal = 'That build has already been changed.';
        return { ok: false, reason: lastRefusal };
      }
    }

    // Phase 1 — take them back out, free: money is settled once, at the end, by the delta.
    const pulled = [];
    for (let i = ops.length - 1; i >= 0; i -= 1) {
      const op = ops[i];
      if (op.k !== 'place') continue;
      const b = world.buildings.get(op.uid);
      const keep = { k: 'delete', defId: op.defId, cx: op.cx, cz: op.cz, rot: op.rot, filter: b.filterTier };
      world.remove(b, { free: true });
      countsDown(op.defId);
      pulled.push(keep);
    }

    // Phase 2 — can everything this gesture DESTROYED go back exactly where it was? Asked only after
    // phase 1, because for a swap-in-place the ground is occupied by the new piece until it is gone.
    let ok = true;
    for (let i = 0; i < ops.length && ok; i += 1) {
      const op = ops[i];
      if (op.k !== 'delete') continue;
      const d = getDef(op.defId);
      if (!d || !grid.fits(d, op.cx, op.cz, op.rot)) ok = false;
    }
    if (!ok) {
      // Put back exactly what phase 1 took out. A refused undo must leave no trace, for the same
      // reason a failed swap must not: a half-applied rewind is a way to lose buildings for free.
      for (let i = pulled.length - 1; i >= 0; i -= 1) restorePiece(pulled[i]);
      undoStack.push(a);
      lastRefusal = 'Something else is standing where that used to be.';
      return { ok: false, reason: lastRefusal };
    }

    for (let i = ops.length - 1; i >= 0; i -= 1) {
      const op = ops[i];
      if (op.k === 'delete') restorePiece(op);
    }

    economy.money -= a.moneyDelta;
    world.flow.markDirty();
    lastRefusal = null;
    hideRun();
    refreshValidity();
    updateGhost();
    return { ok: true, ops: ops.length, money: -a.moneyDelta };
  }

  function commitRun() {
    if (!runCells.length) return 0;
    let n = 0;
    let last = null;
    // The whole drag is recorded as ONE action, so twenty tiles undo in one keystroke — the gesture
    // the player made was "lay this run", not "place a belt" twenty times.
    beginAction();
    for (const step of runCells) {
      const occupied = grid.at(step.cx, step.cz, level());
      if (occupied) {
        if (alreadyIs(occupied, getDef(step.id), step.rot)) continue;
        // A swap is a delete and a place; recorded as both so the undo puts the old piece back with
        // its own rotation rather than merely clearing the cell.
        const before = opRemoved(occupied);
        const swapped = world.replace(getDef(step.id), step.cx, step.cz, step.rot);
        if (swapped) { record(before); record(opPlaced(swapped)); n += 1; last = step; }
        continue;
      }
      const b = world.place(step.id, step.cx, step.cz, step.rot);
      if (b) { record(opPlaced(b)); n += 1; last = step; }
    }
    endAction();
    // One run is one gesture: a single confirmation, not one per tile.
    if (n) sfx('place', last.cx, last.cz);
    else sfx('denied', cell.x, cell.z);
    hideRun();
    return n;
  }

  function placeHere() {
    if (!def || !hasCell) return null;
    // One click, one result: onto empty ground it places, onto a belt of the same family it swaps.
    // The swap is also how rotate-in-place happens — same def, different rot — so recording the
    // outgoing piece here is what makes a rotation undoable back to its original facing.
    const standing = grid.at(cell.x, cell.z, level());
    beginAction();
    let b = world.place(def, cell.x, cell.z, rot);
    if (b) record(opPlaced(b));
    else {
      const before = standing ? opRemoved(standing) : null;
      b = world.replace(def, cell.x, cell.z, rot);
      if (b) {
        if (before) record(before);
        record(opPlaced(b));
      }
    }
    endAction();
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
    // Snapshotted BEFORE the removal: afterwards the building has been unhooked from the grid and
    // its rotation and filter setting are only still readable off the object by luck.
    const before = target ? opRemoved(target) : null;
    beginAction();
    const gone = target ? world.remove(target) : false;
    if (gone && before) record(before);
    endAction();
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

  // --- inspect hook -----------------------------------------------------------
  // Right-CLICK on a placed building asks for its panel. Right-DRAG is the camera's pan and always
  // has been, so the two are told apart by how far the pointer travelled between press and release —
  // never by the button alone. Delete does NOT live here any more: it is the X key and the trash
  // tool, which is how the factory has always actually been torn down.
  function onInspect(cb) {
    if (typeof cb !== 'function') return () => {};
    inspectCbs.push(cb);
    return () => {
      const i = inspectCbs.indexOf(cb);
      if (i >= 0) inspectCbs.splice(i, 1);
    };
  }

  // Safe with nobody listening, and one listener throwing must not eat the others or the gesture.
  function emitInspect(b) {
    for (let i = 0; i < inspectCbs.length; i += 1) {
      try { inspectCbs[i](b); } catch (err) { console.warn('[placement] inspect listener failed', err); }
    }
  }

  function movedFar(e) {
    return Math.hypot(e.clientX - pressX, e.clientY - pressY) > BUILD.clickSlop;
  }

  // The camera owns left-drag; it hands it over while a build tool is up rather than us fighting it.
  // Right-drag is NEVER blocked — panning with it is the existing camera contract.
  if (orbit && orbit.setDragBlocker) orbit.setDragBlocker((e) => active() && (!e || e.button === 0));

  on(window, 'pointermove', (e) => {
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    if (rightDown && !rightMoved && movedFar(e)) rightMoved = true;
    // The hovered cell is tracked even with no build tool selected: F retargets whatever machine is
    // under the pointer, and requiring a tool in hand to change a sorter's material would be absurd.
    // One ray-plane intersection per pointer move — the same one the ghost already pays for.
    const hit = pickCell(e.clientX, e.clientY, cell, level());
    hasCell = !!hit;
    if (!active()) return;
    refreshValidity();
    // The gesture graduates from click to drag the moment it reaches a different cell — that is
    // exactly when a path exists to derive facings from, and not one pointermove sooner.
    if (pendingLay && !dragging && dragFrom && (cell.x !== dragFrom.x || cell.z !== dragFrom.z)) dragging = true;
    if (dragging && dragFrom && def && def.family === 'belt') showRun(planPath(dragFrom, cell));
    updateGhost();
  }, true);

  on(window, 'pointerdown', (e) => {
    if (e.target !== dom) return;
    // Right press is tracked whether or not a build tool is up: inspecting a machine must not require
    // holding one. It swallows nothing, so the camera still receives it and can pan.
    if (e.button === 2) {
      rightDown = true;
      rightMoved = false;
      pressX = e.clientX;
      pressY = e.clientY;
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      hasCell = !!pickCell(e.clientX, e.clientY, cell, level());
      return;
    }
    if (!active()) return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    hasCell = !!pickCell(e.clientX, e.clientY, cell, level());
    if (!hasCell) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    if (deleteMode) { deleteHere(); return; }
    if (BUILD.dragLay && def.family === 'belt' && !def.noDrag) {
      // Armed, not yet dragging: the ghost stays up showing the chosen facing, and no run markers
      // appear until the gesture actually becomes a run.
      pendingLay = true;
      dragging = false;
      dragFrom = { x: cell.x, z: cell.z };
      pressX = e.clientX;
      pressY = e.clientY;
      refreshValidity();
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
    if (e.button === 2) {
      if (!rightDown) return;
      rightDown = false;
      // It panned the camera. A pan is not a request to open anything.
      if (rightMoved || movedFar(e)) { rightMoved = false; return; }
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      hasCell = !!pickCell(e.clientX, e.clientY, cell, level());
      const target = hasCell ? deleteTarget() : null;
      // Empty space opens nothing — a panel that pops up over the void is noise, not information.
      if (target) emitInspect(target);
      return;
    }
    if (pendingLay && !dragging) {
      // One click, one tile, the player's own rotation — routed through placeHere so a click onto an
      // existing belt still swaps in place (which is how rotate-in-place works) and still records a
      // single undoable action.
      pendingLay = false;
      dragFrom = null;
      e.stopPropagation();
      hasCell = !!pickCell(e.clientX, e.clientY, cell, level());
      hideRun();
      refreshValidity();
      if (valid) placeHere();
      else sfx('denied', cell.x, cell.z);
      refreshValidity();
      updateGhost();
      return;
    }
    if (!dragging) return;
    dragging = false;
    pendingLay = false;
    dragFrom = null;
    e.stopPropagation();
    commitRun();
    refreshValidity();
    updateGhost();
  }, true);

  // The canvas never shows the browser menu: right-click is a game gesture here in every mode.
  on(dom, 'contextmenu', (e) => e.preventDefault());

  // Typing a name into the co-op form must never build, rotate or rewind the factory.
  function typing(e) {
    const t = e.target;
    if (!t) return false;
    const tag = t.tagName ? t.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable === true;
  }

  on(window, 'keydown', (e) => {
    if (typing(e)) return;
    // Cmd+Z on a Mac, Ctrl+Z everywhere else. Shift is excluded so a future redo can claim it.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      const r = undo();
      sfx(r.ok ? 'remove' : 'denied', cell.x, cell.z);
      if (!r.ok && world.onUndoRefused) world.onUndoRefused(r.reason);
      return;
    }
    // F: retarget the Sorter or Contract Pad under the pointer. Shift+F walks back down the list.
    // The readout belongs to the HUD/buildbar, not here — this is only the input.
    if (e.key === 'f' || e.key === 'F') {
      const target = hasCell ? deleteTarget() : null;
      if (target && target.def.filter) {
        const t = world.flow.cycleFilter(target, e.shiftKey ? -1 : 1);
        sfx('rotate', target.cx, target.cz);
        if (world.onFilterChanged) world.onFilterChanged(target, t);
      } else sfx('denied', cell.x, cell.z);
      return;
    }
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
    // The machine under the pointer, or null. The buildbar/HUD need it to draw the filter readout.
    hovered: () => (hasCell ? deleteTarget() : null),
    // Right-click on a placed building. cb(building) — the same object world.buildings holds, so the
    // panel can read def/rot/cx/cz/filterTier off it directly. Returns an unsubscribe function.
    onInspect,
    cycleFilter: (b, dir) => world.flow.cycleFilter(b, dir),
    undo,
    canUndo: () => undoStack.length > 0 && !coopBlocked(),
    get undoDepth() { return undoStack.length; },
    get undoRefusal() { return lastRefusal; },
    // Exposed so a save restore or a prestige reset can drop a stack that no longer describes a
    // world that exists. Undoing into a wiped board would resurrect buildings from a past life.
    clearUndo() { undoStack.length = 0; lastRefusal = null; },
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

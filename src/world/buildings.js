// Voidworks — the buildable catalogue: footprints, costs, lane geometry, behaviour and primitive part lists.

import * as THREE from 'three';
import { GRID, FLOW, PALETTE, PANES, SORTER, SWITCH } from '../config.js';
import { tierColor } from './items.js';

const BY = GRID.beltY;
const RISE = FLOW.rampRise;

export const GEOMETRIES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  hex: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cone: new THREE.ConeGeometry(0.5, 1, 12),
  pyr: new THREE.ConeGeometry(0.5, 1, 4),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
  torus: new THREE.TorusGeometry(0.36, 0.11, 8, 18),
};

function mat(color, opts) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.6,
    metalness: 0.12,
    ...opts,
  });
}

export const MATERIALS = {
  steel: mat(PALETTE.steel, { roughness: 0.52, metalness: 0.28 }),
  steelDark: mat(PALETTE.steelDark, { roughness: 0.46, metalness: 0.42 }),
  steelLight: mat(PALETTE.steelLight, { roughness: 0.62, metalness: 0.1 }),
  rubber: mat('#23272e', { roughness: 0.92, metalness: 0.02 }),
  deck: mat('#15181d', { roughness: 0.95, metalness: 0.0 }),
  ink: mat(PALETTE.ink, { roughness: 0.7, metalness: 0.1 }),
  accent: mat(PALETTE.accent, { roughness: 0.38, metalness: 0.1, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.32 }),
  accentDeep: mat(PALETTE.accentDeep, { roughness: 0.44, metalness: 0.2 }),
  warn: mat(PALETTE.warn, { roughness: 0.42, metalness: 0.14, emissive: new THREE.Color(PALETTE.warn), emissiveIntensity: 0.2 }),
  rare: mat(PALETTE.rare, { roughness: 0.34, metalness: 0.2, emissive: new THREE.Color(PALETTE.rare), emissiveIntensity: 0.34 }),
  gold: mat(PALETTE.gold, { roughness: 0.3, metalness: 0.6, emissive: new THREE.Color(PALETTE.gold), emissiveIntensity: 0.18 }),
  // The sorter's decision pane. One SHARED material, deliberately: with primitives every sorter in
  // the factory draws from the same instanced batch, so it cannot carry a per-building tint. The
  // authored glb ships its own `pane` slot for that, and `filterColorFor()` below is the number the
  // renderer will feed it. Until then this stays neutral and the filtered tier is read off the UI.
  sortPane: mat(SORTER.paneColor, {
    transparent: true,
    opacity: SORTER.paneOpacity,
    depthWrite: false,
    roughness: 0.3,
    metalness: 0,
    emissive: new THREE.Color(SORTER.paneColor),
    emissiveIntensity: 0.3,
  }),
};

function part(g, m, px, py, pz, sx, sy, sz, ry, rx, rz) {
  return { g, m, p: [px, py, pz], s: [sx, sy, sz], r: [rx || 0, ry || 0, rz || 0] };
}

// --- pane colour: derived from the effect so it can never drift from the numbers ---

export function paneColorFor(u) {
  if (!u) return PANES.mult[0][1];
  if (u.kind === 'tier') return PANES.tier;
  if (u.destroy) return PANES.risky;
  const ramp = u.kind === 'flat' ? PANES.add : PANES.mult;
  const v = u.amount;
  for (let i = 0; i < ramp.length; i += 1) if (v <= ramp[i][0]) return ramp[i][1];
  return ramp[ramp.length - 1][1];
}

// --- lane geometry ------------------------------------------------------------

function lane(pts, inDir, outDir, inCell, outCell, extra) {
  return { pts, inDir, outDir, inCell, outCell, ...extra };
}

function straightPts(n, y0, y1) {
  const a = -0.5;
  const b = n - 0.5;
  const steps = y0 === y1 ? 1 : 6;
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const e = y0 === y1 ? y0 : y0 + (y1 - y0) * (u * u * (3 - 2 * u));
    out.push(a + (b - a) * u, e, 0);
  }
  return out;
}

function arcPts(cx, cz, r, a0, a1, y) {
  const n = FLOW.arcSamples;
  const out = [];
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + (a1 - a0) * (i / n);
    out.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
  }
  return out;
}

const H = Math.PI / 2;

function straightLane(n, y0, y1, extra) {
  const a = y0 === undefined ? 0 : y0;
  const b = y1 === undefined ? a : y1;
  return lane(straightPts(n, a, b), 0, 0, [0, 0], [n - 1, 0], extra);
}
const turnLeftLane = (y) => lane(arcPts(-0.5, -0.5, 0.5, H, 0, y || 0), 0, 1, [0, 0], [0, 0]);
// A corner tile joining two faces is one physical object; which way items run through it is a property
// of what feeds it, not of the geometry. Carrying both senses is what lets ONE curve, rotated four ways,
// cover every corner in the game — instead of a left and a right variant that are the same tile twice.
const turnLeftBackLane = (y) => lane(arcPts(-0.5, -0.5, 0.5, 0, H, y || 0), 1, 0, [0, 0], [0, 0]);
const turnRightLane = (y) => lane(arcPts(-0.5, 0.5, 0.5, -H, 0, y || 0), 0, 3, [0, 0], [0, 0]);
const mergeFromLeft = () => lane(arcPts(0.5, -0.5, 0.5, Math.PI, H, 0), 3, 0, [0, 0], [0, 0]);
// The two merge arms are mirror images: each is a QUARTER turn from a side face to the +X face.
// Sweeping the right-hand one to -H instead of +3H sends it the long way round — a 270 degree loop
// 2.33 long that leaves the tile entirely, which is both three times the travel and a lane that
// wanders close enough to the main line to fuse items against it.
const mergeFromRight = () => lane(arcPts(0.5, 0.5, 0.5, Math.PI, Math.PI + H, 0), 1, 0, [0, 0], [0, 0]);

function sinkLanes(cells, cx, cz, y) {
  const out = [];
  const has = (x, z) => cells.some((c) => c[0] === x && c[1] === z);
  const faces = [[1, 0, 2], [0, -1, 3], [-1, 0, 0], [0, 1, 1]];
  for (const c of cells) {
    for (const f of faces) {
      if (has(c[0] + f[0], c[1] + f[1])) continue;
      const ex = c[0] + f[0] * 0.5;
      const ez = c[1] + f[1] * 0.5;
      out.push(lane([ex, y || 0, ez, cx, y || 0, cz], f[2], -1, [c[0], c[1]], [c[0], c[1]], { sink: true }));
    }
  }
  return out;
}

// --- part builders ------------------------------------------------------------

function beltParts(len, y0, y1) {
  const out = [];
  const a = y0 || 0;
  const b = y1 === undefined ? a : y1;
  for (let i = 0; i < len; i += 1) {
    const y = a + (b - a) * (len === 1 ? 0 : i / (len - 1));
    out.push(part('box', 'steel', i, BY + y - 0.15, 0, 1.001, 0.19, 0.9));
    out.push(part('box', 'deck', i, BY + y - 0.02, 0, 1.001, 0.09, 0.78));
    out.push(part('box', 'steelDark', i, BY + y + 0.005, -0.45, 1.001, 0.1, 0.08));
    out.push(part('box', 'steelDark', i, BY + y + 0.005, 0.45, 1.001, 0.1, 0.08));
  }
  return out;
}

function cornerParts(exitZ, y) {
  const h = y || 0;
  return [
    part('box', 'steel', 0, BY + h - 0.15, 0, 0.96, 0.19, 0.96),
    part('cyl', 'deck', 0, BY + h - 0.02, 0, 0.88, 0.09, 0.88),
    part('box', 'steelDark', 0, BY + h + 0.005, -0.45 * exitZ, 0.96, 0.1, 0.08),
    part('box', 'steelDark', 0.45, BY + h + 0.005, 0, 0.08, 0.1, 0.96),
    part('cyl', 'accent', -0.24, BY + h + 0.035, exitZ * 0.24, 0.2, 0.06, 0.2),
  ];
}

// A multiplier is a tall thin gate; an adder is a low wide band. Silhouette = family.
const MULT_PANE = { y: BY + 0.48, h: 0.82, w: 0.9, t: 0.045 };
const ADD_PANE = { y: BY + 0.14, h: 0.26, w: 0.86, t: 0.055 };

function multParts() {
  return [
    ...beltParts(1),
    part('box', 'steelDark', 0, BY + 0.46, -0.46, 0.1, 0.92, 0.12),
    part('box', 'steelDark', 0, BY + 0.46, 0.46, 0.1, 0.92, 0.12),
    part('box', 'steel', 0, BY + 0.94, 0, 0.13, 0.09, 1.04),
  ];
}

function addParts() {
  return [
    ...beltParts(1),
    part('box', 'steelDark', 0, BY + 0.13, -0.45, 0.2, 0.32, 0.22),
    part('box', 'steelDark', 0, BY + 0.13, 0.45, 0.2, 0.32, 0.22),
  ];
}

function dropperParts(s, headMat) {
  return [
    part('box', 'steel', 0, 0.42, 0, 0.88 * s, 0.84, 0.88 * s),
    part('box', 'steelDark', 0, 0.06, 0, 0.94 * s, 0.14, 0.94 * s),
    part('cone', headMat, 0, 1.0, 0, 0.86 * s, 0.42, 0.86 * s, 0, Math.PI),
    part('cyl', 'ink', 0, 1.22, 0, 0.2 * s, 0.14, 0.2 * s),
    part('box', 'steelDark', 0.44 * s, 0.62, 0, 0.14, 0.22, 0.5 * s),
    part('box', 'ink', 0.5 * s, 0.3, 0, 0.1, 0.34, 0.34 * s),
  ];
}

// --- catalogue ----------------------------------------------------------------

let ORDER = 0;
function def(d) {
  return {
    levels: [0],
    cells: [[0, 0]],
    rotatable: true,
    speed: FLOW.beltSpeed,
    unlock: 0,
    order: ORDER++,
    // Per-building upgrades work by handing an upgraded building its OWN derived copy of this
    // definition (see src/sim/upgrades.js), so every stat the sim reads off `b.def` is already the
    // effective one and the hot loop needs no per-item lookup. `payMult` is the one effective stat
    // the catalogue did not previously carry: the sell pad's payout scale, 1 on every stock
    // definition, raised only on a derived copy. It lives here rather than in upgrades.js so that
    // `b.def.payMult` is a number on EVERY building, upgraded or not, and the sell path never has
    // to test for undefined.
    payMult: 1,
    ...d,
  };
}

function multiplier(id, name, amount, cost, unlock, cooldown, desc, extra) {
  return def({
    id, name, family: 'upgrader', kind: 'mult', cost, unlock, desc,
    upg: { kind: 'mult', amount, cooldown },
    lanes: [straightLane(1, 0, 0, { trig: 0.56 })],
    parts: multParts(),
    pane: MULT_PANE,
    label: `x${amount}`,
    ...extra,
  });
}

function adder(id, name, amount, cost, unlock, cooldown, desc) {
  return def({
    id, name, family: 'upgrader', kind: 'add', cost, unlock, desc,
    upg: { kind: 'flat', amount, cooldown },
    lanes: [straightLane(1, 0, 0, { trig: 0.56 })],
    parts: addParts(),
    pane: ADD_PANE,
    label: `+${amount}`,
  });
}

const LIGHT = { p: [-0.3, 0.78, 0], s: [0.16, 0.16, 0.16] };
const LIGHT_BIG = { p: [-0.34, 1.0, 0.5], s: [0.2, 0.2, 0.2] };

export const BUILDINGS = [
  // ---- droppers
  def({
    id: 'dropper_scrap', name: 'Scrap Dropper', family: 'dropper', cost: 2800,
    desc: 'Drops slag and iron onto the belt in front of it. Cheap, and it fills your item cap fast.',
    drop: { rate: 1.1, min: 0, max: 1 },
    parts: dropperParts(1, 'steelLight'), light: LIGHT,
  }),
  def({
    id: 'dropper_ore', name: 'Ore Dropper', family: 'dropper', cost: 11000, unlock: 1,
    desc: 'Slower, but every slot it uses holds copper or better.',
    drop: { rate: 0.8, min: 1, max: 2 },
    parts: dropperParts(1, 'warn'), light: LIGHT,
  }),
  def({
    id: 'dropper_deep', name: 'Deep Drill', family: 'dropper', cost: 96000, unlock: 2,
    desc: 'A heavy rig pulling cobalt and aurite out of nothing.',
    drop: { rate: 0.55, min: 3, max: 4 },
    parts: [
      ...dropperParts(1, 'rare'),
      part('cyl', 'steelDark', 0, 1.34, 0, 0.22, 0.36, 0.22),
    ],
    light: LIGHT,
  }),
  def({
    id: 'dropper_void', name: 'Void Extractor', family: 'dropper', cost: 4000000, unlock: 4,
    desc: 'One slow, perfect item at a time: voidglass, and rarely singularite.',
    drop: { rate: 0.32, min: 5, max: 6 },
    parts: [
      part('box', 'ink', 0, 0.42, 0, 0.88, 0.84, 0.88),
      part('box', 'steelDark', 0, 0.06, 0, 0.94, 0.14, 0.94),
      part('sphere', 'rare', 0, 1.12, 0, 0.46, 0.46, 0.46),
      part('torus', 'rare', 0, 1.12, 0, 1.2, 1.2, 1.2, 0, Math.PI / 2),
      part('box', 'ink', 0.5, 0.3, 0, 0.1, 0.34, 0.34),
    ],
    light: LIGHT,
  }),

  // ---- conveyors
  def({
    id: 'belt', name: 'Conveyor', family: 'belt', cost: 350,
    desc: 'Carries items forward. Accepts a feed from either side. Every tile of belt holds items that are not selling yet.',
    lanes: [straightLane(1)], parts: beltParts(1),
  }),
  def({
    id: 'belt_fast', name: 'Fast Conveyor', family: 'belt', cost: 1100, unlock: 1,
    desc: 'Same belt, 80% quicker — items spend less of their life in transit.',
    speed: FLOW.beltSpeed * 1.8,
    lanes: [straightLane(1)],
    parts: [...beltParts(1), part('box', 'accent', 0, BY + 0.03, 0, 0.9, 0.05, 0.2)],
  }),
  def({
    id: 'belt_turn', name: 'Curve', family: 'belt', cost: 420,
    desc: 'Turns the run 90 degrees. Rotate it with R to face any corner — items run through it whichever way you feed it.',
    lanes: [turnLeftLane(), turnLeftBackLane()], parts: cornerParts(-1),
  }),
  def({
    id: 'belt_merge', name: 'Merger', family: 'belt', cost: 1500,
    desc: 'Three feeds in, one line out.',
    lanes: [straightLane(1), mergeFromLeft(), mergeFromRight()],
    parts: [
      ...beltParts(1),
      part('box', 'steelDark', -0.14, BY - 0.15, 0, 0.6, 0.19, 1.0),
      part('cone', 'accent', 0.3, BY + 0.06, 0, 0.2, 0.18, 0.2, 0, -Math.PI / 2),
    ],
  }),
  def({
    id: 'belt_split', name: 'Splitter', family: 'belt', cost: 1100, unlock: 1,
    desc: 'Sends each item to a different exit in turn: straight, left, right.',
    lanes: [straightLane(1), turnLeftLane(), turnRightLane()],
    parts: [
      ...beltParts(1),
      part('box', 'steelDark', 0.14, BY - 0.15, 0, 0.6, 0.19, 1.0),
      part('cyl', 'warn', 0, BY + 0.07, 0, 0.24, 0.14, 0.24),
    ],
  }),
  // A splitter answers "where next?" with "somewhere else this time". A sorter answers it with
  // "what are you?" — which is the entire difference between a longer belt and a layout puzzle.
  // Non-matching material runs STRAIGHT through; the filtered tier turns off to the left arm.
  // `noDrag` because a dragged run of sorters is never what anyone meant by dragging.
  def({
    id: 'sorter', name: 'Sorter', family: 'belt', cost: 2400, unlock: 1,
    desc: 'Reads every item. The material it is set to turns left; everything else carries straight on. Cycle the material with F.',
    sort: true, filter: true, noDrag: true,
    lanes: [
      straightLane(1, 0, 0, { route: 2 }),
      lane(arcPts(-0.5, -0.5, 0.5, H, 0, 0), 0, 1, [0, 0], [0, 0], { route: 1 }),
    ],
    parts: [
      ...beltParts(1),
      part('box', 'steelDark', 0.14, BY - 0.15, 0, 0.6, 0.19, 1.0),
      // Two short posts and a low pane across the belt: the item is READ here, not changed, so the
      // silhouette deliberately sits below the upgrader gates rather than competing with them.
      part('box', 'steelDark', -0.3, BY + 0.24, -0.45, 0.14, 0.5, 0.16),
      part('box', 'steelDark', -0.3, BY + 0.24, 0.45, 0.14, 0.5, 0.16),
      part('box', 'sortPane', -0.3, BY + 0.3, 0, 0.05, 0.34, 0.88),
      part('cyl', 'warn', 0.24, BY + 0.07, -0.24, 0.2, 0.14, 0.2),
    ],
  }),
  // A splitter answers "where next?" with "somewhere else this time"; a sorter answers it with
  // "what are you?". A switch answers it with "wherever the player last put me" — a manual points,
  // not an automatic anything. Three arms, exactly ONE of them live, and it holds until clicked
  // again. The click handling and the button's lit state belong to the input/UI piece; the flow
  // exposes `toggleSwitch` / `setSwitch` / `switchOf` and nothing else.
  // `noDrag` for the same reason the sorter has it: a dragged run of switches is never what anyone
  // meant by dragging.
  def({
    id: 'belt_switch', name: 'Switch', family: 'belt', cost: 1400, unlock: 1,
    switchable: true, noDrag: true,
    desc: 'One way in, three ways out — but only one is open at a time. Press the button on it to turn the line straight, left or right. It stays where you put it.',
    lanes: [
      straightLane(1, 0, 0, { arm: 0 }),
      lane(arcPts(-0.5, -0.5, 0.5, H, 0, 0), 0, 1, [0, 0], [0, 0], { arm: 1 }),
      lane(arcPts(-0.5, 0.5, 0.5, -H, 0, 0), 0, 3, [0, 0], [0, 0], { arm: 2 }),
    ],
    parts: [
      ...beltParts(1),
      // The turnout itself: a stubby housing on the outbound half, so the tile reads as a mechanism
      // rather than a plain belt with a light on it.
      part('box', 'steelDark', 0.16, BY - 0.15, 0, 0.58, 0.21, 1.0),
      // The button. A raised pedestal and a cap on top of it, off to one side of the belt so nothing
      // riding through can hide it. This is an affordance only — the input piece owns what a click
      // on it does, and owns any lit/pressed state it wants to drive off `flow.switchOf(b)`.
      part('cyl', 'steelDark', -0.3, BY + 0.12, -0.36, 0.26, 0.3, 0.26),
      part('cyl', 'warn', -0.3, BY + 0.29, -0.36, 0.22, 0.08, 0.22),
      // A short mast beside the button: somewhere for the UI to hang a direction arrow later, and
      // enough silhouette that a switch is not a plain conveyor from across the factory.
      part('box', 'steelDark', -0.3, BY + 0.34, 0.4, 0.1, 0.62, 0.1),
    ],
  }),
  def({
    id: 'belt_ramp_up', name: 'Ramp Up', family: 'belt', cost: 720, unlock: 1,
    levels: [0, 1],
    desc: 'Lifts the line to the upper deck so two runs can cross.',
    lanes: [straightLane(1, 0, RISE)],
    parts: [...beltParts(1, RISE * 0.5), part('box', 'steelDark', 0, BY + RISE * 0.25 - 0.3, 0, 0.98, 0.3, 0.72)],
  }),
  def({
    id: 'belt_ramp_down', name: 'Ramp Down', family: 'belt', cost: 720, unlock: 1,
    levels: [0, 1],
    desc: 'Brings the upper deck back down to the main line.',
    lanes: [straightLane(1, RISE, 0)],
    parts: [...beltParts(1, RISE * 0.5), part('box', 'steelDark', 0, BY + RISE * 0.25 - 0.3, 0, 0.98, 0.3, 0.72)],
  }),
  def({
    id: 'belt_elev', name: 'Sky Conveyor', family: 'belt', cost: 360, unlock: 1,
    levels: [1], desc: 'Runs on the upper deck, straight over a belt below.',
    lanes: [straightLane(1, RISE, RISE)],
    parts: [...beltParts(1, RISE, RISE), part('box', 'steelDark', 0, BY + RISE - 0.32, 0, 0.34, 0.34, 0.34)],
  }),
  def({
    id: 'belt_sky_turn', name: 'Sky Curve', family: 'belt', cost: 440, unlock: 1,
    levels: [1], desc: 'Turns the upper deck 90 degrees. Rotate it with R to face any corner.',
    lanes: [turnLeftLane(RISE), turnLeftBackLane(RISE)],
    parts: [...cornerParts(-1, RISE), part('box', 'steelDark', 0, BY + RISE - 0.32, 0, 0.34, 0.34, 0.34)],
  }),

  // ---- adders: flat value, worth the most on cheap material
  adder('add_tack', 'Tack Welder', 5, 2100, 0, 0.25, 'A flat +5 on anything that rides through. Pennies — but pennies on slag is a lot.'),
  adder('add_stamp', 'Stamper', 20, 9800, 0, 0.3, 'Flat +20. On slag that is triple value; on aurite it is a rounding error.'),
  adder('add_plate', 'Plating Press', 75, 32000, 1, 0.35, 'Flat +75. The backbone of a mid-game adder line.'),
  adder('add_inject', 'Alloy Injector', 300, 210000, 2, 0.4, 'Flat +300, for lines that already run cobalt and up.'),
  adder('add_infuse', 'Void Infuser', 1200, 3000000, 4, 0.5, 'Flat +1200. Only earns its keep in front of big multipliers.'),

  // ---- multipliers: scale, worth the most on expensive material
  multiplier('mul_125', 'Buffer Wheel', 1.25, 5600, 0, 0.5, 'x1.25. Deliberately feeble, and the first multiplier you can afford.'),
  multiplier('mul_15', 'Refiner', 1.5, 21000, 1, 0.6, 'x1.5. Put it AFTER your adders — it multiplies whatever they put in.'),
  multiplier('mul_2', 'Crucible', 2, 120000, 2, 0.8, 'x2. Doubles everything upstream of it.'),
  multiplier('mul_3', 'Reactor', 3, 780000, 3, 1.0, 'x3. Wants an expensive item and a long adder line in front.'),
  multiplier('mul_5', 'Nova Press', 5, 5400000, 4, 1.4, 'x5. Late-line hardware.'),
  multiplier('mul_10', 'Singularity Gate', 10, 26000000, 5, 2.0, 'x10. The last gate on the belt.'),
  multiplier('mul_gamble', 'Gamble Press', 5, 600000, 3, 3.0,
    'x5 — with a 20% chance the item is crushed to nothing. Fires once per item.',
    { upg: { kind: 'gamble', amount: 5, destroy: 0.2, cooldown: 3, once: true }, label: 'x5?' }),
  multiplier('mul_transmute', 'Transmuter', 1, 450000, 3, 6,
    'Raises the item one whole tier. Only ever fires once per item.',
    { upg: { kind: 'tier', cooldown: 6, once: true }, label: 'tier+' }),

  // ---- terminals
  def({
    id: 'sellpad', name: 'Sell Pad', family: 'sell', cost: 5600,
    rotatable: false,
    desc: 'Anything that touches it turns into money and frees the slot it was using.',
    // One cell, and deliberately the plainest object in the game: a green square. It is the loudest
    // colour on screen and the end of every line, so it needs no detail to be found.
    lanes: sinkLanes([[0, 0]], 0, 0, 0),
    parts: [
      part('box', 'accentDeep', 0, BY - 0.17, 0, 1.0, 0.22, 1.0),
      part('box', 'accent', 0, BY - 0.03, 0, 0.88, 0.09, 0.88),
    ],
  }),
  // The demand side of the sorter. A plain pad is indifferent to what lands on it; this one is not,
  // and the penalty is what makes it a decision rather than a free upgrade — dump a mixed line onto
  // it and most of what you sell is worth a third of its value. The exact numbers, and the proof
  // that sorting into it beats a plain pad, live in SELLPAD in config.js.
  def({
    id: 'sellpad_tier', name: 'Delivery Pad', family: 'sell', cost: 20000, unlock: 1,
    rotatable: false,
    // `tierPad` is kept as the flag other pieces already branch on; `delivery` is the name that
    // describes what it now does. There is deliberately NO `filter` any more — the pad has no
    // material setting to cycle, so `hasFilter()` is false for it and every filter affordance in the
    // UI drops away on its own instead of each panel having to special-case the id.
    tierPad: true, delivery: true,
    desc: 'Accepts only what the order board is asking for right now, and pays 2.2x for it. Anything else that lands on it is destroyed — no money back. Feed it from a sorter. With no order open it sells everything at the plain rate.',
    lanes: sinkLanes([[0, 0]], 0, 0, 0),
    parts: [
      part('box', 'accentDeep', 0, BY - 0.17, 0, 1.0, 0.22, 1.0),
      part('box', 'gold', 0, BY - 0.03, 0, 0.88, 0.09, 0.88),
      // A ring of four studs: the plain pad is a flat green square, so the tier pad has to differ in
      // silhouette as well as colour or the two are one object at a glance from above.
      part('cyl', 'steelDark', -0.38, BY + 0.02, -0.38, 0.14, 0.16, 0.14),
      part('cyl', 'steelDark', 0.38, BY + 0.02, -0.38, 0.14, 0.16, 0.14),
      part('cyl', 'steelDark', -0.38, BY + 0.02, 0.38, 0.14, 0.16, 0.14),
      part('cyl', 'steelDark', 0.38, BY + 0.02, 0.38, 0.14, 0.16, 0.14),
    ],
  }),
  def({
    id: 'buffer', name: 'Buffer Vault', family: 'store', cost: 9600, unlock: 1,
    // 16 slots, not 90: at a starting cap of 100 a 90-slot vault swallowed almost the whole factory
    // for $1200, while the real capacity upgrade buys 15 for $2000. A vault smooths a burst; it is
    // not a way to warehouse the game.
    desc: 'Holds up to 16 items and feeds them back out at 6/s. Stored items still count against your cap.',
    store: { cap: 16, rate: 6 },
    lanes: [
      ...sinkLanes([[0, 0]], 0, 0, 0),
      lane([0, 0, 0, 0.5, 0, 0], 0, 0, [0, 0], [0, 0], { out: true }),
    ],
    parts: [
      part('box', 'steel', 0, 0.44, 0, 0.86, 0.88, 0.86),
      part('box', 'steelDark', 0, 0.04, 0, 0.96, 0.12, 0.96),
      part('box', 'steelLight', 0, 0.92, 0, 0.7, 0.1, 0.7),
      part('box', 'accent', 0, 0.5, 0.44, 0.42, 0.4, 0.08),
    ],
  }),
  def({
    id: 'furnace', name: 'Fusion Furnace', family: 'store', cost: 72000, unlock: 2,
    desc: 'Melts 4 items into one of the next tier up, worth 1.25x the pile — and frees 3 slots doing it.',
    fuse: { need: 4, bonus: 1.25 },
    lanes: [
      ...sinkLanes([[0, 0]], 0, 0, 0),
      lane([0, 0, 0, 0.5, 0, 0], 0, 0, [0, 0], [0, 0], { out: true }),
    ],
    parts: [
      part('box', 'ink', 0, 0.42, 0, 0.84, 0.84, 0.84),
      part('box', 'steelDark', 0, 0.04, 0, 0.94, 0.12, 0.94),
      part('cyl', 'warn', 0, 0.9, 0, 0.5, 0.18, 0.5),
      part('cone', 'steelDark', 0, 1.14, 0, 0.42, 0.34, 0.42, 0, Math.PI),
      part('box', 'warn', 0, 0.44, 0.44, 0.42, 0.36, 0.08),
    ],
  }),
];

// --- authored meshes ----------------------------------------------------------
// One glb per family. `modelRot` is the extra quarter turn a shared mesh needs to line its geometry up
// with its lane — the only place a mesh's own orientation is allowed to be corrected, so the hologram
// and the placed building can never disagree about which way a piece faces.
const MODEL_ROT = {};

const MODEL_FOR = {
  belt: 'belt-straight',
  belt_fast: 'belt-straight',
  belt_turn: 'belt-curve',
  belt_sky_turn: 'belt-curve',
  belt_merge: 'belt-merger',
  belt_split: 'belt-splitter',
  belt_ramp_up: 'belt-ramp-up',
  belt_ramp_down: 'belt-ramp-down',
  belt_elev: 'belt-straight',
  dropper_scrap: 'dropper-basic',
  dropper_ore: 'dropper-mk2',
  dropper_deep: 'dropper-mk3',
  dropper_void: 'dropper-void',
  // world.js loads only what assets/models/manifest.json lists, so these two lines are inert until
  // the modeller adds the names there, and then pick the meshes up with no further change. Neither
  // is pointed at an existing mesh as a stand-in: reusing sellpad.glb for the Contract Pad would
  // make the two pads pixel-identical, which is worse than the primitives.
  sorter: 'sorter',
  sellpad_tier: 'sellpad-tier',
  // Its own mesh, not belt-splitter.glb: a switch that looked identical to a splitter would be worse
  // than primitives, because the two make opposite promises about where an item goes. It is built
  // FROM the splitter (work/blender/vwbuild2.py `_belt_switch`) so the pair keeps one plinth and one
  // junction silhouette, and differs where it matters — the splitter's three equal amber arrows say
  // the stream divides; the switch's single raised amber button says you press it to choose.
  belt_switch: 'belt-switch',
};

export const ITEM_MODELS = [
  'item-slag', 'item-iron', 'item-copper', 'item-cobalt', 'item-aurite', 'item-voidglass', 'item-singularite',
];

// How big a jump this gate is, on its own family's scale. Drives which rung of the upgrade sound
// ladder plays, so a stronger upgrade always sounds higher than a weaker one.
export function upgradePower(u) {
  if (!u) return 0;
  if (u.kind === 'tier') return 3.5;
  if (u.kind === 'gamble') return u.amount * (1 - (u.destroy || 0));
  return u.amount;
}

const familyRank = { add: [], mult: [] };
for (const d of BUILDINGS) if (d.family === 'upgrader') familyRank[d.kind].push(d);
for (const list of Object.values(familyRank)) {
  list.sort((a, b) => upgradePower(a.upg) - upgradePower(b.upg));
  for (let i = 0; i < list.length; i += 1) {
    list[i].sfxStrength = list.length < 2 ? 1 : i / (list.length - 1);
  }
}

for (const d of BUILDINGS) {
  d.model = MODEL_FOR[d.id] || (d.family === 'upgrader' ? (d.kind === 'add' ? 'upgrader-add' : 'upgrader-mult') : null);
  d.modelRot = MODEL_ROT[d.id] || 0;
  d.modelY = d.levels[0] === 1 ? FLOW.rampRise : 0;
  // A glb's origin is the centre of its footprint; a building's origin is its root cell.
  let ox = 0;
  let oz = 0;
  for (const c of d.cells) { ox += c[0]; oz += c[1]; }
  d.modelOffset = [ox / d.cells.length, oz / d.cells.length];
}
// A straight belt's mesh is symmetric front to back, so rotating it 180 degrees changes where items
// GO while changing nothing you can see. Rotation looked broken for exactly that reason. These
// chevrons sit on the rails pointing the way items travel, so direction is readable on a placed belt
// and not only in the build hologram. They ride `modelExtras`, which the part instancer already
// draws, so a factory full of them still costs no extra draw calls.
function dirMarks(y, mat) {
  const h = y === undefined ? 0.435 : y;
  const m = mat || 'steelLight';
  const out = [];
  for (const x of [-0.22, 0.22]) {
    for (const z of [-0.44, 0.44]) {
      out.push(part('pyr', m, x, h, z, 0.13, 0.17, 0.09, 0, 0, -Math.PI / 2));
    }
  }
  return out;
}

// The fast belt reuses the plain belt mesh, so a green stripe along each rail top marks it out.
// The glb's rails top out at 0.425 and its bed carries at 0.34, so this sits on the rail, clear of items.
getDefRaw('belt_fast').modelExtras = [
  part('box', 'accent', 0, 0.435, -0.44, 0.92, 0.03, 0.07),
  part('box', 'accent', 0, 0.435, 0.44, 0.92, 0.03, 0.07),
  ...dirMarks(0.47, 'accentDeep'),
];
getDefRaw('belt').modelExtras = dirMarks();
getDefRaw('belt_elev').modelExtras = dirMarks(0.435 + RISE);

function getDefRaw(id) { return BUILDINGS.find((d) => d.id === id); }

// Panes become instanced parts with one shared material per definition, so the upgrade pulse is a
// single emissive write per definition per frame no matter how many items pass through.
export const PANE_MATERIALS = new Map();
for (const d of BUILDINGS) {
  if (!d.pane) continue;
  const color = new THREE.Color(paneColorFor(d.upg));
  const key = `pane_${d.id}`;
  MATERIALS[key] = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    roughness: 0.25,
    metalness: 0,
  });
  PANE_MATERIALS.set(d.id, MATERIALS[key]);
  d.paneMaterial = key;
  d.parts = [...d.parts, part('box', key, 0, d.pane.y, 0, d.pane.t, d.pane.h, d.pane.w)];
}

export const LIGHT_MATERIALS = {
  ok: mat('#17c964', { emissive: new THREE.Color('#17c964'), emissiveIntensity: 0.9, roughness: 0.3 }),
  stalled: mat('#f5a524', { emissive: new THREE.Color('#f5a524'), emissiveIntensity: 1.1, roughness: 0.3 }),
};

export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));

export function getDef(id) { return BUILDING_BY_ID.get(id) || null; }

export function isBeltLike(d) {
  return !!d && (d.family === 'belt' || d.family === 'upgrader');
}

// Does this definition carry a per-building "which material" setting? Sorter and Contract Pad do;
// nothing else does. One predicate, so the UI never has to enumerate ids.
export function hasFilter(d) { return !!d && !!d.filter; }

// Does this definition carry a per-building EXIT setting the player flips by hand? Only the switch
// conveyor does. Same shape as hasFilter() so the UI can ask one question per affordance.
export function isSwitch(d) { return !!d && !!d.switchable; }

// The world direction (0..3, relative to rot = 0) each switch arm leaves by, in cycle order. Read
// off the lane specs rather than restated, so an arm cannot be drawn pointing one way and route the
// other. Add b.rot and mask with 3 for the direction a PLACED switch's arm faces.
export const SWITCH_ARM_DIRS = (() => {
  const d = getDefRaw('belt_switch');
  const out = [];
  for (const l of d.lanes) out[l.arm] = l.outDir;
  return out;
})();

export function switchArmLabel(i) { return SWITCH.labels[i] || `Arm ${i}`; }

// The colour the authored glb's `pane` slot should be tinted to for a given filtered tier — and the
// swatch the UI should print next to the building. Derived from the item table so it can never drift
// from the material it is naming.
export function filterColorFor(tierIndex) { return tierColor(tierIndex); }

export function buildGhost(d, material) {
  const g = new THREE.Group();
  for (const p of d.parts) {
    const m = new THREE.Mesh(GEOMETRIES[p.g], material || MATERIALS[p.m]);
    m.position.set(p.p[0], p.p[1], p.p[2]);
    m.scale.set(p.s[0], p.s[1], p.s[2]);
    m.rotation.set(p.r[0], p.r[1], p.r[2]);
    g.add(m);
  }
  return g;
}

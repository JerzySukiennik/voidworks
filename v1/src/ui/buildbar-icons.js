// Voidworks — build bar glyphs: every tile is a drawing of the real machine, in its real pane colour.

import { PALETTE } from '../config.js';

const W = 64;
const H = 40;

const STEEL = PALETTE.steel;
const DARK = PALETTE.steelDark;
const DECK = '#2b3038';
const INK = PALETTE.ink;

function svg(inner) {
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" aria-hidden="true">${inner}</svg>`;
}

function r(x, y, w, h, fill, rad, op) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad || 0}" fill="${fill}"${op === undefined ? '' : ` opacity="${op}"`}/>`;
}

function poly(pts, fill, op) {
  return `<polygon points="${pts}" fill="${fill}"${op === undefined ? '' : ` opacity="${op}"`}/>`;
}

// --- belts: plan view, because a curve or a splitter only reads from above --------------------

function ribbonH(x, w) {
  return r(x, 14, w, 12, DECK, 2);
}

function ribbonV(y, h) {
  return r(26, y, 12, h, DECK, 2);
}

function chev(cx, color, cy) {
  const y = cy === undefined ? 20 : cy;
  return poly(`${cx - 3},${y - 4} ${cx + 3},${y} ${cx - 3},${y + 4}`, color || STEEL);
}

const BELT_ICONS = {
  belt: () => svg(ribbonH(6, 52) + chev(24) + chev(38)),
  belt_fast: () => svg(ribbonH(6, 52) + chev(20, PALETTE.accent) + chev(31, PALETTE.accent) + chev(42, PALETTE.accent)),
  belt_turn_l: () => svg(ribbonH(26, 32) + ribbonV(4, 22) + poly('32,8 26,14 38,14', PALETTE.accent) + chev(50)),
  belt_turn_r: () => svg(ribbonH(26, 32) + ribbonV(14, 22) + poly('32,32 26,26 38,26', PALETTE.accent) + chev(50)),
  belt_merge: () => svg(ribbonH(6, 52) + ribbonV(2, 14) + ribbonV(24, 14)
    + poly('32,14 27,8 37,8', STEEL) + poly('32,26 27,32 37,32', STEEL) + chev(48, PALETTE.accent)),
  belt_split: () => svg(ribbonH(6, 52) + ribbonV(2, 14) + ribbonV(24, 14)
    + poly('32,4 27,10 37,10', PALETTE.warn) + poly('32,36 27,30 37,30', PALETTE.warn) + chev(50, PALETTE.warn)),
  belt_ramp_up: () => svg(r(6, 26, 52, 5, DARK, 2) + poly('8,26 56,10 56,17 8,33', DECK)
    + poly('40,12 48,12 44,5', PALETTE.accent)),
  belt_ramp_down: () => svg(r(6, 26, 52, 5, DARK, 2) + poly('8,10 56,26 56,33 8,17', DECK)
    + poly('40,28 48,28 44,35', PALETTE.accent)),
  belt_elev: () => svg(r(6, 30, 52, 4, DARK, 2, 0.3) + r(6, 10, 52, 12, DECK, 2)
    + r(14, 22, 5, 10, DARK) + r(45, 22, 5, 10, DARK) + chev(32, PALETTE.accent, 16)),
};

// --- upgraders: front elevation, because silhouette is what separates the two families --------

function beltLine() {
  return r(4, 30, 56, 5, DARK, 1) + r(6, 29, 52, 2, DECK, 1);
}

function adderIcon(color) {
  return svg(beltLine()
    + r(10, 18, 9, 12, STEEL, 2) + r(45, 18, 9, 12, STEEL, 2)
    + r(15, 20, 34, 9, color, 1, 0.85)
    + r(15, 20, 34, 2, color, 1));
}

function multIcon(color) {
  return svg(beltLine()
    + r(13, 6, 4, 24, STEEL, 1) + r(47, 6, 4, 24, STEEL, 1)
    + r(11, 2, 42, 4, DARK, 2)
    + r(17, 6, 30, 24, color, 1, 0.55)
    + r(17, 6, 30, 2, color, 1));
}

// --- droppers: elevation, hopper on a body, with the material it makes as pips ----------------

function dropperIcon(color, big) {
  const w = big ? 34 : 26;
  const x = (W - w) / 2;
  return svg(r(x, 16, w, 15, STEEL, 2)
    + r(x - 2, 31, w + 4, 3, DARK, 1)
    + poly(`${x - 1},16 ${x + w + 1},16 ${x + w - 6},7 ${x + 6},7`, color)
    + r(W / 2 - 2, 3, 4, 4, INK, 1)
    + r(x + w, 20, 4, 7, DARK, 1)
    + `<circle cx="${x + w + 8}" cy="30" r="2.6" fill="${color}"/>`);
}

// --- terminals ---------------------------------------------------------------------------------

const TERMINAL_ICONS = {
  sellpad: () => svg(r(8, 14, 48, 18, PALETTE.accentDeep, 3)
    + r(11, 16, 42, 13, PALETTE.accent, 2)
    + r(24, 19, 16, 7, PALETTE.accentDeep, 2)
    + r(4, 21, 6, 4, DECK, 1)),
  buffer: () => svg(r(12, 10, 40, 22, STEEL, 3)
    + r(10, 32, 44, 3, DARK, 1)
    + r(15, 7, 34, 4, PALETTE.steelLight, 2)
    + r(22, 18, 20, 10, PALETTE.accent, 2, 0.85)
    + r(52, 20, 6, 5, DECK, 1)),
  furnace: () => svg(r(12, 12, 40, 20, INK, 3)
    + r(10, 32, 44, 3, DARK, 1)
    + r(18, 7, 28, 5, PALETTE.warn, 2)
    + poly('32,15 39,25 25,25', PALETTE.warn)
    + r(52, 20, 6, 5, DECK, 1)),
};

export function iconFor(def, paneColor) {
  if (def.family === 'belt' && BELT_ICONS[def.id]) return BELT_ICONS[def.id]();
  if (def.family === 'upgrader') return def.kind === 'add' ? adderIcon(paneColor) : multIcon(paneColor);
  if (def.family === 'dropper') {
    const heads = { dropper_scrap: PALETTE.steelLight, dropper_ore: PALETTE.warn, dropper_deep: PALETTE.warn, dropper_void: PALETTE.rare };
    return dropperIcon(heads[def.id] || PALETTE.steelLight, def.cells.length > 1);
  }
  if (TERMINAL_ICONS[def.id]) return TERMINAL_ICONS[def.id]();
  return svg(r(16, 12, 32, 20, STEEL, 3));
}

export function groupGlyph(id) {
  const g = {
    dropper: svg(poly('18,10 46,10 40,20 24,20', STEEL) + r(26, 22, 12, 8, DARK, 1) + `<circle cx="32" cy="35" r="3" fill="${DARK}"/>`),
    belt: svg(ribbonH(6, 52) + chev(24) + chev(40)),
    add: svg(beltLine() + r(12, 20, 40, 10, '#4fa8ff', 1, 0.9)),
    mult: svg(beltLine() + r(14, 6, 4, 24, STEEL, 1) + r(46, 6, 4, 24, STEEL, 1) + r(18, 6, 28, 24, '#17c964', 1, 0.6)),
    end: svg(r(10, 14, 44, 16, PALETTE.accent, 3) + r(24, 18, 16, 8, PALETTE.accentDeep, 2)),
  };
  return g[id] || '';
}

export function trashGlyph() {
  return svg(r(22, 8, 20, 4, DARK, 1) + r(19, 13, 26, 21, STEEL, 3)
    + r(26, 18, 3, 11, DARK, 1) + r(36, 18, 3, 11, DARK, 1));
}

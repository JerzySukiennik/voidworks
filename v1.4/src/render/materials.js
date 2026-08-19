// Voidworks — the shared material palette. Every piece reuses these instances; never clone per mesh.

import * as THREE from 'three';
import { PALETTE, RENDER } from '../config.js';

const flat = RENDER.flatShading;

function surface(color, roughness, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness: 0,
    flatShading: opts.smooth ? false : flat,
    ...opts.extra,
  });
}

export const materials = {
  steel: surface(PALETTE.steel, 0.82),
  steelLight: surface(PALETTE.steelLight, 0.86),
  steelDark: surface(PALETTE.steelDark, 0.76),
  rubber: surface(PALETTE.rubber, 0.94, { smooth: true }),
  rubberLight: surface(PALETTE.rubberLight, 0.9, { smooth: true }),
  ink: surface(PALETTE.ink, 0.9),
  accent: surface(PALETTE.accent, 0.62, {
    extra: { emissive: new THREE.Color(PALETTE.accentDeep), emissiveIntensity: 0.22 },
  }),
  accentDeep: surface(PALETTE.accentDeep, 0.7),
  glass: new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.steelLight),
    roughness: 0.12,
    metalness: 0,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
  ghost: new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    roughness: 0.5,
    metalness: 0,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  }),
};

const tierCache = new Map();

export function tierMaterial(colorHex) {
  const key = String(colorHex).toLowerCase();
  let m = tierCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      roughness: 0.58,
      metalness: 0,
      flatShading: flat,
      emissive: new THREE.Color(colorHex),
      emissiveIntensity: 0.06,
    });
    tierCache.set(key, m);
  }
  return m;
}

const paneCache = new Map();

// Upgrader panes must glow against WHITE, where brightness reads as nothing. Saturated tinted
// glass plus a darker rim of the same hue is what carries the colour, so both are unlit.
export function paneMaterial(colorHex) {
  const key = String(colorHex).toLowerCase();
  let pair = paneCache.get(key);
  if (!pair) {
    const base = new THREE.Color(colorHex);
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    const face = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.15), Math.min(0.62, hsl.l)),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const edge = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.2), Math.max(0.24, hsl.l * 0.62)),
      toneMapped: false,
    });
    pair = { face, edge };
    paneCache.set(key, pair);
  }
  return pair;
}

export function allMaterials() {
  const panes = [];
  for (const p of paneCache.values()) panes.push(p.face, p.edge);
  return [...Object.values(materials), ...tierCache.values(), ...panes];
}

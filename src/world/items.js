// Voidworks — material tiers: defs, weighted tier rolls, per-item value maths and the shared item meshes.

import * as THREE from 'three';
import { ITEMS, ECONOMY, FLOW } from '../config.js';

export const TIERS = ITEMS.tiers.map((t, i) => ({ ...t, index: i }));
export const TIER_COUNT = TIERS.length;
export const TOP_TIER = TIER_COUNT - 1;

export function tier(i) { return TIERS[Math.max(0, Math.min(TOP_TIER, i | 0))]; }
export function tierName(i) { return tier(i).name; }
export function tierColor(i) { return tier(i).color; }
export function baseValue(i) { return tier(i).value; }

export function clampTier(i) { return Math.max(0, Math.min(TOP_TIER, i | 0)); }

export function rollTier(minTier, maxTier) {
  const lo = clampTier(minTier);
  const hi = clampTier(maxTier);
  let total = 0;
  for (let i = lo; i <= hi; i += 1) total += TIERS[i].weight;
  let r = Math.random() * total;
  for (let i = lo; i <= hi; i += 1) {
    r -= TIERS[i].weight;
    if (r <= 0) return i;
  }
  return hi;
}

export function rollValue(tierIndex) {
  const j = ECONOMY.valueJitter;
  return baseValue(tierIndex) * (1 - j * 0.5 + Math.random() * j);
}

const geometries = [];
const materials = [];

function makeGeometry(i) {
  const s = FLOW.itemSize;
  switch (i) {
    case 0: return new THREE.BoxGeometry(s * 1.1, s * 0.72, s * 0.94);
    case 1: return new THREE.BoxGeometry(s, s, s);
    case 2: return new THREE.CylinderGeometry(s * 0.52, s * 0.52, s * 0.9, 8);
    case 3: return new THREE.OctahedronGeometry(s * 0.74, 0);
    case 4: return new THREE.DodecahedronGeometry(s * 0.66, 0);
    case 5: return new THREE.IcosahedronGeometry(s * 0.68, 0);
    default: return new THREE.IcosahedronGeometry(s * 0.76, 1);
  }
}

export function tierGeometry(i) {
  if (!geometries[i]) geometries[i] = makeGeometry(i);
  return geometries[i];
}

export function tierMaterial(i) {
  if (!materials[i]) {
    const t = tier(i);
    materials[i] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.color),
      roughness: i >= 5 ? 0.22 : 0.55 - i * 0.05,
      metalness: i >= 2 ? 0.55 : 0.15,
      emissive: new THREE.Color(t.color),
      emissiveIntensity: i >= 5 ? 0.35 : 0.04,
    });
  }
  return materials[i];
}

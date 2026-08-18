// Voidworks — the long game: offline credit, the away summary, prestige points and unlock gating.
//
// Everything in here is a PURE function of numbers. The economy owns the state and calls these; the
// tests can call them with hand-written numbers and no browser. That split is deliberate — an idle
// curve that can only be checked by playing for four hours is a curve nobody ever checks.

import { ECONOMY, PRESTIGE, UNLOCKS } from '../config.js';

// --- offline ------------------------------------------------------------------

export function offlineWindow(elapsedSeconds) {
  const max = ECONOMY.offlineMaxHours * 3600;
  const raw = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
  return { raw, seconds: Math.min(raw, max), max, truncated: raw > max };
}

// The one honest way to price time away: the rate the factory was ACTUALLY achieving when it was
// saved, times a fraction, times a bounded window. `rate` is the measured 4-second sales average, so
// a factory that was sitting at the item cap contributes its capped throughput and nothing more —
// there is no separate "would the droppers have kept up" guess to get wrong.
export function offlineEarnings(rate, elapsedSeconds) {
  const w = offlineWindow(elapsedSeconds);
  if (w.raw < ECONOMY.offlineMinSeconds) return 0;
  const r = Number.isFinite(rate) && rate > 0 ? rate : 0;
  return r * ECONOMY.offlineRate * w.seconds;
}

// The structured thing a returning player is owed. `capped` is the useful field: it is the one fact
// that tells them the item cap, not the dropper, decided what those hours were worth.
export function awayReport(rate, elapsedSeconds, stallFraction) {
  const w = offlineWindow(elapsedSeconds);
  const s = Number.isFinite(stallFraction) ? Math.min(1, Math.max(0, stallFraction)) : 0;
  const money = offlineEarnings(rate, elapsedSeconds);
  return {
    seconds: w.seconds,
    rawSeconds: w.raw,
    truncated: w.truncated,
    maxSeconds: w.max,
    money,
    rate: Number.isFinite(rate) && rate > 0 ? rate : 0,
    efficiency: ECONOMY.offlineRate,
    stallFraction: s,
    cappedSeconds: w.seconds * s,
    capped: s >= ECONOMY.stallCappedAt,
  };
}

// --- prestige -----------------------------------------------------------------

// Square root, not linear: the nth reset needs n^2 times the first one's earnings. That is what
// keeps the tenth reset a decision instead of a formality.
export function prestigeGainFor(earned) {
  if (!Number.isFinite(earned) || earned <= 0) return 0;
  return Math.floor(PRESTIGE.scale * Math.sqrt(earned / PRESTIGE.requirement));
}

export function prestigeMultFor(points) {
  const p = Number.isFinite(points) && points > 0 ? points : 0;
  return 1 + p * PRESTIGE.perPoint;
}

// --- unlocks ------------------------------------------------------------------

export function unlockLevelFor(lifetimeEarned) {
  const e = Number.isFinite(lifetimeEarned) ? lifetimeEarned : 0;
  const t = UNLOCKS.thresholds;
  let level = 0;
  for (let i = 1; i < t.length; i += 1) {
    if (e >= t[i]) level = i;
    else break;
  }
  return level;
}

export function unlockCostFor(level) {
  const t = UNLOCKS.thresholds;
  const i = Math.min(t.length - 1, Math.max(0, level | 0));
  return t[i];
}

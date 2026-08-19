// Voidworks — per-building upgrade levels: the effect ladder, the cost curve, and save/restore.
//
// An individual PLACED machine can be levelled up UPGRADES.maxLevel times. Not a definition, not a
// family: this one machine, on this one cell.
//
// --- how the effect reaches the sim ------------------------------------------------------------
// The flow sim already reads every stat it needs off `b.def` — `b.def.drop.rate`, `b.def.upg`,
// `lane.speed` baked from `b.def.speed`, `b.def.store.cap`, `b.def.fuse.bonus`. So an upgraded
// building is given its OWN derived definition object: a shallow clone of the catalogue entry with
// the handful of numbers that changed replaced, carrying the same `id`, the same `cost`, the same
// `parts` and `model` references.
//
// That is the whole mechanism, and it was chosen for one reason: the hot path must not learn about
// upgrades. There is no per-item lookup, no `effectiveSpeed(b)` call inside stepLane, no allocation
// anywhere near an item. A derived definition is built AT MOST ONCE per (definition, level) for the
// entire session and cached, so a factory with two hundred upgraded conveyors holds three extra
// objects, not two hundred.
//
// Keeping `id` and `cost` identical is not incidental either — `economy.counts`, `priceOf`,
// `charge`, `refund`, the save blob, `paneOwners` and `world.replace` all key on `def.id`. A
// derived definition with its own id would have forked the price curve, which is a money printer:
// upgrade, reload, and every copy of that machine is cheap again.
//
// --- what a level costs ------------------------------------------------------------------------
// `round(economy.priceOf(machine) * base * growth^(level already owned))`, per UPGRADES.cost. The
// base is the machine's CURRENT price including the 1.06^n catalogue curve, so "level this one up"
// and "buy another one" stay the same comparison however big the factory gets.
//
// --- what does NOT happen here -----------------------------------------------------------------
// No prestige, no unlock thresholds of its own. Dropper levels are gated by `economy.isUnlocked`
// on the existing dropper catalogue, so the two ladders share one source of truth.

import { UPGRADES } from '../config.js';
import { BUILDINGS } from '../world/buildings.js';
import { tierName, TOP_TIER } from '../world/items.js';

export const UPGRADE_MAX = UPGRADES.maxLevel;

// `${definition id}#${level}` -> derived definition. Session-lifetime, bounded by
// (catalogue size * maxLevel), built lazily.
const derivedDefs = new Map();

// --- identity -----------------------------------------------------------------

// The level-0 catalogue entry behind whatever `b` is currently running on.
export function upgradeBaseDef(b) {
  const d = b && b.def;
  if (!d) return null;
  return d.upBase || d;
}

// Which ladder a definition climbs. Deliberately derived from what the definition HAS rather than
// from its id, so a new building added to the catalogue is upgradable the day it lands.
function ladderOf(d) {
  if (!d) return null;
  if (d.drop) return 'dropper';
  if (d.fuse) return 'furnace';
  if (d.store) return 'vault';
  if (d.family === 'sell') return 'sell';
  if (d.family === 'upgrader') return 'upgrader';
  if (d.family === 'belt') return 'belt';
  return null;
}

function costKey(d) {
  const k = ladderOf(d);
  if (k === 'vault') return 'store';
  return k;
}

export function isUpgradable(b) {
  const base = upgradeBaseDef(b);
  return !!base && !!ladderOf(base);
}

export function upgradeMax(b) {
  return isUpgradable(b) ? UPGRADES.maxLevel : 0;
}

// The level this individual building is at. The single reader of `b.up`, so nothing else in the
// game has to know that the field exists or that its default is "absent".
export function upgradeLevels(b) {
  return b && b.up ? b.up | 0 : 0;
}

// --- the effect ladder ---------------------------------------------------------

// One step of a dropper's quality, and the order matters: while there is a better material within
// reach, a level buys REACH; only when the range is exhausted does it fall back to raw rate, which
// is nearly worthless at the item cap. That ordering is the whole reason a dropper upgrade is
// interesting rather than an idle-game "+10%".
function stepDrop(p) {
  const n = { ...p };
  if (p.max < TOP_TIER) n.max = p.max + 1;
  else if (p.min < p.max) n.min = p.min + 1;
  else n.rate = p.rate * UPGRADES.dropRateStep;
  return n;
}

function stepUpg(u) {
  const n = { ...u };
  if (u.kind === 'flat') {
    n.amount = u.amount * UPGRADES.flatStep;
  } else if (u.kind === 'tier') {
    // Nothing to scale: `upgradeItem`'s tier case takes no amount. What a tier gate has instead is
    // a rule and a clock, so that is what its levels buy.
    if (n.once) n.once = false;
    n.cooldown = (u.cooldown || 0) * UPGRADES.tierCooldownStep;
  } else {
    // mult / multCap / gamble: scale the GAIN, not the amount. x1.25 and x10 then improve by the
    // same fraction of what they actually do to an item.
    n.amount = 1 + (u.amount - 1) * UPGRADES.multStep;
  }
  return n;
}

function buildDerived(base, level) {
  const key = `${base.id}#${level}`;
  const hit = derivedDefs.get(key);
  if (hit) return hit;

  const prev = level <= 1 ? base : buildDerived(base, level - 1);
  const d = { ...prev };
  d.upBase = base;
  d.upLevel = level;

  switch (ladderOf(base)) {
    case 'dropper':
      d.drop = stepDrop(prev.drop);
      break;
    case 'belt':
      d.speed = prev.speed * UPGRADES.beltSpeedStep;
      break;
    case 'upgrader':
      d.upg = stepUpg(prev.upg);
      break;
    case 'sell':
      d.payMult = (prev.payMult || 1) * UPGRADES.payStep;
      break;
    case 'vault':
      d.store = {
        ...prev.store,
        cap: prev.store.cap + UPGRADES.vaultCapStep,
        rate: prev.store.rate + UPGRADES.vaultRateStep,
      };
      break;
    case 'furnace':
      d.fuse = { ...prev.fuse, bonus: prev.fuse.bonus * UPGRADES.fuseBonusStep };
      break;
    default:
      break;
  }
  derivedDefs.set(key, d);
  return d;
}

export function upgradeDefFor(base, level) {
  if (!base || !ladderOf(base)) return base;
  const lv = Math.max(0, Math.min(UPGRADES.maxLevel, level | 0));
  return lv <= 0 ? base : buildDerived(base, lv);
}

// --- applying a level to a live building ---------------------------------------

// A vault's ring buffer is sized at bake time, so growing its capacity has to move the contents
// rather than re-bake the building — a re-bake would hand the parked items back to the flow, which
// has room for exactly one of them on the output lane and destroys the rest. Capacity only ever
// grows, so nothing is ever dropped here.
function growStore(b, cap) {
  const s = b.store;
  if (!s || cap <= s.cap) return;
  const ids = new Int32Array(cap);
  for (let k = 0; k < s.count; k += 1) ids[k] = s.ids[(s.head + k) % s.cap];
  s.ids = ids;
  s.head = 0;
  s.cap = cap;
}

// Sets the level directly, for free. Every path that is NOT a purchase comes through here: a save
// restore, a network mirror, a test harness, a swap that carries its levels over.
//
// Lanes bake `speed` at bake time, so a belt-family level is written straight onto the already-baked
// lanes instead of re-baking the building. Same reason as the vault: a re-bake would disturb the
// items currently riding the tile, and a speed change has no business doing that.
export function setUpgradeLevel(b, level) {
  if (!b) return 0;
  const base = upgradeBaseDef(b);
  if (!base || !ladderOf(base)) return 0;
  const lv = Math.max(0, Math.min(UPGRADES.maxLevel, level | 0));
  b.up = lv;
  const d = upgradeDefFor(base, lv);
  if (b.def !== d) {
    b.def = d;
    const lanes = b.lanes;
    if (lanes) {
      for (let i = 0; i < lanes.length; i += 1) if (!lanes[i].emit) lanes[i].speed = d.speed;
    }
    if (b.store && d.store) growStore(b, d.store.cap);
  }
  return lv;
}

// --- cost, gating, purchase ----------------------------------------------------

function econOf(ctx) {
  if (!ctx) return null;
  if (ctx.economy) return ctx.economy;
  return typeof ctx.priceOf === 'function' ? ctx : null;
}

// The best material any dropper the player has UNLOCKED can produce, plus one. A dropper level may
// never push its `max` past this, so the upgrade ladder walks in step with the unlock ladder
// instead of racing ahead of it — one source of truth for "how far into the material table is this
// player allowed to be", and it is `economy`'s, not this module's.
function allowedDropMax(eco) {
  let best = 0;
  for (const d of BUILDINGS) {
    if (!d.drop) continue;
    if (eco && !eco.isUnlocked(d)) continue;
    if (d.drop.max > best) best = d.drop.max;
  }
  return Math.min(TOP_TIER, best + 1);
}

// Cost of the NEXT level, or 0 when there is no next level.
export function upgradeCost(b, ctx) {
  const base = upgradeBaseDef(b);
  if (!base || !ladderOf(base)) return 0;
  const lv = upgradeLevels(b);
  if (lv >= UPGRADES.maxLevel) return 0;
  const c = UPGRADES.cost[costKey(base)] || UPGRADES.cost.belt;
  const eco = econOf(ctx);
  const price = eco ? eco.priceOf(base) : base.cost;
  return Math.max(1, Math.round(price * c.base * c.growth ** lv));
}

// Why the next level cannot be bought, or null if it can. A string rather than a boolean because
// "you are at the last level", "you cannot afford it" and "the material is still locked" want three
// different sentences in the panel, and only this module knows which one applies.
export function upgradeBlock(b, ctx) {
  const base = upgradeBaseDef(b);
  if (!base || !ladderOf(base)) return 'unsupported';
  const lv = upgradeLevels(b);
  if (lv >= UPGRADES.maxLevel) return 'max';
  const eco = econOf(ctx);
  if (ladderOf(base) === 'dropper') {
    const next = upgradeDefFor(base, lv + 1);
    if (next.drop.max > allowedDropMax(eco)) return 'locked';
  }
  if (eco && eco.money < upgradeCost(b, ctx)) return 'money';
  return null;
}

export function canUpgrade(b, ctx) {
  return upgradeBlock(b, ctx) === null;
}

// Buys one level. Charges EXACTLY what upgradeCost() quoted, and only after every refusal has been
// checked — a refused upgrade must cost nothing, and money must never be able to go negative, so
// the balance test and the debit are adjacent and there is nothing between them that can fail.
export function applyUpgrade(b, ctx) {
  const level = upgradeLevels(b);
  const reason = upgradeBlock(b, ctx);
  if (reason) return { ok: false, reason, spent: 0, level };
  const eco = econOf(ctx);
  const cost = upgradeCost(b, ctx);
  if (!eco || eco.money < cost) return { ok: false, reason: 'money', spent: 0, level };
  eco.money -= cost;
  b.upSpent = (b.upSpent || 0) + cost;
  const now = setUpgradeLevel(b, level + 1);
  // Same envelope every other machine reacts through, so a bought level flashes the building
  // without this module knowing anything about the renderer.
  b.flash = 1;
  return { ok: true, reason: null, spent: cost, cost, level: now };
}

// What the levels on this building hand back when it is torn out or swapped for something else.
// Falls back to re-deriving the ladder at today's price when `upSpent` is absent, which is what a
// restored save looks like.
export function upgradeRefund(b, ctx) {
  const lv = upgradeLevels(b);
  if (!lv) return 0;
  let spent = b.upSpent;
  if (!Number.isFinite(spent)) {
    const base = upgradeBaseDef(b);
    const c = UPGRADES.cost[costKey(base)] || UPGRADES.cost.belt;
    const eco = econOf(ctx);
    const price = eco ? eco.priceOf(base) : base.cost;
    spent = 0;
    for (let i = 0; i < lv; i += 1) spent += Math.round(price * c.base * c.growth ** i);
  }
  return Math.round(spent * UPGRADES.refund);
}

// Rotating a machine in place is world.replace: a delete followed by a place, which produces a NEW
// building object. Levels belong to the machine, not to the cell, so they ride across only when the
// definition is genuinely the same one.
export function carryUpgrade(from, to) {
  if (!from || !to) return 0;
  const a = upgradeBaseDef(from);
  const c = upgradeBaseDef(to);
  if (!a || !c || a.id !== c.id) return 0;
  to.upSpent = from.upSpent;
  return setUpgradeLevel(to, upgradeLevels(from));
}

// --- what the panel reads ------------------------------------------------------

function round(v, n) {
  const k = 10 ** (n === undefined ? 2 : n);
  return Math.round(v * k) / k;
}

function materialRange(drop) {
  return drop.min === drop.max ? tierName(drop.min) : `${tierName(drop.min)}–${tierName(drop.max)}`;
}

// The stat lines for a definition at a given level, in the words the panel prints. Built from the
// definition itself, so a number shown here is by construction the number the sim is running on.
function statsOf(d) {
  switch (ladderOf(d)) {
    case 'dropper':
      return [
        { label: 'Material', value: materialRange(d.drop) },
        { label: 'Rate', value: `${round(d.drop.rate)}/s` },
      ];
    case 'belt':
      return [{ label: 'Speed', value: `${round(d.speed)}/s` }];
    case 'upgrader': {
      const u = d.upg;
      if (u.kind === 'flat') return [{ label: 'Adds', value: `+${round(u.amount, 1)}` }];
      if (u.kind === 'tier') {
        return [
          { label: 'Effect', value: '+1 material tier' },
          { label: 'Fires', value: u.once ? 'once per item' : 'every pass' },
          { label: 'Cooldown', value: `${round(u.cooldown)}s` },
        ];
      }
      const rows = [{ label: 'Multiplies', value: `×${round(u.amount)}` }];
      if (u.destroy) rows.push({ label: 'Destroys', value: `${Math.round(u.destroy * 100)}% of items` });
      return rows;
    }
    case 'sell':
      return [{ label: 'Payout', value: `×${round(d.payMult || 1)}` }];
    case 'vault':
      return [
        { label: 'Holds', value: `${d.store.cap} items` },
        { label: 'Releases', value: `${round(d.store.rate, 1)}/s` },
      ];
    case 'furnace':
      return [
        { label: 'Fuses', value: `${d.fuse.need} → 1` },
        { label: 'Bonus', value: `×${round(d.fuse.bonus)}` },
      ];
    default:
      return [];
  }
}

// One sentence about what the next level BUYS, in plain words. The panel prints this above the
// numbers; the numbers are the diff below it.
function summaryFor(base, from, to) {
  switch (ladderOf(base)) {
    case 'dropper':
      if (to.drop.max !== from.drop.max) return `Reaches ${tierName(to.drop.max)}. Better material is worth far more than a faster belt while the item cap is what limits you.`;
      if (to.drop.min !== from.drop.min) return `Stops rolling ${tierName(from.drop.min)}. Every slot this dropper fills is now worth more.`;
      return 'Drops faster. Worth little once the factory sits at the item cap — this dropper has no better material left to reach.';
    case 'belt':
      return 'Items cross this tile quicker, so they spend less of their life in transit. One tile of a long run is a small share of it, and a faster tile also gives an item less time to clear an upgrader cooldown.';
    case 'upgrader': {
      if (base.upg.kind === 'tier') {
        return from.upg.once
          ? 'Stops firing only once per item, so a looped line can raise the same item again. On a single straight run this changes nothing.'
          : 'Shorter cooldown, so an item coming round a loop can be raised again sooner. Nothing on a straight run.';
      }
      return base.upg.kind === 'flat'
        ? 'A bigger flat bonus. Flat bonuses are worth most on cheap material, so this is a line that adds before it multiplies.'
        : 'A bigger multiplier. Multipliers are worth most on expensive material, so put this behind your adders.';
    }
    case 'sell':
      return 'Everything sold on this pad is worth more. The purest value-per-slot buy there is, and priced like it.';
    case 'vault':
      return 'More parking and a faster release. Parked items still count against the item cap — a vault smooths a burst, it does not raise your ceiling.';
    case 'furnace':
      return 'Four items become one worth more of their combined value. Fusing is the only thing in the game that GIVES slots back, so a bigger bonus is compounding twice.';
    default:
      return '';
  }
}

const BLOCK_TEXT = {
  max: 'Fully upgraded.',
  money: 'Not enough money.',
  locked: 'Locked: unlock a dropper that reaches this material first.',
  unsupported: 'This building cannot be upgraded.',
};

// Everything the panel needs, in one call, with no further questions to ask.
export function upgradeInfo(b, ctx) {
  const base = upgradeBaseDef(b);
  const level = upgradeLevels(b);
  const max = upgradeMax(b);
  if (!base || !max) {
    return { name: base ? base.name : '', ladder: null, level: 0, max: 0, atMax: true, stats: [], next: null };
  }
  const cur = upgradeDefFor(base, level);
  const out = {
    name: base.name,
    ladder: ladderOf(base),
    level,
    max,
    atMax: level >= max,
    stats: statsOf(cur),
    refund: upgradeRefund(b, ctx),
    next: null,
  };
  if (out.atMax) {
    out.blocked = 'max';
    out.blockedText = BLOCK_TEXT.max;
    return out;
  }
  const nextDef = upgradeDefFor(base, level + 1);
  const from = statsOf(cur);
  const to = statsOf(nextDef);
  const changes = [];
  for (let i = 0; i < to.length; i += 1) {
    if (!from[i] || from[i].value === to[i].value) continue;
    changes.push({ label: to[i].label, from: from[i].value, to: to[i].value });
  }
  const blocked = upgradeBlock(b, ctx);
  out.blocked = blocked;
  out.blockedText = blocked ? BLOCK_TEXT[blocked] || '' : '';
  out.next = {
    level: level + 1,
    cost: upgradeCost(b, ctx),
    summary: summaryFor(base, cur, nextDef),
    changes,
    stats: to,
    affordable: blocked !== 'money',
    available: blocked === null,
  };
  return out;
}

// --- save / restore ------------------------------------------------------------
// Kept OUT of the per-building save entry on purpose: `economy.snapshot` writes
// `[id, cx, cz, rot]` and every older save on disk is that exact shape. A separate optional field
// means a v3 save without it restores as a factory with no levels, which is precisely what it was.
//
// Keyed by cell AND deck, because a ground belt and a sky belt legitimately share (cx, cz).

export function upgradeSnapshot(buildings) {
  const out = [];
  for (const b of buildings) {
    const lv = upgradeLevels(b);
    if (!lv) continue;
    const base = upgradeBaseDef(b);
    out.push([b.cx, b.cz, (base.levels && base.levels[0]) || 0, lv, Math.round(b.upSpent || 0)]);
  }
  return out;
}

export function applyUpgradeSave(list, buildings) {
  if (!Array.isArray(list) || !list.length) return 0;
  const byCell = new Map();
  for (const b of buildings) {
    const base = upgradeBaseDef(b);
    if (!base) continue;
    byCell.set(`${b.cx},${b.cz},${(base.levels && base.levels[0]) || 0}`, b);
  }
  let n = 0;
  for (const e of list) {
    const b = byCell.get(`${e[0]},${e[1]},${e[2]}`);
    if (!b) continue;
    if (Number.isFinite(e[4])) b.upSpent = e[4];
    if (setUpgradeLevel(b, e[3]) > 0) n += 1;
  }
  return n;
}

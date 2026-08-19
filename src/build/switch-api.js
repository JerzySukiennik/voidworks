// Voidworks — the switch conveyor, as seen from the UI side.
//
// The sim half of this machine (`src/world/belt.js`, `src/world/buildings.js`) is another builder's
// file and was not in the tree when the input and the affordance were written. So this is an
// ADAPTER, not a guess dressed as an API: it probes for the names the sim said it would expose,
// falls back to a short list of obvious aliases, and — only if it finds nothing at all — keeps the
// setting on the building itself so the control is still honest about what it changed.
//
// Two rules, both load-bearing:
//
//   1. Nothing in here throws when the sim half is absent. A UI that hard-failed on a missing
//      function would take the whole page down every time the two halves landed out of order.
//   2. Nothing in here implements routing. `live` reports whether a real sim is behind the toggle,
//      and every caller is expected to say so rather than pretend. A UI that quietly moved a number
//      nobody reads is worse than one that admits the engine is not there yet: it looks like it works.
//
// It is one module rather than a copy in the inspector and another in placement.js because the two
// must agree about which arm is live — a panel and a world marker disagreeing about the same switch
// is the exact bug this control exists to prevent.

import { SWITCH } from '../config.js';
// Namespace import, not named: if the catalogue ever renames these the module still LOADS and the
// probes below fall back, instead of the whole UI failing to parse over one missing export.
import * as CATALOGUE from '../world/buildings.js';

// What the sim might call the definition flag. `switch` is the name the config block uses; the rest
// are the shapes the same idea has taken elsewhere in this catalogue.
const DEF_FLAGS = ['switch', 'switchable', 'points', 'toggleOut'];
const DEF_IDS = ['belt_switch', 'switch', 'belt_points'];

// Read / write / toggle, in the order they will be tried on `world.flow`.
const READ = ['switchOf', 'switchArm', 'switchArmOf', 'switchStateOf', 'armOf', 'switchDirOf'];
const SET = ['setSwitch', 'setSwitchArm', 'setArm'];
const TOGGLE = ['toggleSwitch', 'cycleSwitch', 'flipSwitch', 'toggleArm'];

// Resolved on every call, NOT bound once at construction. This module exists precisely because the
// sim half may land after the UI is already running — and a `.bind()` taken at construction time
// captures whatever was there THEN, so a late-arriving engine would be permanently invisible and the
// local fallback would silently own state the sim was supposed to own. The test suite caught exactly
// that: a spy installed on `world.flow` after boot was never called, while the control still
// appeared to work. Late lookup costs one property read per click.
function pick(src, names) {
  if (!src) return null;
  for (let i = 0; i < names.length; i += 1) {
    const fn = src[names[i]];
    if (typeof fn === 'function') return (...args) => src[names[i]](...args);
  }
  return null;
}

export function isSwitchDef(d) {
  if (!d) return false;
  // The catalogue's own predicate is the authority when it exists — the same rule `hasFilter()`
  // already sets for the material affordance: one question per affordance, asked of buildings.js,
  // never a list of ids kept in a UI file.
  if (typeof CATALOGUE.isSwitch === 'function') return !!CATALOGUE.isSwitch(d);
  for (const f of DEF_FLAGS) if (d[f] === true) return true;
  if (DEF_IDS.indexOf(d.id) >= 0) return true;
  return false;
}

// How many exits this switch offers. The definition wins if it says; otherwise the config block's
// `arms`, clamped to the lanes the piece actually has — a switch with two lanes must not offer three.
export function armCountOf(d, b) {
  const lanes = usableLanes(b);
  const want = Number.isFinite(d && d.arms) ? d.arms | 0 : (SWITCH && SWITCH.arms) | 0;
  const n = want > 0 ? want : 3;
  return lanes.length ? Math.min(n, lanes.length) : n;
}

export function armLabel(i) {
  if (typeof CATALOGUE.switchArmLabel === 'function') return CATALOGUE.switchArmLabel(i);
  const l = (SWITCH && SWITCH.labels) || [];
  return l[i] || `Exit ${i + 1}`;
}

// The lanes that can be an ARM: not the emitter a dropper carries, not a sink face, not a store's
// output. Order is definition order, which is the contract the config block states (straight, left,
// right) — so arm k is lane k unless the sim tagged them, in which case the tag wins.
export function usableLanes(b) {
  const ls = (b && b.lanes) || [];
  const out = [];
  for (let i = 0; i < ls.length; i += 1) {
    const l = ls[i];
    if (!l || !l.pts || l.emit || l.sink || l.isOut) continue;
    out.push(l);
  }
  return out;
}

export function laneForArm(b, k) {
  const ls = (b && b.lanes) || [];
  // An explicit tag from the sim beats positional order, always: if belt.js says which lane is arm
  // k, it is not this module's business to have an opinion. Baked lanes carry `arm`, and every lane
  // that is NOT a switch exit carries -1, so matching on `=== k` is safe even for k = 0 and cannot
  // pick up an ordinary belt's only lane by accident.
  for (let i = 0; i < ls.length; i += 1) if (ls[i] && ls[i].arm === k) return ls[i];
  const use = usableLanes(b);
  return use[k] || use[0] || null;
}

export function createSwitchApi(world) {
  // `world.flow` itself is re-read too: a world that swaps its flow object on reset must not leave
  // this adapter talking to a dead one.
  const flow = () => (world && world.flow) || null;
  const read = () => pick(flow(), READ);
  const set = () => pick(flow(), SET);
  const toggle = () => pick(flow(), TOGGLE);
  // "Live" means the SIM is the one holding the answer, asked fresh every time. With only a toggle
  // and no reader it still counts as live — the sim owns the state, we mirror what it returned.
  const isLive = () => !!(toggle() || set() || read());

  // The fallback store. Deliberately written onto the building as `switchArm` rather than into a
  // Map here: `switchArm` is the field name the sim is most likely to read, so if belt.js lands with
  // a reader and no writer, everything this module already set is immediately correct.
  function localGet(b) {
    if (!b) return 0;
    if (Number.isFinite(b.switchArm)) return b.switchArm | 0;
    if (Number.isFinite(b.switchOut)) return b.switchOut | 0;
    return ((SWITCH && SWITCH.defaultArm) | 0) || 0;
  }

  function normalise(v, n) {
    if (Number.isFinite(v)) return ((v | 0) % n + n) % n;
    // A reader that answers with an object or a name rather than an index.
    if (v && typeof v === 'object' && Number.isFinite(v.arm)) return ((v.arm | 0) % n + n) % n;
    if (typeof v === 'string') {
      const i = ((SWITCH && SWITCH.labels) || []).indexOf(v);
      if (i >= 0) return i % n;
    }
    return -1;
  }

  function count(b) {
    return Math.max(1, armCountOf(b && b.def, b));
  }

  function armOf(b) {
    // -1 for anything that is not a switch, matching what the sim's own switchOf() answers. Without
    // this the sim's -1 would come back through normalise() as the LAST arm, and a caller that
    // skipped the isSwitch() check would be handed a plausible number for a machine with no arms.
    if (!b || !isSwitchDef(b.def)) return -1;
    const n = count(b);
    const r = read();
    if (r) {
      const v = normalise(r(b), n);
      if (v >= 0) return v;
    }
    return normalise(localGet(b), n);
  }

  function setArm(b, i) {
    if (!b || !isSwitchDef(b.def)) return -1;
    const n = count(b);
    const want = ((i | 0) % n + n) % n;
    const st = set();
    if (st) {
      const r = st(b, want);
      const v = normalise(r, n);
      // A setter that returns nothing useful is not a failure; re-read instead of distrusting it.
      return v >= 0 ? v : armOf(b);
    }
    b.switchArm = want;
    // A sim that rebuilds links rather than testing per item needs to be told. Cheap, optional, and
    // harmless on an implementation that does not care.
    world.flow?.markDirty?.();
    b.flash = 1;
    return want;
  }

  function toggleArm(b) {
    if (!b || !isSwitchDef(b.def)) return -1;
    const tg = toggle();
    if (tg) {
      const r = tg(b);
      const v = normalise(r, count(b));
      return v >= 0 ? v : armOf(b);
    }
    return setArm(b, armOf(b) + 1);
  }

  return {
    // Is this thing a switch at all? The one question every caller asks first.
    isSwitch: (d) => isSwitchDef(d),
    armCount: (b) => count(b),
    armOf,
    setArm,
    toggle: toggleArm,
    label: armLabel,
    laneForArm,
    // Does the arm this switch is set to actually lead anywhere? A switch pointed at open floor is
    // legal (SWITCH.hideDeadArms is false, same rule as a sorter's arms) but the player should be
    // told, not left wondering where the items went.
    armIsDead(b) {
      const l = laneForArm(b, armOf(b));
      if (!l) return false;
      return !l.link && !l.sink;
    },
    // True when a real sim is behind the toggle. Every surface that can lie about this must read it,
    // and it is a getter rather than a stored flag so a late-landing engine flips it without a reload.
    get live() { return isLive(); },
    // Which names were actually found — for the test suite and for a human debugging a half-landed
    // integration, so "the button does nothing" has an answer that is not a guess.
    probe: () => ({ read: !!read(), set: !!set(), toggle: !!toggle(), live: isLive() }),
  };
}

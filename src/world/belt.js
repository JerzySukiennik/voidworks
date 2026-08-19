// Voidworks — belt graph: lane baking, linking, back-pressured item motion and the instanced item draw.

import { GRID, FLOW, ECONOMY, SORTER, SELLPAD, DELIVERY, SWITCH } from '../config.js';
import { dirVec, rotOffset, opposite } from './grid.js';
import { rollTier, rollValue, clampTier, TOP_TIER } from './items.js';

const KIND_BIT = { flat: 1, mult: 2, multCap: 4, tier: 16, gamble: 32 };

export function createFlow(ctx) {
  const { grid, economy, instancer } = ctx;
  const MAX = FLOW.maxItems;

  const iTier = new Uint8Array(MAX);
  const iValue = new Float32Array(MAX);
  const iT = new Float32Array(MAX);
  // --- per-item, PER-BUILDING gate cooldowns -------------------------------------
  // This used to be two timers per item — one for `flat` gates, one for every other kind — which is
  // not what a cooldown on a machine means. A gate's cooldown never stopped THAT gate re-farming an
  // item; it stopped every OTHER gate of the same class the item met before the clock ran out. At
  // beltSpeed 2.4 a cell takes 0.417 s while cooldowns rise with strength (x1.25 -> 0.5 s, x3 -> 1.0,
  // x5 -> 1.4, x10 -> 2.0), so the STRONGER, later gate on a tight line was the one silently
  // swallowed: a x5 placed one tile after a x3 never fired at all, and its value never showed up on
  // the item or as a pop. Jurek reported it as "the x5 does not make items grow"; it was not a
  // visual bug, the machine was inert. Two belts of separation made it work again, which is how a
  // deterministic threshold sitting exactly on the upstream gate's cooldown showed itself.
  //
  // So the cooldown is now keyed on (item, BUILDING): CD_SLOTS recent gates per item, each slot a
  // building uid and the sim time its cooldown expires. Fixed arrays, no allocation, no map. Eight
  // slots because a looped line can carry several gates between one machine and the item's return
  // to it, and the anti-loop intent — one gate must not re-farm the same item as it comes round —
  // only holds while that gate is still remembered. ECONOMY.maxUpgradesPerItem still caps the chain
  // at 12 firings per item, so this cannot become unbounded.
  //
  // 8 slots * 900 items * (4 + 4) bytes = 57 KB, paid once at boot.
  const CD_SLOTS = 8;
  const iCdUid = new Int32Array(MAX * CD_SLOTS);
  const iCdEnd = new Float32Array(MAX * CD_SLOTS);
  // The sim's own clock, advanced by update(dt). Absolute expiry times mean nothing is decremented
  // per item per tick — the old pair of timers cost two writes per item per frame purely to keep a
  // number that was almost always zero.
  let simNow = 0;

  function cdClear(id) {
    const base = id * CD_SLOTS;
    for (let k = 0; k < CD_SLOTS; k += 1) iCdUid[base + k] = 0;
  }

  // Is this exact building still cooling down on this exact item?
  function cdBlocked(id, uid) {
    const base = id * CD_SLOTS;
    for (let k = 0; k < CD_SLOTS; k += 1) {
      if (iCdUid[base + k] === uid) return iCdEnd[base + k] > simNow;
    }
    return false;
  }

  // Remember that `uid` just fired on this item. Reuse its own slot if it has one, else take an
  // expired slot, else evict the slot that expires soonest — the one whose memory is worth least.
  function cdSet(id, uid, seconds) {
    const base = id * CD_SLOTS;
    let slot = -1;
    let worst = -1;
    let worstEnd = Infinity;
    for (let k = 0; k < CD_SLOTS; k += 1) {
      const u = iCdUid[base + k];
      if (u === uid) { slot = k; break; }
      if (u === 0 || iCdEnd[base + k] <= simNow) { if (slot < 0) slot = k; continue; }
      if (iCdEnd[base + k] < worstEnd) { worstEnd = iCdEnd[base + k]; worst = k; }
    }
    if (slot < 0) slot = worst < 0 ? 0 : worst;
    iCdUid[base + slot] = uid;
    iCdEnd[base + slot] = simNow + (seconds > 0 ? seconds : 0);
  }
  const iFlash = new Float32Array(MAX);
  const iUses = new Uint8Array(MAX);
  const iKinds = new Uint8Array(MAX);
  const iSpin = new Float32Array(MAX);

  const freeList = new Int32Array(MAX);
  let freeTop = MAX;
  for (let i = 0; i < MAX; i += 1) freeList[i] = MAX - 1 - i;
  let live = 0;
  let stored = 0;

  // Conservation ledger. `spawned - sold - destroyed === live` must hold at every instant; it is the
  // property that makes every other claim about the sim checkable, so it is instrumented, not assumed.
  const st = { spawned: 0, sold: 0, destroyed: 0 };

  // The orders module is created after the flow (it needs the economy, which the world builds first),
  // so the hook is settable rather than construction-only. One line of wiring in world.js instead of
  // a reordering of its boot.
  let onDeliver = ctx.onDeliver || null;

  // --- what the order board wants ------------------------------------------------
  // The Delivery Pad has no material setting: it accepts whatever a live order still needs and
  // destroys the rest. That answer changes when an order is issued, completed or expires — a few
  // times a minute — while items arrive at the pad constantly, so it is CACHED here and invalidated
  // on the board's own version counter rather than recomputed per item. `wantSrc` is anything with
  // wantedMask() and wantedVersion(); orders.js is exactly that shape.
  let wantSrc = ctx.orders && typeof ctx.orders.wantedMask === 'function' ? ctx.orders : null;
  let wantMask = 0;
  let wantVer = -1;

  // Bitmask over material tiers with an open contract. 0 = the board is empty, orders are switched
  // off, or nothing is wired yet — all three mean "no demand", never "reject everything".
  function setWantedSource(src) {
    wantSrc = src && typeof src.wantedMask === 'function' && typeof src.wantedVersion === 'function' ? src : null;
    wantVer = -1;
    wantMask = 0;
  }

  function wantedMask() {
    if (!wantSrc) return 0;
    const v = wantSrc.wantedVersion();
    if (v !== wantVer) { wantVer = v; wantMask = wantSrc.wantedMask() | 0; }
    return wantMask;
  }

  let laneList = [];
  let emitters = [];
  let stores = [];
  let dirty = true;
  let runningLanes = 0;
  const tmp = [0, 0];

  function alloc() {
    if (freeTop === 0) return -1;
    freeTop -= 1;
    live += 1;
    return freeList[freeTop];
  }

  // Items that reach the end of a belt with nowhere to go do not park politely — the factory hangs in
  // a void, so they fall out of it. A stalled queue backing up behind a full belt is different and
  // still parks; this is only for a run that simply ENDS.
  const falling = [];

  function dropOff(lane, id) {
    sample(lane, iT[id], pos);
    falling.push({ id, x: pos[0], y: pos[1], z: pos[2], vy: 0, spin: iSpin[id], t: iTier[id] });
  }

  function stepFalling(dt) {
    for (let i = falling.length - 1; i >= 0; i -= 1) {
      const f = falling[i];
      f.vy -= FLOW.gravity * dt;
      f.y += f.vy * dt;
      f.spin += dt * FLOW.fallSpin;
      if (f.y < FLOW.fallKillY) {
        release(f.id);
        st.destroyed += 1;
        falling[i] = falling[falling.length - 1];
        falling.pop();
      }
    }
  }

  function release(id) {
    // The id goes straight back on the free list, so its gate memory has to die with it — otherwise
    // a recycled slot arrives at a machine already "cooling down" from an item that no longer exists.
    cdClear(id);
    freeList[freeTop] = id;
    freeTop += 1;
    live -= 1;
  }

  function initItem(id, tierIdx, value) {
    iTier[id] = tierIdx;
    iValue[id] = value;
    cdClear(id);
    iFlash[id] = 0;
    iUses[id] = 0;
    iKinds[id] = 0;
    iSpin[id] = Math.random() * 6.283;
  }

  // --- baking -----------------------------------------------------------------

  function bakeLane(b, s) {
    const n = s.pts.length / 3;
    const pts = new Float32Array(n * 3);
    const cum = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      rotOffset(s.pts[i * 3], s.pts[i * 3 + 2], b.rot, tmp);
      pts[i * 3] = b.cx + tmp[0];
      pts[i * 3 + 1] = GRID.beltY + s.pts[i * 3 + 1] + FLOW.itemLift;
      pts[i * 3 + 2] = b.cz + tmp[1];
    }
    for (let i = 1; i < n; i += 1) {
      const dx = pts[i * 3] - pts[i * 3 - 3];
      const dy = pts[i * 3 + 1] - pts[i * 3 - 2];
      const dz = pts[i * 3 + 2] - pts[i * 3 - 1];
      cum[i] = cum[i - 1] + Math.hypot(dx, dy, dz);
    }
    rotOffset(s.inCell[0], s.inCell[1], b.rot, tmp);
    const inX = b.cx + tmp[0];
    const inZ = b.cz + tmp[1];
    rotOffset(s.outCell[0], s.outCell[1], b.rot, tmp);
    const outX = b.cx + tmp[0];
    const outZ = b.cz + tmp[1];
    const len = cum[n - 1];
    return {
      b,
      pts,
      cum,
      n,
      len,
      inDir: s.inDir < 0 ? -1 : (s.inDir + b.rot) & 3,
      outDir: s.outDir < 0 ? -1 : (s.outDir + b.rot) & 3,
      inX, inZ, outX, outZ,
      entryY: pts[1],
      exitY: pts[(n - 1) * 3 + 1],
      speed: b.def.speed,
      sink: !!s.sink,
      isOut: !!s.out,
      // 0 = takes anything (every belt in the game). 1 = the filtered tier's arm of a sorter.
      // 2 = the everything-else arm. Baked once; the routing decision reads it per item.
      route: s.route || 0,
      // Which exit of a switch conveyor this lane is. -1 on every other belt in the game. Baked once;
      // the routing decision compares it against the building's current setting.
      arm: s.arm === undefined ? -1 : s.arm,
      emit: false,
      trig: s.trig === undefined ? -1 : s.trig * len,
      items: [],
      link: null,
    };
  }

  // --- per-building material filter -------------------------------------------
  // A sorter and a Contract Pad each carry ONE number: which material tier they care about. It is
  // set here rather than in world.js so that every path that creates a building — the player, a save
  // restore, a network mirror, a test — gets a valid default without any of them having to know.
  // Baking is also the only moment all three share.

  function filterOf(b) {
    return b && b.filterTier !== undefined ? b.filterTier : SORTER.defaultTier;
  }

  function setFilter(b, t) {
    if (!b || !b.def.filter) return -1;
    b.filterTier = clampTier(t);
    b.flash = 1;
    return b.filterTier;
  }

  function cycleFilter(b, dir) {
    if (!b || !b.def.filter) return -1;
    const n = TOP_TIER + 1;
    return setFilter(b, (filterOf(b) + (dir || 1) + n * 2) % n);
  }

  // --- the switch conveyor's one number ------------------------------------------
  // A switch is a manual points: which arm is open is a property the PLAYER sets and nothing in the
  // sim ever changes. It lives on the building as `switchArm` for the same reason `filterTier` does
  // — every path that creates a building (player, save restore, network mirror, test) gets a valid
  // default without any of them having to know the field exists.

  function armCount(b) {
    return b && b.def.lanes ? b.def.lanes.length : SWITCH.arms;
  }

  function switchOf(b) {
    if (!b || !b.def.switchable) return -1;
    return b.switchArm === undefined ? SWITCH.defaultArm : b.switchArm;
  }

  function setSwitch(b, i) {
    if (!b || !b.def.switchable) return -1;
    const n = armCount(b);
    let v = i | 0;
    v = ((v % n) + n) % n;
    b.switchArm = v;
    b.flash = 1;
    return v;
  }

  // The one call the input piece needs. `dir` defaults to +1; pass -1 to step back.
  function toggleSwitch(b, dir) {
    if (!b || !b.def.switchable) return -1;
    return setSwitch(b, switchOf(b) + (dir === undefined ? 1 : dir));
  }

  function bake(b) {
    const def = b.def;
    if (def.filter && b.filterTier === undefined) b.filterTier = clampTier(SORTER.defaultTier);
    if (def.switchable && b.switchArm === undefined) b.switchArm = SWITCH.defaultArm;
    b.lanes = [];
    const specs = def.lanes || [];
    for (let i = 0; i < specs.length; i += 1) b.lanes.push(bakeLane(b, specs[i]));

    if (def.drop) {
      const dc = def.drop.cell || (def.cells.length > 1 ? [1, 0] : [0, 0]);
      rotOffset(dc[0], dc[1], b.rot, tmp);
      b.lanes.push({
        b, pts: null, cum: null, n: 0, len: 0,
        inDir: -1, outDir: b.rot & 3,
        inX: b.cx + tmp[0], inZ: b.cz + tmp[1],
        outX: b.cx + tmp[0], outZ: b.cz + tmp[1],
        entryY: GRID.beltY, exitY: GRID.beltY + FLOW.itemLift,
        speed: 0, sink: false, isOut: false, emit: true,
        trig: -1, items: [], link: null,
      });
      b.timer = FLOW.spawnGrace;
    }

    if (def.store || def.fuse) {
      const cap = def.store ? def.store.cap : def.fuse.need * 3;
      // A store holds ITEM IDS, not copies of their numbers. The item never leaves the pool, so it
      // never leaves the item cap either, and its uses / once-flags / cooldowns are still its own
      // when it comes back out. Storage is a place to stand, not a way to be reborn.
      b.store = { ids: new Int32Array(cap), head: 0, count: 0, cap, acc: 0 };
      b.outLane = b.lanes.find((l) => l.isOut) || null;
    }

    for (const l of b.lanes) bakeSamples(l);
    bakeSiblings(b);
  }

  // --- intra-machine conflicts -------------------------------------------------
  // Two lanes of the SAME machine can run close enough that an item on one sits inside an item on
  // the other: a merger's side arm curls in tangent to its main line, a splitter's three arms all
  // leave from one tile. Arc-length spacing is blind to it — the two items are far apart along both
  // curves and merely near each other in the world. So the crossing is treated as a room with space
  // for one: whichever lane reaches it first holds it, and the others wait at the door. The rule is
  // symmetric — a lane may not drive INTO an occupied crossing, but an item already inside one is
  // always free to leave — so the occupant always has a way out and a machine cannot jam itself.

  const CONF_SAMPLES = 12;

  function bakeSamples(l) {
    l.sp = null;
    if (!l.pts || l.len <= 1e-6) return;
    const sp = new Float32Array(CONF_SAMPLES * 3);
    const o = [0, 0, 0];
    for (let i = 0; i < CONF_SAMPLES; i += 1) {
      sample(l, (l.len * i) / (CONF_SAMPLES - 1), o);
      sp[i * 3] = o[0];
      sp[i * 3 + 1] = o[1];
      sp[i * 3 + 2] = o[2];
    }
    l.sp = sp;
    l.sk = (CONF_SAMPLES - 1) / l.len;
  }

  function bakeSiblings(b) {
    const ls = b.lanes;
    const s2 = FLOW.itemSpacing * FLOW.itemSpacing;
    for (const l of ls) l.siblings = null;
    for (let i = 0; i < ls.length; i += 1) {
      const a = ls[i];
      if (!a.sp || a.sink || a.emit) continue;
      for (let j = 0; j < i; j += 1) {
        const c = ls[j];
        // Sinks consume on arrival, so nothing ever parks on one and nothing can collide with it.
        if (!c.sp || c.sink || c.emit) continue;
        let dmin = Infinity;
        for (let p = 0; p < CONF_SAMPLES; p += 1) {
          for (let q = 0; q < CONF_SAMPLES; q += 1) {
            const dx = a.sp[p * 3] - c.sp[q * 3];
            const dy = a.sp[p * 3 + 1] - c.sp[q * 3 + 1];
            const dz = a.sp[p * 3 + 2] - c.sp[q * 3 + 2];
            const d = dx * dx + dy * dy + dz * dz;
            if (d < dmin) dmin = d;
          }
        }
        if (dmin >= s2) continue;
        (a.siblings || (a.siblings = [])).push(c);
        (c.siblings || (c.siblings = [])).push(a);
      }
    }
  }

  // Would an item standing at `t` on this lane be inside an item riding a lane it must yield to?
  function nearSibling(lane, t) {
    const sibs = lane.siblings;
    if (!sibs) return false;
    const sp = lane.sp;
    let i = Math.round(t * lane.sk);
    if (i < 0) i = 0; else if (i >= CONF_SAMPLES) i = CONF_SAMPLES - 1;
    const ax = sp[i * 3];
    const ay = sp[i * 3 + 1];
    const az = sp[i * 3 + 2];
    const s2 = FLOW.itemSpacing * FLOW.itemSpacing;
    for (let k = 0; k < sibs.length; k += 1) {
      const c = sibs[k];
      const its = c.items;
      for (let m = 0; m < its.length; m += 1) {
        let j = Math.round(iT[its[m]] * c.sk);
        if (j < 0) j = 0; else if (j >= CONF_SAMPLES) j = CONF_SAMPLES - 1;
        const dx = ax - c.sp[j * 3];
        const dy = ay - c.sp[j * 3 + 1];
        const dz = az - c.sp[j * 3 + 2];
        if (dx * dx + dy * dy + dz * dz < s2) return true;
      }
    }
    return false;
  }

  function add(b) {
    bake(b);
    dirty = true;
  }

  function remove(b) {
    for (const l of b.lanes || []) {
      for (const id of l.items) { release(id); st.destroyed += 1; }
      l.items.length = 0;
    }
    if (b.store) {
      const s = b.store;
      for (let k = 0; k < s.count; k += 1) { release(s.ids[(s.head + k) % s.cap]); st.destroyed += 1; }
      stored -= s.count;
      s.count = 0;
      s.head = 0;
    }
    b.lanes = [];
    dirty = true;
  }

  // Hands the items riding a building over to the caller without releasing them, so a piece can be
  // swapped in place without the run losing what was on it. Fractions, because the replacement's
  // lane may be a different length (a curve for a straight, say).
  function detach(b) {
    const out = [];
    for (const l of b.lanes || []) {
      if (l.emit) continue;
      for (const id of l.items) out.push(id, l.len > 1e-6 ? iT[id] / l.len : 0);
      l.items.length = 0;
    }
    if (b.store) {
      const s = b.store;
      for (let k = 0; k < s.count; k += 1) out.push(s.ids[(s.head + k) % s.cap], 0);
      stored -= s.count;
      s.count = 0;
      s.head = 0;
    }
    b.lanes = [];
    dirty = true;
    return out;
  }

  function attach(b, carried) {
    const lane = (b.lanes || []).find((l) => !l.emit && !l.sink && l.len > 1e-6);
    for (let i = 0; i < carried.length; i += 2) {
      const id = carried[i];
      const t = lane ? Math.min(lane.len, carried[i + 1] * lane.len) : 0;
      if (lane && clearanceAt(lane, t, null) >= FLOW.itemSpacing) laneInsert(lane, id, t);
      else { release(id); st.destroyed += 1; }
    }
    dirty = true;
  }

  // --- linking ----------------------------------------------------------------

  function levelOf(y) { return y > GRID.beltY + FLOW.rampRise * 0.5 ? 1 : 0; }

  function nearestT(lane, x, z) {
    const p = lane.pts;
    let bestT = 0;
    let bestD = Infinity;
    for (let i = 1; i < lane.n; i += 1) {
      const ax = p[i * 3 - 3];
      const az = p[i * 3 - 1];
      const bx = p[i * 3];
      const bz = p[i * 3 + 2];
      const ex = bx - ax;
      const ez = bz - az;
      const l2 = ex * ex + ez * ez;
      let u = l2 > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = ax + ex * u - x;
      const dz = az + ez * u - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestT = lane.cum[i - 1] + (lane.cum[i] - lane.cum[i - 1]) * u;
      }
    }
    return { t: bestT, d: Math.sqrt(bestD) };
  }

  function relink() {
    laneList = [];
    emitters = [];
    stores = [];
    for (const b of ctx.buildings.values()) {
      for (const l of b.lanes) {
        if (l.emit) emitters.push(l);
        else laneList.push(l);
      }
      if (b.store) stores.push(b);
    }

    const all = laneList.concat(emitters);
    for (const l of all) { l.link = null; l.feeders = null; }
    for (const l of all) {
      if (l.outDir < 0 || l.sink) continue;
      const d = dirVec(l.outDir);
      const tx = l.outX + d[0];
      const tz = l.outZ + d[1];
      const target = grid.at(tx, tz, levelOf(l.exitY));
      if (!target || target === l.b) continue;
      const lanes = [];
      const t0 = [];
      for (const c of target.lanes) {
        if (c.emit || c.isOut || c.inDir < 0) continue;
        if (c.inX !== tx || c.inZ !== tz) continue;
        if (c.inDir === l.outDir) {
          if (Math.abs(c.entryY - l.exitY) > 0.18) continue;
          lanes.push(c);
          t0.push(0);
        } else if (c.inDir !== opposite(l.outDir) && !c.sink) {
          const hit = nearestT(c, tx, tz);
          if (hit.d > 0.4) continue;
          if (Math.abs(c.pts[1] - l.exitY) > 0.28) continue;
          lanes.push(c);
          t0.push(hit.t);
        }
      }
      if (!lanes.length) continue;
      // `sort` is the building being fed, and only when that building sorts. Carrying it on the LINK
      // rather than looking it up per item keeps the hot loop free of grid lookups and of branches
      // for the 99% of links that feed ordinary belt.
      // `sort` / `sw` are the building being fed, and only when that building sorts or switches.
      // Carrying them on the LINK rather than looking them up per item keeps the hot loop free of
      // grid lookups and of branches for the 99% of links that feed ordinary belt.
      l.link = {
        lanes, t0, rr: 0,
        sort: target.def.sort ? target : null,
        sw: target.def.switchable ? target : null,
      };
      // The reverse edge. Spacing is a property of the WORLD, not of one lane's parameter: the point
      // at t = len of this lane and the point at t0 of the lane it feeds are the same place. Without
      // an edge pointing back, a stalled belt packs items on top of each other across every join.
      for (let k = 0; k < lanes.length; k += 1) {
        const c = lanes[k];
        (c.feeders || (c.feeders = [])).push({ lane: l, t0: t0[k] });
      }
    }
    dirty = false;
  }

  // --- insertion & motion -----------------------------------------------------

  // Arc-length distance from `t` on `lane` to the nearest item that could collide with it — counting
  // items on the lane itself AND the parked head of every lane feeding into it, measured through the
  // join as one continuous curve. `ignore` is the lane the moving item is leaving, which must not
  // block itself. Feeder lists are one or two entries long, so this stays a handful of compares.
  // `ignoreFeeders` matters for one case: an actual hand-off. A rival feeder's head parked at the
  // join sits at exactly this point, so counting it means two feeders veto each other and NOTHING
  // can ever merge — which is precisely what a merger exists to do. At hand-off time the real
  // constraint is spacing against the items already ON the target lane; the item being inserted
  // becomes one of them immediately, so the next feeder is serialised correctly by the line above.
  function clearanceAt(lane, t, ignore, ignoreFeeders) {
    let best = Infinity;
    const items = lane.items;
    for (let i = 0; i < items.length; i += 1) {
      const d = Math.abs(iT[items[i]] - t);
      if (d < best) best = d;
    }
    const f = ignoreFeeders ? null : lane.feeders;
    if (f) {
      for (let i = 0; i < f.length; i += 1) {
        const src = f[i].lane;
        if (src === ignore) continue;
        const its = src.items;
        if (!its.length) continue;
        // items[0] is the furthest along, so it is the only one that can reach the join
        const g = (src.len - iT[its[0]]) + Math.abs(f[i].t0 - t);
        if (g < best) best = g;
      }
    }
    return best;
  }

  function laneRoom(lane, t) {
    return clearanceAt(lane, t, null) >= FLOW.itemSpacing && !nearSibling(lane, t);
  }

  // Which arms of a link is THIS item allowed to take? For every ordinary junction, all of them.
  // For a sorter, exactly one — and that is the whole feature. Routing is strict: an item of the
  // filtered tier may only take the filtered arm, everything else may only take the other, and a
  // blocked arm makes the item WAIT rather than spill down the wrong one. A sorter that leaked
  // under back-pressure would be a splitter with a label on it.
  function routeOk(link, lane, id) {
    const b = link.sort;
    if (!b || !lane.route) return true;
    return lane.route === (iTier[id] === filterOf(b) ? 1 : 2);
  }

  // Which arm of a switch is open. Unlike a sorter this does not depend on the item at all — the
  // answer is the same for everything, which is exactly what makes it a points and not a splitter.
  // Items ALREADY riding a closed arm are untouched: this gates entry only, so flipping the switch
  // under a moving line changes where the next item goes and never where the current one ends up.
  function armOk(link, lane) {
    const b = link.sw;
    if (!b || lane.arm < 0) return true;
    return lane.arm === switchOf(b);
  }

  // How much room the far side of a link has. An item may take any arm that is offered, so the arm
  // with the most room is what decides whether the head of this lane may roll up to its exit.
  // `id` is the head item: on a sorting link the answer depends on WHICH item is asking, because it
  // is only ever allowed one of the arms.
  function linkClearance(link, from, id) {
    const n = link.lanes.length;
    let anyLive = false;
    // A dead arm is a trap on a round-robin splitter, so those links only offer arms that lead
    // somewhere. A sorter is the opposite case: its arms are ASSIGNED, so an arm leading nowhere
    // must stay open and spill into the void exactly as a dead-ended belt already does — hiding it
    // would jam the whole line behind a material the player forgot to give an exit to.
    // A switch is the sorter case, not the splitter case: its arm is CHOSEN, so an arm leading
    // nowhere must stay open and spill into the void rather than be quietly skipped.
    if (n > 1 && !link.sort && !link.sw) {
      for (let k = 0; k < n; k += 1) {
        const c = link.lanes[k];
        if (c.link || c.sink) { anyLive = true; break; }
      }
    }
    let best = 0;
    for (let k = 0; k < n; k += 1) {
      const c = link.lanes[k];
      if (anyLive && !c.link && !c.sink) continue;
      if (link.sort && !routeOk(link, c, id)) continue;
      if (link.sw && !armOk(link, c)) continue;
      if (c.sink) return Infinity;
      // An arm barred by a lane it yields to offers no room at all. If this said otherwise, the head
      // upstream would roll onto the join expecting to hand off and then find the door shut.
      if (nearSibling(c, link.t0[k])) continue;
      const d = clearanceAt(c, link.t0[k], from);
      if (d > best) best = d;
      if (best >= FLOW.itemSpacing) break;
    }
    return best;
  }

  function laneInsert(lane, id, t) {
    const items = lane.items;
    let i = items.length;
    items.push(id);
    while (i > 0 && iT[items[i - 1]] < t) { items[i] = items[i - 1]; i -= 1; }
    items[i] = id;
    iT[id] = t;
  }

  function insertVia(link, id, from) {
    if (!link) return false;
    const n = link.lanes.length;
    // A splitter arm with nothing attached is a trap: items would round-robin into it and stall
    // there forever. When any arm leads somewhere, only those arms are offered.
    let anyLive = false;
    if (n > 1 && !link.sort && !link.sw) {
      for (let k = 0; k < n; k += 1) {
        const c = link.lanes[k];
        if (c.link || c.sink) { anyLive = true; break; }
      }
    }
    for (let k = 0; k < n; k += 1) {
      const j = (link.rr + k) % n;
      const c = link.lanes[j];
      if (anyLive && !c.link && !c.sink) continue;
      // The one line that turns a splitter into a sorter. Note it does NOT fall through to another
      // arm when this one is full: `insertVia` simply returns false and the item stays put.
      if (link.sort && !routeOk(link, c, id)) continue;
      // The same, for a switch: the closed arms are not alternatives, they are shut. An item waits
      // for the open arm exactly as it would wait behind a full belt.
      if (link.sw && !armOk(link, c)) continue;
      if (c.sink || (clearanceAt(c, link.t0[j], from, true) >= FLOW.itemSpacing && !nearSibling(c, link.t0[j]))) {
        link.rr = (j + 1) % n;
        laneInsert(c, id, link.t0[j]);
        return true;
      }
    }
    return false;
  }

  function storePush(b, id) {
    const s = b.store;
    if (s.count >= s.cap) return false;
    s.ids[(s.head + s.count) % s.cap] = id;
    s.count += 1;
    stored += 1;
    return true;
  }

  function consume(lane, id) {
    const b = lane.b;
    if (b.def.family === 'sell') {
      const t = iTier[id];
      // The Delivery Pad has no material setting. It reads the live order board: whatever an open
      // contract still wants is accepted at a premium and credited to that contract, and everything
      // else is DESTROYED — no money, slot freed, value gone. Feeding it a mixed stream is a player
      // mistake and is supposed to read as one.
      //
      // The one exception is an EMPTY board — no live order, or orders switched off. Nothing is
      // wanted then, so nothing can be wrong, and the pad degrades to an ordinary sell pad instead
      // of eating a line for a gap in a timer the player does not control. See DELIVERY in config.
      let matched = false;
      let mult = 1;
      if (b.def.delivery) {
        const mask = wantedMask();
        if (mask) {
          if (!(mask & (1 << t))) {
            // Destroyed, and counted as destroyed: `spawned - sold - destroyed === live` has to keep
            // holding through this path or the ledger is a decoration.
            b.flash = 1;
            if (ctx.onReject) ctx.onReject(b, t);
            release(id);
            st.destroyed += 1;
            return true;
          }
          matched = true;
          mult = DELIVERY.wantedMult;
        } else {
          mult = DELIVERY.idleMult;
        }
      } else if (b.def.tierPad) {
        // Retained for any pad definition that still carries a manual filter. No shipped definition
        // does since the Delivery Pad replaced the Contract Pad, so this branch is dormant rather
        // than dead — it is the behaviour a filtered pad would get if one were ever reintroduced.
        matched = t === filterOf(b);
        mult = matched ? SELLPAD.matchMult : SELLPAD.missMult;
      }
      const paid = economy.sell(iValue[id] * mult * (b.def.payMult || 1));
      b.flash = 1;
      if (ctx.onSell) ctx.onSell(b, paid, t);
      // Only a delivery the board actually asked for counts toward an order. A plain pad contributes
      // nothing, which is what stops an order being filled by a line that is already running.
      if (matched && onDeliver) onDeliver(t, 1, b);
      release(id);
      st.sold += 1;
      return true;
    }
    // A store keeps the item alive and keeps its slot; it is parked, not consumed.
    if (b.store) return storePush(b, id);
    release(id);
    st.destroyed += 1;
    return true;
  }

  function fire(lane, id) {
    const u = lane.b.def.upg;
    if (!u) return;
    // This machine's own cooldown on this exact item. Nothing another machine did can block it.
    if (cdBlocked(id, lane.b.uid)) return;
    if (iUses[id] >= ECONOMY.maxUpgradesPerItem) return;
    const bit = KIND_BIT[u.kind] || 0;
    if (u.once && (iKinds[id] & bit)) return;
    const before = iValue[id];
    const r = economy.upgradeItem(u, iTier[id], iValue[id]);
    if (r.destroy) {
      lane.b.flash = 1;
      if (ctx.onUpgrade) ctx.onUpgrade(lane.b, 0, true);
      return removeFromLane(lane, id);
    }
    iValue[id] = r.value;
    iTier[id] = r.tier;
    iUses[id] += 1;
    iKinds[id] |= bit;
    cdSet(id, lane.b.uid, u.cooldown || 0);
    iFlash[id] = 1;
    lane.b.flash = 1;
    if (ctx.onUpgrade) ctx.onUpgrade(lane.b, r.value - before, false);
    return false;
  }

  function removeFromLane(lane, id) {
    const k = lane.items.indexOf(id);
    if (k >= 0) lane.items.splice(k, 1);
    release(id);
    st.destroyed += 1;
    return true;
  }

  function stepLane(lane, dt) {
    const items = lane.items;
    if (!items.length) return;
    const v = lane.speed;
    const len = lane.len;
    const spacing = FLOW.itemSpacing;
    const trig = lane.trig;
    let limit = len;
    let i = 0;
    while (i < items.length) {
      const id = items[i];
      // The exit of this lane and the entry of the next are the same point in space, so the head may
      // only roll up to `len` when the far side is clear that far. Recomputed per head rather than
      // once per lane: when the head hands off mid-step the item behind becomes the head, and it must
      // not inherit the room its predecessor just used up. Only the head pays for the test, and only
      // when it is close enough to the exit for the answer to matter.
      if (i === 0) {
        limit = len;
        if (lane.link && !lane.sink && iT[id] + v * dt > len - spacing) {
          const clr = linkClearance(lane.link, lane, id);
          if (clr < spacing) limit = Math.max(0, len - (spacing - clr));
        }
      }
      const old = iT[id];
      let nt = old + v * dt;
      // Clamp to the limit, but never below where the item already is: a limit that tightened this
      // tick must stall an item, never drag it backwards past an upgrader's trigger and re-fire it.
      if (nt > limit) nt = limit < old ? old : limit;
      if (nt > len) nt = len;
      // Hold at the mouth of a crossing rather than driving through an item on the lane we yield to.
      // Only a lane that has something to yield to pays for this test.
      // The crossing test must stop short of the exit. On a merger every arm ENDS at the same point,
      // so near the exit each arm always sees the other arm's item, every arm parks a hair short of
      // `len`, the hand-off at `len` never fires, and all three lock forever — the merger accepted
      // side feeds and silently swallowed them. Convergence at the exit is already serialised by the
      // link's own clearance test against the lane being fed, so this only guards genuine mid-lane
      // crossings.
      if (lane.siblings && nt > old && nt < len - FLOW.itemSpacing
          && nearSibling(lane, nt) && !nearSibling(lane, old)) nt = old;
      // Store first, then test the crossing against the value that was actually stored. iT is a
      // Float32Array: a threshold test on the unrounded float64 can land below the trigger while the
      // rounded value lands above it, and the crossing is then never seen on any step.
      iT[id] = nt;
      const now = iT[id];
      if (iFlash[id] > 0) iFlash[id] -= dt * 3.2;
      if (trig >= 0 && old < trig && now >= trig) {
        if (fire(lane, id)) continue;
      }
      if (i === 0 && now >= len - 1e-5) {
        if (lane.sink) {
          if (consume(lane, id)) { items.shift(); continue; }
        } else if (lane.link && insertVia(lane.link, id, lane)) {
          items.shift();
          continue;
        } else if (!lane.link) {
          // No link at all: the belt ends here and there is nothing below it.
          dropOff(lane, id);
          items.shift();
          continue;
        }
      }
      limit = now - spacing;
      i += 1;
    }
  }

  function stepEmitter(lane, dt) {
    const b = lane.b;
    const d = b.def.drop;
    // `live` is every item that exists — on a belt or parked in a vault. Stored items are inside the
    // cap, so a vault buys you somewhere to put items, never permission to have more of them.
    if (live >= ctx.capacity()) { b.stalled = true; b.timer = Math.min(b.timer, 0.12); return; }
    b.timer -= dt;
    if (b.timer > 0) return;
    b.timer += 1 / d.rate;
    if (b.timer < 0) b.timer = 1 / d.rate;
    if (!lane.link) { b.stalled = true; return; }
    const id = alloc();
    if (id < 0) { b.stalled = true; return; }
    b.stalled = false;
    const t = rollTier(d.min, d.max);
    initItem(id, t, rollValue(t));
    if (!insertVia(lane.link, id, lane)) { release(id); b.stalled = true; }
    else {
      st.spawned += 1;
      b.flash = 0.5;
      if (ctx.onDrop) ctx.onDrop(b, t);
    }
  }

  function stepStore(b, dt) {
    const s = b.store;
    const def = b.def;
    if (def.fuse) {
      if (s.count < def.fuse.need) return;
      if (!b.outLane || !b.outLane.link) return;
      if (!laneRoom(b.outLane, 0)) return;
      let sum = 0;
      let top = 0;
      for (let k = 0; k < def.fuse.need; k += 1) {
        const id = s.ids[(s.head + k) % s.cap];
        sum += iValue[id];
        if (iTier[id] > top) top = iTier[id];
      }
      // Four go in, one comes out: the first slot is re-used as the fused item and the other three
      // are genuinely destroyed. Fusing IS a new item, so re-initialising its history here is honest —
      // and it is the only path in the game that may do so, because it costs three slots to take.
      const keep = s.ids[s.head];
      for (let k = 1; k < def.fuse.need; k += 1) { release(s.ids[(s.head + k) % s.cap]); st.destroyed += 1; }
      s.head = (s.head + def.fuse.need) % s.cap;
      s.count -= def.fuse.need;
      stored -= def.fuse.need;
      initItem(keep, clampTier(Math.min(TOP_TIER, top + 1)), sum * def.fuse.bonus);
      laneInsert(b.outLane, keep, 0);
      b.flash = 1;
      return;
    }
    if (!def.store || !b.outLane) return;
    s.acc += def.store.rate * dt;
    while (s.acc >= 1 && s.count > 0) {
      if (!laneRoom(b.outLane, 0)) break;
      // The SAME item rolls back out: same id, same uses, same once-flags, same cooldowns still
      // ticking. A vault is a siding, not a laundry.
      const id = s.ids[s.head];
      s.head = (s.head + 1) % s.cap;
      s.count -= 1;
      stored -= 1;
      laneInsert(b.outLane, id, 0);
      s.acc -= 1;
    }
    if (s.acc > 2) s.acc = 2;
  }

  function update(dt) {
    simNow += dt;
    if (dirty) relink();
    let running = 0;
    for (let i = 0; i < laneList.length; i += 1) {
      const lane = laneList[i];
      if (lane.items.length) running += 1;
      stepLane(lane, dt);
    }
    runningLanes = running;
    for (let i = 0; i < emitters.length; i += 1) stepEmitter(emitters[i], dt);
    for (let i = 0; i < stores.length; i += 1) stepStore(stores[i], dt);
    stepFalling(dt);
  }

  // --- drawing ----------------------------------------------------------------

  function sample(lane, t, out) {
    const cum = lane.cum;
    const pts = lane.pts;
    let i = 1;
    while (i < lane.n - 1 && cum[i] < t) i += 1;
    const t0 = cum[i - 1];
    const seg = cum[i] - t0;
    const u = seg > 1e-6 ? Math.min(1, Math.max(0, (t - t0) / seg)) : 0;
    const a = (i - 1) * 3;
    const b = i * 3;
    out[0] = pts[a] + (pts[b] - pts[a]) * u;
    out[1] = pts[a + 1] + (pts[b + 1] - pts[a + 1]) * u;
    out[2] = pts[a + 2] + (pts[b + 2] - pts[a + 2]) * u;
  }

  const pos = [0, 0, 0];

  function draw(time) {
    instancer.begin();
    for (let i = 0; i < laneList.length; i += 1) {
      const lane = laneList[i];
      const items = lane.items;
      for (let k = 0; k < items.length; k += 1) {
        const id = items[k];
        sample(lane, iT[id], pos);
        const t = iTier[id];
        const f = iFlash[id] > 0 ? iFlash[id] : 0;
        instancer.push(t, pos[0], pos[1] + f * 0.06, pos[2], iSpin[id] + time * FLOW.itemSpin,
          0.32, 1 + Math.min(0.28, iUses[id] * 0.024) + f * 0.5);
      }
    }
    for (let i = 0; i < falling.length; i += 1) {
      const f = falling[i];
      instancer.push(f.t, f.x, f.y, f.z, f.spin, 0.32, 1);
    }
    instancer.end();
  }

  // --- debug / bench ----------------------------------------------------------

  function spawnBurst(n) {
    if (dirty) relink();
    const pool = laneList.filter((l) => !l.sink && l.len > 0.2);
    if (!pool.length) return 0;
    let made = 0;
    let attempts = n * 30;
    while (made < n && attempts-- > 0) {
      const lane = pool[(Math.random() * pool.length) | 0];
      const t = Math.random() * lane.len;
      if (!laneRoom(lane, t)) continue;
      const id = alloc();
      if (id < 0) break;
      const tier = rollTier(0, 3);
      initItem(id, tier, rollValue(tier));
      laneInsert(lane, id, t);
      st.spawned += 1;
      made += 1;
    }
    return made;
  }

  function clear() {
    // Anything mid-fall holds an id from the pool that clear() is about to hand back out. Dropping the
    // list here is what stops a falling item releasing an id it no longer owns and driving live negative.
    falling.length = 0;
    for (const l of laneList) l.items.length = 0;
    for (const b of stores) if (b.store) { b.store.count = 0; b.store.head = 0; }
    st.destroyed += live;
    freeTop = MAX;
    // clear() hands every id back without going through release(), so the gate memory has to be
    // wiped here too or a fresh factory starts with items that machines think they just upgraded.
    for (let i = 0; i < MAX * CD_SLOTS; i += 1) iCdUid[i] = 0;
    for (let i = 0; i < MAX; i += 1) freeList[i] = MAX - 1 - i;
    live = 0;
    stored = 0;
  }

  return {
    add,
    remove,
    detach,
    attach,
    relink,
    update,
    draw,
    spawnBurst,
    clear,
    markDirty() { dirty = true; },
    // The sorter / Contract Pad setting. Exposed rather than owned by the UI so that every consumer
    // — buildbar, HUD, a hotkey, the network mirror, a test — reads and writes the same one number.
    filterOf,
    setFilter,
    cycleFilter,
    // --- switch conveyor, for the input/UI piece ---------------------------------
    // switchOf(b) -> 0..2, or -1 if b is not a switch. SWITCH.labels names them.
    switchOf,
    // setSwitch(b, i) -> the arm that is now open (wrapped into range), or -1.
    setSwitch,
    // toggleSwitch(b, dir) -> the arm that is now open, or -1. dir defaults to +1.
    toggleSwitch,
    // The world direction 0..3 the open arm currently exits by, already rotated with the building —
    // what an arrow or a lit indicator should point along. -1 if b is not a switch.
    switchDirOf(b) {
      if (!b || !b.def.switchable) return -1;
      const specs = b.def.lanes || [];
      const i = switchOf(b);
      for (let k = 0; k < specs.length; k += 1) if (specs[k].arm === i) return (specs[k].outDir + b.rot) & 3;
      return -1;
    },
    // cb(tier, count, pad) — fired only when a Contract Pad consumes an item of the material it is
    // set to. This is the ONLY channel orders listen on, which is what makes "a line already running
    // cannot fill an order" true by construction rather than by policy.
    // Accepts either a plain function (legacy) or the orders API object itself. Passing the object
    // wires BOTH the credit channel and the wanted-set the Delivery Pad reads, in one line — which
    // is the whole wiring this feature needs in world.js.
    setDeliverHook(fn) {
      if (fn && typeof fn === 'object' && typeof fn.deliver === 'function') {
        const api = fn;
        onDeliver = (t, n, pad) => api.deliver(t, n, pad);
        if (typeof api.wantedMask === 'function' && typeof api.wantedVersion === 'function') setWantedSource(api);
        return;
      }
      onDeliver = typeof fn === 'function' ? fn : null;
    },
    // The order board the Delivery Pad reads. Anything with wantedMask() and wantedVersion(); null
    // clears it, which puts every pad back to plain-rate pass-through.
    setWantedSource,
    // The cached mask, for the UI and for tests. 0 means "no demand".
    wantedMask,
    // `live` is the whole population — riding a belt or parked in a vault. This is what the cap counts.
    get count() { return live; },
    get onBelts() { return live - stored; },
    stats() { return { ...st, live, stored, onBelts: live - stored, ok: st.spawned - st.sold - st.destroyed === live }; },
    get runningLanes() { return runningLanes; },
    get stored() { return stored; },
    get poolSize() { return MAX; },
    lanes: () => laneList,
    emitters: () => emitters,
    tOf: (id) => iT[id],
    usesOf: (id) => iUses[id],
    kindsOf: (id) => iKinds[id],
  };
}

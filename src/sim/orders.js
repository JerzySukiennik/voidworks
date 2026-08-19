// Voidworks — orders: the demand side. A contract asks for N units of one material inside a time
// limit and pays a bonus when it is filled.
//
// Three design constraints shaped every number in here, and all three are load-bearing:
//
//   1. An order must never be satisfiable by a line that is already running and doing nothing new.
//      Only a delivery into a DELIVERY PAD counts; a plain sell pad contributes exactly zero. The
//      pad has no material setting of its own — it accepts whatever this board still wants and
//      destroys everything else outright — so filling an order costs a sorter feeding it a clean
//      stream of the right material. Aiming a mixed line at it does not merely pay less, it burns
//      the mismatch. (Previously the pad carried a manual tier setting and paid 0.35x for a miss;
//      Jurek replaced that with the order board and outright destruction, 2026-08-19.)
//
//   2. Orders must not stack into an exploit. There are `ORDERS.slots` of them, never two for the
//      same material, and progress is clamped at `need` — so bonus income is bounded above by
//      slots * bonus / duration no matter how large the factory grows, while belt income scales
//      with the factory. Orders are therefore a nudge that fades as the game grows, not a curve.
//
//   3. An expired order must not punish the player beyond losing the bonus. There is no fine, no
//      reputation, no lost multiplier and no cost to ignoring the board entirely. Expiry costs the
//      unearned bonus and a `ORDERS.cooldown` gap before the slot refills, and nothing else. An
//      idle factory can never go backwards.
//
// The module owns its own clock (driven by update(dt) from the fixed-step sim), so it is
// deterministic and testable without wall time.

import { ORDERS } from '../config.js';
import { TOP_TIER, baseValue, tierName, tierColor, clampTier } from '../world/items.js';

// The highest material an order may ask for, by unlock level. Derived from what the droppers of
// that level can actually produce (scrap 0-1, ore 1-2, deep 3-4, void 5-6), so the board can never
// print a contract the player has no way of filling.
const TIER_CEILING = [1, 2, 4, 4, 6, 6];

export function createOrders(ctx) {
  const economy = ctx && ctx.economy ? ctx.economy : null;
  const rnd = (ctx && ctx.rng) || Math.random;

  let time = 0;
  let seq = 0;
  let enabled = ORDERS.enabled;
  // Set false on a client that is not the network authority: the co-op bank is shared and settled
  // through transactions, so exactly one client may credit an order.
  let crediting = true;

  let completed = 0;
  let expired = 0;
  let bonusEarned = 0;

  // --- the wanted set -----------------------------------------------------------
  // The Delivery Pad accepts whatever any live order still wants and destroys everything else, so
  // "what is wanted right now" is read on the sell path — a hot-ish path that must not walk the slot
  // array per item. It is therefore published as a BITMASK over tiers plus a version counter: the
  // consumer caches the mask and only rebuilds it when the version moves. Orders change a handful of
  // times a minute; items arrive constantly, so the invalidation goes on the rare side.
  //
  // Bit t is set when some slot holds an unfinished order for tier t. `enabled === false` publishes
  // 0, which the pad reads as "no demand" — the same state as an empty board.
  let wantMask = 0;
  let wantVer = 1;

  function refreshWanted() {
    let m = 0;
    if (enabled) {
      for (let i = 0; i < slots.length; i += 1) {
        const o = slots[i].order;
        if (o && o.done < o.need) m |= 1 << o.tier;
      }
    }
    if (m === wantMask) return;
    wantMask = m;
    wantVer += 1;
  }

  // One entry per slot. `order` is the live contract or null; `nextAt` is when an empty slot refills.
  const slots = [];
  for (let i = 0; i < Math.max(1, ORDERS.slots | 0); i += 1) slots.push({ order: null, nextAt: 0 });

  const listeners = [];

  function emit(kind, order, payout) {
    for (let i = 0; i < listeners.length; i += 1) {
      try { listeners[i](kind, order, payout || 0); } catch { /* a listener must not break the sim */ }
    }
  }

  function ceilingTier() {
    const lvl = economy && economy.unlockLevel ? economy.unlockLevel() : 0;
    const i = Math.max(0, Math.min(TIER_CEILING.length - 1, lvl | 0));
    return Math.min(TOP_TIER, TIER_CEILING[i]);
  }

  function unitsFor(t) {
    const u = ORDERS.units;
    return Math.max(1, u[Math.min(u.length - 1, t)] | 0);
  }

  function bonusFor(t, need) {
    return Math.round(need * baseValue(t) * ORDERS.bonusRate);
  }

  function tierTaken(t) {
    for (let i = 0; i < slots.length; i += 1) if (slots[i].order && slots[i].order.tier === t) return true;
    return false;
  }

  function makeOrder() {
    const hi = ceilingTier();
    const lo = clampTier(ORDERS.minTier);
    // Collect the materials not already spoken for, then pick uniformly. Building the pool costs an
    // allocation, but this runs at most once every `cooldown` seconds — never in the flow hot loop.
    const pool = [];
    for (let t = lo; t <= hi; t += 1) if (!tierTaken(t)) pool.push(t);
    if (!pool.length) return null;
    const tier = pool[Math.min(pool.length - 1, (rnd() * pool.length) | 0)];
    const need = unitsFor(tier);
    seq += 1;
    return {
      id: seq,
      tier,
      name: tierName(tier),
      color: tierColor(tier),
      need,
      done: 0,
      bonus: bonusFor(tier, need),
      issuedAt: time,
      endsAt: time + ORDERS.duration,
    };
  }

  function fill(slot) {
    const o = makeOrder();
    if (!o) { slot.nextAt = time + ORDERS.cooldown; return; }
    slot.order = o;
    refreshWanted();
    emit('issued', o, 0);
  }

  function complete(slot) {
    const o = slot.order;
    slot.order = null;
    slot.nextAt = time + ORDERS.cooldown;
    completed += 1;
    const payout = crediting ? o.bonus : 0;
    if (payout && economy) {
      // Credited straight to the purse rather than through economy.sell(). Deliberate: sell() is the
      // sell pad's path — it counts an item sold, feeds the rolling income average and the offline
      // rate, and banks toward prestige. An order bonus is none of those things, and routing it
      // through sell() would let a player farm prestige points off a fixed, capped payout.
      economy.money += payout;
    }
    bonusEarned += payout;
    o.completedAt = time;
    refreshWanted();
    emit('completed', o, payout);
  }

  function expire(slot) {
    const o = slot.order;
    slot.order = null;
    slot.nextAt = time + ORDERS.cooldown;
    expired += 1;
    refreshWanted();
    // No penalty applied here, and there must never be one. See the header.
    emit('expired', o, 0);
  }

  // Called by the flow sim when a Contract Pad set to `tier` consumes an item of that same tier.
  // Returns how many units were actually credited, which is 0 when no order wants this material.
  function deliver(tier, count) {
    if (!enabled) return 0;
    let n = Math.max(1, count | 0);
    let taken = 0;
    for (let i = 0; i < slots.length && n > 0; i += 1) {
      const slot = slots[i];
      const o = slot.order;
      if (!o || o.tier !== tier) continue;
      const room = o.need - o.done;
      const use = n < room ? n : room;
      o.done += use;
      taken += use;
      n -= use;
      if (o.done >= o.need) complete(slot);
    }
    return taken;
  }

  function update(dt) {
    if (!enabled) return;
    time += dt;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      if (slot.order) {
        if (time >= slot.order.endsAt) expire(slot);
      } else if (time >= slot.nextAt) {
        fill(slot);
      }
    }
  }

  function active() {
    const out = [];
    for (let i = 0; i < slots.length; i += 1) if (slots[i].order) out.push(slots[i].order);
    return out;
  }

  return {
    update,
    deliver,

    // --- what the Delivery Pad reads ---------------------------------------------
    // Bitmask over material tiers with a live, unfinished order. 0 means the board is empty (or
    // orders are off), which the pad treats as "no demand", never as "reject everything".
    wantedMask() { return wantMask; },
    // Bumped only when the mask actually CHANGES value, so a consumer that caches on this number
    // rebuilds once per real board change and never on a tick that merely advanced the clock.
    wantedVersion() { return wantVer; },
    // Convenience for the UI; the sim uses the mask directly.
    wants(t) { return (wantMask & (1 << (t | 0))) !== 0; },
    wantedTiers() {
      const out = [];
      for (let t = 0; t <= TOP_TIER; t += 1) if (wantMask & (1 << t)) out.push(t);
      return out;
    },

    // --- state, for the UI ------------------------------------------------------
    active,
    // Seconds left on an order, clamped at zero. The UI should not have to know about the clock.
    timeLeft(o) { return o ? Math.max(0, o.endsAt - time) : 0; },
    progress(o) { return o && o.need ? Math.min(1, o.done / o.need) : 0; },
    slotCount: slots.length,
    // When an empty slot refills, in seconds from now. Null when the slot is not empty.
    waitFor(i) {
      const s = slots[i];
      return s && !s.order ? Math.max(0, s.nextAt - time) : null;
    },
    get time() { return time; },
    get completed() { return completed; },
    get expired() { return expired; },
    get bonusEarned() { return bonusEarned; },
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; refreshWanted(); },
    // Co-op: only the authority credits the shared bank. Everyone still tracks and displays.
    get crediting() { return crediting; },
    setCrediting(v) { crediting = !!v; },

    // --- events -----------------------------------------------------------------
    // cb(kind, order, payout) where kind is 'issued' | 'completed' | 'expired'.
    on(cb) {
      if (typeof cb !== 'function') return () => {};
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i !== -1) listeners.splice(i, 1);
      };
    },

    // --- persistence --------------------------------------------------------------
    // Times are stored RELATIVE to now, so a save that sits on disk for a week does not come back
    // with every order already expired — and cannot be exploited by moving the clock either.
    snapshot() {
      return {
        v: 1,
        seq,
        completed,
        expired,
        bonus: bonusEarned,
        slots: slots.map((s) => (s.order
          ? { t: s.order.tier, need: s.order.need, done: s.order.done, bonus: s.order.bonus, left: Math.max(0, s.order.endsAt - time) }
          : { wait: Math.max(0, s.nextAt - time) })),
      };
    },

    restore(data) {
      if (!data || !Array.isArray(data.slots)) return false;
      seq = Number.isFinite(data.seq) ? data.seq : 0;
      completed = Number.isFinite(data.completed) ? data.completed : 0;
      expired = Number.isFinite(data.expired) ? data.expired : 0;
      bonusEarned = Number.isFinite(data.bonus) ? data.bonus : 0;
      time = 0;
      for (let i = 0; i < slots.length; i += 1) {
        const s = data.slots[i];
        const slot = slots[i];
        slot.order = null;
        slot.nextAt = 0;
        if (!s) continue;
        if (s.t === undefined) { slot.nextAt = Math.max(0, s.wait || 0); continue; }
        const tier = clampTier(s.t);
        seq += 1;
        slot.order = {
          id: seq,
          tier,
          name: tierName(tier),
          color: tierColor(tier),
          need: Math.max(1, s.need | 0),
          done: Math.max(0, Math.min(s.need | 0, s.done | 0)),
          bonus: Math.max(0, s.bonus | 0),
          issuedAt: 0,
          endsAt: Math.max(0, s.left || 0),
        };
      }
      refreshWanted();
      return true;
    },

    reset() {
      time = 0;
      seq = 0;
      completed = 0;
      expired = 0;
      bonusEarned = 0;
      for (let i = 0; i < slots.length; i += 1) { slots[i].order = null; slots[i].nextAt = 0; }
      refreshWanted();
    },
  };
}

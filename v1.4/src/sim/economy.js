// Voidworks — money, sell crediting, upgrader value maths, the price curve and localStorage saves.

import { upgradeSnapshot } from './upgrades.js';
import { ECONOMY, PRESTIGE, UNLOCKS } from '../config.js';
import { clampTier, baseValue, TOP_TIER } from '../world/items.js';
import {
  awayReport, offlineEarnings, prestigeGainFor, prestigeMultFor, unlockLevelFor, unlockCostFor,
} from './progress.js';

export function createEconomy() {
  let money = ECONOMY.startMoney;
  let earned = 0;
  let sold = 0;
  let rate = 0;
  let capacityBought = 0;
  let avgSale = 0;
  const buckets = new Float32Array(16);
  const bucketTime = ECONOMY.rateWindow / buckets.length;
  let bucket = 0;
  let bucketAcc = 0;
  const counts = new Map();

  // --- the long game ----------------------------------------------------------
  // Three numbers outlive a single run, and they are deliberately three rather than one:
  //   `earned`        this run only. Resets on prestige. It is what prestige points are bought with.
  //   `lifeEarned`    every run ever. Survives prestige. It is what unlocks are measured against, so
  //                   a reset never re-locks a building the player has already proven they can use.
  //   `points`        permanent prestige points. Survive prestige, die only on a genuinely new game.
  let lifeEarned = 0;
  let points = 0;
  let prestiges = 0;
  let mult = 1;

  // How much of the recent past this factory spent pinned at the item cap, as an exponential
  // average. Written once per tick from a boolean, never allocates, and is the only input to the
  // "your line is the bottleneck" half of the away summary.
  let stallFrac = 0;

  // Set once on load, read by the HUD, cleared when it has been shown. Null means "nothing to say".
  let away = null;

  function unlocked(def) {
    if (!def) return false;
    return (def.unlock | 0) <= unlockLevelFor(lifeEarned);
  }

  function capacity() {
    return Math.min(ECONOMY.capacityMax, ECONOMY.capacityStart + capacityBought * ECONOMY.capacityStep);
  }

  function capacityPrice() {
    return Math.round(ECONOMY.capacityBase * ECONOMY.capacityGrowth ** capacityBought);
  }

  function priceOf(def) {
    const n = counts.get(def.id) || 0;
    return Math.round(def.cost * ECONOMY.priceGrowth ** n);
  }

  return {
    get money() { return money; },
    set money(v) { money = v; },
    get earned() { return earned; },
    get lifetimeEarned() { return lifeEarned; },
    get sold() { return sold; },
    get rate() { return rate; },
    counts,

    // --- prestige -------------------------------------------------------------
    get prestigePoints() { return points; },
    get prestigeCount() { return prestiges; },
    get prestigeMult() { return mult; },
    prestigeGain() { return prestigeGainFor(earned); },
    canPrestige() { return prestigeGainFor(earned) >= PRESTIGE.minGain; },
    // Earnings still needed before the next whole point lands. Purely a readout for the UI.
    prestigeNext() {
      const g = prestigeGainFor(earned) + 1;
      return Math.max(0, ((g / PRESTIGE.scale) ** 2) * PRESTIGE.requirement - earned);
    },

    // Bank the points and wipe the run. Buildings are NOT this module's to remove — the caller
    // clears the world; this only guarantees that money, capacity and the price curve go with it,
    // so a reset cannot be turned into a discount on a factory you keep.
    prestige() {
      const gain = prestigeGainFor(earned);
      if (gain < PRESTIGE.minGain) return null;
      points += gain;
      prestiges += 1;
      mult = prestigeMultFor(points);
      money = ECONOMY.startMoney;
      earned = 0;
      sold = 0;
      rate = 0;
      capacityBought = 0;
      avgSale = 0;
      stallFrac = 0;
      buckets.fill(0);
      counts.clear();
      return { gain, points, mult, prestiges };
    },

    // --- unlocks --------------------------------------------------------------
    // Measured against LIFETIME earnings, so prestige opens the game up rather than closing it.
    unlockLevel() { return unlockLevelFor(lifeEarned); },
    unlockMax() { return UNLOCKS.thresholds.length - 1; },
    unlockCost(level) { return unlockCostFor(level); },
    isUnlocked: unlocked,
    // Setup affordance, the exact counterpart of `world.money = n` in the test harnesses and the
    // debug console: stand the account up at a given level of progression without playing to it.
    // It moves LIFETIME earnings only, so it grants access without handing out prestige points or
    // this run's earnings — you get the catalogue, not a free win.
    grantUnlocks(level) {
      const want = unlockCostFor(level);
      if (want > lifeEarned) lifeEarned = want;
      return unlockLevelFor(lifeEarned);
    },

    // What the next level would open, for a "keep earning" readout.
    nextUnlockAt() {
      const lvl = unlockLevelFor(lifeEarned);
      const max = UNLOCKS.thresholds.length - 1;
      return lvl >= max ? null : UNLOCKS.thresholds[lvl + 1];
    },

    // --- away -----------------------------------------------------------------
    get away() { return away; },
    clearAway() { away = null; },
    takeAway() { const a = away; away = null; return a; },
    get stallFraction() { return stallFrac; },

    get capacity() { return capacity(); },
    get capacityMax() { return ECONOMY.capacityMax; },
    get capacityStep() { return ECONOMY.capacityStep; },
    capacityPrice,
    setCapacityBought(n) { capacityBought = Math.max(0, n | 0); },
    grantCapacity(target) {
      const need = Math.ceil((Math.min(ECONOMY.capacityMax, target) - ECONOMY.capacityStart) / ECONOMY.capacityStep);
      if (need > capacityBought) capacityBought = need;
      return capacity();
    },
    buyCapacity() {
      if (capacity() >= ECONOMY.capacityMax) return false;
      const p = capacityPrice();
      if (money < p) return false;
      money -= p;
      capacityBought += 1;
      return true;
    },

    priceOf,
    canAfford(def) { return unlocked(def) && money >= priceOf(def); },

    // The unlock gate lives HERE rather than in the placement path, and that is the whole point: a
    // locked building is one you cannot BUY. Every route into the world that costs money goes
    // through charge(), and every route that does not — save restore, the menu showcase, the bench,
    // a peer's building mirrored over the network — goes through free() and is deliberately exempt.
    // Putting the check anywhere else would have meant finding all of those callers and getting
    // every one of them right.
    charge(def) {
      if (!unlocked(def)) return false;
      const p = priceOf(def);
      if (money < p) return false;
      money -= p;
      counts.set(def.id, (counts.get(def.id) || 0) + 1);
      return true;
    },

    free(def) {
      counts.set(def.id, (counts.get(def.id) || 0) + 1);
    },

    // What tearing this piece out would hand back. Exposed so a swap-in-place can price itself as
    // exactly what it is — a delete followed by a place — instead of inventing a second price curve.
    refundValue(def) {
      const n = Math.max(1, counts.get(def.id) || 1);
      return Math.round(Math.round(def.cost * ECONOMY.priceGrowth ** (n - 1)) * ECONOMY.refund);
    },

    refund(def) {
      const n = Math.max(1, counts.get(def.id) || 1);
      const back = Math.round(Math.round(def.cost * ECONOMY.priceGrowth ** (n - 1)) * ECONOMY.refund);
      counts.set(def.id, n - 1);
      money += back;
    },

    // The prestige multiplier is applied HERE and nowhere else: the sell pad is the single point
    // every item in the game passes through on its way to becoming money, and it is downstream of
    // the item cap. Multiplying anything upstream — drop rate, upgrader output — would compound
    // against a fixed number of items in flight; multiplying the price cannot.
    sell(value) {
      const v = value * ECONOMY.sellPadRate * mult;
      money += v;
      earned += v;
      lifeEarned += v;
      buckets[bucket] += v;
      sold += 1;
      avgSale += (v - avgSale) * ECONOMY.saleAverageEase;
      return v;
    },

    get averageSale() { return avgSale; },
    isBigSale(v) { return v >= ECONOMY.bigSellValue || v >= avgSale * ECONOMY.bigSellRatio; },

    upgradeItem(u, tierIdx, value) {
      switch (u.kind) {
        case 'flat':
          return { value: value + u.amount, tier: tierIdx, destroy: false };
        case 'mult':
          return { value: value * u.amount, tier: tierIdx, destroy: false };
        case 'multCap':
          return { value: tierIdx <= u.maxTier ? value * u.amount : value, tier: tierIdx, destroy: false };
        case 'gamble':
          if (Math.random() < u.destroy) return { value: 0, tier: tierIdx, destroy: true };
          return { value: value * u.amount, tier: tierIdx, destroy: false };
        case 'tier': {
          const nt = clampTier(Math.min(TOP_TIER, tierIdx + 1));
          return { value: Math.max(value * 1.15, baseValue(nt)), tier: nt, destroy: false };
        }
        default:
          return { value, tier: tierIdx, destroy: false };
      }
    },

    // `stalled` is optional so this still runs correctly with a caller that has not been rewired;
    // without it the away summary simply never claims the factory was capped. No allocation here,
    // by design — this is the sim hot loop.
    tick(dt, stalled) {
      const k = dt / ECONOMY.stallTau;
      stallFrac += ((stalled ? 1 : 0) - stallFrac) * (k < 1 ? k : 1);
      bucketAcc += dt;
      while (bucketAcc >= bucketTime) {
        bucketAcc -= bucketTime;
        bucket = (bucket + 1) % buckets.length;
        buckets[bucket] = 0;
      }
      let sum = 0;
      for (let i = 0; i < buckets.length; i += 1) sum += buckets[i];
      rate = sum / ECONOMY.rateWindow;
    },

    // Soft by default: clearing the board is not the same as throwing the account away, so prestige
    // points and lifetime earnings ride through. `wipe()` is the hard one.
    reset() {
      money = ECONOMY.startMoney;
      earned = 0;
      sold = 0;
      rate = 0;
      capacityBought = 0;
      avgSale = 0;
      stallFrac = 0;
      buckets.fill(0);
      counts.clear();
    },

    snapshot(buildings) {
      return {
        v: 3,
        money,
        earned,
        cap: capacityBought,
        at: Date.now(),
        // Everything below is new in v3 and optional on the way back in. `rate` and `stall` are the
        // entire basis of offline credit: what this factory was really earning, and how much of that
        // time it spent pinned at the cap.
        rate,
        stall: stallFrac,
        life: lifeEarned,
        pp: points,
        pc: prestiges,
        b: buildings.map((b) => [b.def.id, b.cx, b.cz, b.rot]),
        u: upgradeSnapshot(buildings),
      };
    },

    save(buildings) {
      try {
        localStorage.setItem(ECONOMY.storageKey, JSON.stringify(this.snapshot(buildings)));
        return true;
      } catch {
        return false;
      }
    },

    load() {
      try {
        const raw = localStorage.getItem(ECONOMY.storageKey);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.b)) return null;
        return data;
      } catch {
        return null;
      }
    },

    applyLoaded(data, nowMs) {
      money = Number.isFinite(data.money) ? data.money : ECONOMY.startMoney;
      earned = Number.isFinite(data.earned) ? data.earned : 0;
      capacityBought = Number.isFinite(data.cap) ? data.cap : 0;

      // Every field below is optional. A v2 save has none of them, and every default is the one that
      // makes the old save behave exactly as it did before this feature existed: no prestige, no
      // offline credit (rate 0 credits 0), and unlocks derived from the earnings it does carry.
      points = Number.isFinite(data.pp) ? Math.max(0, data.pp) : 0;
      prestiges = Number.isFinite(data.pc) ? Math.max(0, data.pc) : 0;
      mult = prestigeMultFor(points);
      lifeEarned = Number.isFinite(data.life) ? data.life : earned;
      stallFrac = Number.isFinite(data.stall) ? Math.min(1, Math.max(0, data.stall)) : 0;
      const savedRate = Number.isFinite(data.rate) ? Math.max(0, data.rate) : 0;
      rate = savedRate;

      const now = Number.isFinite(nowMs) ? nowMs : Date.now();
      // A clock that went backwards (timezone change, a save from a machine running fast) must not
      // read as negative time away; offlineWindow floors it at zero.
      const elapsed = Number.isFinite(data.at) ? (now - data.at) / 1000 : 0;
      const report = awayReport(savedRate, elapsed, stallFrac);
      if (report.money > 0) {
        money += report.money;
        earned += report.money;
        lifeEarned += report.money;
      }
      // Reported even when it earned nothing, so a returning player with a dead line is told the
      // line is dead instead of being told nothing at all.
      away = report.rawSeconds >= ECONOMY.offlineMinSeconds ? report : null;
      return away;
    },

    // Exposed so the offline maths can be checked against the exact numbers a save carried, without
    // having to mutate a live economy to do it.
    offlinePreview(rateValue, elapsedSeconds, stallFraction) {
      return awayReport(rateValue, elapsedSeconds, stallFraction);
    },
    offlineEarnings,

    // The hard reset: a genuinely new game. Prestige points and lifetime earnings die here and only
    // here, so "New Game" means new and "reset the board" does not.
    wipe() {
      points = 0;
      prestiges = 0;
      mult = 1;
      lifeEarned = 0;
      stallFrac = 0;
      away = null;
      try { localStorage.removeItem(ECONOMY.storageKey); } catch { /* ignore */ }
    },
  };
}

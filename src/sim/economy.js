// Voidworks — money, sell crediting, upgrader value maths, the price curve and localStorage saves.

import { ECONOMY } from '../config.js';
import { clampTier, baseValue, TOP_TIER } from '../world/items.js';

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
    get sold() { return sold; },
    get rate() { return rate; },
    counts,

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
    canAfford(def) { return money >= priceOf(def); },

    charge(def) {
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

    sell(value) {
      const v = value * ECONOMY.sellPadRate;
      money += v;
      earned += v;
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

    tick(dt) {
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

    reset() {
      money = ECONOMY.startMoney;
      earned = 0;
      sold = 0;
      rate = 0;
      capacityBought = 0;
      avgSale = 0;
      buckets.fill(0);
      counts.clear();
    },

    snapshot(buildings) {
      return {
        v: 2,
        money,
        earned,
        cap: capacityBought,
        at: Date.now(),
        b: buildings.map((b) => [b.def.id, b.cx, b.cz, b.rot]),
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

    applyLoaded(data) {
      money = Number.isFinite(data.money) ? data.money : ECONOMY.startMoney;
      earned = Number.isFinite(data.earned) ? data.earned : 0;
      capacityBought = Number.isFinite(data.cap) ? data.cap : 0;
    },

    wipe() {
      try { localStorage.removeItem(ECONOMY.storageKey); } catch { /* ignore */ }
    },
  };
}

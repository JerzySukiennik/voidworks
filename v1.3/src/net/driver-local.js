// Voidworks — same-machine transport behind the exact interface the Firebase RTDB driver implements.

// Three jobs, one implementation:
//   1. the fallback whenever Firebase is absent or unreachable, so co-op never hard-fails;
//   2. the cross-tab driver (BroadcastChannel + localStorage) that work/net-test.html drives;
//   3. the in-memory fake the headless test runs two clients against, with no browser at all.
//
// It deliberately reproduces the parts of RTDB that the sync model depends on and that a naive
// fake would paper over: real latency between read and commit, optimistic-concurrency
// transactions that abort and retry under contention, onDisconnect, and a server clock that is
// NOT this process's Date.now().

import { NET } from '../config.js';
import {
  byteLength, clone, createStats, getPath, makeUid, pathsOverlap, setPath,
} from './util.js';

const L = NET.local;

// One hub per room code, shared by every driver in this JS context. This is what lets two
// simulated clients in one node process — or two createNet() calls on one page — actually see
// each other, without BroadcastChannel and without a browser.
const hubs = new Map();

function hubFor(code) {
  let hub = hubs.get(code);
  if (!hub) {
    hub = { store: { c: 0, w: {}, skew: null, tree: {} }, drivers: new Set() };
    hubs.set(code, hub);
  }
  return hub;
}

// Test-only: forget every room. Never called by the game.
export function resetLocalDrivers() {
  hubs.clear();
}

function pickStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${L.storagePrefix}probe`, '1');
      localStorage.removeItem(`${L.storagePrefix}probe`);
      return localStorage;
    }
  } catch {
    // private mode or disabled storage — the hub alone still works for this context
  }
  return null;
}

export async function createLocalDriver(options) {
  const opts = options || {};
  const code = String(opts.code || 'LOCALROOM').toUpperCase();
  const uid = opts.uid || makeUid();
  const hub = hubFor(code);
  const storage = opts.isolate ? null : pickStorage();
  const storeKey = L.storagePrefix + code;
  const channelName = L.storagePrefix + code;
  const stats = createStats();
  stats.startedAt = Date.now();
  const latencyScale = typeof opts.latencyScale === 'number' ? opts.latencyScale : 1;

  // Pretend this client's wall clock is wrong. Everything the game reads goes through now(),
  // which corrects back to the shared "server" clock, so a wrong local clock cannot leak into
  // world time — the same property .info/serverTimeOffset gives us on the real database.
  const clientSkew = (Math.random() * 2 - 1) * L.clientSkewSpreadMs;
  const rawNow = () => Date.now() + clientSkew;

  let channel = null;
  try {
    if (!opts.isolate && typeof BroadcastChannel === 'function') channel = new BroadcastChannel(channelName);
  } catch {
    channel = null;
  }

  const valueSubs = [];
  const childSubs = [];
  const disconnects = new Map();
  const timers = new Set();
  let disposed = false;
  let lockChain = Promise.resolve();

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function latency() {
    return Math.max(0, (L.latencyMs + (Math.random() * 2 - 1) * L.latencyJitterMs) * latencyScale);
  }

  function wait(ms) {
    return new Promise((resolve) => later(resolve, ms));
  }

  // ONE store, and it is whichever of the two is actually shared. With localStorage present that
  // is localStorage — every tab of the browser reads and writes the same bytes, so a second tab is
  // a real second client. Without it (node, private mode) the hub object plays the same role for
  // every driver in this context.
  //
  // An earlier version kept a per-context copy and adopted localStorage only when its write
  // counter looked newer. That is wrong with two writers: the counters advance independently, so
  // each tab's writes looked stale to the other and both ended up talking to themselves. Two real
  // browser tabs caught it; one process never would.
  function readStore() {
    if (!storage) return hub.store;
    try {
      const raw = storage.getItem(storeKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          hub.store = { c: parsed.c || 0, w: parsed.w || {}, skew: parsed.skew, tree: parsed.tree || {} };
        }
      }
    } catch {
      // corrupt or unreadable — the last good copy stands
    }
    return hub.store;
  }

  function writeStore() {
    if (!storage) return;
    try {
      storage.setItem(storeKey, JSON.stringify(hub.store));
    } catch {
      // quota — the in-context copy still works for this tab
    }
  }

  // Web Locks are held across TABS of the same browser, which is what makes the read-modify-write
  // above atomic between two real clients rather than merely between two objects in one process.
  // The promise chain is the fallback where they are missing (node).
  async function withLock(fn) {
    if (!opts.isolate && typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      return navigator.locks.request(`${channelName}.lock`, fn);
    }
    const previous = lockChain;
    let release;
    lockChain = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // Highest write counter of any path overlapping `path` — the optimistic-concurrency stamp a
  // transaction validates against, which is what makes a lost update impossible.
  function stampOf(store, path) {
    let max = 0;
    for (const key of Object.keys(store.w)) {
      if (!pathsOverlap(key, path)) continue;
      if (store.w[key] > max) max = store.w[key];
    }
    return max;
  }

  function applyLocal(store, path, value) {
    store.c = (store.c || 0) + 1;
    store.w[path] = store.c;
    setPath(store.tree, path, value === undefined ? null : value);
    return store.c;
  }

  function broadcast(ops) {
    if (!ops.length) return;
    let bytes = 0;
    for (const op of ops) bytes += op.path.length + byteLength(op.value);
    stats.bytesSent += bytes;
    stats.messagesSent += ops.length;
    const paths = ops.map((op) => op.path);
    // Same context: hand the paths straight to the other drivers, after a delay, so they see the
    // change exactly as late as a real socket would deliver it.
    for (const other of hub.drivers) {
      if (other === driver || other.disposed) continue;
      other.deliver(paths);
    }
    if (!channel) return;
    try {
      channel.postMessage({ from: uid, ops });
    } catch {
      // structured clone failure — values here are always JSON-safe
    }
  }

  function emit(paths) {
    const store = readStore();
    for (const sub of valueSubs.slice()) {
      if (!paths.some((p) => pathsOverlap(p, sub.path))) continue;
      sub.cb(clone(getPath(store.tree, sub.path)), sub.path);
    }
    for (const sub of childSubs.slice()) {
      if (!paths.some((p) => pathsOverlap(p, sub.path))) continue;
      const node = getPath(store.tree, sub.path) || {};
      const keys = Object.keys(node);
      for (const key of keys) {
        const value = clone(node[key]);
        const serialized = JSON.stringify(value === undefined ? null : value);
        const prior = sub.known.get(key);
        if (prior === undefined) {
          sub.known.set(key, serialized);
          if (sub.onAdd) sub.onAdd(key, value);
        } else if (prior !== serialized) {
          sub.known.set(key, serialized);
          if (sub.onChange) sub.onChange(key, value);
        }
      }
      for (const key of Array.from(sub.known.keys())) {
        if (keys.indexOf(key) !== -1) continue;
        sub.known.delete(key);
        if (sub.onRemove) sub.onRemove(key);
      }
    }
  }

  function receive(message) {
    if (disposed || !message || message.from === uid || !Array.isArray(message.ops)) return;
    let bytes = 0;
    for (const op of message.ops) bytes += op.path.length + byteLength(op.value);
    stats.bytesReceived += bytes;
    stats.messagesReceived += message.ops.length;
    // The values are already in the shared store — the sender committed them under the lock before
    // posting. Applying them again here would bump the write counter a second time and make every
    // transaction in this tab think it had been raced.
    later(() => emit(message.ops.map((op) => op.path)), latency());
  }

  if (channel) channel.onmessage = (event) => receive(event.data);

  function onStorage(event) {
    if (disposed || !event || event.key !== storeKey) return;
    later(() => emit(['']), 0);
  }
  if (typeof window !== 'undefined' && !opts.isolate) window.addEventListener('storage', onStorage);

  async function commit(ops) {
    await wait(latency());
    await withLock(() => {
      const store = readStore();
      for (const op of ops) applyLocal(store, op.path, op.value);
      writeStore();
    });
    broadcast(ops);
    emit(ops.map((op) => op.path));
  }

  const driver = {
    kind: 'local',
    uid,
    code,
    stats,
    disposed: false,
    rawNow,
    get connected() { return !disposed; },

    // Delivery from another driver in this context. Values are already in the shared hub, so only
    // the paths travel — but the delay is real, and that is what the tests are exercising.
    deliver(paths) {
      if (disposed) return;
      stats.bytesReceived += paths.reduce((n, p) => n + p.length, 0);
      stats.messagesReceived += paths.length;
      later(() => emit(paths), latency());
    },

    now() {
      const store = readStore();
      const skew = typeof store.skew === 'number' ? store.skew : L.clockSkewMs;
      return rawNow() - clientSkew + skew;
    },

    serverTimestamp() {
      return driver.now();
    },

    async get(path) {
      return clone(getPath(readStore().tree, path));
    },

    async set(path, value) {
      await commit([{ path, value }]);
    },

    async update(path, patch) {
      const ops = Object.keys(patch || {}).map((key) => ({ path: `${path}/${key}`, value: patch[key] }));
      if (ops.length) await commit(ops);
    },

    async remove(path) {
      await commit([{ path, value: null }]);
    },

    // Read, apply the mutator, then commit only if nothing overlapping was written in between —
    // the same guarantee runTransaction gives, including the abort-by-returning-undefined
    // convention, so callers cannot tell the two drivers apart.
    async transact(path, fn) {
      for (let attempt = 0; attempt < NET.bank.transactionRetries; attempt += 1) {
        const before = readStore();
        const baseStamp = stampOf(before, path);
        const current = clone(getPath(before.tree, path));
        const next = fn(current);
        if (next === undefined) return { committed: false, value: current, attempts: attempt + 1 };
        await wait(latency());
        const ok = await withLock(() => {
          const store = readStore();
          if (stampOf(store, path) !== baseStamp) return false;
          applyLocal(store, path, next);
          writeStore();
          return true;
        });
        if (ok) {
          broadcast([{ path, value: next }]);
          emit([path]);
          return { committed: true, value: next, attempts: attempt + 1 };
        }
        stats.transactionRetries += 1;
        const backoff = Math.min(NET.bank.retryBackoffMaxMs, NET.bank.retryBackoffMs * 1.6 ** attempt);
        await wait(backoff * (0.5 + Math.random()));
      }
      return { committed: false, value: clone(getPath(readStore().tree, path)), exhausted: true };
    },

    subscribe(path, cb) {
      const sub = { path, cb };
      valueSubs.push(sub);
      cb(clone(getPath(readStore().tree, path)), path);
      return () => {
        const i = valueSubs.indexOf(sub);
        if (i !== -1) valueSubs.splice(i, 1);
      };
    },

    subscribeChildren(path, handlers) {
      const sub = {
        path,
        known: new Map(),
        onAdd: handlers && handlers.onAdd,
        onChange: handlers && handlers.onChange,
        onRemove: handlers && handlers.onRemove,
      };
      childSubs.push(sub);
      const node = getPath(readStore().tree, path) || {};
      for (const key of Object.keys(node)) {
        sub.known.set(key, JSON.stringify(node[key]));
        if (sub.onAdd) sub.onAdd(key, clone(node[key]));
      }
      return () => {
        const i = childSubs.indexOf(sub);
        if (i !== -1) childSubs.splice(i, 1);
      };
    },

    async onDisconnectRemove(path) {
      disconnects.set(path, null);
    },

    async cancelDisconnect(path) {
      disconnects.delete(path);
    },

    // The registered onDisconnect writes, fired now. Called on pagehide, by dispose(), and by the
    // test when it wants to simulate a client whose tab simply vanished.
    flushDisconnect() {
      if (!disconnects.size) return;
      const paths = Array.from(disconnects.keys());
      disconnects.clear();
      const store = readStore();
      for (const path of paths) applyLocal(store, path, null);
      writeStore();
      broadcast(paths.map((path) => ({ path, value: null })));
    },

    dispose() {
      if (disposed) return;
      driver.flushDisconnect();
      disposed = true;
      driver.disposed = true;
      hub.drivers.delete(driver);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      valueSubs.length = 0;
      childSubs.length = 0;
      if (typeof window !== 'undefined' && !opts.isolate) {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener('pagehide', onLeave);
        window.removeEventListener('beforeunload', onLeave);
      }
      if (channel) {
        channel.onmessage = null;
        try { channel.close(); } catch { /* already closed */ }
      }
    },
  };

  function onLeave() {
    driver.flushDisconnect();
  }
  if (typeof window !== 'undefined' && !opts.isolate) {
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
  }

  hub.drivers.add(driver);

  // The first client in decides the shared clock offset, so every peer agrees on "server" time.
  await withLock(() => {
    const store = readStore();
    if (typeof store.skew !== 'number') {
      store.skew = L.clockSkewMs;
      writeStore();
    }
  });

  return driver;
}

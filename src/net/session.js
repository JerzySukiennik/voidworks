// Voidworks — the shared factory: presence, lowest-id authority, transactional buildings, one bank and one clock.

// WHAT IS ON THE WIRE, AND WHY
//
// Shared truth (small, rare, must be conflict-free — every one of these is a transaction):
//   builds/$bid   a placement: def id, cell, rotation, who put it there
//   cells/$key    one claim per grid cell PER LEVEL, holding the bid that owns it
//   bank          { money, earned, cap } — one shared purse and the one shared item cap
//   world         { seed, epoch, host } — the inputs every client's local simulation needs
//   presence/$uid { n, at, s } — who is here and whether they are simulating; onDisconnect
//                 removes it the instant a tab closes
//   cursors/$uid  { p } — where they are looking; lossy, 5 Hz, never a source of truth
//
// NOT on the wire, ever: items. There can be nine hundred of them moving at 60 Hz, and they are a
// pure function of the buildings, the clock and the seed — all three of which are already shared.
// Sending them would cost roughly 5 MB/min per client to transmit something both clients can
// compute for free. So the inputs are synced and the simulation is re-run locally, which is the
// same trade Hollowtree made when it stopped syncing bees.
//
// One consequence has to be stated plainly, because it is the whole reason an authority exists:
// each client runs its OWN copy of the factory, so each client's sell pad fires its own sale. If
// they all banked it, money would grow N times too fast. Exactly one client — the lowest live id
// — deposits, and everyone else's money is a mirror of the bank. Same for anything genuinely
// unpredictable: the dropper's tier roll and the Gamble Press's 20% destroy are drawn from the
// shared seed (src/net/rng.js) so they are not unpredictable at all once the seed is agreed.

import { ECONOMY, NET } from '../config.js';
import { createLocalDriver } from './driver-local.js';
import { createFirebaseDriver, firebaseConfigured } from './driver-firebase.js';
import { createRandomSource, randomSeed } from './rng.js';
import {
  cellClaimKey, escapeName, joinPath, localIdentity, makeUid, normalizeCode,
} from './util.js';

async function pickDriver(code, forced) {
  const want = forced || NET.driver;
  if (want === 'local') return createLocalDriver({ code });
  if (!firebaseConfigured()) {
    if (want === 'firebase') console.warn('[net] firebase requested but NET.FIREBASE is empty — playing on the local driver');
    return createLocalDriver({ code });
  }
  try {
    return await createFirebaseDriver({ code });
  } catch (error) {
    console.warn('[net] realtime database unreachable, playing on the local driver —', error && error.message);
    return createLocalDriver({ code });
  }
}

function emptyBank() {
  return { money: ECONOMY.startMoney, earned: 0, cap: 0, at: 0 };
}

function capacityPriceFor(bought) {
  return Math.round(ECONOMY.capacityBase * ECONOMY.capacityGrowth ** Math.max(0, bought | 0));
}

export function createSession(options) {
  const opts = options || {};
  const code = normalizeCode(opts.code);
  const name = escapeName(opts.name);
  const mode = opts.mode === 'join' ? 'join' : 'host';

  const root = joinPath(NET.root, code);
  const P = {
    presence: joinPath(root, 'presence'),
    cursors: joinPath(root, 'cursors'),
    bank: joinPath(root, 'bank'),
    builds: joinPath(root, 'builds'),
    cells: joinPath(root, 'cells'),
    world: joinPath(root, 'world'),
  };
  const W = {
    seed: joinPath(P.world, 'seed'),
    epoch: joinPath(P.world, 'epoch'),
    host: joinPath(P.world, 'host'),
  };

  const presenceRaw = new Map();
  const cursorRaw = new Map();
  const builds = new Map();
  const subs = [];
  const listeners = { presence: [], authority: [], bank: [], build: [], cursor: [] };

  let driver = null;
  let uid = null;
  let epoch = 0;
  let hostUid = null;
  let disposed = false;
  let isAuthority = false;
  let bankState = emptyBank();
  let buildCounter = 0;
  let lastUpdateAt = 0;
  let heartbeatTimer = null;
  let lastCursorAt = 0;
  let lastClockSyncAt = 0;

  const rng = createRandomSource(0);

  // The pending purse. The authority accumulates what its own simulation sold and flushes it in
  // ONE transaction a few times a second, so a factory selling forty items a second still writes
  // four times a second. Batching is not an optimisation here — it is what keeps a big factory
  // inside the Spark plan's connection budget.
  let pendingDeposit = 0;
  let inFlightDeposit = 0;
  let lastFlushAt = 0;

  // Cursor packing, reused. Nothing in this module allocates per frame.
  const cursorLast = { x: 0, y: 0, z: 0, valid: false };

  function fire(list, ...args) {
    for (const fn of list.slice()) {
      try { fn(...args); } catch (error) { console.warn('[net] listener failed —', error && error.message); }
    }
  }

  function now() {
    return driver ? driver.now() : Date.now();
  }

  function on(list, cb, prime) {
    if (typeof cb !== 'function') return () => {};
    list.push(cb);
    if (prime) prime(cb);
    return () => {
      const i = list.indexOf(cb);
      if (i !== -1) list.splice(i, 1);
    };
  }

  // --- who is here, and who decides ------------------------------------------

  // A client that has stopped calling update() is not simulating anything, so it must not keep
  // voting for itself as the authority — that is precisely how two authorities coexist and money
  // doubles. Evaluated against the clock, so a frozen tab drops out with no network round trip.
  function simulating(at) {
    const stamp = at || now();
    return lastUpdateAt > 0 && stamp - lastUpdateAt < NET.rates.simStaleSec * 1000;
  }

  // Being in the room and being eligible to run it are two different things, and conflating them
  // costs you either the roster or the income. A tab the player alt-tabbed away from still has a
  // player in it — it belongs in the roster — but the browser has throttled its
  // requestAnimationFrame, so its factory is not advancing and it must not be the one banking
  // money. So presence carries `s`: 1 while that client is really simulating. The roster reads
  // every entry; the authority vote reads only the simulating ones.
  function liveUids() {
    const at = now();
    const cutoff = at - NET.rates.authorityStaleSec * 1000;
    const out = [];
    for (const [id, entry] of presenceRaw) {
      if (id === uid) continue;
      const seen = Number(entry && entry.at) || 0;
      if (seen && seen < cutoff) continue;
      if (!Number(entry && entry.s)) continue;
      out.push(id);
    }
    if (uid && simulating(at)) out.push(uid);
    return out.sort();
  }

  function presencePayload(at) {
    return { n: name, at, s: simulating(at) ? 1 : 0 };
  }

  // The authority is the lowest live id. No lease, no election, no message: every client computes
  // the same answer from the same presence list, and onDisconnect makes the list correct within
  // one round trip of a tab closing. Handover is therefore automatic and needs no cooperation
  // from the client that left — which matters, because the common way to leave is to crash.
  function ownerUid() {
    const live = liveUids();
    return live.length ? live[0] : null;
  }

  function recomputeAuthority() {
    const owner = ownerUid();
    const mine = Boolean(uid) && owner === uid;
    if (mine === isAuthority) return;
    isAuthority = mine;
    // Handing over: whatever this client had sold but not yet banked must go now, or the money
    // dies with the authority. Flushing is safe even mid-handover because the deposit is a
    // transaction on a shared node, not a write of a value we read earlier.
    if (!mine && pendingDeposit > 0) flushDeposit(true);
    fire(listeners.authority, isAuthority, owner);
  }

  function roster() {
    const at = now();
    const out = [];
    for (const [id, value] of presenceRaw) {
      const cursor = cursorRaw.get(id) || null;
      out.push({
        id,
        // Escaped on the way in AND on the way out: a name is the one field another client
        // controls, and it ends up next to a DOM node. Consumers still use textContent.
        name: escapeName(value && value.n, 'Engineer'),
        self: id === uid,
        host: id === hostUid,
        authority: id === ownerUid(),
        seenAgo: Math.max(0, at - (Number(value && value.at) || at)),
        cursor,
      });
    }
    out.sort((a, b) => (a.id < b.id ? -1 : 1));
    return out;
  }

  function applyPresence(id, value) {
    if (!value) presenceRaw.delete(id);
    else presenceRaw.set(id, value);
    recomputeAuthority();
    fire(listeners.presence, roster());
  }

  function applyCursor(id, value) {
    if (id === uid) return;
    if (!value || typeof value.p !== 'string') { cursorRaw.delete(id); return; }
    const f = value.p.split(',');
    if (f.length < 5) return;
    const parsed = {
      x: Number(f[0]) / NET.precision.position,
      y: Number(f[1]) / NET.precision.position,
      z: Number(f[2]) / NET.precision.position,
      cx: Number(f[3]) | 0,
      cz: Number(f[4]) | 0,
    };
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y) || !Number.isFinite(parsed.z)) return;
    cursorRaw.set(id, parsed);
    fire(listeners.cursor, id, parsed);
  }

  // --- the bank: one purse, one cap ------------------------------------------

  // Every client's own writes are serialised into a queue. Two players colliding on the bank is
  // what transactions are for; one player colliding with themselves twenty times in a tick is
  // just wasted retries, and enough of them exhaust the budget and silently drop a deposit.
  let bankChain = Promise.resolve();

  function queueBank(task) {
    const next = bankChain.then(task, task);
    bankChain = next.then(() => {}, () => {});
    return next;
  }

  function normalizeBank(value) {
    const base = emptyBank();
    if (value && typeof value === 'object') {
      if (Number.isFinite(Number(value.money))) base.money = Number(value.money);
      if (Number.isFinite(Number(value.earned))) base.earned = Number(value.earned);
      if (Number.isFinite(Number(value.cap))) base.cap = Math.max(0, Number(value.cap) | 0);
      base.at = Number(value.at) || 0;
    }
    return base;
  }

  function applyBank(value) {
    bankState = normalizeBank(value);
    fire(listeners.bank, bankSnapshot());
  }

  function bankSnapshot() {
    return {
      money: bankState.money,
      earned: bankState.earned,
      capacityBought: bankState.cap,
      // The item cap is derived here, from the shared purchase count and the shared config, so
      // every client computes the identical number. It is the central constraint of the game: if
      // two clients disagreed about it their droppers would stall at different moments and the
      // factories would drift apart within seconds.
      capacity: Math.min(ECONOMY.capacityMax, ECONOMY.capacityStart + bankState.cap * ECONOMY.capacityStep),
      capacityPrice: capacityPriceFor(bankState.cap),
      at: bankState.at,
    };
  }

  function mutateBank(mutator) {
    if (!driver) return Promise.resolve(false);
    return queueBank(async () => {
      const result = await driver.transact(P.bank, (current) => mutator(normalizeBank(current)));
      if (result.committed) applyBank(result.value);
      return Boolean(result.committed);
    });
  }

  function deposit(amount) {
    const value = Number(amount);
    if (!(value > 0)) return Promise.resolve(false);
    return mutateBank((base) => {
      base.money += value;
      base.earned += value;
      base.at = now();
      return base;
    });
  }

  // Returns false and changes nothing when the shared purse cannot cover it. The check and the
  // subtraction are inside one transaction, so two players buying the last upgrader at the same
  // instant cannot both succeed and drive the bank negative.
  function spend(amount) {
    const value = Number(amount) || 0;
    if (value <= 0) return Promise.resolve(true);
    return mutateBank((base) => {
      if (base.money + 1e-6 < value) return undefined; // abort — nothing is written
      base.money = Math.max(0, base.money - value);
      base.at = now();
      return base;
    });
  }

  function refund(amount) {
    const value = Number(amount) || 0;
    if (value <= 0) return Promise.resolve(false);
    return mutateBank((base) => {
      base.money += value;
      base.at = now();
      return base;
    });
  }

  // The cap and its price move together inside one transaction, so two players expanding at once
  // pay two different (rising) prices and get two steps — never one step for two payments.
  function buyCapacity() {
    return mutateBank((base) => {
      const capacity = Math.min(ECONOMY.capacityMax, ECONOMY.capacityStart + base.cap * ECONOMY.capacityStep);
      if (capacity >= ECONOMY.capacityMax) return undefined;
      const price = capacityPriceFor(base.cap);
      if (base.money < price) return undefined;
      base.money -= price;
      base.cap += 1;
      base.at = now();
      return base;
    });
  }

  function flushDeposit(force) {
    const amount = pendingDeposit;
    if (amount <= 0) return;
    if (!force && amount < NET.rates.bankFlushMin) return;
    pendingDeposit = 0;
    // Held as in-flight rather than simply zeroed, so the money the player is looking at does not
    // dip for the round trip and then jump back. `pending` covers both, and the dip disappears.
    inFlightDeposit += amount;
    deposit(amount).then((ok) => {
      inFlightDeposit -= amount;
      // A failed flush must not evaporate: put it back and let the next tick try again.
      if (!ok) pendingDeposit += amount;
    }, () => {
      inFlightDeposit -= amount;
      pendingDeposit += amount;
    });
  }

  // Called by the bridge with whatever this client's own simulation just sold. Only the authority
  // banks it; everyone else's identical sale is dropped on the floor, which is the entire reason
  // the money does not multiply by the number of players.
  function earn(amount) {
    const value = Number(amount) || 0;
    if (!(value > 0) || !isAuthority) return false;
    pendingDeposit += value;
    return true;
  }

  // --- buildings: claim the cells, then pay, then publish ---------------------

  function claimPath(key) {
    return joinPath(P.cells, key);
  }

  async function releaseClaims(keys, bid) {
    for (const key of keys) {
      // Only ever clear our own claim: a transaction, because by now the cell may already have
      // been legitimately taken by someone else after our own removal.
      await driver.transact(claimPath(key), (current) => (current === bid ? null : undefined)).catch(() => {});
    }
  }

  // `cells` is [[x, z, level], ...] — the footprint the caller computed from the building def.
  // Claims are taken ONE AT A TIME IN SORTED KEY ORDER. That ordering is the whole trick for
  // multi-cell buildings: two players dropping a 2x2 sell pad on overlapping ground contend on
  // the same first cell, so exactly one wins outright. Claiming in parallel would let each win a
  // different cell and both roll back — a stalemate where neither player can build.
  async function placeBuilding(spec) {
    if (!driver || disposed) return { ok: false, reason: 'offline' };
    const cells = (spec.cells || []).map((c) => cellClaimKey(c[0], c[1], c[2] || 0)).sort();
    if (!cells.length) return { ok: false, reason: 'empty' };
    buildCounter += 1;
    const bid = `${uid}_${buildCounter.toString(36)}`;
    const claimed = [];
    for (const key of cells) {
      const result = await driver.transact(claimPath(key), (current) => (current ? undefined : bid));
      if (!result.committed) {
        await releaseClaims(claimed, bid);
        return { ok: false, reason: 'occupied', bid };
      }
      claimed.push(key);
    }
    // Ground first, money second: a player who cannot afford it has lost nothing, and a cell that
    // was claimed but never paid for is released immediately below.
    const price = Number(spec.price) || 0;
    if (price > 0 && !(await spend(price))) {
      await releaseClaims(claimed, bid);
      return { ok: false, reason: 'poor', bid };
    }
    await driver.set(joinPath(P.builds, bid), {
      d: String(spec.defId),
      x: spec.x | 0,
      z: spec.z | 0,
      r: (spec.rot | 0) & 3,
      u: uid,
      t: now(),
    });
    return { ok: true, bid };
  }

  async function removeBuilding(bid, spec) {
    if (!driver || disposed || !bid) return false;
    const cells = (spec && spec.cells ? spec.cells : []).map((c) => cellClaimKey(c[0], c[1], c[2] || 0)).sort();

    // The claims come back FIRST, and unconditionally. Two earlier bugs lived here:
    //
    //   1. this bailed out when `builds` did not know the bid — but `builds` is the mirror of the
    //      shared tree, filled by the subscription echo. Deleting a building faster than its own
    //      echo returned meant the early return ran, the cells were never released, and that ground
    //      stayed claimed forever: the building vanished locally and nobody could ever build there again.
    //   2. releasing after `driver.remove` meant a failed or rejected remove leaked the claims too.
    //
    // Releasing unconditionally is safe because `releaseClaims` only ever clears a cell that still
    // holds OUR bid — it cannot free ground that someone else has since taken.
    await releaseClaims(cells, bid);

    try {
      await driver.remove(joinPath(P.builds, bid));
    } catch {
      /* the entry may already be gone; the ground is what mattered and it is free */
    }

    const back = Number(spec && spec.refund) || 0;
    if (back > 0) await refund(back);
    return true;
  }

  function applyBuild(bid, value) {
    if (!value || typeof value !== 'object' || typeof value.d !== 'string') return;
    const entry = {
      bid,
      defId: value.d,
      x: value.x | 0,
      z: value.z | 0,
      rot: (value.r | 0) & 3,
      by: String(value.u || ''),
      mine: value.u === uid,
      at: Number(value.t) || 0,
    };
    const had = builds.has(bid);
    builds.set(bid, entry);
    fire(listeners.build, had ? 'change' : 'add', entry);
  }

  function dropBuild(bid) {
    const entry = builds.get(bid);
    if (!entry) return;
    builds.delete(bid);
    fire(listeners.build, 'remove', entry);
  }

  // --- presence heartbeat -----------------------------------------------------

  // On setInterval, never on the frame loop: a hidden tab stops requestAnimationFrame, and a
  // heartbeat that stopped with it would let a frozen client keep believing it is the authority.
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => { onHeartbeat().catch(() => {}); }, NET.rates.heartbeatSec * 1000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  async function onHeartbeat() {
    if (disposed || !driver || !uid) return;
    // Unconditionally: a throttled tab must keep its seat in the room. Whether it is simulating
    // rides along in the same write, so the authority vote sees the truth either way.
    driver.set(joinPath(P.presence, uid), presencePayload(now())).catch(() => {});
    prunePresence();
    recomputeAuthority();
  }

  // onDisconnect is the primary cleanup and it is instant. This only catches the case where the
  // socket died without the server noticing, so the window is deliberately generous — a player who
  // alt-tabs has their timers throttled by the browser and must not be evicted for it.
  function prunePresence() {
    const cutoff = now() - NET.rates.presenceStaleSec * 1000;
    let pruned = false;
    for (const [id, entry] of Array.from(presenceRaw)) {
      if (id === uid) continue;
      const seen = Number(entry && entry.at) || 0;
      if (!seen || seen >= cutoff) continue;
      presenceRaw.delete(id);
      cursorRaw.delete(id);
      pruned = true;
      if (isAuthority) {
        driver.remove(joinPath(P.presence, id)).catch(() => {});
        driver.remove(joinPath(P.cursors, id)).catch(() => {});
      }
    }
    if (pruned) fire(listeners.presence, roster());
  }

  // --- per-frame --------------------------------------------------------------

  function publishCursor(x, y, z, cx, cz) {
    if (!driver || !uid || disposed) return;
    const at = now();
    if (at - lastCursorAt < 1000 / NET.rates.cursorHz) return;
    const e = NET.rates.cursorEpsilon;
    if (cursorLast.valid
      && Math.abs(x - cursorLast.x) < e && Math.abs(y - cursorLast.y) < e && Math.abs(z - cursorLast.z) < e) return;
    lastCursorAt = at;
    cursorLast.x = x; cursorLast.y = y; cursorLast.z = z; cursorLast.valid = true;
    const k = NET.precision.position;
    const packed = `${Math.round(x * k)},${Math.round(y * k)},${Math.round(z * k)},${cx | 0},${cz | 0}`;
    driver.set(joinPath(P.cursors, uid), { p: packed, at }).catch(() => {});
  }

  function update(dt) {
    if (disposed || !driver || !uid) return;
    const at = now();
    // Coming back from a stall (hidden tab, long load): re-announce at once rather than waiting
    // for the next heartbeat, so the roster heals immediately.
    const resumed = lastUpdateAt > 0 && at - lastUpdateAt >= NET.rates.simStaleSec * 1000;
    lastUpdateAt = at;
    if (resumed) {
      driver.set(joinPath(P.presence, uid), presencePayload(at)).catch(() => {});
      recomputeAuthority();
    }
    if (isAuthority && pendingDeposit > 0 && at - lastFlushAt >= 1000 / NET.rates.bankFlushHz) {
      lastFlushAt = at;
      flushDeposit(false);
    }
    if (isAuthority && at - lastClockSyncAt >= NET.rates.clockSyncSec * 1000) {
      lastClockSyncAt = at;
      mutateBank((base) => { base.at = now(); return base; }).catch(() => {});
    }
  }

  // --- join -------------------------------------------------------------------

  async function handshake() {
    uid = driver.uid || localIdentity() || makeUid();

    // The seed and the epoch are minted exactly once per room, by whoever gets there first, and
    // read by everyone else. serverTimestamp keeps the epoch on the database's clock rather than
    // on the clock of whichever player happened to open the room.
    const seeded = await driver.transact(W.seed, (current) => {
      const value = Number(current);
      return Number.isFinite(value) && value > 0 ? undefined : randomSeed();
    });
    let seed = Number(seeded.value);
    if (!Number.isFinite(seed) || seed <= 0) seed = Number(await driver.get(W.seed));
    rng.reseed(Number.isFinite(seed) && seed > 0 ? seed : 1);

    const stamped = await driver.transact(W.epoch, (current) => (
      Number(current) > 0 ? undefined : driver.serverTimestamp()
    ));
    let stamp = Number(stamped.value);
    if (!Number.isFinite(stamp) || stamp <= 0) stamp = Number(await driver.get(W.epoch));
    epoch = Number.isFinite(stamp) && stamp > 0 ? stamp : now();

    const claimedHost = await driver.transact(W.host, (current) => (current ? undefined : uid));
    hostUid = (typeof claimedHost.value === 'string' && claimedHost.value) || (await driver.get(W.host)) || uid;

    // A closed tab cleans itself up without cooperation, which is what makes authority handover
    // work when the authority is the one who crashed.
    await driver.onDisconnectRemove(joinPath(P.presence, uid));
    await driver.onDisconnectRemove(joinPath(P.cursors, uid));
    lastUpdateAt = now();
    await driver.set(joinPath(P.presence, uid), presencePayload(now()));

    subs.push(driver.subscribe(P.bank, applyBank));
    subs.push(driver.subscribeChildren(P.presence, {
      onAdd: applyPresence,
      onChange: applyPresence,
      onRemove: (id) => applyPresence(id, null),
    }));
    subs.push(driver.subscribeChildren(P.cursors, {
      onAdd: applyCursor,
      onChange: applyCursor,
      onRemove: (id) => { cursorRaw.delete(id); },
    }));
    subs.push(driver.subscribeChildren(P.builds, {
      onAdd: applyBuild,
      onChange: applyBuild,
      onRemove: dropBuild,
    }));

    // The room's opening balance is written once, by whoever creates it. Joining a live room must
    // never reset the purse, so this only fires when the node does not exist at all.
    await mutateBank((base) => (bankState.at || base.at ? undefined : { ...base, at: now() }));

    lastUpdateAt = now();
    recomputeAuthority();
    startHeartbeat();

    return { uid, code, seed: rng.seed, epoch, driver: driver.kind, mode };
  }

  const ready = (async () => {
    driver = await pickDriver(code, opts.driver);
    try {
      return await handshake();
    } catch (error) {
      // Reaching the database is not the same as being allowed to write to it. This database is
      // shared with four other games, so the realistic failure is PERMISSION_DENIED: the rules do
      // not (yet) carry the `voidworks` block. A denied handshake must not leave co-op dead — drop
      // to the local driver and let the players at least share a machine.
      if (!driver || driver.kind !== 'firebase') throw error;
      console.warn('[net] the database refused the handshake, falling back to the local driver —', error && error.message);
      for (const off of subs) {
        try { off(); } catch { /* already detached */ }
      }
      subs.length = 0;
      try { driver.dispose(); } catch { /* already gone */ }
      driver = await createLocalDriver({ code });
      return handshake();
    }
  })();

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopHeartbeat();
    // Anything sold and not yet banked goes now, synchronously scheduled before teardown, or the
    // last second of this player's income is lost.
    if (pendingDeposit > 0) flushDeposit(true);
    for (const off of subs) {
      try { off(); } catch { /* already detached */ }
    }
    subs.length = 0;
    if (driver) {
      // Fire the onDisconnect writes now rather than merely queueing them: disposing the driver
      // tears down pending work, so a scheduled removal would be lost and the player would linger.
      driver.flushDisconnect();
      const handle = driver;
      setTimeout(() => handle.dispose(), 400);
    }
    presenceRaw.clear();
    cursorRaw.clear();
    builds.clear();
  }

  return {
    ready,
    update,
    dispose,
    rng,

    get uid() { return uid; },
    get code() { return code; },
    get mode() { return mode; },
    get name() { return name; },
    get epoch() { return epoch; },
    get seed() { return rng.seed; },
    get driverKind() { return driver ? driver.kind : null; },
    // Test hook: the cell-claim subtree is the one piece of shared state a player can permanently
    // corrupt, so it has to be checkable from outside rather than only inferable from symptoms.
    async buildIds() {
      if (!driver) return null;
      const all = await driver.get(P.builds);
      return all ? Object.keys(all) : [];
    },
    async claimAt(x, z, level) {
      if (!driver) return null;
      return driver.get(joinPath(P.cells, cellClaimKey(x, z, level || 0)));
    },
    get playerCount() { return presenceRaw.size; },
    now,
    roster,

    authority: {
      isMine() { return Boolean(uid) && ownerUid() === uid; },
      owner: ownerUid,
      onChange(cb) { return on(listeners.authority, cb, (fn) => fn(isAuthority, ownerUid())); },
    },

    bank: {
      snapshot: bankSnapshot,
      earn,
      deposit,
      spend,
      refund,
      buyCapacity,
      flush: () => flushDeposit(true),
      // Sold but not yet acknowledged by the bank — queued plus in flight. The bridge adds it to
      // the bank's figure so the HUD never lags a sale by a round trip.
      get pending() { return pendingDeposit + inFlightDeposit; },
      onChange(cb) { return on(listeners.bank, cb, (fn) => fn(bankSnapshot())); },
    },

    buildings: {
      all: builds,
      place: placeBuilding,
      remove: removeBuilding,
      onChange(cb) {
        return on(listeners.build, cb, (fn) => {
          for (const entry of builds.values()) fn('add', entry);
        });
      },
    },

    presence: {
      publishCursor,
      onChange(cb) { return on(listeners.presence, cb, (fn) => fn(roster())); },
      onCursor(cb) { return on(listeners.cursor, cb); },
    },

    stats() {
      if (!driver) return null;
      const seconds = Math.max(0.001, (Date.now() - driver.stats.startedAt) / 1000);
      return { ...driver.stats, driver: driver.kind, seconds, players: presenceRaw.size };
    },
  };
}

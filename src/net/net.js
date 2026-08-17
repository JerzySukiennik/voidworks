// Voidworks — the bridge between one shared session and this client's world: buildings, the bank, the cap, cursors.

// The rule this file obeys: NOTHING outside src/net/ knows multiplayer exists. It attaches to the
// world's public surface (place / remove / economy / grid) and detaches cleanly, so with
// NET.enabled false — or simply nobody hosting — the game is byte-for-byte the singleplayer game.
// That is why the wrappers are installed on join and restored on leave rather than living inside
// world.js: singleplayer never executes a line of this.

import { ECONOMY, NET } from '../config.js';
import { createSession } from './session.js';
import { escapeName, makeRoomCode, normalizeCode } from './util.js';

export { makeRoomCode, normalizeCode, escapeName };

// [x, z, level] for every cell a building would occupy — the claim set a placement must win
// before it is allowed to exist. Levels are part of the key because a ramp and a belt may legally
// share x,z on different levels, and claiming per (x,z) alone would forbid a legal build.
function footprintCells(grid, def, cx, cz, rot) {
  const flat = grid.footprint(def, cx, cz, rot, []);
  const cells = [];
  for (let i = 0; i < flat.length; i += 2) {
    for (let l = 0; l < def.levels.length; l += 1) cells.push([flat[i], flat[i + 1], def.levels[l]]);
  }
  return cells;
}

// The singleplayer refund, computed before the count is decremented so it matches exactly what
// economy.refund() would have paid — the shared bank must not be a different game.
function refundFor(economy, def) {
  const n = Math.max(1, economy.counts.get(def.id) || 1);
  return Math.round(Math.round(def.cost * ECONOMY.priceGrowth ** (n - 1)) * ECONOMY.refund);
}

export function createNetLink(world) {
  let session = null;
  let status = 'off';
  let error = null;
  const statusListeners = [];

  // bid <-> local building, the only mapping the bridge needs to keep.
  const byBid = new Map();
  const bidOf = new Map();

  const original = { place: null, remove: null, removeAt: null, buyCapacity: null };
  const offs = [];

  // Money reconcile state. `shadow` is what the shared bank last said this client's money was;
  // anything the local simulation added on top of it since is income this client's own sell pads
  // produced this frame.
  let shadow = 0;
  let bankMoney = 0;

  function setStatus(next, err) {
    status = next;
    error = err || null;
    for (const cb of statusListeners.slice()) {
      try { cb(status, error); } catch { /* listener's problem */ }
    }
  }

  function defOf(idOrDef) {
    if (!idOrDef) return null;
    if (typeof idOrDef !== 'string') return idOrDef;
    for (const d of world.catalogue) if (d.id === idOrDef) return d;
    return null;
  }

  // --- mirroring the shared build list into this client's world ---------------

  // Entries the shared tree says exist but that would not fit locally yet. This is not
  // hypothetical: lose a race for a cell and the winner's building can arrive a few milliseconds
  // before your own optimistic copy is taken back out, so the cell is briefly occupied by
  // something that is about to disappear. Without the retry the loser's client would simply never
  // show the winner's building — the two factories would disagree permanently over one cell.
  const deferred = [];

  // Ids this client's catalogue has never heard of. A room outlives a release: someone on a newer
  // build can place something this page has no definition for, and a renamed id (belt_turn_l and
  // belt_turn_r became one rotating belt_turn) does the same thing to an old saved room. Such an
  // entry can never be placed, so it must be dropped rather than deferred — the deferred list is a
  // retry queue for cells that are momentarily occupied, and a permanently unplaceable entry would
  // sit in it being retried every single frame for as long as the room is open.
  const unknown = new Set();

  function applyRemoteBuild(entry) {
    if (byBid.has(entry.bid)) return true;
    if (unknown.has(entry.bid)) return false;
    if (!defOf(entry.defId)) {
      unknown.add(entry.bid);
      return false;
    }
    const b = original.place.call(world, entry.defId, entry.x, entry.z, entry.rot, { free: true });
    if (!b) {
      if (!deferred.some((e) => e.bid === entry.bid)) deferred.push(entry);
      return false;
    }
    byBid.set(entry.bid, b);
    bidOf.set(b, entry.bid);
    world.flow.markDirty();
    return true;
  }

  function drainDeferred() {
    for (let i = deferred.length - 1; i >= 0; i -= 1) {
      const entry = deferred[i];
      // Gone from the shared tree while we were waiting: it was never ours to place.
      if (!session.buildings.all.has(entry.bid)) { deferred.splice(i, 1); continue; }
      if (byBid.has(entry.bid)) { deferred.splice(i, 1); continue; }
      const b = original.place.call(world, entry.defId, entry.x, entry.z, entry.rot, { free: true });
      if (!b) continue;
      byBid.set(entry.bid, b);
      bidOf.set(b, entry.bid);
      world.flow.markDirty();
      deferred.splice(i, 1);
    }
  }

  function applyRemoteRemove(entry) {
    const b = byBid.get(entry.bid);
    byBid.delete(entry.bid);
    unknown.delete(entry.bid);
    if (!b) return;
    bidOf.delete(b);
    // free:true, because the money side of a removal is settled once, by the client that asked
    // for it, against the shared bank — never once per client against a local purse.
    const n = world.economy.counts.get(b.def.id) || 0;
    original.remove.call(world, b, { free: true });
    if (n > 0) world.economy.counts.set(b.def.id, n - 1);
    world.flow.markDirty();
  }

  // --- the wrappers a player's own actions go through -------------------------

  function netPlace(defId, cx, cz, rot, opts) {
    // free:true is the world talking to itself (starter factory, save restore, our own mirror).
    // It is never a player action, so it must not touch the shared tree.
    if (opts && opts.free) return original.place.call(world, defId, cx, cz, rot, opts);
    const def = defOf(defId);
    if (!def) return null;
    const r = def.rotatable ? (rot | 0) & 3 : 0;
    if (!world.grid.fits(def, cx, cz, r)) return null;
    const price = world.priceOf(def);
    if (world.economy.money < price) return null;

    // Placed locally at once so the click feels instant, then reconciled: if the shared claim is
    // lost — someone else got that cell in the same instant — it is taken straight back out.
    const b = original.place.call(world, def, cx, cz, r, { free: true });
    if (!b) return null;
    world.flow.markDirty();

    session.buildings.place({
      defId: def.id,
      x: cx,
      z: cz,
      rot: r,
      price,
      cells: footprintCells(world.grid, def, cx, cz, r),
    }).then((result) => {
      if (result.ok) {
        // Our own entry comes back through the subscription; claim it here so the mirror does not
        // place a second copy on top of the one already standing.
        byBid.set(result.bid, b);
        bidOf.set(b, result.bid);
        return;
      }
      const n = world.economy.counts.get(def.id) || 0;
      original.remove.call(world, b, { free: true });
      if (n > 0) world.economy.counts.set(def.id, n - 1);
      world.flow.markDirty();
      world.audio?.play?.('denied');
    }).catch(() => {});

    return b;
  }

  function netRemove(b, opts) {
    if (opts && opts.free) return original.remove.call(world, b, opts);
    if (!b || !bidOf.has(b)) return false;
    const bid = bidOf.get(b);
    const def = b.def;
    const back = refundFor(world.economy, def);
    const cells = footprintCells(world.grid, def, b.cx, b.cz, b.rot);
    const n = world.economy.counts.get(def.id) || 0;
    const ok = original.remove.call(world, b, { free: true });
    if (!ok) return false;
    if (n > 0) world.economy.counts.set(def.id, n - 1);
    bidOf.delete(b);
    byBid.delete(bid);
    world.flow.markDirty();
    session.buildings.remove(bid, { cells, refund: back }).catch(() => {});
    return true;
  }

  function netRemoveAt(x, z, level) {
    const b = level === undefined ? world.grid.anyAt(x, z) : world.grid.at(x, z, level);
    return b ? netRemove(b) : false;
  }

  function netBuyCapacity() {
    // Fire and forget: the shared bank answers, and the answer arrives as a bank snapshot that
    // moves both the money and the cap on every client at once.
    session.bank.buyCapacity().catch(() => {});
    return true;
  }

  // --- bank mirror ------------------------------------------------------------

  function onBank(snapshot) {
    bankMoney = snapshot.money;
    world.economy.money = bankMoney + session.bank.pending;
    shadow = world.economy.money;
    // The item cap is the game's central constraint, so it is mirrored, not negotiated: every
    // client derives it from the same purchase count and stalls its droppers at the same moment.
    world.economy.setCapacityBought(snapshot.capacityBought);
  }

  // --- the shared factory this client starts from -----------------------------

  async function adoptRoom(info) {
    // Joining an existing room means adopting its factory wholesale: the local one (starter or
    // saved) is not ours to merge in, and merging would double every belt.
    const existing = Array.from(session.buildings.all.values());
    if (info.mode === 'join' || existing.length) {
      world.clearAll();
      byBid.clear();
      bidOf.clear();
      deferred.length = 0;
      unknown.clear();
      for (const entry of existing) applyRemoteBuild(entry);
      world.flow.relink();
      return;
    }
    // Hosting an empty room: publish what is standing here, so the host's factory becomes the
    // room's factory instead of vanishing the moment co-op starts.
    const local = Array.from(world.buildings.values());
    world.clearAll();
    byBid.clear();
    bidOf.clear();
    deferred.length = 0;
    unknown.clear();

    // Published with bounded concurrency, not one at a time. A starter factory is a hundred
    // buildings and each one is a claim plus a write, so strictly sequential publishing made
    // hosting take twelve seconds — twelve seconds during which the menu is frozen AND a friend
    // joining collides with every single write. Buildings are independent (they occupy disjoint
    // cells by construction, since they were all standing here a moment ago), so they can go up
    // together. The limit exists because the point is to stop hammering one node, not to swap a
    // slow queue for a hundred-way stampede.
    const queue = local.slice();
    const worker = async () => {
      while (queue.length) {
        const b = queue.shift();
        await session.buildings.place({
          defId: b.def.id,
          x: b.cx,
          z: b.cz,
          rot: b.rot,
          price: 0,
          cells: footprintCells(world.grid, b.def, b.cx, b.cz, b.rot),
        }).catch(() => {});
      }
    };
    const lanes = Math.max(1, Math.min(NET.publishConcurrency, queue.length));
    await Promise.all(Array.from({ length: lanes }, worker));
    world.flow.relink();
  }

  function install() {
    original.place = world.place;
    original.remove = world.remove;
    original.removeAt = world.removeAt;
    original.buyCapacity = world.buyCapacity;
    world.place = netPlace;
    world.remove = netRemove;
    world.removeAt = netRemoveAt;
    world.buyCapacity = netBuyCapacity;
  }

  function uninstall() {
    if (!original.place) return;
    world.place = original.place;
    world.remove = original.remove;
    world.removeAt = original.removeAt;
    world.buyCapacity = original.buyCapacity;
    original.place = null;
  }

  async function connect(mode, name, code) {
    if (!NET.enabled || NET.driver === 'off') {
      setStatus('off', new Error('multiplayer is disabled in config'));
      return null;
    }
    if (session) leave();
    setStatus('connecting');
    session = createSession({ mode, name, code: mode === 'host' ? (code || makeRoomCode()) : code });
    let info = null;
    try {
      info = await session.ready;
    } catch (err) {
      session = null;
      setStatus('error', err);
      return null;
    }
    install();
    await adoptRoom(info);

    offs.push(session.bank.onChange(onBank));
    offs.push(session.buildings.onChange((kind, entry) => {
      if (kind === 'add') applyRemoteBuild(entry);
      else if (kind === 'remove') applyRemoteRemove(entry);
    }));
    offs.push(session.presence.onChange(() => setStatus('live')));
    offs.push(session.authority.onChange(() => setStatus('live')));

    setStatus('live');
    return info;
  }

  function leave() {
    for (const off of offs) {
      try { off(); } catch { /* already detached */ }
    }
    offs.length = 0;
    uninstall();
    if (session) session.dispose();
    session = null;
    byBid.clear();
    bidOf.clear();
    deferred.length = 0;
    unknown.clear();
    setStatus('off');
  }

  // --- per frame --------------------------------------------------------------

  // No allocation here, on purpose: this runs inside the render loop next to a sim that is
  // already moving nine hundred items. The only string it ever builds is the cursor packet, five
  // times a second, behind a movement threshold.
  function update(dt) {
    if (!session) return;
    session.update(dt);
    // Almost always empty, and an empty array costs one length check — no allocation.
    if (deferred.length) drainDeferred();

    // Whatever this client's own sell pads earned since the last frame. Only the authority banks
    // it; on every other client the identical sale is discarded, which is what stops N players
    // from multiplying the income by N. Losses are dropped too — purchases were already settled
    // against the shared bank before the local place ever happened.
    const delta = world.economy.money - shadow;
    if (delta > 0) session.bank.earn(delta);
    const target = bankMoney + session.bank.pending;
    world.economy.money = target;
    shadow = target;

    const orbit = world.orbit;
    if (orbit && orbit.target) {
      const cell = world.placement && world.placement.cell ? world.placement.cell : null;
      session.presence.publishCursor(
        orbit.target.x, orbit.target.y, orbit.target.z,
        cell ? cell.x : 0, cell ? cell.z : 0,
      );
    }
  }

  return {
    update,
    leave,
    host: (name, code) => connect('host', name, code),
    join: (name, code) => connect('join', name, code),
    get active() { return Boolean(session); },
    get status() { return status; },
    get error() { return error; },
    get code() { return session ? session.code : null; },
    get uid() { return session ? session.uid : null; },
    get seed() { return session ? session.seed : 0; },
    get rng() { return session ? session.rng : null; },
    get isAuthority() { return Boolean(session) && session.authority.isMine(); },
    get session() { return session; },
    roster: () => (session ? session.roster() : []),
    onStatus(cb) {
      if (typeof cb !== 'function') return () => {};
      statusListeners.push(cb);
      cb(status, error);
      return () => {
        const i = statusListeners.indexOf(cb);
        if (i !== -1) statusListeners.splice(i, 1);
      };
    },
    stats: () => (session ? session.stats() : null),
  };
}

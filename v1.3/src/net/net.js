// Voidworks — the bridge between one shared session and this client's world: buildings, the bank, the cap, cursors.

// The rule this file obeys: NOTHING outside src/net/ knows multiplayer exists. It attaches to the
// world's public surface (place / remove / economy / grid) and detaches cleanly, so with
// NET.enabled false — or simply nobody hosting — the game is byte-for-byte the singleplayer game.
// That is why the wrappers are installed on join and restored on leave rather than living inside
// world.js: singleplayer never executes a line of this.

import { ECONOMY, NET, PRESENCE } from '../config.js';
import { createSession } from './session.js';
import { escapeName, makeRoomCode, normalizeCode } from './util.js';

// NOTE: ./avatars.js is imported DYNAMICALLY, inside connect(), and that is not a style choice.
// avatars.js imports three, which resolves through the page's importmap and does not exist as a node
// package — so a static import here would make `import('src/net/net.js')` explode in every headless
// harness we own (work/tools/net-sim.mjs is 38 checks of exactly that). Loading it at join time also
// means singleplayer never even fetches the module.

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
  // Built on join, torn down on leave. Singleplayer never constructs it, so with nobody hosting
  // there is no group in the scene, no listener on the document and nothing on any wire.
  let avatars = null;
  let pingSeq = 0;
  let pingCell = { x: 0, z: 0 };
  let keyHandler = null;
  let status = 'off';
  let error = null;
  const statusListeners = [];

  // bid <-> local building, the only mapping the bridge needs to keep.
  const byBid = new Map();
  const bidOf = new Map();

  const original = { place: null, remove: null, removeAt: null, buyCapacity: null };
  // buildings whose shared id is still in flight, so a delete arriving first can wait for it
  const placing = new Map();
  // pieces deleted while their own placement was still in flight — their late reply must not claim
  // the shared id, because by then the echo has already built a mirror copy that owns it
  const orphaned = new Set();
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

    // Keep the RAW request, not the chain below it: the chain's handlers return nothing, so a delete
    // waiting on it would receive `undefined` instead of the result carrying the shared id.
    const request = session.buildings.place({
      defId: def.id,
      x: cx,
      z: cz,
      rot: r,
      price,
      cells: footprintCells(world.grid, def, cx, cz, r),
    });
    placing.set(b, request);

    request.then((result) => {
      if (result.ok) {
        // Deleted before the reply landed: the echo has already stood a mirror copy on this ground
        // and that copy is what the removal echo will look for. Claiming the id here would point it
        // at this dead object instead, and the copy would stand on the grid forever.
        if (orphaned.has(b)) { orphaned.delete(b); return; }
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
    }).catch(() => {}).finally(() => { placing.delete(b); });

    return b;
  }

  function netRemove(b, opts) {
    if (opts && opts.free) return original.remove.call(world, b, opts);
    if (!b) return false;

    // A building placed a moment ago has no shared id yet — the id arrives with the round trip. The
    // old code refused to remove it at all, so a quick delete silently did nothing and the player was
    // left unable to build on ground they believed they had cleared. Take it out locally now and
    // settle the shared side when the id lands.
    if (!bidOf.has(b)) {
      const inFlight = placing.get(b);
      if (!inFlight) return false;
      const def = b.def;
      const back = refundFor(world.economy, def);
      const cells = footprintCells(world.grid, def, b.cx, b.cz, b.rot);
      const n = world.economy.counts.get(def.id) || 0;
      if (!original.remove.call(world, b, { free: true })) return false;
      if (n > 0) world.economy.counts.set(def.id, n - 1);
      world.flow.markDirty();
      orphaned.add(b);
      inFlight.then((result) => {
        if (!result || !result.ok || !result.bid) return;
        // Deliberately do NOT drop the bid from the mirror here. The place echo may already have
        // rebuilt this piece as a remote copy, and only `applyRemoteRemove` — driven by the removal
        // echo — knows how to take that copy back out. Forgetting the bid first would strand it on
        // the grid permanently, which is the same class of bug one layer up.
        session.buildings.remove(result.bid, { cells, refund: back }).catch(() => {});
      }).catch(() => {});
      return true;
    }

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
    // --- presence: the other players, as bodies -------------------------------
    // Guarded on the world actually having a renderer: the headless harnesses drive this same bridge
    // against a world with no scene and no camera, and co-op must work there exactly as it does in
    // the browser, minus the drawing. A failure to load the layer is logged and dropped — losing the
    // avatars is a cosmetic loss, and it must never take the session down with it.
    if (world.view && world.view.scene && world.view.camera) {
      try {
        const mod = await import('./avatars.js');
        avatars = mod.createAvatars({ scene: world.view.scene, camera: world.view.camera });
        avatars.setSelf(session.uid);
        avatars.sync(session.roster());
      } catch (err) {
        avatars = null;
        console.warn('[net] the avatar layer failed to load, co-op continues without bodies —', err && err.message);
      }
    }
    offs.push(session.presence.onChange((list) => {
      if (avatars) avatars.sync(list);
      // Somebody arrived or left: re-announce this client's pose on the next frame even if it has
      // not moved a millimetre, so a newcomer sees a stationary player immediately.
      session.presence.repose();
      setStatus('live');
    }));
    offs.push(session.presence.onCursor((id, p) => {
      if (!avatars) return;
      avatars.pose(id, p.x, p.y, p.z, p.az, p.pol);
      // The ping rides in the same packet. It fires on a CHANGE of the counter and on nothing else,
      // so a client that joins mid-ping adopts the current counter silently instead of replaying it.
      avatars.applyPingSeq(id, p.seq, p.px, p.pz);
    }));

    // One key, bound only while a room is open and removed when it closes. `v` is free: placement
    // owns r/x/Escape/Delete, the buildbar owns Tab and 1-9, orbit owns wasd/arrows/q/e/f/space.
    if (avatars) keyHandler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (String(e.key).toLowerCase() !== PRESENCE.ping.key) return;
      ping();
    };
    if (keyHandler) addEventListener('keydown', keyHandler);

    offs.push(session.authority.onChange(() => setStatus('live')));

    setStatus('live');
    return info;
  }

  // Point at the cell under the pointer (or an explicit one, which is what the suite drives). The
  // marker is drawn locally at once — a ping you have to wait a round trip to see feels broken —
  // and the counter is what carries it to everyone else on the next pose packet, which publishPose
  // sends immediately rather than at the next rate-limited slot.
  function ping(x, z) {
    if (!session || !avatars) return false;
    const cell = world.placement && world.placement.cell ? world.placement.cell : null;
    const cx = Math.round(Number.isFinite(x) ? x : (cell ? cell.x : 0));
    const cz = Math.round(Number.isFinite(z) ? z : (cell ? cell.z : 0));
    // The rules bound a build cell to +/-64 and the wire budget assumes three digits; a ping fired
    // from a wildly panned camera must not blow the packet.
    pingCell.x = Math.max(-999, Math.min(999, cx));
    pingCell.z = Math.max(-999, Math.min(999, cz));
    pingSeq = (pingSeq % 999) + 1;
    avatars.firePing(session.uid, pingCell.x, pingCell.z);
    return true;
  }

  function leave() {
    if (keyHandler) { removeEventListener('keydown', keyHandler); keyHandler = null; }
    if (avatars) { avatars.dispose(); avatars = null; }
    pingSeq = 0;
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

    // The pose. It is the CAMERA that is published, not the orbit target: the head is the eye, and
    // the two angles are the sender's own orbit state, so the receiver reconstructs the exact view
    // direction rather than guessing at it from a point on the ground.
    const orbit = world.orbit;
    const camera = world.view && world.view.camera;
    if (orbit && orbit.state && camera) {
      const cell = world.placement && world.placement.cell ? world.placement.cell : null;
      session.presence.publishPose(
        camera.position.x, camera.position.y, camera.position.z,
        orbit.state.azimuth, orbit.state.polar,
        cell ? cell.x : 0, cell ? cell.z : 0,
        pingSeq, pingCell.x, pingCell.z,
      );
    }

    if (avatars) avatars.update(dt);
  }

  return {
    update,
    leave,
    ping,
    get avatars() { return avatars; },
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

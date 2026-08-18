// Voidworks — the other players, drawn: a floating head with two detached hands and a name, sat at
// their camera. Plus the ping markers anyone can drop on a cell.

// WHY A HEAD AND NOT A CURSOR (Jurek, and it settles the design)
//
//   "kursor miałby taki problem, że jeżeli gracz jest obrócony, to nie może działać"
//
// A dot on the build plane is a projection of somebody's aim onto a surface that does not exist in
// this game, and it carries no facing at all. Two players looking at the same cell from opposite
// sides produce the identical dot. So the camera itself becomes the body: the head IS the eye, which
// means "where are they" and "which way are they looking" are the same fact and cannot disagree.
//
// Everything in here is local rendering. The wire is one string per player, six times a second,
// handled in session.js — nothing about a head, a hand or a ping is shared state.

import * as THREE from 'three';
import { PRESENCE, GRID } from '../config.js';

const M = PRESENCE.models;

// Scratch. Nothing in the update path allocates: no vector is constructed, no array is built, and
// the avatar list is walked by index rather than by iterator.
const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _zero = new THREE.Vector3(0, 0, 0);
const _worldUp = new THREE.Vector3(0, 1, 0);
const _altUp = new THREE.Vector3(0, 0, 1);
const _mat = new THREE.Matrix4();
const _tmpColor = new THREE.Color();
const _tmpHSL = { h: 0, s: 0, l: 0 };
const _tmpInk = new THREE.Color();

// --- identity colour ----------------------------------------------------------

// Stable per uid, so a player is the same colour in every session and on every other client — no
// negotiation, no colour slot to run out of, no chance two clients disagree about who is orange.
// FNV-1a over the id, spread around the hue circle by the golden angle so neighbouring ids do not
// land on neighbouring hues.
export function colorForUid(uid, out) {
  const id = String(uid || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hue = ((h % 997) * 0.618033988749895) % 1;
  const target = out || new THREE.Color();
  return target.setHSL(hue, 0.68, 0.56);
}

// --- models, with a primitive fallback that can never fail ---------------------

// One load per page, shared by every avatar. It is deliberately allowed to resolve to an empty map:
// the modeller may not have exported these yet, the manifest may not list them, the fetch may fail
// offline. In every one of those cases the primitives below stand in and the feature still works —
// which is the difference between "not modelled yet" and "broken".
let modelPromise = null;

function loadAvatarModels() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const out = new Map();
    const wanted = [M.head, M.handL, M.handR];
    let listed = [];
    try {
      const res = await fetch('assets/models/manifest.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        listed = (data.models || []).map((n) => String(n).replace(/\.glb$/, ''));
      }
    } catch { /* no manifest — primitives */ }
    const found = wanted.filter((n) => listed.indexOf(n) !== -1);
    if (!found.length) return out;
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      await Promise.all(found.map(async (id) => {
        try {
          const gltf = await loader.loadAsync(`assets/models/${id}.glb`);
          out.set(id, gltf.scene);
        } catch { /* keep the primitive for this one part only */ }
      }));
    } catch { /* loader unavailable */ }
    return out;
  })();
  return modelPromise;
}

// Shared primitive geometry. Built once; the fallback is not a second-class citizen that leaks.
const GEO = {
  head: new THREE.IcosahedronGeometry(PRESENCE.headRadius, 2),
  visor: new THREE.SphereGeometry(PRESENCE.headRadius * 0.74, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
  hand: new THREE.IcosahedronGeometry(PRESENCE.handRadius, 1),
  ring: new THREE.RingGeometry(PRESENCE.ping.ringRadius * 0.62, PRESENCE.ping.ringRadius, 28),
  beam: new THREE.CylinderGeometry(0.045, 0.045, 1, 8, 1, true),
};
GEO.ring.rotateX(-Math.PI / 2);
GEO.beam.translate(0, 0.5, 0);

// The authored head faces +X (ARCHITECTURE.md's convention, and the modeller confirmed it for this
// asset). Object3D orientation in three is "forward is -Z". Rotating the model's own node by +90
// degrees about Y sends its +X to -Z — check the sign rather than trusting it: three rotates a point
// about +Y as x' = x cos0 + z sin0, z' = -x sin0 + z cos0, so (1,0,0) at 0 = +PI/2 becomes (0,0,-1).
// Get this backwards and every avatar politely shows you the back of its head.
const MODEL_YAW = Math.PI / 2;

function tintClone(source, color) {
  const node = source.clone(true);
  node.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map((m) => {
      // Only the slot the modeller named `tint` is recoloured. Everything else keeps whatever the
      // model was authored with, so a head can have neutral trim and one coloured shell.
      if (!m || m.name !== M.tint) return m;
      const c = m.clone();
      c.userData.owned = true;
      if (c.color) c.color.copy(color);
      if (c.emissive) c.emissive.copy(color).multiplyScalar(0.35);
      return c;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });
  node.rotation.y = MODEL_YAW;
  return node;
}

function primitiveHead(color) {
  const g = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({
    color, roughness: 0.42, metalness: 0.08, emissive: color, emissiveIntensity: 0.18,
  });
  shellMat.userData.owned = true;
  const shell = new THREE.Mesh(GEO.head, shellMat);
  // A sphere has no front. The visor cap is what makes "which way is this person looking" readable
  // from across the factory in the fallback, and it is why the fallback is testable as a real head
  // rather than as a placeholder blob.
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x15181d, roughness: 0.16, metalness: 0.55, transparent: true, opacity: 0.92,
  });
  visorMat.userData.owned = true;
  const visor = new THREE.Mesh(GEO.visor, visorMat);
  visor.rotation.x = Math.PI / 2;
  visor.position.z = -PRESENCE.headRadius * 0.30;
  g.add(shell, visor);
  return g;
}

function primitiveHand(color) {
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.5, metalness: 0.05, emissive: color, emissiveIntensity: 0.12,
  });
  mat.userData.owned = true;
  return new THREE.Mesh(GEO.hand, mat);
}

// --- the name plate -----------------------------------------------------------

// A canvas texture on a sprite. Sprites face the viewer by construction, which is requirement one;
// requirement two (stays readable) is the clamped distance scaling in update(); requirement three
// (never z-fights, never hides inside the head) is depthTest:false plus a high renderOrder, so it
// draws last and unconditionally, and it is parked above the head rather than inside it.
//
// The name is escaped before it is ever stored or transmitted (net/util.js escapeName) and this
// draws it into a bitmap — it never becomes markup, and there is no DOM node to inject into.
function makeLabel(text, color) {
  const px = PRESENCE.labelPixels;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `600 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const width = Math.min(512, Math.ceil(ctx.measureText(text).width) + px * 1.6);
  canvas.width = Math.max(64, width);
  canvas.height = Math.round(px * 2);
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.font = `600 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  // CONTRAST, on a white world. The player colours are bright by design — they have to read as a
  // shaded 3D body — but bright-on-white is exactly the combination that disappears, and it
  // disappears WORST at distance, where the glyphs minify and a thin halo is averaged away. So the
  // text is drawn in a darkened version of the same hue (identity preserved, legibility gained) with
  // a WHITE halo rather than a dark one: this world is predominantly white void and pale machines,
  // so the halo's job is to separate dark text from a light background, not the reverse.
  _tmpColor.copy(color).getHSL(_tmpHSL);
  const ink = _tmpInk.setHSL(_tmpHSL.h, Math.min(1, _tmpHSL.s * 1.05), Math.min(_tmpHSL.l, 0.40));
  c.lineWidth = px * 0.42;
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.92)';
  c.strokeText(text, canvas.width / 2, canvas.height / 2 + 1);
  c.fillStyle = `#${ink.getHexString()}`;
  c.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false,
    // fog:false is the one that actually decides whether a name is readable across the factory.
    // SpriteMaterial fogs by DEFAULT, and this world's fog colour is the white void itself, so a
    // nameplate thirty units out was being blended into the background until it was a pale ghost —
    // which looks exactly like "the colour is too light" and is not fixable by darkening the ink.
    // A label is UI that happens to live in the scene; distance may shrink it, never dissolve it.
    fog: false,
  }));
  sprite.renderOrder = 9000;
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}

// --- the layer ----------------------------------------------------------------

export function createAvatars(options) {
  const opts = options || {};
  const scene = opts.scene;
  const camera = opts.camera;
  if (!scene || !camera) throw new Error('avatars need a scene and a camera');

  const root = new THREE.Group();
  root.name = 'net-avatars';
  // Presence is not part of the factory and must never be lit or shadowed like it — and more
  // importantly it must never end up inside anything that measures the build (camera framing,
  // bounds). It is its own top-level group and it is removed wholesale on leave.
  root.matrixAutoUpdate = true;
  scene.add(root);

  const byUid = new Map();
  // Walked by index in update(): iterating the Map would allocate an iterator every frame.
  const list = [];
  let models = null;
  let selfUid = null;
  let disposed = false;
  let time = 0;

  loadAvatarModels().then((loaded) => {
    if (disposed) return;
    models = loaded;
    // Anyone already on screen swaps from primitives to the authored mesh in place.
    for (let i = 0; i < list.length; i += 1) rebuildBody(list[i]);
  }).catch(() => { models = new Map(); });

  // `sources` records, per part, whether the authored glb or the primitive is standing there. It is
  // reported by debug() so a test can assert the models are actually in use rather than assuming it
  // from the fact that nothing crashed — a silent permanent fallback would look identical otherwise.
  const sources = { head: 'primitive', handL: 'primitive', handR: 'primitive' };

  function partFor(kind, color) {
    const id = kind === 'head' ? M.head : (kind === 'handL' ? M.handL : M.handR);
    const source = models && models.get(id);
    sources[kind] = source ? 'model' : 'primitive';
    if (source) return tintClone(source, color);
    return kind === 'head' ? primitiveHead(color) : primitiveHand(color);
  }

  function disposeNode(node) {
    if (!node) return;
    node.traverse((o) => {
      if (!o.isMesh) return;
      // Geometry is either shared (GEO.*) or owned by the cached glb scene — in both cases it
      // outlives this avatar and must not be disposed here. Materials cloned for the tint are ours.
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && m.userData && m.userData.owned) m.dispose();
    });
  }

  function rebuildBody(a) {
    if (a.headBody) { a.head.remove(a.headBody); disposeNode(a.headBody); }
    if (a.handLBody) { a.handL.remove(a.handLBody); disposeNode(a.handLBody); }
    if (a.handRBody) { a.handR.remove(a.handRBody); disposeNode(a.handRBody); }
    a.headBody = partFor('head', a.color);
    a.handLBody = partFor('handL', a.color);
    a.handRBody = partFor('handR', a.color);
    a.head.add(a.headBody);
    a.handL.add(a.handLBody);
    a.handR.add(a.handRBody);
  }

  function add(uid, name) {
    const color = colorForUid(uid);
    const a = {
      uid,
      name,
      color,
      head: new THREE.Group(),
      handL: new THREE.Group(),
      handR: new THREE.Group(),
      headBody: null,
      handLBody: null,
      handRBody: null,
      label: makeLabel(name, color),
      pos: new THREE.Vector3(),
      goalPos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      goalQuat: new THREE.Quaternion(),
      handLPos: new THREE.Vector3(),
      handRPos: new THREE.Vector3(),
      phase: (colorForUid(uid, _tmpColor).getHSL(_tmpHSL).h || 0) * Math.PI * 2,
      // Until the first pose sample lands there is nothing truthful to draw, so nothing is drawn.
      // A head parked at the origin for a second is worse than no head.
      seen: false,
      lastSeq: null,
    };
    rebuildBody(a);
    a.head.visible = false;
    a.handL.visible = false;
    a.handR.visible = false;
    a.label.visible = false;
    root.add(a.head, a.handL, a.handR, a.label);
    byUid.set(uid, a);
    list.push(a);
    return a;
  }

  function drop(uid) {
    const a = byUid.get(uid);
    if (!a) return;
    byUid.delete(uid);
    const i = list.indexOf(a);
    if (i !== -1) list.splice(i, 1);
    root.remove(a.head, a.handL, a.handR, a.label);
    disposeNode(a.headBody);
    disposeNode(a.handLBody);
    disposeNode(a.handRBody);
    if (a.label.material.map) a.label.material.map.dispose();
    a.label.material.dispose();
  }

  // Reconcile against the roster. `self` is never given a body — you are the camera, so drawing your
  // own head would put a sphere in your own lens.
  function sync(roster) {
    if (!Array.isArray(roster)) return;
    for (let i = 0; i < roster.length; i += 1) {
      const p = roster[i];
      if (!p || !p.id || p.self || p.id === selfUid) continue;
      if (byUid.size >= PRESENCE.maxDrawn && !byUid.has(p.id)) continue;
      const existing = byUid.get(p.id);
      if (!existing) add(p.id, p.name || 'Engineer');
      else if (existing.name !== p.name && p.name) {
        // Renames are rare enough to be worth a texture rebuild and too visible to ignore.
        existing.name = p.name;
        root.remove(existing.label);
        if (existing.label.material.map) existing.label.material.map.dispose();
        existing.label.material.dispose();
        existing.label = makeLabel(p.name, existing.color);
        existing.label.visible = existing.seen;
        root.add(existing.label);
      }
    }
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const a = list[i];
      let present = false;
      for (let j = 0; j < roster.length; j += 1) {
        if (roster[j] && roster[j].id === a.uid && !roster[j].self) { present = true; break; }
      }
      if (!present) drop(a.uid);
    }
  }

  // One pose sample from the wire. `az`/`pol` are the sender's orbit angles, which is exactly how
  // its own camera is built (camera/orbit.js applyCamera), so the look vector below is the sender's
  // view direction reconstructed rather than approximated.
  function pose(uid, x, y, z, az, pol) {
    const a = byUid.get(uid);
    if (!a) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    a.goalPos.set(x, y, z);
    const sp = Math.sin(pol);
    _look.set(-Math.sin(az) * sp, -Math.cos(pol), -Math.cos(az) * sp);
    if (_look.lengthSq() < 1e-8) _look.set(0, -1, 0);
    _up.copy(Math.abs(_look.y) > 0.999 ? _altUp : _worldUp);
    // Matrix4.lookAt(eye, target, up) orients -Z from eye towards target, which is the same
    // convention Object3D.lookAt uses — the head therefore faces the way the player is looking.
    _mat.lookAt(_zero, _look, _up);
    a.goalQuat.setFromRotationMatrix(_mat);
    if (!a.seen) {
      a.seen = true;
      a.pos.copy(a.goalPos);
      a.quat.copy(a.goalQuat);
      a.handLPos.copy(a.goalPos);
      a.handRPos.copy(a.goalPos);
      a.head.visible = true;
      a.handL.visible = true;
      a.handR.visible = true;
      a.label.visible = true;
    }
  }

  // --- pings ------------------------------------------------------------------

  // Pooled, fixed size, allocated once. A ping is NOT shared state: it rides along in the pose
  // packet as a cell plus a sequence number, and it starts its life on the RECEIVER's clock the
  // first time that sequence number changes. Three things fall out of that, all of them the point:
  // a client that joins later never replays an old ping; a client that disconnects leaves no node
  // behind to expire (onDisconnect already removes its cursor entry); and there is no litter to
  // clean up because nothing was ever written that outlives the packet.
  const pings = [];
  for (let i = 0; i < PRESENCE.ping.pool; i += 1) {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    ringMat.userData.owned = true;
    beamMat.userData.owned = true;
    const ring = new THREE.Mesh(GEO.ring, ringMat);
    const beam = new THREE.Mesh(GEO.beam, beamMat);
    beam.scale.y = PRESENCE.ping.beamHeight;
    g.add(ring, beam);
    g.visible = false;
    root.add(g);
    pings.push({ node: g, ringMat, beamMat, ring, beam, t: 0 });
  }
  let pingCursor = 0;

  function firePing(uid, cx, cz) {
    const x = cx | 0;
    const z = cz | 0;
    const a = byUid.get(uid);
    const color = a ? a.color : colorForUid(uid, _tmpColor);
    // Round-robin: the oldest slot is reused, so a spamming player can never starve the pool of
    // everyone else's markers for longer than pool/rate.
    const slot = pings[pingCursor % pings.length];
    pingCursor += 1;
    slot.t = PRESENCE.ping.life;
    slot.node.position.set(x, GRID.beltY, z);
    slot.node.visible = true;
    slot.ringMat.color.copy(color);
    slot.beamMat.color.copy(color);
    return slot;
  }

  // --- per frame ---------------------------------------------------------------

  function update(dt) {
    if (disposed) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(0.1, dt) : 0;
    time += step;
    const kPos = 1 - Math.exp(-PRESENCE.smoothPos * step);
    const kRot = 1 - Math.exp(-PRESENCE.smoothRot * step);
    const kHand = 1 - Math.exp(-PRESENCE.handLag * step);

    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      if (!a.seen) continue;

      a.pos.lerp(a.goalPos, kPos);
      a.quat.slerp(a.goalQuat, kRot);
      a.head.position.copy(a.pos);
      a.head.quaternion.copy(a.quat);

      _right.set(1, 0, 0).applyQuaternion(a.quat);
      _up.set(0, 1, 0).applyQuaternion(a.quat);
      _fwd.set(0, 0, -1).applyQuaternion(a.quat);

      // Left hand, then right. The bob is per-hand out of phase so the pair reads as alive rather
      // than as one rigid crossbar, and the lag means a fast turn throws them wide before they
      // settle — which is the whole reason they are separate objects and not children of the head.
      const bob = PRESENCE.bobAmp;
      const w = Math.PI * 2 * PRESENCE.bobHz;
      _v.copy(a.pos)
        .addScaledVector(_fwd, PRESENCE.handForward)
        .addScaledVector(_right, -PRESENCE.handGap)
        .addScaledVector(_up, -PRESENCE.handDrop);
      _v.y += Math.sin(time * w + a.phase) * bob;
      a.handLPos.lerp(_v, kHand);
      a.handL.position.copy(a.handLPos);
      a.handL.quaternion.copy(a.quat);

      _v.copy(a.pos)
        .addScaledVector(_fwd, PRESENCE.handForward)
        .addScaledVector(_right, PRESENCE.handGap)
        .addScaledVector(_up, -PRESENCE.handDrop);
      _v.y += Math.sin(time * w + a.phase + Math.PI * 0.6) * bob;
      a.handRPos.lerp(_v, kHand);
      a.handR.position.copy(a.handRPos);
      a.handR.quaternion.copy(a.quat);

      // The plate sits above the head in WORLD up, never in head-local up: a player looking
      // straight down would otherwise tip their own name sideways and then edge-on.
      a.label.position.set(a.pos.x, a.pos.y + PRESENCE.labelHeight, a.pos.z);
      const d = camera.position.distanceTo(a.label.position);
      const h = Math.min(PRESENCE.labelMax, Math.max(PRESENCE.labelMin, d * PRESENCE.labelScale));
      a.label.scale.set(h * a.label.userData.aspect, h, 1);
    }

    for (let i = 0; i < pings.length; i += 1) {
      const p = pings[i];
      if (p.t <= 0) continue;
      p.t -= step;
      if (p.t <= 0) { p.t = 0; p.node.visible = false; p.ringMat.opacity = 0; p.beamMat.opacity = 0; continue; }
      const k = p.t / PRESENCE.ping.life;           // 1 at birth, 0 at death
      const age = 1 - k;
      const pulse = 0.55 + 0.45 * Math.sin(age * Math.PI * 6);
      p.ringMat.opacity = k * 0.9 * pulse;
      p.beamMat.opacity = k * 0.55;
      const s = 1 + age * 0.9;
      p.ring.scale.set(s, 1, s);
      p.beam.scale.y = PRESENCE.ping.beamHeight * (1 + age * PRESENCE.ping.rise * 0.35);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (let i = list.length - 1; i >= 0; i -= 1) drop(list[i].uid);
    for (let i = 0; i < pings.length; i += 1) {
      root.remove(pings[i].node);
      pings[i].ringMat.dispose();
      pings[i].beamMat.dispose();
    }
    pings.length = 0;
    scene.remove(root);
  }

  return {
    root,
    sync,
    pose,
    update,
    dispose,
    firePing,
    setSelf(uid) { selfUid = uid || null; if (selfUid) drop(selfUid); },
    // Fires only when the sequence CHANGES, and the first sequence ever seen from a player is
    // recorded silently. Joining a room mid-ping must not replay it.
    applyPingSeq(uid, seq, cx, cz) {
      const a = byUid.get(uid);
      if (!a) return false;
      const s = seq | 0;
      if (a.lastSeq === null) { a.lastSeq = s; return false; }
      if (a.lastSeq === s) return false;
      a.lastSeq = s;
      if (!s) return false;
      firePing(uid, cx, cz);
      return true;
    },
    get count() { return list.length; },
    // Test hooks. The suite has to be able to assert a world position and a name against the other
    // tab's actual camera, and inspection of a screenshot cannot do that.
    debug() {
      const out = [];
      for (let i = 0; i < list.length; i += 1) {
        const a = list[i];
        out.push({
          uid: a.uid,
          name: a.name,
          seen: a.seen,
          color: `#${a.color.getHexString()}`,
          head: { x: a.head.position.x, y: a.head.position.y, z: a.head.position.z },
          goal: { x: a.goalPos.x, y: a.goalPos.y, z: a.goalPos.z },
          handL: { x: a.handL.position.x, y: a.handL.position.y, z: a.handL.position.z },
          handR: { x: a.handR.position.x, y: a.handR.position.y, z: a.handR.position.z },
          label: { x: a.label.position.x, y: a.label.position.y, z: a.label.position.z, visible: a.label.visible },
          visible: a.head.visible,
          // The direction this head is facing, in world space. Exposed because "the model faces the
          // right way" is a claim about a rotation, and the only honest way to check a rotation is to
          // stand in front of it and look — which needs this vector to place the camera.
          fwd: (() => {
            _v.set(0, 0, -1).applyQuaternion(a.quat);
            return { x: _v.x, y: _v.y, z: _v.z };
          })(),
          sources: { head: sources.head, handL: sources.handL, handR: sources.handR },
        });
      }
      return out;
    },
    activePings() {
      const out = [];
      for (let i = 0; i < pings.length; i += 1) {
        const p = pings[i];
        if (p.t <= 0) continue;
        out.push({
          x: p.node.position.x,
          z: p.node.position.z,
          left: p.t,
          color: `#${p.ringMat.color.getHexString()}`,
        });
      }
      return out;
    },
  };
}

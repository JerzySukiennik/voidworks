// Voidworks — audio bus, lazy loaders, voice-limited mixer. Boots and plays with zero files present.
//
// `ready` resolves as soon as the mixer is constructed — it never waits for a user gesture, so
// `await audio.ready` can never hang. It resolves to 'running' when the browser let the context
// start immediately, or 'suspended' when a gesture is still owed (`unlocked` and `whenUnlocked`
// report that), or null when the browser has no Web Audio at all.

import { AUDIO, SETTINGS } from '../config.js';

const BUSES = ['music', 'sfx', 'ambience'];

function readSettings() {
  const d = SETTINGS.defaults;
  try {
    const raw = localStorage.getItem(SETTINGS.storageKey);
    if (!raw) return { master: d.master, music: d.music, sfx: d.sfx };
    const s = JSON.parse(raw) || {};
    return {
      master: typeof s.master === 'number' ? s.master : d.master,
      music: typeof s.music === 'number' ? s.music : d.music,
      sfx: typeof s.sfx === 'number' ? s.sfx : d.sfx,
    };
  } catch {
    return { master: d.master, music: d.music, sfx: d.sfx };
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function def(id) {
  return AUDIO.sounds[id] || null;
}

export function createAudio() {
  const levels = readSettings();
  const buffers = new Map();
  const pending = new Map();
  const missing = new Set();
  const lastShot = new Map();
  const held = new Map();
  const active = new Map();
  const loops = new Map();
  const queued = [];

  let ctx = null;
  let master = null;
  let bus = null;
  let voices = 0;
  let camera = null;
  let unlocked = false;
  let resolveReady;
  let resolveUnlocked;
  const ready = new Promise((r) => {
    resolveReady = r;
  });
  const whenUnlocked = new Promise((r) => {
    resolveUnlocked = r;
  });

  const right = { x: 1, y: 0, z: 0 };

  const root = new URL(`../../${AUDIO.base}`, import.meta.url);
  function url(id, ext) {
    return new URL(`${id}.${ext}`, root).href;
  }

  // Our .ogg files are Opus, which Safari cannot decode. Ask the browser what it can actually play
  // instead of trying Opus first and relying on a fallback — a fallback that only runs after a failure
  // is a fallback nobody tests, and on Safari that meant silence.
  const formats = (() => {
    const list = AUDIO.formats.slice();
    let ok = true;
    try {
      const probe = document.createElement('audio');
      ok = !!probe.canPlayType('audio/ogg; codecs="opus"');
    } catch {
      ok = false;
    }
    if (ok) return list;
    return list.filter((e) => e !== 'ogg').concat(list.filter((e) => e === 'ogg'));
  })();

  // Safari's older decodeAudioData ignores the promise form and only calls back. Wrapping the callback
  // form works everywhere and cannot silently resolve to undefined.
  function decode(bytes) {
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(bytes, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  }

  function load(id) {
    if (buffers.has(id)) return Promise.resolve(buffers.get(id));
    if (missing.has(id)) return Promise.resolve(null);
    if (pending.has(id)) return pending.get(id);
    const attempt = async () => {
      for (const ext of formats) {
        try {
          const res = await fetch(url(id, ext));
          if (!res.ok) continue;
          const bytes = await res.arrayBuffer();
          const buf = await decode(bytes);
          if (!buf) continue;
          buffers.set(id, buf);
          return buf;
        } catch {
          /* try the next container */
        }
      }
      missing.add(id);
      return null;
    };
    const p = attempt().finally(() => pending.delete(id));
    pending.set(id, p);
    return p;
  }

  function applyLevels(ramp) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const fade = ramp ? AUDIO.busFade : 0.001;
    const m = clamp01(levels.master) * AUDIO.masterCeiling;
    master.gain.setTargetAtTime(m, t, fade);
    bus.music.gain.setTargetAtTime(clamp01(levels.music), t, fade);
    bus.sfx.gain.setTargetAtTime(clamp01(levels.sfx), t, fade);
    bus.ambience.gain.setTargetAtTime(clamp01(levels.sfx) * AUDIO.ambienceFromSfx, t, fade);
  }

  function build() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    ctx = new Ctor({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.connect(ctx.destination);
    bus = {};
    for (const b of BUSES) {
      const g = ctx.createGain();
      g.connect(master);
      bus[b] = g;
    }
    applyLevels(false);
    return true;
  }

  function unlock() {
    if (unlocked) return;
    if (!ctx && !build()) return;
    unlocked = true;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    resolveUnlocked(true);
    for (const id of AUDIO.autoStart) startLoop(id, {});
    while (queued.length) {
      const q = queued.shift();
      if (ctx.currentTime - q.t < 0.4) play(q.id, q.opts);
    }
  }

  let spatialGain = 1;
  let spatialPan = 0;
  function place(x, y, z) {
    if (!camera) {
      spatialGain = 1;
      spatialPan = 0;
      return;
    }
    const cp = camera.position;
    const dx = x - cp.x;
    const dy = y - cp.y;
    const dz = z - cp.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
    const d = AUDIO.distance;
    const fall = d.ref / Math.max(d.ref, dist);
    const cut = dist > d.max ? 0 : 1 - Math.max(0, dist - d.ref) / (d.max - d.ref);
    spatialGain = Math.max(d.minGain, fall * cut);
    spatialPan = Math.max(-1, Math.min(1, ((dx * right.x + dy * right.y + dz * right.z) / dist) * d.panWidth));
  }

  function shoot(id, spec, positional, x, y, z, tier, gainMul, pitchMul) {
    const now = ctx.currentTime;
    const cd = spec.cooldown || 0;
    if (now - (lastShot.get(id) || -1e9) < cd) {
      held.set(id, (held.get(id) || 0) + 1);
      return false;
    }
    if (spec.max && (active.get(id) || 0) >= spec.max) {
      held.set(id, (held.get(id) || 0) + 1);
      return false;
    }
    if (voices >= AUDIO.maxVoices) return false;
    const buf = buffers.get(id);
    if (!buf) {
      load(id);
      return false;
    }

    const thicken = Math.min(0.5, (held.get(id) || 0) * 0.08);
    held.set(id, 0);
    lastShot.set(id, now);
    if (positional && !spec.flat) place(x, y, z);
    else {
      spatialGain = 1;
      spatialPan = 0;
    }

    const t = tier > AUDIO.tierMax ? AUDIO.tierMax : tier;
    const rate =
      pitchMul * Math.pow(AUDIO.tierPitch, t) * (1 + (Math.random() * 2 - 1) * (spec.pitchVar || 0));
    const amp =
      (spec.gain || 1) *
      gainMul *
      (1 + (Math.random() * 2 - 1) * (spec.gainVar || 0)) *
      (1 + thicken) *
      spatialGain;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate < 0.25 ? 0.25 : rate;
    const g = ctx.createGain();
    g.gain.value = amp < 0 ? 0 : amp > 1.6 ? 1.6 : amp;
    let tail = g;
    if (spatialPan !== 0 && ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = spatialPan;
      g.connect(pan);
      tail = pan;
    }
    src.connect(g);
    tail.connect(bus[spec.bus] || bus.sfx);

    voices++;
    active.set(id, (active.get(id) || 0) + 1);
    src.onended = () => {
      voices--;
      active.set(id, Math.max(0, (active.get(id) || 0) - 1));
      try {
        src.disconnect();
        g.disconnect();
        if (tail !== g) tail.disconnect();
      } catch {
        /* already torn down */
      }
    };
    src.start(now);
    // Files carry a silent tail so libmp3lame can encode them; stop at the audible end so the
    // voice slot is released on time instead of being held by padding.
    if (spec.active) src.stop(now + spec.active / src.playbackRate.value + 0.01);
    return true;
  }

  // Hot path: no options object, no allocation. Safe to call hundreds of times a second.
  function at(id, x, y, z, tier) {
    const spec = def(id);
    if (!spec || !unlocked) return false;
    return shoot(id, spec, true, x, y, z, tier || 0, 1, 1);
  }

  function play(id, opts) {
    const spec = def(id);
    if (!spec) return false;
    if (!unlocked) {
      // Copy: callers reuse one mutable scratch options object, so holding theirs would
      // replay a queued shot with whatever position it has drifted to by unlock time.
      if (ctx && queued.length < 32) {
        const p = opts && opts.pos;
        queued.push({
          id,
          t: ctx.currentTime,
          opts: opts
            ? {
                tier: opts.tier || 0,
                gain: opts.gain,
                pitch: opts.pitch,
                pos: p
                  ? {
                      x: p.x !== undefined ? p.x : p[0],
                      y: p.y !== undefined ? p.y : p[1],
                      z: p.z !== undefined ? p.z : p[2],
                    }
                  : undefined,
              }
            : undefined,
        });
      }
      return false;
    }
    if (!opts) return shoot(id, spec, false, 0, 0, 0, 0, 1, 1);
    const p = opts.pos;
    const has = p !== undefined && p !== null;
    return shoot(
      id,
      spec,
      has,
      has ? (p.x !== undefined ? p.x : p[0]) : 0,
      has ? (p.y !== undefined ? p.y : p[1]) : 0,
      has ? (p.z !== undefined ? p.z : p[2]) : 0,
      opts.tier || 0,
      opts.gain !== undefined ? opts.gain : 1,
      opts.pitch || 1
    );
  }

  function startLoop(id, opts) {
    const spec = def(id);
    if (!spec || !spec.loop) return null;
    let h = loops.get(id);
    if (!h) {
      const initial = opts.gain !== undefined ? opts.gain : spec.initial !== undefined ? spec.initial : 1;
      h = { id, spec, node: null, gain: null, target: clamp01(initial), current: 0 };
      loops.set(id, h);
    }
    if (opts.gain !== undefined) h.target = clamp01(opts.gain);
    if (!unlocked || h.node) return h;
    load(id).then((buf) => {
      if (!buf || h.node || !unlocked) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = spec.start || 0;
      src.loopEnd = Math.min(spec.loopEnd || buf.duration, buf.duration);
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g);
      g.connect(bus[spec.bus] || bus.ambience);
      src.start(0, spec.start || 0);
      h.node = src;
      h.gain = g;
    });
    return h;
  }

  function loop(id, opts = {}) {
    const h = startLoop(id, opts);
    if (!h) return null;
    return {
      gain(v) {
        h.target = clamp01(v);
      },
      stop() {
        h.target = 0;
        h.stopping = true;
      },
    };
  }

  function setLevels(l = {}) {
    if (typeof l.master === 'number') levels.master = clamp01(l.master);
    if (typeof l.music === 'number') levels.music = clamp01(l.music);
    if (typeof l.sfx === 'number') levels.sfx = clamp01(l.sfx);
    applyLevels(true);
  }

  function setListener(cam) {
    camera = cam || null;
  }

  function update(dt) {
    if (!ctx) return;
    const m = camera && camera.matrixWorld && camera.matrixWorld.elements;
    if (m) {
      right.x = m[0];
      right.y = m[1];
      right.z = m[2];
    }
    const k = Math.min(1, dt * AUDIO.belt.ease);
    for (const h of loops.values()) {
      if (!h.gain) continue;
      h.current += (h.target - h.current) * k;
      h.gain.gain.setTargetAtTime(h.current * (h.spec.gain || 1), ctx.currentTime, 0.04);
      if (h.stopping && h.current < 0.001 && h.node) {
        try {
          h.node.stop();
        } catch {
          /* already stopped */
        }
        h.node = null;
        h.gain = null;
        h.stopping = false;
        loops.delete(h.id);
      }
    }
  }

  function belts(count) {
    const b = AUDIO.belt;
    loop('belt-loop', { gain: Math.min(b.ceiling, 1 - Math.exp(-count * b.perBelt)) });
  }

  const gestures = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
  const onGesture = () => {
    unlock();
    if (unlocked) for (const g of gestures) removeEventListener(g, onGesture);
  };
  for (const g of gestures) addEventListener(g, onGesture, { passive: true });
  build();
  resolveReady(ctx ? ctx.state : null);
  if (ctx) {
    if (ctx.state === 'running') unlock();
    for (const id of Object.keys(AUDIO.sounds)) if (AUDIO.sounds[id].bus !== 'music') load(id);
  }

  return {
    ready,
    whenUnlocked,
    play,
    at,
    loop,
    belts,
    setLevels,
    setListener,
    update,
    get unlocked() {
      return unlocked;
    },
    get context() {
      return ctx;
    },
  };
}

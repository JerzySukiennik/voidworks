// Voidworks — the shared random stream. One seed on the wire replaces every item ever synced.

// Items on belts are never sent. They do not need to be: given the same buildings, the same clock
// and the same sequence of random numbers, every client's flow simulation produces the same items
// in the same places. Buildings and the clock are already shared truth, so the seed is the third
// and last input — a single 32-bit integer instead of a per-item stream at 60 Hz.
//
// The stream must be *split*, not shared linearly: if every dropper drew from one counter, a
// client whose fifth dropper ticked a frame earlier would take the number meant for the third and
// the two factories would diverge forever. So each consumer gets its own sub-stream keyed by
// (world seed, building uid, purpose) and advanced by its own draw count. A dropper that stalls at
// the item cap simply does not advance its own stream, and nobody else's is disturbed.

// mulberry32: 32 bits of state, one multiply-xor round, uniform enough for tier rolls and far
// cheaper than anything cryptographic. Deterministic across engines because every step is forced
// back into uint32 with >>> 0 and Math.imul.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a over a string, so a sub-stream key is a number without any allocation beyond the key.
export function hashString(text, seed) {
  let h = (seed >>> 0) || 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}

// A registry of independent sub-streams over one world seed.
//
//   const rng = createRandomSource(seed);
//   rng.stream(building.uid, 'tier')()   // -> [0,1), identical on every client
//
// `Math.random` stays the fallback for anything cosmetic (item spin, particle jitter): those
// differ between clients and are supposed to, because syncing them would cost bandwidth to make
// two screens agree about something neither player can see.
export function createRandomSource(seed) {
  let worldSeed = seed >>> 0;
  const streams = new Map();

  function stream(owner, purpose) {
    const key = `${owner}:${purpose || ''}`;
    let fn = streams.get(key);
    if (!fn) {
      fn = mulberry32(hashString(key, worldSeed));
      streams.set(key, fn);
    }
    return fn;
  }

  return {
    get seed() { return worldSeed; },

    // Re-seeding wipes every sub-stream: a client that joins mid-session adopts the room's seed
    // and must not carry a single number over from the one it minted while alone.
    reseed(next) {
      worldSeed = next >>> 0;
      streams.clear();
    },

    stream,
    value(owner, purpose) { return stream(owner, purpose)(); },
    // Deterministic integer in [0, n).
    int(owner, purpose, n) { return Math.floor(stream(owner, purpose)() * Math.max(1, n | 0)); },
    forget(owner) {
      const prefix = `${owner}:`;
      for (const key of streams.keys()) if (key.startsWith(prefix)) streams.delete(key);
    },
    get streamCount() { return streams.size; },
  };
}

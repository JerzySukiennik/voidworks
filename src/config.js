// Voidworks — every tunable in one place. Sections are owned by single pieces; edit only your own.

export const GRID = {
  cell: 1.0,
  beltY: 0.34,
  half: 40,
  snap: true,
};

// --- owned by: render ---------------------------------------------------------
export const PALETTE = {
  void: '#f4f5f7',
  voidFar: '#e7eaef',
  ink: '#1a1d22',
  shadow: '#c9ced8',
  steel: '#aeb8c8',
  steelDark: '#7e8899',
  steelLight: '#ccd4e1',
  rubber: '#454c58',
  rubberLight: '#5b6472',
  accent: '#17c964',
  accentDeep: '#0e9f4c',
  warn: '#f5a524',
  rare: '#7c5cff',
  gold: '#f2c94c',
};

export const RENDER = {
  exposure: 1.0,
  flatShading: true,
  pixelRatioMax: 2,

  // The void is the brightest thing in the frame and it stays there. L180–220 is the mud band
  // where a value-stacked model stops reading; the backdrop is deliberately parked ABOVE it so
  // no amount of empty canvas can drag the histogram into the mud.
  backdrop: {
    top: '#eef2f8',
    mid: '#ffffff',
    bottom: '#e9eef6',
  },
  // Fog is rebuilt from the camera distance every frame, so both zoom extremes dissolve
  // the far end of the factory by the same fraction. leadIn/reach are multiples of volume.radius.
  // This is the only aerial perspective in a game with no horizon: the far end of a long belt run
  // lifts toward the void, which is what puts the near end visibly in FRONT of it.
  fog: { color: '#f6f9fd', leadIn: 0.22, reach: 0.92 },

  light: {
    // Low key (about 26° elevation) on purpose: the factory is a nearly FLAT sheet of belts, so
    // shadow length is the only way one belt reaches across onto the next. At 38° a 0.5-high belt
    // frame threw 0.6 units and landed in mid-air between belts; at 26° it throws ~1.0 and lands
    // on the neighbour. Long shadows are also the single loudest Islanders cue.
    key: { color: '#fff4e3', intensity: 3.25, dir: [-0.4, 0.49, -0.775] },
    // Fill and rim are deliberately thin. Everything that is not facing the key has to be allowed
    // to go genuinely dark — with no terrain to carry the blacks, the unlit faces ARE the blacks.
    fill: { color: '#c6d8f6', intensity: 0.15, dir: [0.55, 0.34, 0.76] },
    rim: { color: '#e8f0ff', intensity: 0.11, dir: [-0.6, -0.5, 0.62] },
    hemi: { sky: '#eef4ff', ground: '#8d9bb4', intensity: 0.3 },
  },

  // The build volume is a box floating in the void — there is no ground plane anywhere.
  volume: { center: [0, 1.2, 0], radius: 26, height: 14 },

  shadow: {
    mapSize: 2048,
    // The shadow camera follows where you are LOOKING (texel-snapped) instead of covering the
    // whole build volume, so a tight extent buys texel density instead of losing coverage.
    extent: 17,
    distance: 46,
    // Depth range is derived, not fixed: near/far hug the fitted box. VSM stores depth as a
    // half-float moment pair, so its light bleed scales with how much of [near,far] is wasted —
    // 1..110 was throwing away 2/3 of the range and bleeding shadows away at long throws.
    depthPad: 6,
    // Light-bleed reduction. three.js hard-codes 0.3 in VSMShadow() and exposes no knob; the
    // chunk is patched at boot from this value. Higher = less bleed, slightly thinner penumbra.
    bleed: 0.62,
    radius: 3.4,
    blurSamples: 10,
    bias: 0,
    normalBias: 0.016,
    intensity: 1.0,
  },

  // With no ground and a flat factory, AO is doing more work than cast shadow: it is what darkens
  // the trough between belt rails, the gap under a frame and the inside corner of every junction.
  ao: { enabled: true, radius: 1.35, intensity: 1.45, thickness: 1.0, samples: 10, scale: 0.5, scaleStrength: 1.15,
    denoise: { samples: 8, rings: 2, radius: 4, lumaPhi: 8, depthPhi: 1.5, normalPhi: 4 } },
  bloom: { enabled: true, strength: 0.12, radius: 0.5, threshold: 0.965, scale: 0.5 },

  // The void grade. `lobe` brightens toward the on-screen key so the emptiness has a light source
  // in it; `tilt` darkens away from it; `edge` closes the frame. All three are held ABOVE the mud
  // band by `floor`, which is the lowest the grade is ever allowed to push a white pixel.
  vignette: { amount: 0.13, softness: 0.58, tilt: 0.085, lobe: 0.05, floor: 0.9, grain: 0.005 },

  // Measured on the AMD Radeon Pro 5500M at a 1600x1000 viewport with 220 items in motion, using
  // work/tools/bench.mjs (serialised frame cost, no instrumentation). Every full-resolution pass
  // over this buffer costs real milliseconds here, so `pixelRatioMax` is the single strongest knob
  // in this block — stronger than AO samples, stronger than shadow map size. Treat it that way.
  //
  //   low     is the guaranteed-60 tier and must stay inside 16.67 ms. Do not add a pass to it.
  //   medium  is the everyday tier.
  //   high    is the screenshot tier and is allowed to cost what it costs.
  quality: {
    high: { ao: true, aoScale: 0.5, bloom: true, smaa: true, shadowMapSize: 2048, shadowType: 'vsm', shadowBlur: 8, pixelRatioMax: 1.25 },
    // SMAA is off at medium on measured evidence, not taste: it is three full-resolution passes and
    // ablation puts it at ~40 ms of high's 85 ms frame — the most expensive single thing in the post
    // chain, more than AO, shadows and the entire building geometry each cost. It stays at `high`,
    // which is the screenshot tier, and nowhere else.
    medium: { ao: true, aoScale: 0.4, bloom: false, smaa: false, shadowMapSize: 1024, shadowType: 'vsm', shadowBlur: 4, pixelRatioMax: 1 },
    // low genuinely drops everything expensive: no AO, no bloom, no SMAA, and PCF instead of VSM
    // so the two full-screen shadow-map blur passes stop running every frame as well.
    low: { ao: false, aoScale: 0.5, bloom: false, smaa: false, shadowMapSize: 1024, shadowType: 'pcf', shadowBlur: 0, pixelRatioMax: 1 },
  },
};

// --- owned by: camera ---------------------------------------------------------
export const CAMERA = {
  fov: 32,
  near: 0.5,
  far: 400,
  minPolar: 0.16,
  maxPolar: 2.98,
  minDistance: 6,
  maxDistance: 70,
  startDistance: 26,
  startPolar: 0.8,
  startAzimuth: -0.7,
  targetY: 0.6,
  smoothOrbit: 0.135,
  smoothPan: 0.1,
  smoothZoom: 0.16,
  smoothFocus: 0.4,
  rotateSpeed: 0.0044,
  panSpeed: 1.0,
  keyPanSpeed: 1.9,
  zoomSpeed: 0.9,
  zoomStep: 0.0017,
  pinchSpeed: 1.0,
  flick: 0.14,
  flickMax: 0.85,
  snapAngle: Math.PI / 4,
  softZone: 0.34,
  panLimit: 44,
  panLimitY: 22,
  panMargin: 10,
  softPan: 7,
  zoomOutFit: 1.45,
  frameFill: 0.86,
  heroFill: 0.95,
  heroBias: 0.05,
  autoFrameSeconds: 0.25,
  maxStep: 0.05,
  maxCatchUp: 0.5,
  autoOrbit: 0.02,
};

// --- owned by: economy --------------------------------------------------------
export const ITEMS = {
  tiers: [
    { id: 'slag', name: 'Slag', value: 10, color: '#b6bfcc', weight: 40 },
    { id: 'iron', name: 'Iron', value: 25, color: '#e6ecf5', weight: 26 },
    { id: 'copper', name: 'Copper', value: 70, color: '#ff8f3d', weight: 16 },
    { id: 'cobalt', name: 'Cobalt', value: 200, color: '#3d7dff', weight: 9 },
    { id: 'aurite', name: 'Aurite', value: 650, color: '#ffcf33', weight: 5 },
    { id: 'voidglass', name: 'Voidglass', value: 2200, color: '#9b6bff', weight: 3 },
    { id: 'singularite', name: 'Singularite', value: 9000, color: '#ff4f86', weight: 1 },
  ],
};

// Pane colour ramps. Silhouette says which family, colour says how strong.
export const PANES = {
  mult: [
    [1.25, '#9aa3b0'], [1.5, '#35d6e8'], [2, '#17c964'],
    [3, '#f5a524'], [5, '#ff6b4a'], [Infinity, '#7c5cff'],
  ],
  add: [
    [5, '#cfe6ff'], [20, '#9fd6ff'], [75, '#4fa8ff'],
    [300, '#2563eb'], [Infinity, '#4c1fd0'],
  ],
  tier: '#f2c94c',
  risky: '#e0524a',
};

export const ECONOMY = {
  // You start in an empty void with exactly enough to build the first loop yourself:
  // a Scrap Dropper (200) + two Conveyors (2x25) + a Sell Pad (400) = 650, plus 100 of slack so a
  // misplaced tile is a lesson rather than a dead save. Nothing is built for you.
  startMoney: 750,
  sellPadRate: 1.0,
  autosaveSeconds: 8,
  storageKey: 'voidworks.save.v1',
  priceGrowth: 1.06,
  refund: 0.5,
  maxUpgradesPerItem: 12,
  valueJitter: 0.18,
  tickRate: 60,
  maxSubSteps: 4,

  // The item cap: the whole factory may only hold this many items at once.
  // Droppers stall at the cap, so every slot is a choice about what is worth carrying.
  capacityStart: 100,
  capacityStep: 15,
  capacityMax: 900,
  capacityBase: 2000,
  capacityGrowth: 1.17,

  rateWindow: 4,
  labelMinGain: 18,

  // A sale is "big" when it beats a floor or clearly beats what this factory normally sells,
  // so a rare material landing stays an event at every stage of the game.
  bigSellValue: 1800,
  bigSellRatio: 6,
  saleAverageEase: 0.02,
};

// --- owned by: flow -----------------------------------------------------------
export const FLOW = {
  beltSpeed: 2.4,
  itemSpacing: 0.46,
  maxItems: 900,
  spawnGrace: 0.15,

  // Falling: a belt that ends in nothing spills its items into the void. They keep their slot until
  // they are gone, so dumping items is not a way to cheat the cap — it just wastes them.
  gravity: 14,
  fallSpin: 2.6,
  fallKillY: -14,
  rampRise: 0.5,
  arcSamples: 9,
  itemSize: 0.26,
  itemSpin: 1.3,
  itemLift: 0.16,
  labelPool: 40,
  labelLife: 1.15,
  labelRise: 1.05,
  labelCoalesce: 0.55,
};

// --- owned by: build ----------------------------------------------------------
export const BUILD = {
  extent: 44,
  ghostOpacity: 0.44,
  ghostValid: '#17c964',
  ghostInvalid: '#e0524a',
  helperFade: 0.18,
  helperRadius: 13,
  dragLay: true,
  levelRise: 0.52,

  // The hologram's direction arrow. It is built from the building's own item path, so it curves on a
  // curve and climbs on a ramp — and it exists ONLY in the hologram, never on a placed building.
  arrowLift: 0.5,
  arrowHead: 0.075,
  arrowChevrons: 3,
  arrowColor: '#0e9f4c',
  arrowOpacity: 0.95,

  // The delete outline: a wireframe cage around whatever is under the cursor.
  deleteBoxY: 0.42,
  deleteBoxH: 1.1,
};

// --- owned by: menu / ui ------------------------------------------------------
export const MENU = {
  backdrop: {
    // Close enough that the factory is a subject rather than a texture. It sat at radius 46 while the
    // world was a long thin line; a compact showcase wants a much tighter rig or it reads as a smudge.
    fov: 34,
    radius: 24,
    height: 15,
    lookY: 1.1,
    speed: 0.026,
    bobAmp: 0.05,
    bobSpeed: 0.14,
    frameOffset: 0.22,
    startAngle: 0.62,
  },
};

export const SCREENS = {
  fadeOut: 0.6,
  enterDuration: 0.7,
  itemStagger: 0.055,
  blurPx: 0,
  panelBlurPx: 20,
  // Solid under the type, then it gets out of the way. The right stops were raised while the world was
  // a dark diagonal that fought the title; a compact showcase does not, so it is allowed to be seen.
  veil: 'linear-gradient(96deg,rgba(247,248,250,.98) 0%,rgba(247,248,250,.95) 38%,rgba(247,248,250,.58) 54%,rgba(247,248,250,.14) 74%,rgba(247,248,250,.10) 100%)',
  colors: {
    text: '#3b414b',
    dim: '#8a929e',
    faint: 'rgba(26,29,34,.10)',
    bright: '#12151a',
    accent: '#17c964',
    accentDeep: '#0e9f4c',
    onAccent: '#062616',
    panel: 'rgba(255,255,255,.82)',
    panelEdge: 'rgba(26,29,34,.17)',
    live: '#17c964',
    warn: '#d98a12',
    fail: '#e0524a',
  },
  copy: {
    eyebrow: 'a factory in the void',
    title: 'Voidworks',
    tagline: 'Drop it, carry it, refine it, sell it. Nothing else exists.',
    footer: 'drag to orbit · scroll to zoom · esc for this screen',
    back: 'Back',
    play: 'Play',
    playNote: 'One factory, all yours.',
    coop: 'Co-op',
    coopNote: 'Build the same line together.',
    settings: 'Settings',
    settingsNote: 'Sound, quality, camera.',
    credits: 'Credits',
    creditsNote: 'Who made the void.',
    resume: 'Resume',
    resumeNote: 'Back to the belts.',
    quit: 'Main menu',
    quitNote: 'Leave the factory running.',
    pausedEyebrow: 'paused',
    playTitle: 'Play',
    playNew: 'New factory',
    playContinue: 'Continue',
    playNoSave: 'Nothing saved yet. A new factory starts you on an empty plate with a little money.',
    playSaveLabel: 'Saved factory',
    playWipeWarn: 'Starting new overwrites the saved factory.',
    coopTitle: 'Co-op',
    coopName: 'Your name',
    coopNamePlaceholder: 'Engineer',
    coopHost: 'Host a factory',
    coopHostNote: 'You get a code to hand out.',
    coopHostGet: 'Get a code',
    coopHostStart: 'Open the factory',
    coopJoin: 'Join with code',
    coopCodePlaceholder: 'CODE',
    coopJoinAction: 'Join',
    coopBadCode: 'A code is eight letters and numbers.',
    coopCopy: 'Copy',
    coopCopied: 'Copied',
    settingsTitle: 'Settings',
    optMaster: 'Master volume',
    optMusic: 'Music',
    optSfx: 'Effects',
    optQuality: 'Visual quality',
    optQualityNote: 'Shadows, ambient occlusion and bloom.',
    optSensitivity: 'Camera sensitivity',
    optSensitivityNote: 'Orbit and pan speed of the mouse.',
    creditsTitle: 'Credits',
  },
};

export const SETTINGS = {
  storageKey: 'voidworks.settings.v1',
  sensitivityMin: 0.4,
  sensitivityMax: 2.5,
  nameMaxLength: 16,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  qualityTiers: [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
  ],
  defaults: { master: 0.8, music: 0.5, sfx: 0.85, quality: 'high', sensitivity: 1, name: '' },
};

// --- owned by: net ------------------------------------------------------------
// Multiplayer is one shared factory: the BUILDINGS, the BANK and the ITEM CAP are shared truth,
// every item on every belt is simulated locally from a shared seed. Nothing here is a secret —
// a Firebase web apiKey identifies a project, it does not authorise anything. What guards a
// factory is database.rules.json plus the length of the room code.
export const NET = {
  enabled: true,

  // 'auto'     — Firebase when FIREBASE is filled in and reachable, otherwise the local driver
  // 'firebase' — insist on the Realtime Database
  // 'local'    — BroadcastChannel + localStorage, same machine, no credentials (also the test driver)
  // 'off'      — refuse to network at all; host/join become no-ops and the game stays singleplayer
  //
  // 'auto' since 2026-08-17, when the merged ruleset was deployed to gzowos-games-default-rtdb and
  // read back to confirm the `voidworks` block landed without disturbing the four neighbours. Until
  // that deploy this was pinned to 'local', because every write under /voidworks was denied by the
  // root default-deny; 'auto' would have failed silently. If the rules are ever rolled back, pin it
  // to 'local' again in the same change — the two belong together.
  //
  // ?netdriver=local forces the same-machine driver for one page load; ?netdriver=firebase plus
  // ?emulator=127.0.0.1:9000 points the real transport at the local emulator. Either way it is one
  // page load and it changes nothing for anybody else.
  driver: (typeof location !== 'undefined' && new URLSearchParams(location.search).get('netdriver')) || 'auto',

  // Fixed by the security rules. The database is SHARED: gzowos-games-default-rtdb already hosts
  // the Gzowo's Games dashboard (presence, sessions, friendAccess, waitlists, ageBands) and three
  // other games, each under its own top-level namespace — satisfarm/, sentinelCity/, ducks/.
  // Voidworks follows the same convention, so its subtree is disjoint from all of them and its
  // rules can be added alongside theirs rather than replacing anything.
  root: 'voidworks/factories',

  // The room code is the ONLY access control — this project has no Firebase Auth, because
  // anonymous sign-in needs billing. The rules reject codes shorter than eight characters.
  codeMinLength: 8,
  codeLength: 8,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',

  // Identity replaces auth.uid: a random id minted once, kept in localStorage, and ordered
  // lexicographically — which is all the "lowest id is the authority" rule needs.
  identityKey: 'voidworks.uid.v1',
  identityLength: 16,

  maxPlayers: 6,
  nameMaxLength: 16,

  // How many buildings the host uploads at once when opening a room. Sequential publishing of a
  // hundred-building starter factory took twelve seconds and blocked the menu; unbounded parallel
  // publishing just moves the pile-up onto the database. Six lanes is the middle.
  publishConcurrency: 6,

  rates: {
    heartbeatSec: 3,        // presence refresh + authority recompute; setInterval, never the frame loop
    presenceStaleSec: 45,   // backstop only — onDisconnect removes a closed tab instantly. Generous,
                            // because a hidden tab has its timers throttled and must not be evicted.
    simStaleSec: 4,         // no update() for this long = not simulating = not eligible to be authority
    // How stale another client's heartbeat may be before we stop counting it as a candidate to run
    // the world. Deliberately far tighter than presenceStaleSec: a frozen tab should vanish from
    // the authority vote in seconds (or nobody banks income) while staying in the ROSTER for the
    // full generous window (or alt-tabbing looks like leaving).
    authorityStaleSec: 10,
    cursorHz: 5,            // camera target + hovered cell; cheap, lossy, never per-frame
    cursorEpsilon: 0.15,    // world units of movement below which a cursor sample is skipped
    bankFlushHz: 4,         // the authority batches sell income into one transaction at this rate
    bankFlushMin: 0.5,      // ...and never writes a flush smaller than this
    clockSyncSec: 30,
  },

  bank: {
    // Contention on the bank is the normal case, not an edge case: two players selling into the
    // same node at once is exactly what runTransaction exists for.
    transactionRetries: 40,
    retryBackoffMs: 6,
    retryBackoffMaxMs: 140,
  },

  precision: { position: 100, cell: 1 },

  local: {
    storagePrefix: 'voidworks.net.',
    latencyMs: 40,
    latencyJitterMs: 20,
    clockSkewMs: 900,        // simulated server-vs-client offset; proves now() is not Date.now()
    clientSkewSpreadMs: 2500,
  },

  // The "Voidworks" web app inside the EXISTING gzowos-games project — no new project was created,
  // because that account is near its project limit. A Firebase web apiKey is a public client
  // identifier, not a secret: it names the project, it authorises nothing. What guards a factory is
  // database.rules.json plus the length of the room code.
  //
  // This database is SHARED with four other things, which is why the rules for it are generated
  // rather than authored — see the header of database.rules.json before touching them.
  FIREBASE: {
    apiKey: 'AIzaSyAaTuELH_mToxH3hRJ4WPIVTECSH7Z8-FY',
    authDomain: 'gzowos-games.firebaseapp.com',
    databaseURL: 'https://gzowos-games-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'gzowos-games',
    messagingSenderId: '658227201482',
    storageBucket: 'gzowos-games.firebasestorage.app',
    appId: '1:658227201482:web:e99efcb0442ed251c4bb33',
  },

  // No auth module: this project has no Firebase Auth. Loading it would only cost bytes.
  firebaseSdk: {
    version: '10.14.1',
    appUrl: 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
    dbUrl: 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js',
  },

  connectTimeoutSec: 8,
  debug: typeof location !== 'undefined' && new URLSearchParams(location.search).has('net'),
};

export const DEBUG = {
  showGrid: true,
  showStats: new URLSearchParams(location.search).has('stats'),
  scene: new URLSearchParams(location.search).get('scene') || null,
};

// --- owned by: buildbar -------------------------------------------------------
// The bar is the game's legend: every tile is a side elevation of the real machine with its real
// pane colour, so the player learns the world's colour system before placing anything.
export const BUILDBAR = {
  z: 5,
  maxWidth: 1180,
  bottom: 16,
  // Four rows per tile — machine, headline number, name, price — and nothing else; the caption that
  // used to sit above the shelf now rides in the rack, where the cap control used to be.
  tile: { w: 92, h: 92, gap: 6, art: 26 },
  rackRow: 32,
  pollSeconds: 0.22,

  colors: {
    panel: 'rgba(255,255,255,.90)',
    panelEdge: 'rgba(26,29,34,.13)',
    tile: 'rgba(255,255,255,.72)',
    tileEdge: 'rgba(26,29,34,.10)',
    tileHover: '#ffffff',
    ink: '#12151a',
    text: '#3b414b',
    dim: '#98a0ac',
    faint: 'rgba(26,29,34,.08)',
    accent: '#17c964',
    accentDeep: '#0e9f4c',
    onAccent: '#062616',
    steel: '#8d97a6',
    steelDark: '#6c7686',
    risk: '#e0524a',
    savings: 'rgba(23,201,100,.55)',
  },

  // Group order is the shape of the whole bar: source, transport, the two upgrader families, then
  // the ends of the line. Adders are one blue family; multipliers run the full strength ramp.
  groups: [
    { id: 'dropper', key: 'dropper', name: 'Droppers', hint: 'Sources. Every item they emit takes a slot from your cap.', tint: '#8d97a6' },
    { id: 'belt', key: 'belt', name: 'Conveyors', hint: 'Transport. Drag to lay a run; belt length costs you slots.', tint: '#6c7686' },
    { id: 'add', key: 'upgrader', name: 'Adders', hint: 'Flat value, one blue family. Best on cheap material — put them first.', tint: '#4fa8ff', ramp: ['#cfe6ff', '#9fd6ff', '#4fa8ff', '#2563eb', '#4c1fd0'] },
    { id: 'mult', key: 'upgrader', name: 'Multipliers', hint: 'Colour = strength. Best on expensive material — put them last.', tint: '#17c964', ramp: ['#9aa3b0', '#35d6e8', '#17c964', '#f5a524', '#ff6b4a', '#7c5cff'] },
    { id: 'end', key: 'sell', name: 'Terminals', hint: 'Where the line ends: sell, hold, or fuse four slots into one.', tint: '#0e9f4c' },
  ],

  // The item cap lives in the HUD (always on screen, and the cap is the game's central constraint);
  // the bar deliberately carries no readout and no second buy button for it.
  copy: {
    remove: 'Remove',
    removeHint: 'right-click a building, or hold X',
    keysGroup: 'Q E',
    keysRotateNote: 'turn',
    keysGroupNote: 'group',
    keysNote: 'pick',
    afford: 'you can build',
    saving: 'saving for',
    footprint: 'Footprint',
    cost: 'Cost',
    effect: 'Effect',
    throughput: 'Speed',
    familyAdd: 'Adder · low wide band',
    familyMult: 'Multiplier · tall gate',
  },
};

// --- owned by: audio ----------------------------------------------------------
export const AUDIO = {
  base: 'assets/audio/',
  formats: ['ogg', 'mp3'],
  autoStart: ['amb-void', 'music-void', 'belt-loop'],
  masterCeiling: 0.85,
  ambienceFromSfx: 0.6,
  busFade: 0.09,
  maxVoices: 26,

  // Extra pitch per upgrade STRENGTH within one rung. The ladder itself is baked into the
  // files as a major pentatonic scale, so this only needs to nudge.
  tierPitch: 1.05,
  tierMax: 6,

  distance: { ref: 8, max: 48, panWidth: 0.7, minGain: 0.06 },

  // Belt bed gain = ceiling * (1 - e^(-belts * perBelt)). At perBelt 0.018 that is
  // 0.37 at 26 belts, 0.66 at 60, 0.89 at 120 — it keeps climbing past a real factory.
  belt: { perBelt: 0.018, ceiling: 1.0, ease: 1.6 },

  // gain values are not taste alone: each was solved so the sound lands on a measured
  // effective in-game level (see assets/audio/CREDITS.md) at the default slider positions.
  sounds: {
    'amb-void': { bus: 'ambience', gain: 0.531, loop: true, loopEnd: 4.0 },
    'belt-loop': { bus: 'ambience', gain: 0.169, loop: true, loopEnd: 2.0, start: 0, initial: 0 },
    'music-void': { bus: 'music', gain: 1.0, loop: true, loopEnd: 96.0 },

    dropper: { bus: 'sfx', gain: 0.352, active: 0.24, max: 4, cooldown: 0.05, pitchVar: 0.07, gainVar: 0.18 },

    // The upgrade ladder. Five rungs cut from ONE source at major-pentatonic ratios
    // (1 / 1.1225 / 1.2599 / 1.4983 / 1.6818), so rung order IS pitch order and any two
    // rungs ringing together stay consonant. Add rungs by appending, never by reordering.
    'upgrade-a': { bus: 'sfx', gain: 0.465, active: 0.1, max: 5, cooldown: 0.045, pitchVar: 0.045, gainVar: 0.16 },
    'upgrade-b': { bus: 'sfx', gain: 0.459, active: 0.089, max: 5, cooldown: 0.045, pitchVar: 0.045, gainVar: 0.16 },
    'upgrade-c': { bus: 'sfx', gain: 0.504, active: 0.079, max: 5, cooldown: 0.045, pitchVar: 0.045, gainVar: 0.16 },
    'upgrade-d': { bus: 'sfx', gain: 0.495, active: 0.066, max: 5, cooldown: 0.045, pitchVar: 0.045, gainVar: 0.16 },
    'upgrade-e': { bus: 'sfx', gain: 0.532, active: 0.059, max: 5, cooldown: 0.045, pitchVar: 0.045, gainVar: 0.16 },

    sell: { bus: 'sfx', gain: 0.46, active: 0.273, max: 5, cooldown: 0.05, pitchVar: 0.05, gainVar: 0.18 },
    'sell-big': { bus: 'sfx', gain: 0.969, active: 0.556, max: 2, cooldown: 0.28, pitchVar: 0.02, gainVar: 0.06 },

    // Gamble Press ate the item. Fires at a 20% rate on a busy line, so it is held tight.
    destroy: { bus: 'sfx', gain: 0.713, active: 0.279, max: 2, cooldown: 0.22, pitchVar: 0.03, gainVar: 0.1 },

    place: { bus: 'sfx', gain: 0.953, active: 0.256, max: 3, cooldown: 0.03, pitchVar: 0.04, gainVar: 0.08 },
    rotate: { bus: 'sfx', gain: 0.784, active: 0.19, max: 2, cooldown: 0.04, pitchVar: 0.03, gainVar: 0.06 },
    remove: { bus: 'sfx', gain: 0.683, active: 0.148, max: 3, cooldown: 0.03, pitchVar: 0.04, gainVar: 0.08 },
    denied: { bus: 'sfx', gain: 0.766, active: 0.145, max: 1, cooldown: 0.18 },

    'ui-hover': { bus: 'sfx', gain: 0.323, active: 0.035, max: 2, cooldown: 0.035, flat: true },
    'ui-click': { bus: 'sfx', gain: 0.63, active: 0.058, max: 3, cooldown: 0.02, flat: true },
    'ui-open': { bus: 'sfx', gain: 0.578, active: 0.168, max: 2, cooldown: 0.06, flat: true },
    'ui-close': { bus: 'sfx', gain: 0.548, active: 0.166, max: 2, cooldown: 0.06, flat: true },
  },
};

// --- owned by: hud ------------------------------------------------------------
export const HUD = {
  top: 24,
  moneySize: 'clamp(40px,3.5vw,56px)',
  moneyWeight: 300,
  money: '#17c964',
  rate: '#8a929e',
  quiet: '#8d95a1',
  stall: '#c07d0e',
  rollTau: 0.16,
  fadeSeconds: 0.28,
};

# Voidworks — architecture contract

A factory hanging in a white void. Droppers spawn materials, conveyors carry them,
upgraders raise their value, a green sell pad turns them into money.
Money is plain green text, top centre. The world orbits. Singleplayer + multiplayer.

This file is the contract between parallel agents. **Do not edit files outside the
"Owns" list of the piece you were assigned.** If you need something from another
piece, read its module's exports — do not reach into its internals and do not
rewrite it.

## Stack

- three.js r169, ES modules from CDN via importmap, **no build step**
- No physics engine — item motion is arc-length parameterisation along belt splines
- Firebase RTDB for multiplayer (account `gzowotesla@gmail.com`)
- All 3D models authored in **Blender** → `assets/models/*.glb` (Draco off, glTF binary)
- All audio fetched from the internet (CC0 first) → `assets/audio/*.ogg|mp3`

## The void beat the benchmark, on purpose (Jurek, 2026-08-17)

A blind judge compared our best screenshot against six real reference shots and picked the real game in
five of them — scoring us **4/10** — and named exactly one reason: **there is no environment in the
frame**. Measured, not asserted: our greyscale histogram is bimodal (values cluster at ~0.1 and ~0.9
with nothing between) where Islanders holds four to five clean value steps. Mid-tones come from ground
and mid-distance geometry, and we have neither. It tried twelve camera angles; none fixed it.

Its recommendation was to add a floor. **Jurek declined, and that decision stands.** The white void is
the concept, not an oversight, and it outranks winning a like-for-like comparison with a game that has
terrain. The "beat a real screenshot in a blind test" goal is therefore **retired** — not failed, and
not to be quietly reopened by a future agent who reads the 4/10 and assumes it is a bug to fix.

Do not add a floor, a platform, a shadow-catcher or a backdrop plane.

## There is no ground

**The factory floats.** No floor, no plate, no base, no shadow-catcher, no horizon. Every component
hangs suspended in empty white space, held together visually by the belts between them. The grid is a
virtual build plane in mid-air, shown only as a faint helper while placing and never shipped as a
surface. Undersides are visible — model every building as a closed, finished volume. Shadows fall from
one floating object onto another, never onto a floor.

## What an upgrader looks like (Jurek, decided)

An upgrader is **a conveyor segment**, not a separate machine. Same belt profile, same surface at
y = 0.34, items ride straight through it without stopping. On top of that segment:

- **two uprights**, one on each side of the belt — plain posts, part of the belt frame's family
- **one flat panel spanning between them**, standing across the belt like a gate: a single
  semi-transparent sheet at about **50% opacity**, additive/emissive, no beams, no scanlines, no
  individual lasers. One clean pane of light the item passes through.
### Two families: silhouette says which kind, colour says how strong

There are **two kinds** of upgrader and they must be distinguishable at a glance, from any angle, in a
dense factory. Colour is already spent on strength, so the **kind is carried by silhouette**:

| | **Multiplier (×)** | **Adder (+)** |
|---|---|---|
| what it does | multiplies the item's value | adds a flat amount to it |
| posts | tall and thin | short and chunky |
| pane | **full height** — a tall vertical gate | **a low wide band** hugging the belt, roughly the bottom third |
| hue family | grey → cyan → green → amber → red → violet | blues only |
| glyph etched on the post | `✕` | `✚` |

Because the two families never share a hue family, a colour alone is never ambiguous; because they
never share a silhouette, a greyscale screenshot is never ambiguous either.

**Multiplier ramp** (colour by factor):

| factor | colour |
|---|---|
| ×1.25 | `#9aa3b0` grey |
| ×1.5 | `#35d6e8` cyan |
| ×2 | `#17c964` green |
| ×3 | `#f5a524` amber |
| ×5 | `#ff6b4a` orange-red |
| ×10 | `#7c5cff` violet |
| tier upgrade | `#f2c94c` gold |
| risky (can destroy the item) | `#e0524a` red |

**Adder ramp** (colour by amount):

| amount | colour |
|---|---|
| +5 | `#cfe6ff` |
| +20 | `#9fd6ff` |
| +75 | `#4fa8ff` |
| +300 | `#2563eb` |
| +1200 | `#4c1fd0` |

The posts stay neutral steel across both families; **only the pane's colour differs**, so a dense
factory reads as a row of coloured gates. That is the legibility rule for this piece.

### Why both kinds exist

An adder is flat, so it is worth most on a **cheap** item; a multiplier scales, so it is worth most on
an **expensive** one. With Slag at 10, a `+20` adder triples it while a `×2` merely takes it to 20 — but
on Singularite at 9000 the same adder is noise and the multiplier is worth 9000. That tension is the
strategy: early factories are built out of adders, late ones out of multipliers, and the interesting
middle is a line that adds first and multiplies afterwards. **Order along the belt matters**, and it
must genuinely matter in the maths.

Item base values are therefore spaced to make that trade real:
Slag 10 · Iron 25 · Copper 70 · Cobalt 200 · Aurite 650 · Voidglass 2200 · Singularite 9000.

## The item cap (the core constraint)

There is a **hard limit on how many items exist in the whole factory at once**.

- An item leaving a dropper: **+1**.
- An item consumed by the sell pad: **−1**.
- At the cap, droppers **stop producing** and say so visibly. Nothing is silently dropped.

This is the central design tension, not a technical detail. Because slots are scarce, the question
stops being "how much can I produce" and becomes **"how much is each slot worth"** — a slot filled with
Slag is a slot not filled with Aurite, and a long upgrader line is worth building precisely because it
raises the value of a slot you already paid for. Throughput and value pull against each other, and belt
length becomes a real cost because items in transit occupy slots without earning.

Capacity is itself an upgrade: it starts tight, and buying more is one of the main money sinks.

It also bounds the renderer for free — the cap is the upper bound on live items, so the 60 fps target
is a property of the design rather than something to hope for.

## Coordinate & grid convention

- World is XZ ground plane, **+Y up**. Grid cell = **1.0 world unit**.
- A building occupies an integer footprint on the grid; its origin is the **centre
  of its footprint, on the ground plane (y = 0)**.
- Belt surface height (where items ride) = **`GRID.beltY = 0.34`**.
- Rotation is 4-way only: `rot ∈ {0,1,2,3}` = `rot * 90°` about +Y. `rot = 0` faces **+X**.
- Blender export convention: **+Y up, -Z forward**, 1 Blender unit = 1 world unit,
  origin at footprint centre on the ground, mesh built so that "forward" (the
  direction a belt moves items) is **+X** at `rot = 0`.

## Files

```
index.html                 entry: importmap, canvas, boot overlay
src/config.js              ALL tunables: palette, grid, camera, economy, render
src/main.js                boot, loop, wiring (thin — no gameplay logic here)
src/render/scene.js        renderer, lights, void backdrop, post-processing
src/render/materials.js    shared material palette (flat + gradient ramps)
src/render/instancing.js   InstancedMesh pools for items and repeated parts
src/camera/orbit.js        orbit / pan / zoom controller
src/world/grid.js          grid math, occupancy map, snapping, raycast to cell
src/world/buildings.js     building defs (catalogue) + factory functions
src/world/belt.js          belt graph, splines, item motion
src/world/items.js         material tiers, item defs, value maths
src/sim/economy.js         money, sell pad, upgrader maths, prices, save/load
src/sim/tick.js            fixed-step simulation
src/build/placement.js     ghost, snapping, validity, place/delete/rotate
src/ui/hud.js              money text + minimal in-game readouts
src/ui/buildbar.js         build catalogue bar
src/ui/menu.js             main menu (Hollowtree style)
src/ui/screens.css.js      shared screen stylesheet
src/audio/audio.js         audio bus, loaders, mixer
src/net/net.js             Firebase RTDB sync
assets/models/*.glb
assets/audio/*
work/                      NOT shipped: tools, screenshots, critic verdicts
```

## Piece ownership

| id | piece | owns |
|---|---|---|
| `render` | void, light, post, palette | `src/render/*`, render section of `config.js` |
| `camera` | orbit controller | `src/camera/*` |
| `models-belt` | conveyor + junctions | `assets/models/belt*.glb` |
| `models-dropper` | droppers / miners | `assets/models/dropper*.glb` |
| `models-upgrader` | upgraders | `assets/models/upgrader*.glb` |
| `models-sellpad` | sell pad | `assets/models/sellpad*.glb` |
| `models-items` | material meshes | `assets/models/item*.glb` |
| `flow` | belt graph + item motion + instancing | `src/world/belt.js`, `src/render/instancing.js` |
| `economy` | value maths, prices, save | `src/sim/*`, `src/world/items.js` |
| `build` | placement UX | `src/build/*`, `src/world/grid.js` |
| `hud` | money text, readouts | `src/ui/hud.js` |
| `buildbar` | catalogue bar | `src/ui/buildbar.js` |
| `menu` | main menu | `src/ui/menu.js`, `src/ui/screens.css.js` |
| `audio` | all sound | `src/audio/*`, `assets/audio/*` |
| `net` | multiplayer | `src/net/*` |
| `perf` | 60 fps @ 200+ items | measurement only; reports, does not own code |

`src/config.js` is shared. Edit **only your own section**, never reformat the file.

## Quality bar

Judged blind against `reference/`. A screenshot of Voidworks placed next to a real
Islanders / shapez 2 screenshot must be picked as the better looking game.
Never below 60 fps with 200+ items in motion.

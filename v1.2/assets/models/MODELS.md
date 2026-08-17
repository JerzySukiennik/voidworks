# Voidworks models

Every file here is a GLB, glTF binary, Draco off, authored in Blender and exported with
`export_yup=True`. Source scene: `work/blender/voidworks.blend`; build scripts
`work/blender/vwkit.py` + `work/blender/vwbelt.py` + `work/blender/vwbuild2.py`
(round 2 rebuild — `build_all()` regenerates all 22 files from scratch); proof renders
`work/blender/r2-*.png`.

**A file only loads if its basename is listed in `manifest.json`.** All 22 below are listed.

`build_all()` is **idempotent** — running it twice against an already-built `.blend` gives
byte-identical tri counts and bounds (verified). That is not free: the first attempt joined a
second set of underside ribs onto the furnace, and an inner-roller filter that matched on a
`_-1` name suffix silently stopped matching once Blender started appending `.001`, which put
`belt-curve`'s overhang straight back. If you add a stage, re-run it twice and diff.

`work/blender/run_headless.py` rebuilds and re-renders everything without the GUI. It exists
because `critic_contract.py` calls `read_factory_settings()`, which unregisters the BlenderMCP
addon and kills the live connection — run the audit last, or work headless afterwards.

## Contract every file honours

- **+Y up, ‑Z forward** in glTF terms. 1 unit = 1 grid cell = 1 world unit.
- **Origin** at the centre of the grid footprint, on the build plane (`y = 0`).
- **Forward = +X.** A belt at `rot = 0` moves items toward +X.
- **Belt surface = `y = 0.34`** (`GRID.beltY`). Every carrying surface tops out at exactly 0.34.
- Modifiers and transforms applied. Flat shaded. No textures, no UVs — colour comes from
  material slots only.
- Undersides are closed, finished volumes — the factory floats and the player orbits under it.
- **Only the upgrader `pane` is `doubleSided`.** Every opaque material exports single-sided
  so backface culling actually works. (Round 1 shipped the whole set double-sided.)

## The value stack (round 2)

Round 1's whole set was one mid-grey body plus a thin accent stripe, so in greyscale it
collapsed into a narrow band and no form separated from its neighbour. Every model now
carries a real tonal structure **in the massing**, not in a stripe:

| step | slot | hex | where |
|---|---|---|---|
| 0 | `ink` | `#12151a` | base, plinth, underside, recesses, mouths |
| 0b | `charcoal` | `#2b313a` | belt frame body — the belt family's identity value |
| 1 | `steelDark` | `#6e7787` | mid trim, collars, ribs, vent bands |
| 2 | `steel` | `#b9c0cc` | main bodies, belt rail caps |
| 3 | `steelLight` | `#e6ecf4` | crowns and caps — machines only |

Two rules hold the hierarchy together: **the belt family commits to dark** (the way shapez 2
commits its belts to orange) so belt runs read as dark ribbons carrying bright cargo, and
**only machines wear step 3**, so a machine always sits above the belt it stands on in value.

Other slots: `rubber` `#31373f` / `rubberLight` `#454c58` (belt bed + cleats),
`warn`/`warn_E` `#f5a524`, `rare` `#7c5cff`, `accent_E`/`accentDeep_E` `#17c964`/`#0e9f4c`
(sellpad only, reserved), `pane` (tinted at runtime), `item_*` (one per item mesh).

Measured against the critic's own test — desaturate a dense scene and compare the histogram
to `work/crit/grey-islanders.png`: pixels stuck in the collapsed L180–220 band fell from
**26.0% to 16.2%** (Islanders 13.0%) and the dark anchor below L90 grew from **21.0% to
28.6%** (Islanders 43.7%). Islanders stays darker because dark terrain fills its frame;
Voidworks has no ground, so its dark anchor is the belts.

## Belts — `models-belt`

Every belt variant is one swept cross-section, so the profile, rail height, groove line,
cleat pitch and roller bosses are identical across the family and joins are invisible.
Cleat pitch is 0.25, which tiles exactly cell to cell. Round 2 kept the geometry and moved
the material keys: ink base and groove, charcoal frame, dark bed, and a bright cap band
along the top of each rail. Undersides gained rib ladders so the view from below is a frame
rather than a black rectangle.

| file | footprint | tris | height | notes |
|---|---|---|---|---|
| `belt-straight` | 1×1 | 412 | 0.001–0.425 | tiles seamlessly along X; 3 underside ribs + spine |
| `belt-curve` | 1×1 | 752 | 0.02–0.425 | enters the −X face moving +X, leaves the −Y face moving −Y (glTF −Y = world −Z). The four rotations cover all four corner pairs; direction of travel is a graph property, so one mesh is enough. |
| `belt-ramp-up` | 1×1 | 812 | 0.02–0.925 | smoothstep S-curve, ends **+0.5** higher than it starts; both ends are flat so they meet level belts flush |
| `belt-ramp-down` | 1×1 | 812 | −0.48–0.425 | same but ends **−0.5** lower; geometry extends below the build plane |
| `belt-merger` | 1×1 | 704 | 0.00–0.55 | 3 in (−X, +Y, −Y) → 1 out (+X). Open pad, four corner posts, two amber chevrons pointing +X, taller posts on the output side |
| `belt-splitter` | 1×1 | 936 | 0.00–0.55 | 1 in (−X) → 3 out (+X, +Y, −Y). Same pad plus a hexagonal turntable hub and three outward chevrons |

**Round 1's documented `belt-curve` overhang is gone.** It reached −0.543 past the cell
corner and was blamed on the swept profile; the profile in fact stops dead on −0.500. The
overhang was the *inner* roller bosses — 0.478 outboard of a 0.5-radius arc drops them onto
the cell corner. Rollers belong on the outside of a turn, so the inner ones were removed and
`belt-curve` now stays inside its own cell on every axis.

## Upgraders — `models-upgrader`

Both are a **belt-straight segment** with posts and one pane, so they tile into a belt run
and items ride through without stopping. **Two base models only, panes tinted at runtime** —
no colour variants exported.

| file | footprint | tris | height | silhouette |
|---|---|---|---|---|
| `upgrader-mult` | 1×1 | 1800 | 0.00–1.300 | tall thin posts on a coffered flange, mid collar, near-white head cap, **full-height** pane 0.70 × 0.92, `✕` glyph on each outer post face |
| `upgrader-add` | 1×1 | 2152 | 0.00–0.734 | two long heavy flank housings with recessed vent bands, near-white crown plates and four bright bollards, **low wide band** pane 0.70 × 0.28, `✚` glyph on each outer face |

The adder was rebuilt, not tweaked. Round 1's posts barely cleared the belt rails, so with
the pane stripped there was nothing above the belt at all and at ~60 px it read as a glint.
The constraint that produced that failure is real and worth writing down: **nothing may
bridge over the belt below y = 0.68**, because a 0.30-tall item riding at 0.34 needs the
headroom. Round 2 therefore spends the missing mass *sideways and along the belt* instead of
upward — long flank housings rather than a gantry. Verified by the critic's own test: render
both families at ~60 px, greyscale, panes deleted (`show_family_small(panes=False)` →
`work/blender/r2-family-small-grey.png`). Two tall thin verticals vs one low wide mass; they
do not collide.

The `pane` slot exports as: `alphaMode: BLEND`, `baseColorFactor` alpha `0.5`,
`emissiveFactor` = the pane colour, `doubleSided: true`, roughness 0.25, metallic 0. Tint by
writing `material.color` **and** `material.emissive` on the slot named `pane`; leave alpha and
blending alone. Shipped defaults are `#17c964` (mult) and `#9fd6ff` (add). Both files export
a slot named exactly `pane` — inside one .blend only one material can hold that name, so
`stage_upgraders()` hands the name over between the two exports.

Posts are neutral steel on both, so colour is free to carry strength only.

Both reach ±0.518 laterally: the head cap and the glyph sit slightly proud of the post face.
That is harmless because an upgrader's lateral neighbour is always a belt, which is 0.94
wide, so the two never meet.

## Droppers — `models-dropper`

All four are **1×1**, same family, escalating. Each has a hopper with visible contents, an
ink-recessed window on both flanks showing the tier accent, and a tapered spout leaving the
+X face whose dark mouth sits just above belt height and aims forward-down. Plinths are
coffered — an ink rim frame with a recessed ceiling and bright cross ribs.

Round 1 escalated only by height and stripe colour, which a desaturated screenshot cannot
see. Round 2 escalates three things it can: **footprint width, height, and how much
near-white crown the machine wears.**

| file | tris | width (z) | height | tier cues |
|---|---|---|---|---|
| `dropper-basic` | 796 | 0.64 | 0.00–1.050 | steel body, small crown, neutral window |
| `dropper-mk2` | 796 | 0.74 | 0.00–1.230 | wider, taller, larger crown, amber window |
| `dropper-mk3` | 988 | 0.84 | 0.00–1.613 | violet window, near-full crown, exhaust stack |
| `dropper-void` | 1192 | 0.94 | 0.00–1.887 | **ink body** — the top tier inverts the stack and is the highest-contrast object in the family — full crown, violet core on two arms |

The spout overhangs the +X face to x = 0.569. That is deliberate — it reads as leaning over
the belt it feeds — but it means the cell in front of a dropper should be a belt, not another
machine.

## Sellpad — `models-sellpad`

| file | footprint | tris | height |
|---|---|---|---|
| `sellpad` | 2×2 | 3672 | 0.00–0.715 |

**Geometry deliberately unchanged in round 2.** It was the strongest piece in round 1 and the
only one that already had a real value stack; it was the target the rest of the set was
raised to meet. It was re-exported only to pick up the single-sided material fix.

Chunky steel frame, a green ring at belt height around a **recessed glowing well** with a
bright grid, four corner pylons with glowing collars and caps, and a green emissive panel on
the underside so it glows into the void from below. Emissive slots are `accent_E` (strength
1.15) and `accentDeep_E` (0.5) — tuned to sit just under the bloom threshold. Green is used
**only** here.

## Furnace and storage

| file | footprint | tris | height | notes |
|---|---|---|---|---|
| `furnace` | 2×2 | 2640 | 0.00–1.90 | glowing amber band, amber door on the +X face at belt height, chimney with a glowing throat, hopper on top |
| `storage` | 2×2 | 2424 | 0.00–1.68 | ribbed silo, amber fill gauge on all four faces, lid and hatch |

Both now genuinely stay inside ±1.0 on X and Y. Round 1's doc claimed this; the furnace
actually reached 1.005 and has been scaled back onto the line. Both received the value stack
by height (dark base → mid body → steel upper → near-white cap) plus underside ribs, but they
remain the least characterful pieces in the set.

## Items — `models-items`

Roughly 0.3 units across, **origin at the bottom** so the mesh sits on `y = 0` — place an
instance at `y = GRID.beltY (0.34)` and it rests on the belt surface. One material slot each.
All are single-material single-primitive meshes, which is what `InstancedMesh` wants: take
`gltf.scene.children[0].geometry` and the matching material directly.

Round 1's `item-iron` was a 12-tri near-white cube whose jitter vanished at real size, so on a
crowded belt it read as a **missing asset**; the bottom of the ramp was four lumps letting
colour do all the work. Round 2 separates every step by shape, and gives the cheap end dark
values so the ramp climbs in brightness as well as in silhouette.

| file | tris | shape | colour | emissive |
|---|---|---|---|---|
| `item-slag` | 28 | flat wide jagged slab, hugs the belt | `#5f6672` | – |
| `item-iron` | 16 | cast ingot — a low tapered rectangular bar | `#a9bad0` | – |
| `item-copper` | 32 | round rod lying across the belt | `#e08b4c` | – |
| `item-cobalt` | 48 | upright hexagonal column with a point | `#4c7ce0` | – |
| `item-aurite` | 32 | stepped spire — sharp four-sided pyramid on a plinth | `#f2c94c` | – |
| `item-voidglass` | 80 | cluster of four tall shards | `#7c5cff` | 0.45 |
| `item-singularite` | 116 | six-spiked star | `#ff5c8a` | 0.75 |

Silhouette ramp: slab → bar → rod → column → spire → cluster → star. Colours live in the GLB
material, not in `ITEMS.tiers` — the loader takes the mesh's own material, so `slag` and
`iron` here are intentionally darker than the `color` values in `src/config.js`, which are
used only by the primitive fallback and by UI.

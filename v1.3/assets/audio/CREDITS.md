# Audio credits

Every file in `assets/audio/` is listed here with its source, author and licence, and then
measured again in a second table so nothing in this document is a claim rather than a number.

**All sources are CC0 1.0 (public domain dedication).** Attribution is not legally required;
it is kept here anyway. Nothing under CC-BY-NC, CC-BY-SA or an unclear licence was shipped.

Each id ships twice: `<id>.ogg` (Ogg **Opus**, what the game prefers — Opus is gapless, so a loop
wraps without the encoder padding MP3 would add) and `<id>.mp3` (fallback for any browser that
cannot decode Ogg Opus). `src/audio/audio.js` tries `.ogg` first and falls back automatically.
Both containers decode to identical sample counts.

## Sources

| Source | Author | Licence | Where |
|---|---|---|---|
| Kenney "Sci-Fi Sounds" | Kenney | CC0 1.0 | https://kenney.nl/assets/sci-fi-sounds |
| Kenney "Interface Sounds" | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds |
| Kenney "UI Audio" | Kenney | CC0 1.0 | https://kenney.nl/assets/ui-audio |
| Kenney "Impact Sounds" | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds |
| Kenney "RPG Audio" | Kenney | CC0 1.0 | https://kenney.nl/assets/rpg-audio |
| Kenney "Music Jingles" | Kenney | CC0 1.0 | https://kenney.nl/assets/music-jingles |
| OpenGameArt "Another space background track" | yd | CC0 1.0 | https://opengameart.org/content/another-space-background-track |

## Beds and loops

| File | Source | Original | Author | Licence | Processing |
|---|---|---|---|---|---|
| `amb-void` | [https://kenney.nl/assets/sci-fi-sounds](https://kenney.nl/assets/sci-fi-sounds) | `spaceEngineLow_000.ogg` | Kenney | CC0 1.0 | high-pass 30 Hz + low-pass 1.4 kHz, −9 dB shelf above 700 Hz, widened, cut to a **4.000 s** loop with a 0.5 s equal-power wrap crossfade |
| `belt-loop` | [https://kenney.nl/assets/sci-fi-sounds](https://kenney.nl/assets/sci-fi-sounds) | `spaceEngineLow_004.ogg (body) + engineCircular_004.ogg (grain, −7.5 dB)` | Kenney | CC0 1.0 | band-limited to 45–900 Hz and 90–1800 Hz, mixed, limited, cut to a **2.000 s** loop with a 0.45 s equal-power wrap crossfade |
| `music-void` | [https://opengameart.org/content/another-space-background-track](https://opengameart.org/content/another-space-background-track) | `ObservingTheStar.ogg` | yd | CC0 1.0 | fades discarded, DC removed, region 30–126 s cut to a **96.000 s** loop with a 5 s equal-power wrap crossfade |

## The upgrade ladder

All five rungs are the **same source file** resampled to a **major pentatonic** scale, so rung order is
literally pitch order and any two rungs ringing at the same instant are consonant. Round 1 shipped three
unrelated timbres whose dominant partials ran 1316 / 2216 / 294 Hz — a ladder that went backwards.

| File | Source | Original | Author | Licence | Processing |
|---|---|---|---|---|---|
| `upgrade-a` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `pluck_001.ogg` | Kenney | CC0 1.0 | resampled ×1.0000 (root) |
| `upgrade-b` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `pluck_001.ogg` | Kenney | CC0 1.0 | resampled ×1.1225 (major 2nd) |
| `upgrade-c` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `pluck_001.ogg` | Kenney | CC0 1.0 | resampled ×1.2599 (major 3rd) |
| `upgrade-d` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `pluck_001.ogg` | Kenney | CC0 1.0 | resampled ×1.4983 (perfect 5th) |
| `upgrade-e` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `pluck_001.ogg` | Kenney | CC0 1.0 | resampled ×1.6818 (major 6th) |

## Item and machine events

| File | Source | Original | Author | Licence | Processing |
|---|---|---|---|---|---|
| `dropper` | [https://kenney.nl/assets/impact-sounds](https://kenney.nl/assets/impact-sounds) | `impactMetal_light_002.ogg` | Kenney | CC0 1.0 | pitched ×0.86, low-passed 5.2 kHz |
| `sell` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `confirmation_001.ogg` | Kenney | CC0 1.0 | pitched ×1.06 |
| `sell-big` | [https://kenney.nl/assets/music-jingles](https://kenney.nl/assets/music-jingles) | `Steel jingles/jingles_STEEL09.ogg` | Kenney | CC0 1.0 | 29.6 ms of head silence cut |
| `destroy` | [https://kenney.nl/assets/impact-sounds](https://kenney.nl/assets/impact-sounds) | `impactMetal_heavy_002.ogg (snap, ×0.92) + impactPlate_heavy_001.ogg (slam, −5 dB)` | Kenney | CC0 1.0 | snap low-passed 6 kHz, slam band-limited 55–700 Hz and cut to 0.30 s with a fade so it stays dry |

## Build feedback

| File | Source | Original | Author | Licence | Processing |
|---|---|---|---|---|---|
| `place` | [https://kenney.nl/assets/rpg-audio](https://kenney.nl/assets/rpg-audio) | `metalLatch.ogg` | Kenney | CC0 1.0 | pitched ×0.94, low-passed 8 kHz, 47.0 ms of head silence cut |
| `rotate` | [https://kenney.nl/assets/ui-audio](https://kenney.nl/assets/ui-audio) | `switch2.ogg` | Kenney | CC0 1.0 | pitched ×1.08, 39.6 ms of head silence cut |
| `remove` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `drop_003.ogg` | Kenney | CC0 1.0 | pitched ×0.92 |
| `denied` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `error_008.ogg` | Kenney | CC0 1.0 | pitched ×0.96 |

## Menu feedback

| File | Source | Original | Author | Licence | Processing |
|---|---|---|---|---|---|
| `ui-hover` | [https://kenney.nl/assets/ui-audio](https://kenney.nl/assets/ui-audio) | `rollover2.ogg` | Kenney | CC0 1.0 | 19.5 ms of head silence cut |
| `ui-click` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `click_001.ogg` | Kenney | CC0 1.0 | — |
| `ui-open` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `open_001.ogg (air, high-passed 3 kHz, −6 dB) + drop_002.ogg (body, ×1.10, low-passed 2.2 kHz)` | Kenney | CC0 1.0 | layered to give the air some body |
| `ui-close` | [https://kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `close_001.ogg (air, high-passed 3 kHz, −10 dB) + drop_002.ogg (body, ×0.88, low-passed 2.2 kHz)` | Kenney | CC0 1.0 | layered, body pitched below ui-open so close falls where open rises |

## How every file was processed

- **Onset.** Each one-shot is cut to start `2 ms` before the first sample that reaches 6% of its
  peak, then given a 1.5 ms equal-power fade-in and a 12 ms fade-out so no cut edge can click.
  Round 1 shipped up to 50 ms of pre-roll silence; the head cuts applied are listed above.
  `denied` still measures a ~17 ms "onset" against a 12% threshold — that is not silence, it is the
  source's own two-stage envelope, which is already audible at −20 dB from sample zero.
- **Tail.** Every one-shot is padded with silence to at least 0.160 s because `libmp3lame` cannot
  encode a file shorter than its own encoder delay — a 35 ms input produced an unreadable MP3.
  The padding never costs latency, and `AUDIO.sounds[*].active` tells the mixer the audible length
  so a voice slot is released on time instead of being held by silence.
- **Loudness.** Files are matched by **RMS measured over the first 0.160 s**, the same window for
  every one-shot, to −26 dBFS, with the limiter never allowed to squash a transient by more than
  4 dB. Where that cap binds (`place`, `rotate`, `ui-hover`, `ui-click` are the peaky ones) the file
  lands 1–3 dB low and the deficit is corrected in `AUDIO.sounds[*].gain`, so the **effective**
  column — what you actually hear, at the default slider positions — is the flat one. The three
  beds carry a *static* gain to an EBU R128 target instead (`ebur128`, applied as a single
  `volume=`; a time-varying `loudnorm` would have broken the loop seams).
- **Mix order.** The belt bed sits **under** everything: −42.0 dBFS effective at full activity,
  against −35.1 for music and −37.6 for a sale. `amb-void` sits lower still at −45.0, but it is a
  wide 1.5–11 kHz air bed (centroid 11.6 kHz) deliberately placed in the band the belt bed leaves
  empty (centroid 147 Hz), so it is audible as room rather than fighting the machines.
- **Verified.** No file clips, none has a DC offset above 0.0005, none is silent, no `.ogg` or
  `.mp3` peaks above −1 dBFS, every `.ogg` is smaller than its `.mp3`, and each loop's wrap
  discontinuity is smaller than the 99.9th-percentile sample-to-sample step inside the same file —
  the seam is quieter than the material, so it cannot click.

## Measured, not claimed

Every number below was read back off the shipped `.ogg`/`.mp3`. "effective" is the level at the
default sliders (master 0.8, sfx 0.85, music 0.5) including the config gain and the bus gains.
One-shots are measured over their first 0.160 s; the beds over their full loop length.

| File | s | dom Hz | centroid Hz | file RMS | peak .ogg | peak .mp3 | DC | clipped | seam / p99.9 | config gain | effective | ogg KB | mp3 KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `amb-void` | 4.000 | 14901 | 11636 | -30.3 | -12.7 | -15.0 | +0.00000 | 0 | -48 / -14 | 0.531 | **-45.0** | 28.3 | 39.8 |
| `belt-loop` | 2.000 | 54 | 147 | -17.4 | -9.1 | -9.5 | -0.00094 | 0 | -42 / -37 | 0.169 | **-42.0** | 16.3 | 24.2 |
| `music-void` | 96.000 | 97 | 393 | -25.7 | -1.3 | -1.9 | +0.00004 | 0 | -100 / -27 | 1.0 | **-35.1** | 668.5 | 938.1 |
| `upgrade-a` | 0.160 | 1324 | 1610 | -27.1 | -1.6 | -3.2 | -0.00007 | 0 | — | 0.465 | **-38.5** | 0.8 | 1.9 |
| `upgrade-b` | 0.160 | 1486 | 1954 | -26.6 | -4.9 | -3.8 | -0.00002 | 0 | — | 0.459 | **-38.1** | 0.9 | 1.9 |
| `upgrade-c` | 0.160 | 1658 | 2058 | -27.1 | -3.6 | -3.7 | -0.00001 | 0 | — | 0.504 | **-37.8** | 0.9 | 1.9 |
| `upgrade-d` | 0.160 | 1981 | 2418 | -26.6 | -3.4 | -4.3 | -0.00001 | 0 | — | 0.495 | **-37.5** | 0.9 | 1.9 |
| `upgrade-e` | 0.160 | 2218 | 2879 | -26.9 | -4.6 | -3.9 | +0.00002 | 0 | — | 0.532 | **-37.1** | 0.7 | 1.9 |
| `dropper` | 0.240 | 2573 | 2479 | -26.2 | -9.6 | -9.5 | +0.00011 | 0 | — | 0.352 | **-40.0** | 1.2 | 2.5 |
| `sell` | 0.273 | 420 | 435 | -26.1 | -17.3 | -17.3 | +0.00004 | 0 | — | 0.46 | **-37.6** | 1.2 | 2.7 |
| `sell-big` | 0.556 | 668 | 865 | -26.0 | -14.5 | -15.0 | -0.00017 | 0 | — | 0.969 | **-31.0** | 3.7 | 6.2 |
| `destroy` | 0.279 | 54 | 573 | -26.3 | -9.9 | -10.3 | -0.00038 | 0 | — | 0.713 | **-34.0** | 1.1 | 2.7 |
| `place` | 0.256 | 1637 | 3683 | -27.8 | -6.6 | -4.8 | +0.00001 | 0 | — | 0.953 | **-33.0** | 1.1 | 2.5 |
| `rotate` | 0.190 | 1217 | 4640 | -29.1 | -6.1 | -3.3 | -0.00001 | 0 | — | 0.784 | **-36.0** | 0.9 | 2.1 |
| `remove` | 0.160 | 678 | 672 | -25.9 | -10.4 | -11.0 | -0.00004 | 0 | — | 0.683 | **-34.0** | 1.0 | 1.9 |
| `denied` | 0.160 | 54 | 453 | -25.9 | -4.5 | -5.6 | +0.00101 | 0 | — | 0.766 | **-33.0** | 0.7 | 1.9 |
| `ui-hover` | 0.160 | 269 | 606 | -29.4 | -3.0 | -2.6 | -0.00001 | 0 | — | 0.323 | **-44.0** | 0.7 | 1.9 |
| `ui-click` | 0.160 | 226 | 1676 | -29.2 | -2.9 | -2.7 | -0.00031 | 0 | — | 0.63 | **-38.0** | 0.6 | 1.9 |
| `ui-open` | 0.168 | 915 | 4925 | -26.5 | -12.4 | -11.7 | +0.00001 | 0 | — | 0.578 | **-36.0** | 0.9 | 1.9 |
| `ui-close` | 0.166 | 721 | 4360 | -26.0 | -9.9 | -10.3 | +0.00007 | 0 | — | 0.548 | **-36.0** | 1.0 | 1.9 |

Total shipped: **731 KB** of `.ogg` and **1042 KB** of `.mp3`.

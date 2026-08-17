# Voidworks

A factory hanging in a white void. Droppers spawn materials, conveyors carry them, upgraders raise their
value, a green sell pad turns them into money.

Two families of upgrader, and the difference is the whole game. **Adders** add a flat amount, so they are
worth most on cheap material. **Multipliers** scale, so they are worth most on expensive material. The
best line adds first and multiplies afterwards, because the multiplier compounds what the adders put in —
measured at 2.4x over the reverse order. Silhouette tells you which kind a machine is; the colour of its
laser pane tells you how strong.

The constraint that makes it a game: **a hard limit on how many items exist at once**. A dropper adds one,
the sell pad removes one, and at the cap production stops. So the question is never "how much can I
produce" but "how much is each slot worth" — and belt length becomes a real cost, because an item in
transit occupies a slot while earning nothing.

Singleplayer and co-op. Built with three.js, no build step. All models authored in Blender, all sound CC0.

## Run it

```bash
node work/tools/serve.js
```

Then open http://localhost:5178/

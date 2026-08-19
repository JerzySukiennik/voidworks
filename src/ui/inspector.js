// Voidworks — the building inspector: right-click a placed machine and it explains itself, in the
// top-right corner, in exactly the terms the buildbar used while you were shopping for it.
//
// Two rules shape this file:
//
//   1. It borrows the buildbar's palette rather than declaring its own (BUILDBAR.colors), because a
//      second panel with its own greys is how a UI stops looking like one designer's work.
//   2. It never writes to the DOM on a frame where nothing it displays changed. Every write goes
//      through `put()`, which compares against the last value it wrote and counts the ones that get
//      through — `api.writes` is that counter, and work/tools/inspectortest.mjs asserts on it.

import { INSPECTOR, BUILDBAR, ITEMS } from '../config.js';
import { paneColorFor } from '../world/buildings.js';

const C = BUILDBAR.colors;
const COPY = INSPECTOR.copy;
const EASE = 'cubic-bezier(.22,.61,.36,1)';

const CSS = `
.vw-insp{position:fixed;top:${INSPECTOR.top}px;right:${INSPECTOR.right}px;z-index:${INSPECTOR.z};
  width:${INSPECTOR.width}px;max-height:${INSPECTOR.maxHeightVh}vh;overflow-y:auto;overscroll-behavior:contain;
  padding:14px 15px 13px;border-radius:14px;box-sizing:border-box;
  background:${C.panel};border:1px solid ${C.panelEdge};
  box-shadow:0 18px 40px rgba(26,29,34,.13),0 2px 6px rgba(26,29,34,.05);
  backdrop-filter:blur(16px) saturate(1.06);-webkit-backdrop-filter:blur(16px) saturate(1.06);
  font-family:ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;
  font-feature-settings:"tnum" 1,"lnum" 1;-webkit-font-smoothing:antialiased;color:${C.text};
  opacity:0;transform:translateY(-6px) scale(.985);pointer-events:none;
  transition:opacity .2s ${EASE},transform .2s ${EASE}}
.vw-insp.on{opacity:1;transform:none;pointer-events:auto}
.vw-insp *{box-sizing:border-box}

.vw-insp-head{display:flex;align-items:center;gap:8px}
.vw-insp-dot{width:9px;height:9px;border-radius:3px;flex:none;
  box-shadow:0 0 0 1px rgba(26,29,34,.12) inset}
.vw-insp-name{font-size:14px;font-weight:700;letter-spacing:-.01em;color:${C.ink};
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vw-insp-x{margin-left:auto;flex:none;width:20px;height:20px;border-radius:6px;cursor:pointer;
  border:1px solid transparent;background:none;padding:0;line-height:1;font-size:14px;color:${C.dim};
  display:flex;align-items:center;justify-content:center;
  transition:color .16s ease,background .16s ease,border-color .16s ease}
.vw-insp-x:hover{color:${C.ink};background:rgba(26,29,34,.05)}
.vw-insp-x:focus-visible{outline:none;border-color:${C.accent};box-shadow:0 0 0 3px rgba(23,201,100,.2)}

.vw-insp-fam{margin-top:3px;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  color:${C.dim}}
.vw-insp-eff{margin-top:9px;display:flex;align-items:baseline;gap:8px}
.vw-insp-eff b{font-size:19px;font-weight:700;line-height:1;letter-spacing:-.015em;color:${C.ink}}
.vw-insp-eff span{font-size:10.5px;line-height:1.35;color:${C.text}}

.vw-insp-grid{margin-top:11px;padding-top:10px;border-top:1px solid ${C.faint};
  display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}
.vw-insp-grid div{display:flex;flex-direction:column;gap:2px;min-width:0}
.vw-insp-grid span{font-size:8.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${C.dim}}
.vw-insp-grid b{font-size:11.5px;font-weight:600;color:${C.ink};white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.vw-insp-grid b.warn{color:${C.risk}}
.vw-insp-mat{display:flex;align-items:center;gap:5px}
.vw-insp-mat i{width:7px;height:7px;border-radius:2px;flex:none;box-shadow:0 0 0 1px rgba(26,29,34,.14) inset}

.vw-insp-up{margin-top:12px;padding-top:11px;border-top:1px solid ${C.faint}}
.vw-insp-lab{font-size:8.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${C.dim}}
.vw-insp-lvl{margin-top:7px;display:flex;align-items:center;gap:8px}
.vw-insp-pips{display:flex;gap:3px;flex:none}
.vw-insp-pips i{width:14px;height:4px;border-radius:2px;display:block;background:rgba(26,29,34,.1)}
.vw-insp-pips i.on{background:${C.accent}}
.vw-insp-lvlno{margin-left:auto;font-size:11px;font-weight:700;color:${C.ink}}
.vw-insp-next{margin-top:8px;font-size:10.5px;line-height:1.45;color:${C.text};min-height:15px}
/* Money is the loudest green in this game and the sell pad is the second. A solid green slab in the
   corner outshouted both, so the button is green INK on a green tint and only fills on hover — still
   unmistakably the one action in the panel, still quieter than the money it is spending. */
.vw-insp-buy{margin-top:9px;width:100%;padding:9px 12px;border-radius:10px;cursor:pointer;
  border:1px solid rgba(23,201,100,.42);font:inherit;font-size:10.5px;font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:${C.accentDeep};background:rgba(23,201,100,.10);
  transition:background .18s ease,color .18s ease,border-color .18s ease,transform .18s ${EASE}}
.vw-insp-buy:hover{background:${C.accent};color:${C.onAccent};border-color:${C.accent};transform:translateY(-1px)}
.vw-insp-buy:active{transform:none}
.vw-insp-buy:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(23,201,100,.24)}
.vw-insp-buy.off{background:rgba(26,29,34,.05);border-color:rgba(26,29,34,.09);color:${C.dim};
  cursor:default;transform:none}
.vw-insp-note{margin-top:7px;font-size:10px;line-height:1.4;color:${C.dim}}
.vw-insp-foot{margin-top:10px;font-size:8.5px;font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:${C.dim};opacity:.7}
@media (prefers-reduced-motion:reduce){.vw-insp{transition-duration:.01ms}}
`;

let injected = false;
function injectStyles() {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'vw-inspector-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const num = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');

// Same rule as the buildbar's tile price: exact while the figure is still something you save toward,
// magnitude once it stops being one.
function shortMoney(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, '')}M`;
  if (n >= 1e4) return `$${Math.round(n / 1e3)}k`;
  return money(n);
}

// --- the numbers, in the buildbar's words -------------------------------------
// Deliberately mirrored from buildbar.js rather than imported: that module exports a factory, not
// its formatters, and it is not this piece's file to change. The strings must stay identical, so
// any edit to one of these belongs in both.

const BELT_EFFECT = {
  belt_turn: 'corner', belt_merge: '3→1', belt_split: '1→3',
  belt_ramp_up: 'up', belt_ramp_down: 'down', belt_elev: 'deck',
};

function effectOf(def) {
  if (def.family === 'dropper') return `${num(def.drop.rate)}/s`;
  if (def.family === 'belt') return BELT_EFFECT[def.id] || `${num(def.speed)}/s`;
  if (def.family === 'upgrader') {
    if (def.upg.kind === 'tier') return 'tier +1';
    if (def.upg.kind === 'flat') return `+${def.upg.amount}`;
    return `×${def.upg.amount}`;
  }
  if (def.id === 'sellpad' || def.family === 'sell') return 'sell';
  if (def.store) return `${def.store.cap} held`;
  if (def.fuse) return '4 → 1';
  return '—';
}

function longEffectOf(def) {
  if (def.family === 'dropper') {
    const t = ITEMS.tiers;
    return `${num(def.drop.rate)} items/s · ${t[def.drop.min].name}–${t[def.drop.max].name}`;
  }
  if (def.family === 'belt') return `${num(def.speed)} units/s`;
  if (def.family === 'upgrader') {
    if (def.upg.kind === 'tier') return 'One whole material tier up, once per item';
    if (def.upg.kind === 'flat') return `+${def.upg.amount} flat to item value`;
    if (def.upg.destroy) return `×${def.upg.amount} value, ${Math.round(def.upg.destroy * 100)}% chance to destroy`;
    return `×${def.upg.amount} item value`;
  }
  if (def.tierPad) return 'Pays 2.2× for its material, 0.35× for the rest';
  if (def.family === 'sell') return 'Converts an item to money, frees its slot';
  if (def.store) return `Holds ${def.store.cap}, releases ${def.store.rate}/s`;
  if (def.fuse) return `4 items → 1 of the next tier at ×${def.fuse.bonus}`;
  return '—';
}

function familyOf(def) {
  if (def.family === 'upgrader') return def.kind === 'add' ? BUILDBAR.copy.familyAdd : BUILDBAR.copy.familyMult;
  if (def.family === 'dropper') return 'Dropper · source';
  if (def.family === 'belt') return 'Conveyor · transport';
  return 'Terminal · end of line';
}

// Pane colours are tuned for an emissive sheet in a white void; as ink on white the pale end of both
// ramps disappears, so the swatch is fine but any text taking the hue needs darkening. Same function
// as the buildbar's, same reason.
function tintOf(def) {
  if (def.family === 'upgrader') return paneColorFor(def.upg);
  if (def.family === 'dropper') return '#8d97a6';
  if (def.family === 'belt') return '#6c7686';
  return '#0e9f4c';
}

// --- the upgrade system, whatever shape it turns up in ------------------------
// `src/sim/upgrades.js` is another builder's file and did not exist when this was written, so this
// is an ADAPTER, not a guess dressed as an API: it probes for the documented names first and a
// short list of obvious aliases second, and if it finds nothing the panel is read-only. Nothing
// here throws when the system is absent, and nothing here is a stub implementation of it — an
// inspector that invented its own upgrade maths would be lying about the game.

const NAMES = {
  levels: ['upgradeLevels', 'levels', 'levelOf'],
  info: ['upgradeInfo', 'info', 'describe'],
  cost: ['upgradeCost', 'cost', 'priceOf'],
  can: ['canUpgrade', 'can', 'affordable'],
  apply: ['applyUpgrade', 'upgrade', 'buy', 'apply'],
};

function pick(src, list) {
  if (!src) return null;
  for (const n of list) if (typeof src[n] === 'function') return src[n].bind(src);
  return null;
}

function bindUpgrades(src) {
  if (!src) return null;
  const fn = {
    levels: pick(src, NAMES.levels),
    info: pick(src, NAMES.info),
    cost: pick(src, NAMES.cost),
    can: pick(src, NAMES.can),
    apply: pick(src, NAMES.apply),
  };
  // An "upgrade system" that cannot describe a level and cannot sell one is not one.
  if (!fn.apply && !fn.info && !fn.levels) return null;
  return fn;
}

// Everything the panel needs, normalised out of whatever the system returned. Each accessor is
// allowed to answer in any of the obvious shapes — a number, `{level,max}`, `{ok,reason}` — because
// pinning that down is the other builder's call, not this one's.
function readUpgrade(fn, b) {
  if (!fn || !b) return null;
  let level = 0;
  let max = 0;
  let label = '';
  let desc = '';
  let cost = NaN;
  let can = null;
  let reason = '';

  const lv = fn.levels ? fn.levels(b) : null;
  if (typeof lv === 'number') level = lv | 0;
  else if (lv && typeof lv === 'object') {
    if (Number.isFinite(lv.level)) level = lv.level | 0;
    if (Number.isFinite(lv.max)) max = lv.max | 0;
  }

  const info = fn.info ? fn.info(b) : null;
  if (info && typeof info === 'object') {
    if (Number.isFinite(info.level)) level = info.level | 0;
    if (Number.isFinite(info.max)) max = info.max | 0;
    if (Number.isFinite(info.cost)) cost = info.cost;
    const next = info.next || info;
    if (typeof next.label === 'string') label = next.label;
    if (typeof next.desc === 'string') desc = next.desc;
    else if (typeof next.text === 'string') desc = next.text;
    else if (typeof next.effect === 'string') desc = next.effect;
    if (!Number.isFinite(cost) && Number.isFinite(next.cost)) cost = next.cost;
    if (info.next === null) max = max || level;
  } else if (typeof info === 'string') desc = info;

  if (fn.cost) {
    const c = fn.cost(b);
    if (Number.isFinite(c)) cost = c;
  }

  if (fn.can) {
    const r = fn.can(b);
    if (typeof r === 'boolean') can = r;
    else if (r && typeof r === 'object') {
      can = !!(r.ok !== undefined ? r.ok : r.can);
      if (typeof r.reason === 'string') reason = r.reason;
    }
  }

  return { level, max, label, desc, cost, can, reason, buyable: !!fn.apply };
}

// --- the panel ----------------------------------------------------------------

export function createInspector(world, opts) {
  injectStyles();

  const root = el('div', 'vw-insp', document.body);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', COPY.title);

  const head = el('div', 'vw-insp-head', root);
  const dot = el('i', 'vw-insp-dot', head);
  const nameEl = el('div', 'vw-insp-name', head);
  const closeEl = el('button', 'vw-insp-x', head, '×');
  closeEl.type = 'button';
  closeEl.title = COPY.close;
  closeEl.setAttribute('aria-label', COPY.close);

  const famEl = el('div', 'vw-insp-fam', root);
  const effWrap = el('div', 'vw-insp-eff', root);
  const effEl = el('b', null, effWrap);
  const effLongEl = el('span', null, effWrap);

  const grid = el('div', 'vw-insp-grid', root);
  function cell(label) {
    const box = el('div', null, grid);
    el('span', null, box, label);
    const value = el('b', null, box);
    return { box, value };
  }
  const cThroughput = cell(COPY.throughput);
  const cRefund = cell(COPY.refund);
  const cStatus = cell(COPY.status);
  const cCell = cell(COPY.cell);
  const cMaterial = cell(COPY.material);
  cMaterial.value.className = 'vw-insp-mat';
  const matDot = el('i', null, cMaterial.value);
  const matText = el('span', null, cMaterial.value);
  matText.style.cssText = 'font-size:11.5px;font-weight:600;letter-spacing:0;text-transform:none;color:inherit';

  const up = el('div', 'vw-insp-up', root);
  el('div', 'vw-insp-lab', up, COPY.upgrades);
  const lvlRow = el('div', 'vw-insp-lvl', up);
  const pips = el('div', 'vw-insp-pips', lvlRow);
  const lvlNo = el('div', 'vw-insp-lvlno', lvlRow);
  const nextEl = el('div', 'vw-insp-next', up);
  const buyEl = el('button', 'vw-insp-buy', up);
  buyEl.type = 'button';
  const noteEl = el('div', 'vw-insp-note', up);
  el('div', 'vw-insp-foot', root, COPY.hint);

  // --- write gate -------------------------------------------------------------
  // The panel polls, so every value below is compared before it is written. `writes` counts what
  // actually reached the DOM; a panel sitting open on an idle building must not move it.
  const last = new Map();
  let writes = 0;

  function put(node, key, value) {
    const k = `${key}`;
    if (last.get(k) === value) return false;
    last.set(k, value);
    writes += 1;
    if (key.endsWith('|cls')) node.className = value;
    else if (key.endsWith('|bg')) node.style.background = value;
    else node.textContent = value;
    return true;
  }

  function show(node, key, on) {
    const v = on ? '' : 'none';
    if (last.get(key) === v) return;
    last.set(key, v);
    writes += 1;
    node.style.display = v;
  }

  // --- state ------------------------------------------------------------------

  let target = null;
  let open = false;
  let acc = 0;
  let upgrades = bindUpgrades((opts && opts.upgrades) || world.upgrades || null);
  let pipCount = 0;

  function tierOf(b) {
    const f = world.flow;
    if (f && f.filterOf) return f.filterOf(b);
    return b.filterTier;
  }

  function refresh(force) {
    if (!open || !target) return;
    // A building someone else deleted — or one this player deleted through the trash tool — must
    // not leave a panel describing it on screen.
    if (!world.buildings || !world.buildings.has(target.uid)) { close(); return; }

    const b = target;
    const def = b.def;

    if (force) {
      put(dot, 'dot|bg', tintOf(def));
      put(nameEl, 'name', def.name);
      put(famEl, 'fam', familyOf(def));
      put(effEl, 'eff', effectOf(def));
      put(effLongEl, 'effLong', longEffectOf(def));
      put(cThroughput.value, 'thru', def.family === 'dropper'
        ? `${num(1 / def.drop.rate)}s cycle`
        : `${num(def.speed)}/s`);
      put(cCell.value, 'cell', `${b.cx}, ${b.cz}${def.levels[0] === 1 ? ' · deck' : ''}`);
    }

    // Refund follows how many of this def you own, so it is live, not a constant.
    const refund = world.economy && world.economy.refundValue ? world.economy.refundValue(def) : 0;
    put(cRefund.value, 'refund', shortMoney(refund));

    // Status is the one genuinely per-frame fact about a placed machine.
    let status = '—';
    let bad = false;
    if (def.family === 'dropper') {
      bad = !!b.stalled;
      status = bad ? COPY.stalled : COPY.running;
    } else if (b.store) {
      status = `${b.store.count} / ${b.store.cap} ${COPY.held.toLowerCase()}`;
      bad = b.store.count >= b.store.cap;
    } else if (def.family === 'upgrader') {
      status = def.upg.once ? 'Once per item' : `${num(def.upg.cooldown)}s cooldown`;
    } else if (def.family === 'belt') {
      status = def.levels[0] === 1 ? 'Upper deck' : 'Ground';
    } else if (def.family === 'sell') {
      status = COPY.running;
    }
    put(cStatus.value, 'status', status);
    put(cStatus.value, 'status|cls', bad ? 'warn' : '');

    const hasFilter = !!def.filter;
    show(cMaterial.box, 'mat|show', hasFilter);
    if (hasFilter) {
      const t = ITEMS.tiers[Math.max(0, Math.min(ITEMS.tiers.length - 1, tierOf(b) | 0))];
      put(matDot, 'mat|bg', t.color);
      put(matText, 'mat', `${t.name} · ${COPY.materialHint}`);
    }

    refreshUpgrades(force);
  }

  function refreshUpgrades(force) {
    const b = target;
    const u = readUpgrade(upgrades, b);

    if (!u) {
      show(lvlRow, 'lvl|show', false);
      show(buyEl, 'buy|show', false);
      show(nextEl, 'next|show', false);
      show(noteEl, 'note|show', true);
      put(noteEl, 'note', COPY.none);
      return;
    }

    show(lvlRow, 'lvl|show', true);
    show(nextEl, 'next|show', true);

    // Pip count is a structural change, not a value change: it only ever happens when the panel is
    // pointed at a different building.
    const wantPips = Math.max(0, Math.min(12, u.max || 0));
    if (force || wantPips !== pipCount) {
      pipCount = wantPips;
      pips.textContent = '';
      for (let i = 0; i < wantPips; i += 1) el('i', null, pips);
      writes += 1;
      last.delete('pips|on');
    }
    const onKey = `${u.level}`;
    if (last.get('pips|on') !== onKey) {
      last.set('pips|on', onKey);
      writes += 1;
      const kids = pips.children;
      for (let i = 0; i < kids.length; i += 1) kids[i].className = i < u.level ? 'on' : '';
    }
    put(lvlNo, 'lvlno', u.max ? `${COPY.level} ${u.level} / ${u.max}` : `${COPY.level} ${u.level}`);

    const maxed = (u.max && u.level >= u.max) || (!u.buyable);
    const desc = u.desc || u.label || '';
    put(nextEl, 'next', maxed ? '' : (desc ? `${COPY.next}: ${desc}` : ''));

    if (maxed) {
      show(buyEl, 'buy|show', false);
      show(noteEl, 'note|show', true);
      put(noteEl, 'note', u.buyable ? COPY.maxed : COPY.none);
      return;
    }

    show(buyEl, 'buy|show', true);
    const cash = Number(world.money) || 0;
    const price = Number.isFinite(u.cost) ? u.cost : NaN;
    const afford = Number.isFinite(price) ? cash >= price : true;
    const allowed = u.can === null ? afford : (u.can && afford);
    put(buyEl, 'buy', Number.isFinite(price) ? `${COPY.buy} · ${shortMoney(price)}` : COPY.buy);
    put(buyEl, 'buy|cls', allowed ? 'vw-insp-buy' : 'vw-insp-buy off');
    const note = allowed ? '' : (u.reason || (afford ? '' : COPY.poor));
    show(noteEl, 'note|show', !!note);
    put(noteEl, 'note', note);
  }

  function buy() {
    if (!open || !target || !upgrades || !upgrades.apply) return false;
    const u = readUpgrade(upgrades, target);
    if (!u) return false;
    if (u.can === false) { world.audio?.play?.('denied'); return false; }
    if (Number.isFinite(u.cost) && (Number(world.money) || 0) < u.cost) {
      world.audio?.play?.('denied');
      return false;
    }
    const res = upgrades.apply(target);
    const ok = res !== false && res !== null;
    world.audio?.play?.(ok ? 'ui-click' : 'denied');
    refresh(false);
    return ok;
  }
  buyEl.addEventListener('click', buy);

  // --- open / close -----------------------------------------------------------

  // Deliberately NOT a close when handed nothing: `close()` is how you close. A probe that calls
  // openFor() with an empty hand should learn that nothing opened, not tear down the panel it was
  // trying to measure — which is exactly how this piece was once reported as broken.
  function openFor(b) {
    if (!b || !b.def) return false;
    if (!world.buildings || !world.buildings.has(b.uid)) {
      if (target === b) close();
      return false;
    }
    const changed = target !== b;
    target = b;
    if (changed) {
      last.clear();
      pipCount = -1;
    }
    if (!open) {
      open = true;
      root.classList.add('on');
    }
    refresh(true);
    return true;
  }

  function close() {
    if (!open) return false;
    open = false;
    target = null;
    root.classList.remove('on');
    return true;
  }

  closeEl.addEventListener('click', close);

  // --- input ------------------------------------------------------------------
  // The right-click that opens this panel belongs to placement.js. Until that hook lands, the
  // fallback below drives the panel from the same information placement already tracks
  // (`placement.hovered()`), and it retires itself permanently the first time the real hook calls
  // `openFor` — so the two can never both fire.

  const listeners = [];
  function on(t, type, fn, o) { t.addEventListener(type, fn, o); listeners.push([t, type, fn, o]); }

  let fallback = !(opts && opts.hooked);
  let press = null;
  // Did an inspect arrive during the right-press currently in flight? placement.js emits nothing for
  // empty space, so this is how "right-click the void to dismiss" survives being hooked: the gesture
  // ends, nothing was inspected, the panel goes away. placement's pointerup listener is registered
  // first and therefore runs first, but the ordering does not actually matter — if this ran first it
  // would close and the emit would immediately reopen.
  let gestureInspect = false;

  const dom = world.view && world.view.renderer ? world.view.renderer.domElement : null;

  function typing(e) {
    const t = (e && e.target) || document.activeElement;
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable === true;
  }

  on(window, 'pointerdown', (e) => {
    // Left-clicking anywhere that is not this panel dismisses it. Right presses are excluded here
    // because a right press is the gesture that OPENS the panel — closing on it first would make
    // the panel flicker on every right-click.
    if (e.button === 0 && open && !root.contains(e.target)) close();
    if (e.button !== 2) return;
    if (dom && e.target !== dom) return;
    gestureInspect = false;
    press = { x: e.clientX, y: e.clientY, t: performance.now() };
  }, true);

  on(window, 'pointerup', (e) => {
    if (e.button !== 2) return;
    const p = press;
    press = null;
    if (!p) return;
    // A right-DRAG pans the camera and is never a click. Both gates must pass.
    const moved = Math.abs(e.clientX - p.x) > INSPECTOR.clickSlopPx
      || Math.abs(e.clientY - p.y) > INSPECTOR.clickSlopPx;
    if (moved || performance.now() - p.t > INSPECTOR.clickHoldMs) return;
    if (!fallback) {
      // Hooked: placement decides what opens. All that is left here is the other half of the
      // gesture — a click that inspected nothing dismisses whatever is up.
      if (!gestureInspect) close();
      return;
    }
    // A build tool in hand means right-click still belongs to placement; the panel stays out of it.
    if (world.selected && world.selected()) return;
    const hit = world.placement && world.placement.hovered ? world.placement.hovered() : null;
    if (hit) openFor(hit);
    else close();
  }, true);

  // The browser's own menu is never what anyone wants over a game canvas, and right-click is a game
  // gesture now whichever half of this file is driving it. placement.js suppresses the menu only
  // while a build tool is up, so without this a right-click to inspect pops the OS menu over the
  // factory. Calling preventDefault twice on the same event is harmless.
  if (dom) on(dom, 'contextmenu', (e) => e.preventDefault());

  on(window, 'keydown', (e) => {
    if (e.key !== 'Escape' || typing(e)) return;
    if (open) { close(); e.stopPropagation(); }
  }, true);

  return {
    node: root,
    // The hook placement.js should call: a building opens the panel, null closes it.
    inspect(b) {
      fallback = false;
      gestureInspect = true;
      if (b) return openFor(b);
      close();
      return false;
    },
    openFor,
    close,
    buy,
    get isOpen() { return open; },
    get target() { return target; },
    get writes() { return writes; },
    // Wiring for src/sim/upgrades.js once it exists — main.js may pass it at construction instead.
    setUpgrades(api) {
      upgrades = bindUpgrades(api);
      if (open) { last.clear(); pipCount = -1; refresh(true); }
      return !!upgrades;
    },
    get hasUpgrades() { return !!upgrades; },
    update(dt) {
      if (!open) return;
      acc += dt || 0;
      if (acc < INSPECTOR.pollSeconds) return;
      acc = 0;
      refresh(false);
    },
    dispose() {
      for (const [t, type, fn, o] of listeners) t.removeEventListener(type, fn, o);
      listeners.length = 0;
      root.remove();
    },
  };
}

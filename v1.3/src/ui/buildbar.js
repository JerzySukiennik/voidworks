// Voidworks — the build catalogue: grouped tiles that teach the upgrader colour system while you shop.

import { BUILDBAR, ITEMS } from '../config.js';
import { paneColorFor } from '../world/buildings.js';
import { iconFor, groupGlyph, trashGlyph } from './buildbar-icons.js';

const C = BUILDBAR.colors;
const T = BUILDBAR.tile;
const COPY = BUILDBAR.copy;

const CSS = `
.vw-bar{position:fixed;left:0;right:0;bottom:${BUILDBAR.bottom}px;z-index:${BUILDBAR.z};
  display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;
  font-family:ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;
  color:${C.text};-webkit-font-smoothing:antialiased;transition:opacity .28s ease,transform .28s ease}
.vw-bar.off{opacity:0;transform:translateY(14px);pointer-events:none}
.vw-bar *{box-sizing:border-box}

.vw-shelf{display:flex;align-items:flex-end;gap:${T.gap}px;padding:8px 9px;pointer-events:auto;
  max-width:${BUILDBAR.maxWidth}px;background:${C.panel};border:1px solid ${C.panelEdge};border-radius:14px;
  box-shadow:0 14px 34px rgba(26,29,34,.11),0 2px 6px rgba(26,29,34,.05);backdrop-filter:blur(14px)}

.vw-tile{position:relative;width:${T.w}px;height:${T.h}px;border-radius:10px;border:1px solid ${C.tileEdge};
  background:${C.tile};display:flex;flex-direction:column;align-items:center;cursor:pointer;overflow:hidden;
  padding:3px 3px 5px;transition:background .14s ease,border-color .14s ease,transform .14s ease,opacity .18s ease}
.vw-tile:hover{background:${C.tileHover};border-color:rgba(26,29,34,.22);transform:translateY(-2px)}
.vw-tile.poor{opacity:.46}
.vw-tile.poor:hover{opacity:.82}
.vw-tile.on{background:#fff;border-color:${C.accent};box-shadow:0 0 0 2px rgba(23,201,100,.28);opacity:1}
.vw-tile-key{position:absolute;top:4px;left:6px;font-size:9px;font-weight:700;color:${C.dim};line-height:1}
.vw-tile.on .vw-tile-key{color:${C.accentDeep}}
.vw-tile-fp{position:absolute;top:4px;right:6px;font-size:8.5px;font-weight:700;letter-spacing:.04em;color:${C.dim};line-height:1}
.vw-tile>*{flex:none}
.vw-tile-art{width:100%;height:${T.art}px;margin-top:6px;display:flex;align-items:center;justify-content:center}
.vw-tile-eff{margin-top:4px;font-size:15px;font-weight:700;line-height:1;letter-spacing:-.01em;color:${C.ink};
  font-feature-settings:"tnum" 1;white-space:nowrap}
.vw-tile-name{margin-top:4px;font-size:8px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;
  line-height:11px;height:11px;color:${C.dim};text-align:center;width:100%;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
/* Price and the small caveat share one line: a caveat is always about the price you are paying. */
.vw-tile-foot{margin-top:auto;padding-top:3px;display:flex;align-items:center;justify-content:center;
  gap:5px;width:100%;height:14px}
.vw-tile-cost{font-size:11.5px;font-weight:600;color:${C.text};font-feature-settings:"tnum" 1;line-height:1}
.vw-tile.poor .vw-tile-cost{color:${C.dim};font-weight:500}
.vw-tile-note{display:flex;gap:3px;align-items:center;font-size:7.5px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;line-height:1;color:${C.dim};white-space:nowrap}
.vw-tile-note i{width:5px;height:5px;border-radius:50%;display:block;box-shadow:0 0 0 1px rgba(26,29,34,.14) inset}
.vw-shelf-gap{width:1px;align-self:stretch;margin:6px 5px;background:${C.faint};flex:none}
.vw-tile-track{position:absolute;left:0;right:0;bottom:0;height:2px;background:transparent}
.vw-tile.poor .vw-tile-track{background:rgba(26,29,34,.07)}
.vw-tile-bar{height:100%;width:0;background:${C.savings};transition:width .3s ease}

/* One persistent strip: tabs on the left, the open group's caption in the middle where the item-cap
   control used to sit (the cap belongs to the HUD), keys on the right. */
.vw-rack{display:flex;align-items:center;gap:5px;padding:4px 5px;pointer-events:auto;
  width:min(${BUILDBAR.maxWidth}px, calc(100vw - 28px));
  background:${C.panel};border:1px solid ${C.panelEdge};border-radius:12px;
  box-shadow:0 10px 26px rgba(26,29,34,.10);backdrop-filter:blur(14px)}
.vw-tab{position:relative;display:flex;align-items:center;gap:7px;height:${BUILDBAR.rackRow}px;padding:0 10px 0 8px;
  border-radius:8px;cursor:pointer;border:1px solid transparent;flex:none;
  transition:background .14s ease,border-color .14s ease}
.vw-tab:hover{background:rgba(26,29,34,.05)}
.vw-tab.on{background:#fff;border-color:${C.panelEdge};box-shadow:0 1px 3px rgba(26,29,34,.08)}
.vw-tab-art{width:26px;height:17px;display:block;flex:none;opacity:.72}
.vw-tab.on .vw-tab-art{opacity:1}
.vw-tab-label{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${C.dim};white-space:nowrap}
.vw-tab.on .vw-tab-label{color:${C.ink}}
.vw-tab-ramp{display:flex;gap:2px;margin-left:1px}
.vw-tab-ramp i{width:4px;height:4px;border-radius:1px;display:block;opacity:.55;
  box-shadow:0 0 0 .5px rgba(26,29,34,.2) inset}
.vw-tab.on .vw-tab-ramp i{opacity:1}
.vw-tab-rule{position:absolute;left:8px;right:8px;bottom:-4px;height:2px;border-radius:1px;background:transparent}
.vw-tab.on .vw-tab-rule{background:${C.accent}}

.vw-rack-sep{width:1px;height:20px;background:${C.faint};margin:0 3px;flex:none}
.vw-hint{flex:1 1 auto;min-width:130px;padding:0 6px;font-size:10.5px;line-height:1.32;color:${C.dim};
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.vw-hint b{color:${C.ink};font-weight:700}
/* Narrow screens: the key legend goes before the caption does — the tiles already print their numbers. */
@media (max-width:1200px){.vw-keys,.vw-rack-sep.for-keys{display:none}}
@media (max-width:1120px){.vw-hint{display:none}}
.vw-tool{width:${BUILDBAR.rackRow}px;height:${BUILDBAR.rackRow}px;border-radius:8px;cursor:pointer;flex:none;
  display:flex;align-items:center;justify-content:center;
  border:1px solid transparent;transition:background .14s ease}
.vw-tool:hover{background:rgba(224,82,74,.12)}
.vw-tool.on{background:rgba(224,82,74,.18);border-color:rgba(224,82,74,.4)}
.vw-tool svg{width:20px;height:20px;opacity:.7}
.vw-keys{display:flex;align-items:center;gap:4px;font-size:9px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;color:${C.dim};flex:none}
.vw-keys kbd{font:inherit;border:1px solid ${C.panelEdge};border-radius:4px;padding:2px 4px;background:rgba(255,255,255,.7)}

.vw-detail{position:fixed;z-index:${BUILDBAR.z + 1};width:288px;padding:13px 14px 12px;border-radius:13px;
  background:rgba(255,255,255,.96);border:1px solid ${C.panelEdge};pointer-events:none;opacity:0;
  box-shadow:0 18px 40px rgba(26,29,34,.16);backdrop-filter:blur(16px);transition:opacity .16s ease;
  font-family:inherit}
.vw-detail.on{opacity:1}
.vw-detail-top{display:flex;align-items:baseline;gap:8px}
.vw-detail-dot{width:9px;height:9px;border-radius:3px;flex:none;align-self:center}
.vw-detail-name{font-size:14px;font-weight:700;color:${C.ink};letter-spacing:-.01em}
.vw-detail-cost{margin-left:auto;font-size:13px;font-weight:700;font-feature-settings:"tnum" 1}
.vw-detail-fam{margin-top:3px;font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${C.dim}}
.vw-detail-desc{margin-top:8px;font-size:11.5px;line-height:1.45;color:${C.text}}
.vw-detail-grid{margin-top:10px;padding-top:9px;border-top:1px solid ${C.faint};display:grid;
  grid-template-columns:1fr 1fr;gap:7px 12px}
.vw-detail-grid div{display:flex;flex-direction:column;gap:2px}
.vw-detail-grid span{font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${C.dim}}
.vw-detail-grid b{font-size:11.5px;font-weight:600;color:${C.ink};font-feature-settings:"tnum" 1}
`;

let injected = false;
function injectStyles() {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'vw-buildbar-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const num = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');

// Prices span $25 to $1.6m; the tile keeps exact figures while they are countable and switches to
// magnitude once they stop being a number you save toward one dollar at a time.
function shortMoney(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, '')}M`;
  if (n >= 1e4) return `$${Math.round(n / 1e3)}k`;
  return money(n);
}

// Pane colours are tuned for an emissive sheet in a white void; as ink on white the pale end of both
// ramps disappears, so text takes the same hue darkened until it holds.
function readable(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  let r = (v >> 16) & 255;
  let g = (v >> 8) & 255;
  let b = v & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.52) {
    const k = Math.min(0.72, (lum - 0.44) * 1.5);
    r = Math.round(r * (1 - k));
    g = Math.round(g * (1 - k));
    b = Math.round(b * (1 - k));
  }
  return `rgb(${r},${g},${b})`;
}

function el(tag, cls, parent, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  if (parent) parent.appendChild(n);
  return n;
}

const BELT_EFFECT = {
  belt_turn: 'corner', belt_merge: '3→1', belt_split: '1→3',
  belt_ramp_up: 'up', belt_ramp_down: 'down', belt_elev: 'deck',
};

// The headline is the number a player compares two entries by; where there is no number it is the
// tersest possible verb. Nothing here is decorative.
function effectOf(def) {
  if (def.family === 'dropper') return `${num(def.drop.rate)}/s`;
  if (def.family === 'belt') return BELT_EFFECT[def.id] || `${num(def.speed)}/s`;
  if (def.family === 'upgrader') {
    if (def.upg.kind === 'tier') return 'tier +1';
    if (def.upg.kind === 'flat') return `+${def.upg.amount}`;
    return `×${def.upg.amount}`;
  }
  if (def.id === 'sellpad') return 'sell';
  if (def.store) return `${def.store.cap} held`;
  if (def.fuse) return `4 → 1`;
  return '';
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
  if (def.id === 'sellpad') return 'Converts an item to money, frees its slot';
  if (def.store) return `Holds ${def.store.cap}, releases ${def.store.rate}/s`;
  if (def.fuse) return `4 items → 1 of the next tier at ×${def.fuse.bonus}`;
  return '—';
}

function familyOf(def) {
  if (def.family === 'upgrader') return def.kind === 'add' ? COPY.familyAdd : COPY.familyMult;
  if (def.family === 'dropper') return 'Dropper · source';
  if (def.family === 'belt') return 'Conveyor · transport';
  return 'Terminal · end of line';
}

function groupIdOf(def) {
  if (def.family === 'upgrader') return def.kind === 'add' ? 'add' : 'mult';
  if (def.family === 'dropper') return 'dropper';
  if (def.family === 'belt') return 'belt';
  return 'end';
}

export function createBuildbar(world) {
  injectStyles();

  const root = el('div', 'vw-bar', document.body);
  const shelf = el('div', 'vw-shelf', root);
  const rack = el('div', 'vw-rack', root);
  const detail = el('div', 'vw-detail', document.body);

  // Cost order is the progression ladder, and for the ramp entries it is also the colour ramp — so the
  // two off-ramp machines (gold tier, red gamble) are pushed past a divider instead of breaking it.
  const special = (d) => (d.upg && (d.upg.kind === 'tier' || d.upg.destroy) ? 1 : 0);
  const defs = world.catalogue.slice().sort((a, b) => special(a) - special(b) || a.cost - b.cost);
  const groups = BUILDBAR.groups.map((g) => ({ ...g, defs: defs.filter((d) => groupIdOf(d) === g.id) }))
    .filter((g) => g.defs.length);

  let open = groups[0].id;
  let selected = null;
  let deleting = false;
  let hovered = null;
  const tiles = new Map();

  // --- tabs -------------------------------------------------------------------

  const tabs = new Map();
  for (const g of groups) {
    const tab = el('div', 'vw-tab', rack);
    el('div', 'vw-tab-art', tab, groupGlyph(g.id));
    el('div', 'vw-tab-label', tab, g.name);
    if (g.ramp) {
      const ramp = el('div', 'vw-tab-ramp', tab);
      for (const c of g.ramp) el('i', null, ramp).style.background = c;
    }
    el('div', 'vw-tab-rule', tab);
    tab.addEventListener('click', () => openGroup(g.id));
    tab.addEventListener('mouseenter', () => { hint.innerHTML = groupHint(g); });
    tab.addEventListener('mouseleave', () => { hint.innerHTML = groupHint(current()); });
    tabs.set(g.id, tab);
  }

  el('div', 'vw-rack-sep', rack);

  const hint = el('div', 'vw-hint', rack);

  el('div', 'vw-rack-sep', rack);

  const tool = el('div', 'vw-tool', rack, trashGlyph());
  tool.title = `${COPY.remove} — ${COPY.removeHint}`;
  tool.addEventListener('click', () => setDelete(!deleting));

  el('div', 'vw-rack-sep for-keys', rack);

  const keys = el('div', 'vw-keys', rack);
  el('kbd', null, keys, '1–9');
  el('span', null, keys, COPY.keysNote);
  el('kbd', null, keys, 'Tab');
  el('span', null, keys, COPY.keysGroupNote);
  el('kbd', null, keys, 'R');
  el('span', null, keys, COPY.keysRotateNote);

  // --- tiles ------------------------------------------------------------------

  function buildTiles() {
    shelf.textContent = '';
    tiles.clear();
    const g = current();
    g.defs.forEach((def, i) => {
      const color = def.family === 'upgrader' ? paneColorFor(def.upg) : g.tint;
      if (i > 0 && special(def) > special(g.defs[i - 1])) el('div', 'vw-shelf-gap', shelf);
      const node = el('div', 'vw-tile', shelf);
      el('div', 'vw-tile-key', node, String(i + 1));
      if (def.cells.length > 1) el('div', 'vw-tile-fp', node, '2×2');
      el('div', 'vw-tile-art', node, iconFor(def, color));
      const eff = el('div', 'vw-tile-eff', node, effectOf(def));
      if (def.family === 'upgrader') eff.style.color = readable(color);
      const nameEl = el('div', 'vw-tile-name', node, def.name);
      nameEl.title = def.name;
      const foot = el('div', 'vw-tile-foot', node);
      const cost = el('div', 'vw-tile-cost', foot, '');
      const note = el('div', 'vw-tile-note', foot);
      if (def.family === 'dropper') {
        for (let t = def.drop.min; t <= def.drop.max; t += 1) {
          el('i', null, note).style.background = ITEMS.tiers[t].color;
        }
      } else if (def.upg && def.upg.destroy) {
        note.textContent = `${Math.round(def.upg.destroy * 100)}% loss`;
        note.style.color = C.risk;
      } else if (def.upg && def.upg.once) {
        note.textContent = 'once';
      } else if (def.fuse) {
        note.textContent = `×${def.fuse.bonus}`;
      }
      const bar = el('div', 'vw-tile-bar', el('div', 'vw-tile-track', node));

      node.addEventListener('click', () => pick(def.id));
      node.addEventListener('mouseenter', () => showDetail(def, node, color));
      node.addEventListener('mouseleave', () => hideDetail(def));
      tiles.set(def.id, { def, node, cost, bar, state: null, fill: -1 });
    });
  }

  // --- state ------------------------------------------------------------------

  function current() { return groups.find((g) => g.id === open) || groups[0]; }

  function groupHint(g) {
    const i = g.hint.indexOf('. ');
    return i < 0 ? g.hint : `<b>${g.hint.slice(0, i + 1)}</b> ${g.hint.slice(i + 2)}`;
  }

  function openGroup(id) {
    if (open === id) return;
    open = id;
    for (const [gid, tab] of tabs) tab.classList.toggle('on', gid === open);
    hint.innerHTML = groupHint(current());
    buildTiles();
    if (selected && tiles.has(selected)) tiles.get(selected).node.classList.add('on');
    refresh(true);
  }

  function cycleGroup(dir) {
    const i = groups.findIndex((g) => g.id === open);
    openGroup(groups[(i + dir + groups.length) % groups.length].id);
  }

  function setDelete(on) {
    deleting = on;
    world.select(on ? 'delete' : null);
    syncSelection(true);
  }

  function pick(id) {
    deleting = false;
    world.select(selected === id ? null : id);
    syncSelection(true);
  }

  function syncSelection(force) {
    const now = world.selected ? world.selected() : null;
    const isDelete = now === 'delete';
    const next = isDelete ? null : now;
    if (!force && next === selected && isDelete === deleting) return;
    selected = next;
    deleting = isDelete;
    for (const [id, t] of tiles) t.node.classList.toggle('on', id === selected);
    tool.classList.toggle('on', deleting);
    if (selected) {
      const g = groups.find((gr) => gr.defs.some((d) => d.id === selected));
      if (g && g.id !== open) openGroup(g.id);
    }
  }

  // --- affordability: written only when a threshold is actually crossed --------

  function refresh(force) {
    const cash = world.money;
    for (const t of tiles.values()) {
      const price = world.priceOf(t.def.id);
      const afford = cash >= price;
      const sig = `${afford ? 1 : 0}|${price}`;
      if (force || sig !== t.state) {
        t.state = sig;
        t.cost.textContent = shortMoney(price);
        t.node.classList.toggle('poor', !afford);
      }
      const fill = afford ? 100 : Math.round((cash / price) * 100);
      if (force || Math.abs(fill - t.fill) >= 2) {
        t.fill = fill;
        t.bar.style.width = afford ? '0%' : `${fill}%`;
      }
    }
  }

  // --- hover detail -----------------------------------------------------------

  function showDetail(def, node, color) {
    hovered = def.id;
    const price = world.priceOf(def.id);
    const afford = world.money >= price;
    const rows = [
      [COPY.effect, longEffectOf(def)],
      [COPY.cost, money(price)],
      [COPY.footprint, `${def.cells.length > 1 ? '2 × 2' : '1 × 1'}${def.rotatable ? '' : ' · fixed'}`],
      [def.family === 'dropper' ? 'Cycle' : COPY.throughput,
        def.family === 'dropper' ? `${num(1 / def.drop.rate)}s` : `${num(def.speed)}/s`],
    ];
    detail.innerHTML = `<div class="vw-detail-top"><i class="vw-detail-dot" style="background:${color}"></i>`
      + `<div class="vw-detail-name">${def.name}</div>`
      + `<div class="vw-detail-cost" style="color:${afford ? C.accentDeep : C.dim}">${money(price)}</div></div>`
      + `<div class="vw-detail-fam">${familyOf(def)}</div>`
      + `<div class="vw-detail-desc">${def.desc}</div>`
      + `<div class="vw-detail-grid">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
    const r = node.getBoundingClientRect();
    const w = 288;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    detail.style.left = `${left}px`;
    detail.style.top = '0px';
    detail.classList.add('on');
    detail.style.top = `${Math.max(12, r.top - detail.offsetHeight - 10)}px`;
  }

  function hideDetail(def) {
    if (def && hovered !== def.id) return;
    hovered = null;
    detail.classList.remove('on');
  }

  // --- keyboard ---------------------------------------------------------------

  function typing() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  }

  function onKey(e) {
    if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { deleting = false; syncSelection(true); return; }
    // Q and E belong to the camera: they snap-rotate the world, and a player spinning the view was
    // silently flipping build groups underneath the cursor. Tab cycles groups instead.
    if (e.key === 'Tab') { cycleGroup(e.shiftKey ? -1 : 1); e.preventDefault(); return; }
    if (e.key >= '1' && e.key <= '9') {
      const list = current().defs;
      const d = list[Number(e.key) - 1];
      if (d) { pick(d.id); e.preventDefault(); }
    }
  }
  window.addEventListener('keydown', onKey);

  // --- poll: no per-frame DOM writes, only threshold crossings -----------------

  let acc = 0;
  let visible = true;

  tabs.get(open).classList.add('on');
  hint.innerHTML = groupHint(current());
  buildTiles();
  refresh(true);
  syncSelection(true);

  return {
    node: root,
    update(dt) {
      if (!visible) return;
      acc += dt || 0;
      if (acc < BUILDBAR.pollSeconds) return;
      acc = 0;
      syncSelection(false);
      refresh(false);
    },
    show() { visible = true; root.classList.remove('off'); },
    hide() { visible = false; root.classList.add('off'); hideDetail(null); },
    openGroup,
    dispose() {
      window.removeEventListener('keydown', onKey);
      root.remove();
      detail.remove();
    },
  };
}

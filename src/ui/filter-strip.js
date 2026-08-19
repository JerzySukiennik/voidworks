// Voidworks — the sorter's material control.
//
// The tier-routing engine was finished, tested and completely inert: `flow.setFilter` existed, the
// F hotkey in placement.js called it, and there was nothing on screen that named the hotkey, showed
// which material a sorter was set to, or let a mouse change it. The most interesting machine in the
// game was a belt that did something invisible.
//
// This is deliberately NOT a panel. It is one strip that exists only while a filterable machine is
// under the pointer, sitting above the buildbar where the eye already is when building. It carries
// exactly three things: which machine, which material, and how to change it — seven swatches and
// the letter F. Nothing about it is on screen when there is no sorter under the cursor.
//
// It never runs a raycast of its own: `placement.hovered()` reads the cell the build system already
// tracked on the last pointermove, so hovering costs a map lookup at 10 Hz.

import { ITEMS, SURFACE } from '../config.js';
import { hasFilter, filterColorFor } from '../world/buildings.js';

const C = SURFACE.colors;
const F = SURFACE.filter;
const STYLE_ID = 'vw-filter-css';

const CSS = `
.vw-filter{position:fixed;left:0;right:0;bottom:${F.bottom}px;z-index:7;display:flex;justify-content:center;
  pointer-events:none;opacity:0;transform:translateY(6px);transition:opacity .16s ease,transform .16s ease;
  font-family:ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.vw-filter.on{opacity:1;transform:translateY(0)}
.vw-filter-in{pointer-events:auto;display:flex;align-items:center;gap:9px;padding:5px 9px;border-radius:11px;
  background:${C.panel};border:1px solid ${C.panelEdge};box-shadow:0 10px 26px rgba(26,29,34,.10);
  backdrop-filter:blur(14px)}
.vw-filter-what{font-size:9px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:${C.dim};
  white-space:nowrap}
.vw-filter-now{font-size:11.5px;font-weight:700;color:${C.ink};white-space:nowrap;min-width:66px}
.vw-filter-swatches{display:flex;gap:4px}
.vw-filter-sw{width:${F.swatch}px;height:${F.swatch}px;border-radius:5px;cursor:pointer;border:0;padding:0;
  box-shadow:0 0 0 1px rgba(26,29,34,.16) inset;opacity:.55;transition:opacity .12s ease,transform .12s ease}
.vw-filter-sw:hover{opacity:1;transform:translateY(-1px)}
.vw-filter-sw.on{opacity:1;box-shadow:0 0 0 1.5px ${C.ink},0 0 0 3.5px rgba(255,255,255,.9)}
.vw-filter-key{display:flex;align-items:center;gap:4px;font-size:9px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;color:${C.dim}}
.vw-filter-key kbd{font:inherit;border:1px solid ${C.panelEdge};border-radius:4px;padding:2px 5px;
  background:rgba(255,255,255,.7)}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function createFilterStrip(world) {
  injectStyles();

  const root = document.createElement('div');
  root.className = 'vw-filter';
  root.dataset.vwFilter = 'off';
  const box = document.createElement('div');
  box.className = 'vw-filter-in';
  const what = document.createElement('div');
  what.className = 'vw-filter-what';
  const now = document.createElement('div');
  now.className = 'vw-filter-now';
  const swatches = document.createElement('div');
  swatches.className = 'vw-filter-swatches';
  const key = document.createElement('div');
  key.className = 'vw-filter-key';
  key.innerHTML = `<kbd>${SURFACE.copy.filterHint}</kbd><span>material</span>`;
  box.append(what, now, swatches, key);
  root.appendChild(box);
  document.body.appendChild(root);

  const buttons = ITEMS.tiers.map((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vw-filter-sw';
    b.dataset.tier = String(i);
    b.title = t.name;
    b.style.background = filterColorFor(i);
    b.addEventListener('click', () => set(i));
    swatches.appendChild(b);
    return b;
  });

  // The machine the strip is currently describing. Latched rather than read live, because the
  // moment the cursor leaves the sorter to reach a swatch the hover is gone — without the latch the
  // strip would delete itself on the way to being clicked.
  let target = null;
  let hold = 0;
  let inside = false;
  let visible = false;
  let wanted = true;
  let acc = 0;
  let lastName = '';
  let lastTier = -1;

  box.addEventListener('pointerenter', () => { inside = true; });
  box.addEventListener('pointerleave', () => { inside = false; hold = F.hold; });

  function set(t) {
    if (!target) return;
    const applied = world.flow.setFilter(target, t);
    world.audio?.play?.(applied >= 0 ? 'ui-click' : 'denied');
    paint(true);
  }

  function show(on) {
    if (on === visible) return;
    visible = on;
    root.classList.toggle('on', on);
    root.dataset.vwFilter = on ? 'on' : 'off';
  }

  // Writes only when the machine or its setting actually changed. Called from a 10 Hz poll, so on a
  // still cursor over a sorter this does nothing at all.
  function paint(force) {
    if (!target) return;
    const tier = world.flow.filterOf(target);
    if (!force && target.def.name === lastName && tier === lastTier) return;
    lastName = target.def.name;
    lastTier = tier;
    what.textContent = target.def.name;
    now.textContent = ITEMS.tiers[tier].name;
    now.style.color = C.ink;
    for (let i = 0; i < buttons.length; i += 1) buttons[i].classList.toggle('on', i === tier);
  }

  function drop() {
    target = null;
    lastName = '';
    lastTier = -1;
    show(false);
  }

  function update(dt) {
    if (!wanted) return;
    acc += dt || 0;
    if (acc < SURFACE.filterPoll) return;
    acc = 0;

    const hovered = world.placement && world.placement.hovered ? world.placement.hovered() : null;
    if (hovered && hasFilter(hovered.def)) {
      if (hovered !== target) {
        target = hovered;
        paint(true);
      } else {
        paint(false);
      }
      hold = F.hold;
      show(true);
      return;
    }

    if (!target) return;
    // The machine can be deleted out from under the strip; a target that is no longer in the world
    // is dropped at once rather than left describing a hole in the factory.
    if (!world.buildings.has(target.uid)) { drop(); return; }
    if (inside) { hold = F.hold; paint(false); return; }
    hold -= SURFACE.filterPoll;
    if (hold <= 0) drop();
    else paint(false);
  }

  // The F hotkey lives in placement.js and calls this hook if it exists. Chained rather than
  // assigned, so whatever else in the UI wants to know about a filter change keeps working.
  const prevHook = world.onFilterChanged;
  world.onFilterChanged = (b, t) => {
    if (typeof prevHook === 'function') prevHook(b, t);
    if (b && hasFilter(b.def)) {
      target = b;
      hold = F.hold;
      show(true);
      paint(true);
    }
  };

  return {
    node: root,
    update,
    // Test/debug surface: what the strip currently describes, without scraping the DOM.
    get target() { return target; },
    get shown() { return visible; },
    setVisible(on) {
      wanted = !!on;
      if (!wanted) drop();
    },
    destroy() {
      if (world.onFilterChanged && prevHook !== undefined) world.onFilterChanged = prevHook;
      root.remove();
    },
  };
}

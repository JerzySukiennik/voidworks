// Voidworks — orders, made visible.
//
// The order engine ran from the first frame and no player could ever have known: a contract was
// issued, counted down and expired without a single pixel changing. This is the smallest thing that
// fixes that, and it is deliberately not a panel — no card, no border, no shadow, no backdrop. One
// dim caption in the top-left corner and one row per live slot, drawn as text on the void the same
// way the money is.
//
// A row says the four things a contract is: what it wants, how much of it has landed, what it pays,
// and how long is left. The rail underneath is the delivery progress, not the clock — the clock is
// the number, because "1:42" is readable at a glance and a shrinking bar is not.
//
// The countdown is the only thing here that changes on its own, and it is written at most four
// times a second and only when the printed second has actually changed.

import { SURFACE } from '../config.js';

const C = SURFACE.colors;
const O = SURFACE.orders;
const STYLE_ID = 'vw-orders-css';

const CSS = `
.vw-orders{position:fixed;top:${O.top}px;left:${O.left}px;z-index:6;pointer-events:none;
  display:flex;flex-direction:column;gap:7px;min-width:${O.rail + 74}px;
  font-family:ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;
  font-variant-numeric:tabular-nums lining-nums;-webkit-font-smoothing:antialiased;
  opacity:1;transition:opacity .28s ease}
.vw-orders.is-hidden{opacity:0}
.vw-orders-title{font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${C.dim}}
.vw-order{display:flex;flex-direction:column;gap:4px}
.vw-order.gone{display:none}
.vw-order-line{display:flex;align-items:baseline;gap:6px;font-size:11.5px;line-height:1;color:${C.text}}
.vw-order-dot{width:7px;height:7px;border-radius:2px;flex:none;align-self:center;
  box-shadow:0 0 0 1px rgba(26,29,34,.16) inset}
.vw-order-name{font-weight:700;color:${C.ink}}
.vw-order-need{color:${C.dim};font-weight:600}
.vw-order-clock{margin-left:auto;font-weight:600;color:${C.dim}}
.vw-order-clock.soon{color:${C.warn}}
.vw-order-rail{width:${O.rail}px;height:2px;border-radius:1px;background:rgba(26,29,34,.09)}
.vw-order-fill{height:100%;width:0;border-radius:1px;transition:width .3s ease}
.vw-orders-note{font-size:10.5px;line-height:1.3;color:${C.dim};max-width:${O.rail + 74}px}
.vw-orders-note.win{color:${C.accentDeep};font-weight:600}
.vw-orders-note.gone{display:none}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s - m * 60).padStart(2, '0')}`;
}

function short(n) {
  const v = Math.round(n);
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e4) return `$${Math.round(v / 1e3)}k`;
  return `$${v.toLocaleString('en-US')}`;
}

export function createOrdersPanel(world) {
  injectStyles();

  const orders = world.orders;
  const root = document.createElement('div');
  root.className = 'vw-orders';
  const title = document.createElement('div');
  title.className = 'vw-orders-title';
  title.textContent = SURFACE.copy.ordersTitle;
  root.appendChild(title);

  // One row per slot, built once and reused. A slot that is empty hides its row rather than
  // destroying it — a contract board that reflowed every twenty seconds would be the loudest thing
  // on a screen whose whole point is that it is quiet.
  const rows = [];
  for (let i = 0; i < orders.slotCount; i += 1) {
    const row = document.createElement('div');
    row.className = 'vw-order gone';
    row.dataset.slot = String(i);
    const line = document.createElement('div');
    line.className = 'vw-order-line';
    const dot = document.createElement('i');
    dot.className = 'vw-order-dot';
    const name = document.createElement('span');
    name.className = 'vw-order-name';
    const need = document.createElement('span');
    need.className = 'vw-order-need';
    const clockEl = document.createElement('span');
    clockEl.className = 'vw-order-clock';
    line.append(dot, name, need, clockEl);
    const rail = document.createElement('div');
    rail.className = 'vw-order-rail';
    const fill = document.createElement('i');
    fill.className = 'vw-order-fill';
    rail.appendChild(fill);
    row.append(line, rail);
    root.appendChild(row);
    rows.push({ row, dot, name, need, clock: clockEl, fill, id: -1, txt: '', time: '', pct: -1, soon: null });
  }

  const note = document.createElement('div');
  note.className = 'vw-orders-note gone';
  root.appendChild(note);
  document.body.appendChild(root);

  let acc = 0;
  let noteLeft = 0;
  let wanted = true;
  let hidden = false;

  // Events are the only reason this module allocates anything, and they fire twice a minute at most.
  const off = orders.on((kind, order, payout) => {
    if (kind === 'completed') {
      note.textContent = `${order.name} order filled · +${short(payout)}`;
      note.classList.add('win');
    } else if (kind === 'expired') {
      note.textContent = `${order.name} order expired · no penalty`;
      note.classList.remove('win');
    } else return;
    note.classList.remove('gone');
    noteLeft = O.flashSeconds;
  });

  function applyVisible() {
    root.classList.toggle('is-hidden', !wanted || hidden);
  }

  function paint() {
    const live = orders.active();
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const o = live[i] || null;
      if (!o) {
        if (r.id !== -1) { r.id = -1; r.row.classList.add('gone'); }
        continue;
      }
      if (o.id !== r.id) {
        r.id = o.id;
        r.row.classList.remove('gone');
        r.dot.style.background = o.color;
        r.fill.style.background = o.color;
        r.name.textContent = o.name;
        r.txt = '';
        r.pct = -1;
      }
      const txt = `${o.done}/${o.need} · +${short(o.bonus)}`;
      if (txt !== r.txt) { r.txt = txt; r.need.textContent = txt; }

      const left = orders.timeLeft(o);
      const t = clock(left);
      if (t !== r.time) { r.time = t; r.clock.textContent = t; }
      const soon = left <= 20;
      if (soon !== r.soon) { r.soon = soon; r.clock.classList.toggle('soon', soon); }

      const pct = Math.round(orders.progress(o) * 100);
      if (Math.abs(pct - r.pct) >= 1) { r.pct = pct; r.fill.style.width = `${pct}%`; }
    }
  }

  paint();

  return {
    node: root,
    update(dt) {
      if (!wanted || hidden) return;
      if (noteLeft > 0) {
        noteLeft -= dt || 0;
        if (noteLeft <= 0) note.classList.add('gone');
      }
      acc += dt || 0;
      if (acc < SURFACE.ordersPoll) return;
      acc = 0;
      paint();
    },
    // The HUD hides everything behind a front screen; orders ride with it.
    setScreenOpen(on) { hidden = !!on; applyVisible(); },
    setVisible(on) { wanted = !!on; applyVisible(); },
    destroy() { off(); root.remove(); },
  };
}

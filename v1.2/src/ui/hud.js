// Voidworks — HUD: plain green money top centre, with the rate and the item cap kept quiet beneath it.

import { HUD } from '../config.js';

const STYLE_ID = 'vw-hud-style';

const CSS = `
.vw-hud{position:fixed;top:${HUD.top}px;left:0;right:0;z-index:6;pointer-events:none;
display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center;
font-family:ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;
font-feature-settings:"tnum" 1,"lnum" 1;font-variant-numeric:tabular-nums lining-nums;
-webkit-font-smoothing:antialiased;transition:opacity ${HUD.fadeSeconds}s ease}
.vw-hud.is-hidden{opacity:0}
.vw-hud-money{font-size:${HUD.moneySize};font-weight:${HUD.moneyWeight};line-height:1;
letter-spacing:.005em;color:${HUD.money};text-shadow:0 1px 2px rgba(26,29,34,.10)}
.vw-hud-rate{font-size:13px;font-weight:500;letter-spacing:.12em;color:${HUD.rate}}
.vw-hud-cap{display:flex;align-items:baseline;gap:7px;font-size:11.5px;letter-spacing:.14em;
text-transform:uppercase;color:${HUD.quiet}}
.vw-hud-cap.is-stalled{color:${HUD.stall}}
.vw-hud-buy{pointer-events:auto;cursor:pointer;background:none;border:0;padding:0 1px;font:inherit;
color:${HUD.quiet};opacity:.8;transition:opacity .16s ease,color .16s ease}
.vw-hud-buy:hover{opacity:1;color:${HUD.money}}
.vw-hud-buy.is-poor{opacity:.3;cursor:default}
.vw-hud-buy.is-poor:hover{color:${HUD.quiet}}
.vw-hud-buy.is-gone{display:none}
.vw-hud-cap.is-stalled .vw-hud-buy{color:${HUD.stall};opacity:1}
.vw-hud-cap.is-stalled .vw-hud-buy.is-poor{opacity:.45}
.vw-hud-stall{font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:${HUD.stall};
opacity:0;transition:opacity .3s ease}
.vw-hud-stall.is-on{animation:vw-hud-breathe 2.6s ease-in-out infinite}
@keyframes vw-hud-breathe{0%,100%{opacity:.5}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.vw-hud-stall.is-on{animation:none;opacity:.9}}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

function amount(value) {
  const n = Math.floor(value);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString('en-US');
}

export function createHud(world) {
  injectStyles();

  const node = document.createElement('div');
  node.className = 'vw-hud';

  const moneyEl = document.createElement('div');
  moneyEl.className = 'vw-hud-money';
  const rateEl = document.createElement('div');
  rateEl.className = 'vw-hud-rate';
  const capEl = document.createElement('div');
  capEl.className = 'vw-hud-cap';
  const capText = document.createElement('span');
  const buyEl = document.createElement('button');
  buyEl.className = 'vw-hud-buy';
  buyEl.type = 'button';
  capEl.append(capText, buyEl);
  const stallEl = document.createElement('div');
  stallEl.className = 'vw-hud-stall';
  stallEl.textContent = 'at capacity · droppers paused';
  node.append(moneyEl, rateEl, capEl, stallEl);
  document.body.appendChild(node);

  let shown = 0;
  let money = Number(world.money) || 0;
  let lastMoney = '';
  let lastRate = '';
  let lastCap = '';
  let lastBuy = '';
  let stalled = null;
  let poor = null;
  let atMax = null;
  let wanted = true;
  let screenOpen = false;
  let probe = 0;

  // The menu is expected to call setVisible(false), but a front screen must never have money
  // showing through it, so the HUD also checks for a painted .vw-screen five times a second.
  function screenIsUp() {
    const screen = document.querySelector('.vw-screen');
    if (!screen || !screen.getClientRects().length) return false;
    return parseFloat(getComputedStyle(screen).opacity) > 0.02;
  }

  function applyVisible() {
    node.classList.toggle('is-hidden', !wanted || screenOpen);
  }

  function buy() {
    const bought = world.buyCapacity && world.buyCapacity();
    world.audio?.play?.(bought ? 'ui-click' : 'denied');
  }
  buyEl.addEventListener('click', buy);

  function update(dt) {
    probe -= dt;
    if (probe <= 0) {
      probe = 0.2;
      const up = screenIsUp();
      if (up !== screenOpen) {
        screenOpen = up;
        applyVisible();
      }
    }

    const target = Number(world.money) || 0;
    const step = dt > 0 ? 1 - Math.exp(-dt / HUD.rollTau) : 1;
    money += (target - money) * step;
    if (Math.abs(target - money) < 0.5) money = target;
    shown = money;

    // Behind a front screen the numbers keep rolling but nothing is painted.
    if (!wanted || screenOpen) return;

    const moneyText = `$${amount(shown)}`;
    if (moneyText !== lastMoney) {
      lastMoney = moneyText;
      moneyEl.textContent = moneyText;
    }

    const rateText = `+$${amount(world.moneyPerSecond || 0)}/s`;
    if (rateText !== lastRate) {
      lastRate = rateText;
      rateEl.textContent = rateText;
    }

    const count = world.itemCount | 0;
    const cap = world.itemCap | 0;
    const capMaxed = cap >= (world.itemCapMax | 0);
    const capText2 = `${count} / ${cap} items`;
    if (capText2 !== lastCap) {
      lastCap = capText2;
      capText.textContent = capText2;
    }

    const isStalled = !!world.stalled;
    if (isStalled !== stalled) {
      stalled = isStalled;
      capEl.classList.toggle('is-stalled', isStalled);
      stallEl.classList.toggle('is-on', isStalled);
    }

    if (capMaxed !== atMax) {
      atMax = capMaxed;
      buyEl.classList.toggle('is-gone', capMaxed);
    }
    if (!capMaxed) {
      const price = (world.capacityPrice && world.capacityPrice()) || 0;
      const buyText = `· raise cap $${amount(price)}`;
      if (buyText !== lastBuy) {
        lastBuy = buyText;
        buyEl.textContent = buyText;
      }
      const cannot = target < price;
      if (cannot !== poor) {
        poor = cannot;
        buyEl.classList.toggle('is-poor', cannot);
      }
    }
  }

  function setVisible(on) {
    wanted = !!on;
    applyVisible();
  }

  function destroy() {
    buyEl.removeEventListener('click', buy);
    node.remove();
  }

  update(0);
  return { node, update, setVisible, destroy };
}

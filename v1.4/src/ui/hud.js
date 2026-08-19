// Voidworks — HUD: plain green money top centre, with the rate and the item cap kept quiet beneath it.
//
// Two long-game readouts hang off the bottom of that same column, and both are conditional by
// design — neither has a permanent home, because neither has something to say most of the time:
//
//   PRESTIGE  appears the moment `economy.canPrestige()` turns true and vanishes the moment the
//             reset is spent. It gets no button of its own. A reset is available perhaps once an
//             hour; a control that is dead for the other fifty-nine minutes teaches the player to
//             stop reading that part of the screen, which is worse than not having it. In a room it
//             is still shown and still clickable — `world.prestige()` answers `{refused:'coop'}` and
//             the line says so out loud, because a feature that silently does nothing reads as a bug.
//
//   AWAY      appears once, on return from an absence, and then never again for that absence. The
//             useful half is `capped`: it tells a returning player that their BELT, not their
//             droppers, decided what those hours were worth.
//
// The HUD also owns the two pieces that had nowhere else to live — the sorter's material strip and
// the orders board — so that the menu's existing hide/show of `window.vw.hud` carries all of them
// at once and main.js needs no new wiring.

import { HUD, SURFACE } from '../config.js';
import { createFilterStrip } from './filter-strip.js';
import { createOrdersPanel } from './orders-panel.js';

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
/* Plain text with an underline, not a pill. The money above it is plain green text and the sell pad
   is deliberately the plainest object in the game; a bordered green chip under the money would have
   been the loudest thing on the screen for a control the player uses once an hour. */
.vw-hud-pres{pointer-events:auto;cursor:pointer;background:none;border:0;padding:1px 2px;font:inherit;
margin-top:3px;font-size:11.5px;font-weight:600;letter-spacing:.01em;color:${SURFACE.colors.accentDeep};
text-decoration:underline;text-decoration-color:rgba(14,159,76,.34);text-underline-offset:3px;
transition:text-decoration-color .16s ease,opacity .2s ease;display:none}
.vw-hud-pres.is-on{display:block}
.vw-hud-pres:hover{text-decoration-color:${SURFACE.colors.accentDeep}}
.vw-hud-pres.is-refused{color:${SURFACE.colors.warn};cursor:default;text-decoration:none}
.vw-hud-away{pointer-events:auto;cursor:pointer;margin-top:3px;max-width:min(520px,86vw);
font-size:11.5px;line-height:1.42;color:${HUD.quiet};display:none;opacity:0;transition:opacity .35s ease}
.vw-hud-away.is-on{display:block;opacity:1}
.vw-hud-away b{color:${SURFACE.colors.ink};font-weight:700}
.vw-hud-away i{font-style:normal;color:${SURFACE.colors.warn};font-weight:600}
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
  const presEl = document.createElement('button');
  presEl.className = 'vw-hud-pres';
  presEl.type = 'button';
  presEl.dataset.vwPrestige = 'off';
  const awayEl = document.createElement('div');
  awayEl.className = 'vw-hud-away';
  awayEl.dataset.vwAway = 'off';
  node.append(moneyEl, rateEl, capEl, stallEl, presEl, awayEl);
  document.body.appendChild(node);

  // Owned by the HUD only in the sense that something has to update them and hide them behind the
  // menu; neither reaches back into this file.
  const filterStrip = createFilterStrip(world);
  const ordersPanel = createOrdersPanel(world);

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
    filterStrip.setVisible(wanted && !screenOpen);
    ordersPanel.setVisible(wanted);
    ordersPanel.setScreenOpen(screenOpen);
  }

  function buy() {
    const bought = world.buyCapacity && world.buyCapacity();
    world.audio?.play?.(bought ? 'ui-click' : 'denied');
  }
  buyEl.addEventListener('click', buy);

  // --- prestige ---------------------------------------------------------------

  let presOn = false;
  let presText = '';
  let refusal = 0;
  let presPoll = 0;

  function showPres(on) {
    if (on === presOn) return;
    presOn = on;
    presEl.classList.toggle('is-on', on);
    presEl.dataset.vwPrestige = on ? 'on' : 'off';
  }

  function refuse(reason) {
    refusal = SURFACE.prestige.refusalSeconds;
    presText = reason;
    presEl.textContent = reason;
    presEl.classList.add('is-refused');
    showPres(true);
    presEl.dataset.vwPrestige = 'refused';
  }

  function doPrestige() {
    if (refusal > 0) return;
    const res = world.prestige ? world.prestige() : null;
    if (res && res.refused === 'coop') {
      world.audio?.play?.('denied');
      refuse(SURFACE.copy.prestigeCoop);
      return;
    }
    if (!res) {
      world.audio?.play?.('denied');
      refuse('not enough earned this run yet');
      return;
    }
    world.audio?.play?.('ui-click');
    // The run is gone: money, capacity and the price curve all reset, so the rolling money display
    // is snapped rather than left easing down from a number that no longer exists.
    money = Number(world.money) || 0;
    lastMoney = '';
    presText = '';
    showPres(false);
  }
  presEl.addEventListener('click', doPrestige);

  function updatePrestige(dt) {
    if (refusal > 0) {
      refusal -= dt;
      if (refusal > 0) return;
      presEl.classList.remove('is-refused');
      presText = '';
      showPres(false);
    }
    presPoll -= dt;
    if (presPoll > 0) return;
    presPoll = SURFACE.hudPoll;
    const eco = world.economy;
    if (!eco || !eco.canPrestige || !eco.canPrestige()) { showPres(false); return; }
    const gain = eco.prestigeGain();
    const want = `${SURFACE.copy.prestige} ${gain} ${gain === 1 ? SURFACE.copy.prestigePoint : SURFACE.copy.prestigePoints}`
      + ` · +${Math.round(gain * 25)}% sale value`;
    if (want !== presText) {
      presText = want;
      presEl.textContent = want;
    }
    showPres(true);
  }

  // --- the away summary: once, then gone --------------------------------------
  // Taken on the first update rather than at construction so that a world still restoring its save
  // has finished applying it. `takeAway()` clears the economy's copy, which is what makes this
  // un-repeatable by construction: there is no second report to show.

  let awayLeft = 0;
  let awayTaken = false;

  function hideAway() {
    awayLeft = 0;
    awayEl.classList.remove('is-on');
    awayEl.dataset.vwAway = 'done';
  }
  awayEl.addEventListener('click', hideAway);

  function duration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s < 90) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 90) return `${m} min`;
    return `${(s / 3600).toFixed(1).replace(/\.0$/, '')} h`;
  }

  function takeAway() {
    awayTaken = true;
    const eco = world.economy;
    const a = eco && eco.takeAway ? eco.takeAway() : null;
    if (!a) { awayEl.dataset.vwAway = 'none'; return; }
    const head = `Away ${duration(a.rawSeconds)}${a.truncated ? ` (credited ${duration(a.seconds)})` : ''}`;
    const paid = a.money > 0
      ? ` · <b>+$${Math.round(a.money).toLocaleString('en-US')}</b> at half rate`
      : ` · <b>nothing earned</b>`;
    // The one genuinely useful sentence in the whole report, and the reason it exists: the player
    // whose factory sat pinned at the cap needs to be told to build belt, not another dropper.
    const why = a.money <= 0
      ? ` — <i>${SURFACE.copy.awayIdle}</i>`
      : (a.capped ? ` — <i>${SURFACE.copy.awayCapped}</i>` : '');
    awayEl.innerHTML = head + paid + why;
    awayEl.classList.add('is-on');
    awayEl.dataset.vwAway = 'on';
    awayLeft = SURFACE.away.seconds;
  }

  function updateAway(dt) {
    if (!awayTaken) { takeAway(); return; }
    if (awayLeft <= 0) return;
    awayLeft -= dt;
    if (awayLeft <= 0) hideAway();
  }

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

    filterStrip.update(dt);
    ordersPanel.update(dt);

    // Behind a front screen the numbers keep rolling but nothing is painted.
    if (!wanted || screenOpen) return;

    updatePrestige(dt);
    updateAway(dt);

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
    presEl.removeEventListener('click', doPrestige);
    filterStrip.destroy();
    ordersPanel.destroy();
    node.remove();
  }

  update(0);
  return { node, update, setVisible, destroy, filterStrip, ordersPanel };
}

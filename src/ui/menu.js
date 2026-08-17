// Voidworks — front screens over the live factory: play routes, co-op codes, settings, credits and the in-game pause.

import { MENU, SCREENS, SETTINGS, ECONOMY, NET } from '../config.js';
import { injectScreenStyles, el } from './screens.css.js';

const COPY = SCREENS.copy;
const CODE_LENGTH = Math.max(8, NET.codeMinLength || 8);
const CODE_PATTERN = new RegExp(`^[${SETTINGS.codeAlphabet}]{${CODE_LENGTH}}$`);

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeStore(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    return;
  }
}

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readSave() {
  const save = readStore(ECONOMY.storageKey);
  if (!save || typeof save !== 'object') return null;
  const money = num(save.money, num(save.cash, null));
  const elapsed = num(save.elapsed, num(save.playSeconds, num(save.time, null)));
  return { money, elapsed, raw: save };
}

function formatMoney(value) {
  if (value === null) return '—';
  const rounded = Math.floor(value);
  if (rounded >= 1e9) return `$${(rounded / 1e9).toFixed(2)}B`;
  if (rounded >= 1e6) return `$${(rounded / 1e6).toFixed(2)}M`;
  return `$${rounded.toLocaleString('en-US')}`;
}

function formatElapsed(seconds) {
  if (seconds === null) return '—';
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(total % 60).padStart(2, '0')}s`;
}

function makeCode() {
  const alphabet = SETTINGS.codeAlphabet;
  let out = '';
  const bytes = new Uint8Array(CODE_LENGTH);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < CODE_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < CODE_LENGTH; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function sanitiseName(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '')
    .slice(0, SETTINGS.nameMaxLength)
    .trim();
}

// The menu composes its own picture rather than borrowing whatever the player left behind: a fixed
// rig on its own slow orbit, with the factory pushed clear of the text column. The orbit controller
// always looks at its target, so the yaw offset is applied by sliding the target sideways along the
// camera's right axis by distance * tan(frameOffset) — the same framing move, expressed in the
// controller's public API rather than by reaching into it.
function createBackdrop() {
  const B = MENU.backdrop;
  const polarBase = Math.atan2(B.radius, B.height);
  const distance = Math.hypot(B.radius, B.height);
  const lateral = distance * Math.tan(B.frameOffset);
  let raf = 0;
  let time = 0;
  let last = 0;
  let saved = null;
  let savedFov = null;
  let running = false;
  let attached = false;

  function orbit() {
    return globalThis.vw && globalThis.vw.orbit;
  }

  function camera() {
    const view = globalThis.vw && globalThis.vw.view;
    return view && view.camera;
  }

  function pose() {
    const azimuth = B.startAngle + B.speed * time;
    return {
      azimuth,
      polar: polarBase + B.bobAmp * Math.sin(time * B.bobSpeed),
      distance,
      target: {
        x: -lateral * Math.cos(azimuth),
        y: B.lookY,
        z: lateral * Math.sin(azimuth),
      },
    };
  }

  // main.js calls show() while it is still wiring, so window.vw does not exist yet on the first
  // frames. The rig therefore attaches lazily instead of bailing out — otherwise the menu silently
  // falls back to whatever pose the gameplay camera happens to hold.
  function attach() {
    const rig = orbit();
    if (!rig || attached) return attached;
    attached = true;
    if (typeof rig.get === 'function') saved = rig.get();
    if (typeof rig.setAutoOrbit === 'function') rig.setAutoOrbit(false);
    if (typeof rig.setEnabled === 'function') rig.setEnabled(false);
    const cam = camera();
    if (cam && typeof cam.fov === 'number') {
      savedFov = cam.fov;
      cam.fov = B.fov;
      if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
    }
    setHudVisible(false);
    return true;
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    time += dt;
    if (!attach()) return;
    const rig = orbit();
    if (rig && typeof rig.set === 'function') rig.set(pose(), false);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      if (!attached) return;
      attached = false;
      const cam = camera();
      if (cam && savedFov !== null) {
        cam.fov = savedFov;
        if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
      }
      savedFov = null;
      setHudVisible(true);
      const rig = orbit();
      if (!rig) return;
      if (saved && typeof rig.set === 'function') rig.set(saved, false);
      saved = null;
      if (typeof rig.setEnabled === 'function') rig.setEnabled(true);
    },
  };
}

// The gameplay readouts belong to other pieces that are still moving, and they have not settled on
// one name for this: some expose setVisible(bool), others show()/hide(). Try both, require neither —
// a piece that grows setVisible later is picked up without a change here.
function setHudVisible(on) {
  const vw = globalThis.vw;
  if (!vw) return;
  for (const key of ['hud', 'buildbar']) {
    const piece = vw[key];
    if (!piece) continue;
    if (typeof piece.setVisible === 'function') piece.setVisible(on);
    else if (on && typeof piece.show === 'function') piece.show();
    else if (!on && typeof piece.hide === 'function') piece.hide();
  }
}

function paintRange(node) {
  const min = Number(node.min);
  const max = Number(node.max);
  const t = (Number(node.value) - min) / (max - min || 1);
  node.style.setProperty('--p', `${(t * 100).toFixed(1)}%`);
}

function field(parent, labelText, noteText) {
  const wrap = el('div', 'vw-field', parent);
  const head = el('div', 'vw-field-head', wrap);
  el('div', 'vw-label', head, labelText);
  const value = el('div', 'vw-field-value', head);
  const body = el('div', null, wrap);
  if (noteText) el('div', 'vw-note', wrap, noteText);
  return { wrap, value, body };
}

function slider(parent, labelText, noteText, initial, min, max, format, onInput) {
  const f = field(parent, labelText, noteText);
  const range = el('input', 'vw-range', f.body);
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = '0.001';
  range.value = String(initial);
  range.setAttribute('aria-label', labelText);
  paintRange(range);
  f.value.textContent = format(initial);
  range.addEventListener('input', () => {
    const v = Number(range.value);
    paintRange(range);
    f.value.textContent = format(v);
    onInput(v);
  });
  return range;
}

export function createMenu(options) {
  const config = options || {};
  injectScreenStyles();

  const stored = readStore(SETTINGS.storageKey) || {};
  const D = SETTINGS.defaults;
  const settings = {
    master: num(stored.master, D.master),
    music: num(stored.music, D.music),
    sfx: num(stored.sfx, D.sfx),
    quality: SETTINGS.qualityTiers.some((t) => t.id === stored.quality) ? stored.quality : D.quality,
    sensitivity: num(stored.sensitivity, D.sensitivity),
    name: sanitiseName(stored.name || D.name),
  };
  const backdrop = createBackdrop();

  function persist() {
    writeStore(SETTINGS.storageKey, { ...settings, name: sanitiseName(settings.name) });
    if (typeof config.onSettings === 'function') config.onSettings({ ...settings });
  }

  const root = el('div', 'vw-screen', document.body);
  root.classList.add('is-gone');
  el('div', 'vw-veil', root);
  el('div', 'vw-vignette', root);
  el('div', 'vw-grain', root);

  const layout = el('div', 'vw-menu', root);
  const col = el('div', 'vw-menu-col', layout);

  const brand = el('div', 'vw-brand', col);
  const eyebrow = el('div', 'vw-eyebrow', brand, COPY.eyebrow);
  el('h1', 'vw-title', brand, COPY.title);
  el('div', 'vw-title-rule', brand);
  const tagline = el('div', 'vw-tagline', brand, COPY.tagline);

  const mainNav = el('nav', 'vw-nav', col);
  const pauseNav = el('nav', 'vw-nav is-off', col);
  const panels = el('div', 'vw-panels', layout);

  const foot = el('div', 'vw-foot', root);
  el('div', null, foot, COPY.footer);

  let openPanel = null;
  let openedFrom = null;
  const items = [];

  function closePanel() {
    if (!openPanel) return;
    openPanel.classList.remove('is-on');
    openPanel = null;
    for (const item of items) {
      item.button.classList.remove('is-active');
      if (item.panel) item.button.setAttribute('aria-expanded', 'false');
    }
    if (openedFrom && document.body.contains(openedFrom)) openedFrom.focus({ preventScroll: true });
    openedFrom = null;
  }

  function showPanel(next) {
    if (openPanel === next) return;
    if (openPanel) openPanel.classList.remove('is-on');
    openPanel = next;
    for (const item of items) {
      const on = item.panel === openPanel;
      item.button.classList.toggle('is-active', on);
      if (item.panel) item.button.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    openPanel.classList.add('is-on');
    const body = openPanel.querySelector('.vw-panel-body');
    const focusable = (body && body.querySelector('input,select,button')) || openPanel.querySelector('button');
    if (focusable) focusable.focus({ preventScroll: true });
    // Stacked layouts push the panel below the fold; the panel is capped at a viewport fraction, so
    // bringing it into view leaves every control reachable without the column jumping on wide screens.
    if (layout.scrollHeight > layout.clientHeight + 1) {
      openPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function navItem(nav, label, note, panel, action) {
    const button = el('button', 'vw-nav-item', nav);
    button.type = 'button';
    el('span', 'vw-nav-text', button, label);
    if (note) el('span', 'vw-nav-note', button, note);
    const index = nav.childElementCount - 1;
    button.style.transitionDelay = `${(index * SCREENS.itemStagger).toFixed(3)}s`;
    if (panel) {
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', panel.id);
    }
    button.addEventListener('click', () => {
      if (panel) {
        if (openPanel === panel) closePanel();
        else {
          openedFrom = button;
          showPanel(panel);
        }
      } else if (action) action();
    });
    items.push({ button, panel: panel || null });
    return button;
  }

  let panelSeq = 0;

  function panel(titleText) {
    const node = el('div', 'vw-panel', panels);
    node.id = `vw-panel-${++panelSeq}`;
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', titleText);
    const head = el('div', 'vw-panel-head', node);
    el('div', 'vw-panel-title', head, titleText);
    const back = el('button', 'vw-btn is-ghost', head);
    back.type = 'button';
    back.textContent = COPY.back;
    back.style.padding = '7px 13px';
    back.addEventListener('click', (event) => {
      event.preventDefault();
      closePanel();
    });
    const body = el('div', 'vw-panel-body', node);
    return { node, body };
  }

  const playPanel = panel(COPY.playTitle);
  const saveStat = el('div', 'vw-stat', playPanel.body);
  const saveHead = el('div', 'vw-stat-row', saveStat);
  el('div', 'vw-label', saveHead, COPY.playSaveLabel);
  const saveAge = el('div', 'vw-field-value', saveHead, '');
  const saveMoneyRow = el('div', 'vw-stat-row', saveStat);
  el('div', 'vw-note', saveMoneyRow, 'Banked');
  const saveMoney = el('div', 'vw-stat-value is-money', saveMoneyRow, '—');
  const saveTimeRow = el('div', 'vw-stat-row', saveStat);
  el('div', 'vw-note', saveTimeRow, 'Time in the void');
  const saveTime = el('div', 'vw-stat-value', saveTimeRow, '—');
  const playNote = el('div', 'vw-note', playPanel.body, '');
  const playRow = el('div', 'vw-btn-row', playPanel.body);
  const continueButton = el('button', 'vw-btn', playRow);
  continueButton.type = 'button';
  continueButton.textContent = COPY.playContinue;
  const newButton = el('button', 'vw-btn is-ghost', playRow);
  newButton.type = 'button';
  newButton.textContent = COPY.playNew;

  function paintSave() {
    const save = readSave();
    if (save) {
      saveStat.style.display = '';
      saveMoney.textContent = formatMoney(save.money);
      saveTime.textContent = formatElapsed(save.elapsed);
      saveAge.textContent = 'on disk';
      playNote.textContent = COPY.playWipeWarn;
      continueButton.disabled = false;
      continueButton.className = 'vw-btn';
      newButton.className = 'vw-btn is-ghost';
    } else {
      saveStat.style.display = 'none';
      playNote.textContent = COPY.playNoSave;
      continueButton.disabled = true;
      newButton.className = 'vw-btn';
    }
  }

  continueButton.addEventListener('click', () => launchPlay('continue'));
  newButton.addEventListener('click', () => launchPlay('new'));

  const coopPanel = panel(COPY.coopTitle);
  const nameField = field(coopPanel.body, COPY.coopName);
  const nameInput = el('input', 'vw-input', nameField.body);
  nameInput.type = 'text';
  nameInput.maxLength = SETTINGS.nameMaxLength;
  nameInput.placeholder = COPY.coopNamePlaceholder;
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.value = settings.name;
  nameInput.addEventListener('input', () => {
    settings.name = nameInput.value.slice(0, SETTINGS.nameMaxLength);
    persist();
  });

  el('div', 'vw-hr', coopPanel.body);

  const hostField = field(coopPanel.body, COPY.coopHost);
  hostField.wrap.insertBefore(el('div', 'vw-note', null, COPY.coopHostNote), hostField.body);
  const codeBox = el('div', 'vw-code-box', hostField.body);
  const codeRow = el('div', 'vw-code-row', codeBox);
  const codeValue = el('div', 'vw-code-value is-pending', codeRow, '·'.repeat(CODE_LENGTH));
  const copyButton = el('button', 'vw-copy', codeRow, COPY.coopCopy);
  copyButton.type = 'button';
  copyButton.disabled = true;
  const hostButton = el('button', 'vw-btn', codeBox);
  hostButton.type = 'button';
  hostButton.textContent = COPY.coopHostGet;
  hostButton.style.alignSelf = 'flex-start';

  let hostCode = '';
  hostButton.addEventListener('click', () => {
    if (!hostCode) {
      hostCode = makeCode();
      codeValue.textContent = hostCode;
      codeValue.classList.remove('is-pending');
      copyButton.disabled = false;
      copyButton.classList.remove('is-done');
      copyButton.textContent = COPY.coopCopy;
      hostButton.textContent = COPY.coopHostStart;
      paintCoopCta();
      return;
    }
    persist();
    finish(() => {
      if (typeof config.onHost === 'function') config.onHost(playerName(), hostCode);
    });
  });

  copyButton.addEventListener('click', () => {
    if (!hostCode) return;
    const done = () => {
      copyButton.classList.add('is-done');
      copyButton.textContent = COPY.coopCopied;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(hostCode).then(done, done);
    else done();
  });

  el('div', 'vw-hr', coopPanel.body);

  const joinField = field(coopPanel.body, COPY.coopJoin);
  const codeInput = el('input', 'vw-input vw-code', joinField.body);
  codeInput.type = 'text';
  codeInput.maxLength = CODE_LENGTH;
  codeInput.placeholder = COPY.coopCodePlaceholder;
  codeInput.autocomplete = 'off';
  codeInput.spellcheck = false;
  codeInput.setAttribute('aria-label', COPY.coopJoin);
  const codeError = el('div', 'vw-note is-bad', joinField.body, '');
  codeError.style.opacity = '0';
  const joinButton = el('button', 'vw-btn is-ghost', joinField.body);
  joinButton.type = 'button';
  joinButton.textContent = COPY.coopJoinAction;
  joinButton.style.alignSelf = 'flex-start';
  joinButton.style.marginTop = '10px';

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
    codeInput.classList.remove('is-bad');
    codeError.style.opacity = '0';
    paintCoopCta();
  });
  codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinButton.click();
  });
  joinButton.addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      codeInput.classList.add('is-bad');
      codeError.textContent = COPY.coopBadCode;
      codeError.style.opacity = '1';
      codeInput.focus();
      return;
    }
    persist();
    finish(() => {
      if (typeof config.onJoin === 'function') config.onJoin(playerName(), code);
    });
  });

  // Exactly one solid accent button is on screen at a time: the code input takes the lead the moment
  // a full code is typed, otherwise hosting owns it.
  function paintCoopCta() {
    const joinReady = codeInput.value.length === CODE_LENGTH;
    joinButton.className = joinReady ? 'vw-btn' : 'vw-btn is-ghost';
    hostButton.className = joinReady ? 'vw-btn is-ghost' : 'vw-btn';
  }

  function playerName() {
    return sanitiseName(settings.name) || COPY.coopNamePlaceholder;
  }

  const settingsPanel = panel(COPY.settingsTitle);
  slider(settingsPanel.body, COPY.optMaster, null, settings.master, 0, 1, (v) => `${Math.round(v * 100)}%`, (v) => {
    settings.master = v;
    persist();
  });
  slider(settingsPanel.body, COPY.optMusic, null, settings.music, 0, 1, (v) => `${Math.round(v * 100)}%`, (v) => {
    settings.music = v;
    persist();
  });
  slider(settingsPanel.body, COPY.optSfx, null, settings.sfx, 0, 1, (v) => `${Math.round(v * 100)}%`, (v) => {
    settings.sfx = v;
    persist();
  });

  el('div', 'vw-hr', settingsPanel.body);

  const qualityField = field(settingsPanel.body, COPY.optQuality, COPY.optQualityNote);
  const qualityChips = el('div', 'vw-chips', qualityField.body);
  const qualityNodes = [];
  for (const tier of SETTINGS.qualityTiers) {
    const chip = el('button', 'vw-chip', qualityChips, tier.name);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      settings.quality = tier.id;
      paintQuality();
      persist();
    });
    qualityNodes.push({ chip, tier });
  }
  function paintQuality() {
    for (const q of qualityNodes) {
      q.chip.classList.toggle('is-on', q.tier.id === settings.quality);
      q.chip.setAttribute('aria-pressed', q.tier.id === settings.quality ? 'true' : 'false');
    }
    const found = SETTINGS.qualityTiers.find((t) => t.id === settings.quality);
    qualityField.value.textContent = found ? found.name : '';
  }

  slider(
    settingsPanel.body,
    COPY.optSensitivity,
    COPY.optSensitivityNote,
    settings.sensitivity,
    SETTINGS.sensitivityMin,
    SETTINGS.sensitivityMax,
    (v) => `${v.toFixed(2)}×`,
    (v) => {
      settings.sensitivity = v;
      persist();
    }
  );

  const creditsPanel = panel(COPY.creditsTitle);
  const credits = el('div', 'vw-credits', creditsPanel.body);
  const CREDIT_LINES = [
    ['Design & direction', 'Jurek'],
    ['Built with', 'Claude Code'],
    ['Engine', 'three.js r169'],
    ['Multiplayer', 'Firebase RTDB'],
    ['Made in', 'Gzowo'],
  ];
  for (const [role, name] of CREDIT_LINES) {
    const row = el('div', 'vw-credit', credits);
    el('div', 'vw-credit-role', row, role);
    el('div', 'vw-credit-name', row, name);
  }
  el('div', 'vw-hr', creditsPanel.body);
  el('div', 'vw-note', creditsPanel.body, 'A factory hanging in a white void. Thank you for playing.');

  navItem(mainNav, COPY.play, COPY.playNote, playPanel.node);
  navItem(mainNav, COPY.coop, COPY.coopNote, coopPanel.node);
  navItem(mainNav, COPY.settings, COPY.settingsNote, settingsPanel.node);
  navItem(mainNav, COPY.credits, COPY.creditsNote, creditsPanel.node);

  navItem(pauseNav, COPY.resume, COPY.resumeNote, null, () => finish(null));
  navItem(pauseNav, COPY.settings, COPY.settingsNote, settingsPanel.node);
  navItem(pauseNav, COPY.credits, COPY.creditsNote, creditsPanel.node);
  navItem(pauseNav, COPY.quit, COPY.quitNote, null, () => setMode('menu'));

  paintQuality();
  paintSave();
  paintCoopCta();

  let visible = false;
  let closed = false;
  let mode = 'menu';

  function setMode(next) {
    mode = next;
    const paused = mode === 'pause';
    mainNav.classList.toggle('is-off', paused);
    pauseNav.classList.toggle('is-off', !paused);
    eyebrow.textContent = paused ? COPY.pausedEyebrow : COPY.eyebrow;
    tagline.style.display = paused ? 'none' : '';
    foot.style.display = paused ? 'none' : '';
    closePanel();
    if (!paused) paintSave();
  }

  function onKey(event) {
    if (closed) return;
    if (event.code !== 'Escape') return;
    if (visible) {
      if (openPanel) {
        event.preventDefault();
        closePanel();
      } else if (mode === 'pause') {
        event.preventDefault();
        finish(null);
      }
      return;
    }
    event.preventDefault();
    setMode('pause');
    show();
  }
  window.addEventListener('keydown', onKey);

  function show() {
    if (closed) return;
    if (!document.body.contains(root)) document.body.appendChild(root);
    root.classList.remove('is-gone');
    visible = true;
    backdrop.start();
    setHudVisible(false);
    requestAnimationFrame(() => {
      if (!visible) return;
      root.classList.add('is-on');
      const first = (mode === 'pause' ? pauseNav : mainNav).querySelector('.vw-nav-item');
      if (first) first.focus({ preventScroll: true });
    });
  }

  function hide() {
    visible = false;
    closePanel();
    root.classList.remove('is-on');
    root.classList.add('is-gone');
    backdrop.stop();
    setHudVisible(true);
    return new Promise((resolve) => setTimeout(resolve, SCREENS.fadeOut * 1000));
  }

  async function finish(after) {
    if (!visible) return;
    persist();
    await hide();
    setMode('pause');
    if (typeof after === 'function') after();
  }

  function launchPlay(kind) {
    finish(() => {
      if (typeof config.onPlay === 'function') config.onPlay(kind);
    });
  }

  return {
    root,
    show,
    hide,
    get isOpen() {
      return visible;
    },
    get settings() {
      return { ...settings };
    },
    destroy() {
      closed = true;
      visible = false;
      window.removeEventListener('keydown', onKey);
      backdrop.stop();
      setHudVisible(true);
      root.remove();
    },
  };
}

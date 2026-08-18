// Voidworks — hand-rolled orbit / pan / zoom controller: 1:1 while dragging, critically damped on release.

import * as THREE from 'three';
import { CAMERA } from '../config.js';

const TAU = Math.PI * 2;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function smoothstep(t) {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
}

function channel(value, smooth) {
  return { value, goal: value, vel: 0, smooth, base: smooth };
}

function stepChannel(c, dt) {
  const st = Math.max(1e-4, c.smooth);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = c.value - c.goal;
  const temp = (c.vel + omega * change) * dt;
  c.vel = (c.vel - omega * temp) * exp;
  c.value = c.goal + (change + temp) * exp;
  if (Math.abs(c.value - c.goal) < 1e-6 && Math.abs(c.vel) < 1e-5) {
    c.value = c.goal;
    c.vel = 0;
  }
}

function syncChannel(c) {
  c.value = c.goal;
  c.vel = 0;
}

export function createOrbit(camera, dom, opts = {}) {
  const az = channel(CAMERA.startAzimuth, CAMERA.smoothOrbit);
  const pol = channel(clamp(CAMERA.startPolar, CAMERA.minPolar, CAMERA.maxPolar), CAMERA.smoothOrbit);
  const dist = channel(clamp(CAMERA.startDistance, CAMERA.minDistance, CAMERA.maxDistance), CAMERA.smoothZoom);
  const tx = channel(0, CAMERA.smoothPan);
  const ty = channel(CAMERA.targetY, CAMERA.smoothPan);
  const tz = channel(0, CAMERA.smoothPan);
  const channels = [az, pol, dist, tx, ty, tz];

  const target = new THREE.Vector3(tx.value, ty.value, tz.value);
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const screenUp = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const boxCenter = new THREE.Vector3();
  const boxSize = new THREE.Vector3();
  const probe = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  const bounds = { cx: 0, cz: 0, rx: CAMERA.panLimit, rz: CAMERA.panLimit, maxD: CAMERA.maxDistance };
  const fit = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  const pointers = new Map();
  const keys = new Set();
  const state = {
    azimuth: az.value,
    polar: pol.value,
    distance: dist.value,
    target,
    mode: 'idle',
    dragging: false,
    enabled: true,
    autoOrbit: false,
    touched: false,
    framed: false,
  };

  let enabled = true;
  let autoOrbit = false;
  let mode = 'idle';
  let dragPanned = false;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let velX = 0;
  let velY = 0;
  let pinchDist = 0;
  let pinchX = 0;
  let pinchY = 0;
  let autoFrameT = 0;
  let sensitivity = opts.sensitivity || 1;
  let boundsProvider = opts.getBounds || null;
  let dragBlocker = opts.dragBlocker || null;

  dom.style.touchAction = 'none';

  function setSmooth(kind) {
    for (const c of channels) c.smooth = c.base;
    if (kind === 'focus') for (const c of channels) c.smooth = CAMERA.smoothFocus;
  }

  function touched() {
    state.touched = true;
    if (autoOrbit) {
      autoOrbit = false;
      state.autoOrbit = false;
    }
    setSmooth('user');
  }

  function basis(a) {
    forward.set(-Math.sin(a), 0, -Math.cos(a));
    right.set(Math.cos(a), 0, -Math.sin(a));
  }

  function offsetFor(a, p, d, out) {
    const s = Math.sin(p) * d;
    return out.set(Math.sin(a) * s, Math.cos(p) * d, Math.cos(a) * s);
  }

  function fitBox(b, center, padding) {
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * camera.aspect;
    offsetFor(az.goal, pol.goal, 1, tmpA);
    basis(az.goal);
    screenUp.copy(right).cross(tmpB.copy(tmpA).negate()).normalize();
    let d = 0;
    for (let i = 0; i < 8; i += 1) {
      const vx = (i & 1 ? b.max.x : b.min.x) - center.x;
      const vy = (i & 2 ? b.max.y : b.min.y) - center.y;
      const vz = (i & 4 ? b.max.z : b.min.z) - center.z;
      const along = vx * tmpA.x + vy * tmpA.y + vz * tmpA.z;
      const h = Math.abs(vx * right.x + vy * right.y + vz * right.z);
      const v = Math.abs(vx * screenUp.x + vy * screenUp.y + vz * screenUp.z);
      d = Math.max(d, h / tanH + along, v / tanV + along);
    }
    return clamp(d * padding, CAMERA.minDistance, CAMERA.maxDistance);
  }

  function projectBox(b, cx, cy, cz, d) {
    offsetFor(az.goal, pol.goal, d, tmpA);
    probe.fov = camera.fov;
    probe.aspect = camera.aspect;
    probe.near = camera.near;
    probe.far = camera.far;
    probe.position.set(cx + tmpA.x, cy + tmpA.y, cz + tmpA.z);
    probe.up.set(0, 1, 0);
    probe.lookAt(cx, cy, cz);
    probe.updateProjectionMatrix();
    probe.updateMatrixWorld();
    fit.minX = Infinity;
    fit.maxX = -Infinity;
    fit.minY = Infinity;
    fit.maxY = -Infinity;
    for (let i = 0; i < 8; i += 1) {
      tmpB.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      const bx = tmpB.x - probe.position.x;
      const by = tmpB.y - probe.position.y;
      const bz = tmpB.z - probe.position.z;
      if (bx * tmpA.x + by * tmpA.y + bz * tmpA.z > 0) return false;
      tmpB.project(probe);
      if (!Number.isFinite(tmpB.x) || !Number.isFinite(tmpB.y)) return false;
      fit.minX = Math.min(fit.minX, tmpB.x);
      fit.maxX = Math.max(fit.maxX, tmpB.x);
      fit.minY = Math.min(fit.minY, tmpB.y);
      fit.maxY = Math.max(fit.maxY, tmpB.y);
    }
    return true;
  }

  function frameFit(b, fill, bias) {
    b.getCenter(boxCenter);
    let cx = boxCenter.x;
    const cy = boxCenter.y;
    let cz = boxCenter.z;
    let d = fitBox(b, boxCenter, 1);
    basis(az.goal);
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * camera.aspect;
    const cosP = Math.cos(pol.goal);
    const vScale = (cosP < 0 ? -1 : 1) * Math.max(0.3, Math.abs(cosP));
    for (let i = 0; i < 6; i += 1) {
      if (!projectBox(b, cx, cy, cz, d)) break;
      const ox = (fit.minX + fit.maxX) / 2;
      const oy = (fit.minY + fit.maxY) / 2 - bias;
      const hx = (fit.maxX - fit.minX) / 2;
      const hy = (fit.maxY - fit.minY) / 2;
      const sx = ox * tanH * d;
      const sy = (oy * tanV * d) / vScale;
      cx += right.x * sx + forward.x * sy;
      cz += right.z * sx + forward.z * sy;
      d = clamp((d * Math.max(hx, hy)) / fill, CAMERA.minDistance, CAMERA.maxDistance);
      if (Math.abs(ox) < 2e-3 && Math.abs(oy) < 2e-3 && Math.abs(Math.max(hx, hy) - fill) < 2e-3) break;
    }
    boxCenter.set(cx, cy, cz);
    return d;
  }

  function readBounds() {
    const b = boundsProvider ? boundsProvider() : null;
    if (!b || !b.isBox3 || b.isEmpty()) {
      bounds.cx = 0;
      bounds.cz = 0;
      bounds.rx = CAMERA.panLimit;
      bounds.rz = CAMERA.panLimit;
      bounds.maxD = CAMERA.maxDistance;
      return null;
    }
    b.getCenter(boxCenter);
    b.getSize(boxSize);
    bounds.cx = boxCenter.x;
    bounds.cz = boxCenter.z;
    bounds.rx = boxSize.x / 2 + CAMERA.panMargin;
    bounds.rz = boxSize.z / 2 + CAMERA.panMargin;
    bounds.maxD = clamp(fitBox(b, boxCenter, CAMERA.zoomOutFit), CAMERA.minDistance + 2, CAMERA.maxDistance);
    return b;
  }

  function softAxis(v, d, c, r) {
    if (d === 0) return clamp(v, c - r, c + r);
    const rel = v - c;
    const room = d > 0 ? r - rel : r + rel;
    const k = smoothstep(room / CAMERA.softPan);
    return clamp(v + d * k, c - r, c + r);
  }

  function panBy(dx, dz) {
    readBounds();
    tx.goal = softAxis(tx.goal, dx, bounds.cx, bounds.rx);
    tz.goal = softAxis(tz.goal, dz, bounds.cz, bounds.rz);
    ty.goal = clamp(ty.goal, -CAMERA.panLimitY, CAMERA.panLimitY);
  }

  function clampTarget() {
    ty.goal = clamp(ty.goal, -CAMERA.panLimitY, CAMERA.panLimitY);
    if (!enabled) {
      tx.goal = clamp(tx.goal, -CAMERA.panLimit, CAMERA.panLimit);
      tz.goal = clamp(tz.goal, -CAMERA.panLimit, CAMERA.panLimit);
      return;
    }
    readBounds();
    tx.goal = clamp(tx.goal, bounds.cx - bounds.rx, bounds.cx + bounds.rx);
    tz.goal = clamp(tz.goal, bounds.cz - bounds.rz, bounds.cz + bounds.rz);
  }

  function softPolar(delta) {
    const room = delta > 0 ? CAMERA.maxPolar - pol.goal : pol.goal - CAMERA.minPolar;
    const k = smoothstep(room / CAMERA.softZone);
    pol.goal = clamp(pol.goal + delta * k, CAMERA.minPolar, CAMERA.maxPolar);
    return k;
  }

  function worldPerPixel(d) {
    const h = dom.clientHeight || innerHeight;
    return (2 * Math.tan((camera.fov * Math.PI) / 360) * Math.abs(d)) / h;
  }

  function screenToGround(x, y, planeY = 0, out) {
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const nx = ((x - rect.left) / rect.width) * 2 - 1;
    const ny = -((y - rect.top) / rect.height) * 2 + 1;
    camera.updateMatrixWorld();
    rayOrigin.setFromMatrixPosition(camera.matrixWorld);
    rayDir.set(nx, ny, 0.5).unproject(camera).sub(rayOrigin).normalize();
    if (Math.abs(rayDir.y) < 1e-7) return null;
    const t = (planeY - rayOrigin.y) / rayDir.y;
    if (!(t > 0) || !Number.isFinite(t)) return null;
    const v = out || new THREE.Vector3();
    return v.set(rayOrigin.x + rayDir.x * t, planeY, rayOrigin.z + rayDir.z * t);
  }

  function goalRay(x, y) {
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const nx = ((x - rect.left) / rect.width) * 2 - 1;
    const ny = -((y - rect.top) / rect.height) * 2 + 1;
    probe.fov = camera.fov;
    probe.aspect = camera.aspect;
    probe.near = camera.near;
    probe.far = camera.far;
    probe.updateProjectionMatrix();
    offsetFor(az.goal, pol.goal, dist.goal, tmpA);
    probe.position.set(tx.goal + tmpA.x, ty.goal + tmpA.y, tz.goal + tmpA.z);
    probe.up.set(0, 1, 0);
    probe.lookAt(tx.goal, ty.goal, tz.goal);
    probe.updateMatrixWorld();
    rayOrigin.copy(probe.position);
    rayDir.set(nx, ny, 0.5).unproject(probe).sub(rayOrigin).normalize();
    return true;
  }

  function zoomTo(factor, cx, cy) {
    readBounds();
    const maxD = bounds.maxD;
    const next = clamp(dist.goal * factor, CAMERA.minDistance, maxD);
    if (cx !== undefined && goalRay(cx, cy) && Math.abs(rayDir.y) > 1e-3) {
      const tHit = -rayOrigin.y / rayDir.y;
      if (tHit > 0 && tHit < maxD * 3) {
        anchor.set(rayOrigin.x + rayDir.x * tHit, 0, rayOrigin.z + rayDir.z * tHit);
        offsetFor(az.goal, pol.goal, 1, tmpA);
        const t2 = -(ty.goal + tmpA.y * next) / rayDir.y;
        if (Number.isFinite(t2) && t2 > 0) {
          tx.goal = anchor.x - rayDir.x * t2 - tmpA.x * next;
          tz.goal = anchor.z - rayDir.z * t2 - tmpA.z * next;
        }
      }
    }
    dist.goal = next;
    clampTarget();
  }

  function panPixels(dx, dy) {
    const w = worldPerPixel(dist.value) * CAMERA.panSpeed * sensitivity;
    basis(az.value);
    const wx = (forward.x * dy - right.x * dx) * w;
    const wz = (forward.z * dy - right.z * dx) * w;
    panBy(wx, wz);
  }

  function isPanButton(e) {
    return e.button === 2 || e.shiftKey;
  }

  function onDown(e) {
    if (!enabled) return;
    if (e.pointerType === 'mouse' && e.button === 1) e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    touched();
    if (pointers.size === 2 && e.pointerType !== 'mouse') {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchX = (a.x + b.x) / 2;
      pinchY = (a.y + b.y) / 2;
      mode = 'pinch';
      state.mode = mode;
      return;
    }
    if (pointers.size > 1) return;
    if (e.pointerType === 'mouse' && e.button === 0 && dragBlocker && dragBlocker(e)) {
      mode = 'idle';
      return;
    }
    mode = e.pointerType === 'mouse' && isPanButton(e) ? 'pan' : 'orbit';
    state.mode = mode;
    state.dragging = true;
    dragPanned = mode === 'pan';
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = performance.now();
    velX = 0;
    velY = 0;
    try {
      dom.setPointerCapture(e.pointerId);
    } catch {}
  }

  function onMove(e) {
    if (!enabled) return;
    const p = pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (mode === 'pinch') {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (pinchDist > 0 && d > 0) zoomTo(Math.pow(pinchDist / d, CAMERA.pinchSpeed), mx, my);
      panPixels(mx - pinchX, my - pinchY);
      pinchDist = d;
      pinchX = mx;
      pinchY = my;
      syncChannel(dist);
      syncChannel(tx);
      syncChannel(tz);
      return;
    }
    if (mode === 'idle' || !p) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const now = performance.now();
    const dt = Math.max(8, now - lastT) / 1000;
    lastT = now;
    velX = velX * 0.6 + (dx / dt) * 0.4;
    velY = velY * 0.6 + (dy / dt) * 0.4;
    const panning = mode === 'pan' || (e.shiftKey && e.pointerType === 'mouse');
    dragPanned = panning;
    if (panning) {
      panPixels(dx, dy);
      syncChannel(tx);
      syncChannel(tz);
    } else {
      az.goal -= dx * CAMERA.rotateSpeed * sensitivity;
      softPolar(-dy * CAMERA.rotateSpeed * sensitivity);
      syncChannel(az);
      syncChannel(pol);
    }
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    try {
      dom.releasePointerCapture(e.pointerId);
    } catch {}
    if (mode === 'orbit' && !dragPanned && pointers.size === 0) {
      const va = -velX * CAMERA.rotateSpeed * sensitivity;
      const vp = -velY * CAMERA.rotateSpeed * sensitivity;
      az.vel = va;
      az.goal += clamp(va * CAMERA.flick, -CAMERA.flickMax, CAMERA.flickMax);
      pol.vel = vp * softPolar(clamp(vp * CAMERA.flick, -CAMERA.flickMax, CAMERA.flickMax));
    }
    if (pointers.size === 0) {
      mode = 'idle';
      state.dragging = false;
      state.mode = mode;
      dragPanned = false;
    } else if (pointers.size === 1) {
      const [a] = [...pointers.values()];
      mode = 'orbit';
      state.mode = mode;
      dragPanned = false;
      lastX = a.x;
      lastY = a.y;
      lastT = performance.now();
      velX = 0;
      velY = 0;
    }
  }

  function onWheel(e) {
    if (!enabled) return;
    e.preventDefault();
    touched();
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 400 : 1;
    const amount = clamp(e.deltaY * unit, -600, 600) * CAMERA.zoomStep * CAMERA.zoomSpeed;
    zoomTo(Math.exp(amount), e.clientX, e.clientY);
  }

  function focus(point, distance) {
    setSmooth('focus');
    tx.goal = point.x;
    ty.goal = point.y;
    tz.goal = point.z;
    if (distance !== undefined) dist.goal = clamp(distance, CAMERA.minDistance, CAMERA.maxDistance);
    clampTarget();
  }

  function frameAll(hero = false) {
    const b = readBounds();
    pol.goal = clamp(CAMERA.startPolar, CAMERA.minPolar, CAMERA.maxPolar);
    if (!b) {
      focus(tmpB.set(0, CAMERA.targetY, 0), CAMERA.startDistance);
      return false;
    }
    const d = frameFit(b, hero ? CAMERA.heroFill : CAMERA.frameFill, hero ? CAMERA.heroBias : 0);
    focus(boxCenter, d);
    return true;
  }

  function autoFrame(dt) {
    if (!enabled || state.touched || mode !== 'idle' || !boundsProvider) return;
    autoFrameT -= dt;
    if (autoFrameT > 0) return;
    autoFrameT = CAMERA.autoFrameSeconds;
    if (!frameAll(true)) return;
    if (!state.framed) {
      state.framed = true;
      for (const c of channels) syncChannel(c);
    }
  }

  function onKeyDown(e) {
    if (!enabled) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k.length === 1 && 'wasd'.includes(k)) {
      keys.add(k);
      touched();
      e.preventDefault();
      return;
    }
    if (k.startsWith('arrow')) {
      keys.add(k);
      touched();
      e.preventDefault();
      return;
    }
    if (k === 'q' || k === 'e') {
      touched();
      az.goal += k === 'q' ? CAMERA.snapAngle : -CAMERA.snapAngle;
      return;
    }
    if (k === 'f' || k === ' ') {
      touched();
      frameAll(false);
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    keys.delete(e.key.toLowerCase());
  }

  function onBlur() {
    keys.clear();
    pointers.clear();
    mode = 'idle';
    dragPanned = false;
    state.dragging = false;
    state.mode = mode;
  }

  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);
  addEventListener('pointerup', onUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);

  function keyPan(dt) {
    let kx = 0;
    let kz = 0;
    if (keys.has('w') || keys.has('arrowup')) kz += 1;
    if (keys.has('s') || keys.has('arrowdown')) kz -= 1;
    if (keys.has('d') || keys.has('arrowright')) kx += 1;
    if (keys.has('a') || keys.has('arrowleft')) kx -= 1;
    if (!kx && !kz) return;
    const len = Math.hypot(kx, kz);
    const speed = (CAMERA.keyPanSpeed * CAMERA.panSpeed * Math.max(4, dist.value) * 0.35 * dt) / len;
    basis(az.value);
    panBy((forward.x * kz + right.x * kx) * speed, (forward.z * kz + right.z * kx) * speed);
  }

  function step(h) {
    keyPan(h);
    if (autoOrbit) az.goal += CAMERA.autoOrbit * h;
    readBounds();
    dist.goal = clamp(dist.goal, CAMERA.minDistance, enabled ? bounds.maxD : CAMERA.maxDistance);
    pol.goal = clamp(pol.goal, CAMERA.minPolar, CAMERA.maxPolar);
    for (const c of channels) stepChannel(c, h);
  }

  function applyCamera() {
    pol.value = clamp(pol.value, CAMERA.minPolar, CAMERA.maxPolar);
    dist.value = clamp(dist.value, CAMERA.minDistance, CAMERA.maxDistance);
    target.set(tx.value, ty.value, tz.value);
    offsetFor(az.value, pol.value, dist.value, offset);
    camera.position.copy(target).add(offset);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    state.azimuth = ((az.value % TAU) + TAU) % TAU;
    state.polar = pol.value;
    state.distance = dist.value;
  }

  function update(dt) {
    let rem = clamp(Number.isFinite(dt) && dt > 0 ? dt : 1 / 60, 1 / 1000, CAMERA.maxCatchUp);
    autoFrame(rem);
    while (rem > 1e-6) {
      const h = Math.min(CAMERA.maxStep, rem);
      step(h);
      rem -= h;
    }
    applyCamera();
  }

  update(0);

  return {
    target,
    state,
    update,
    focus,
    frameAll,
    screenToGround,
    setEnabled(b) {
      enabled = !!b;
      state.enabled = enabled;
      if (!enabled) onBlur();
    },
    setAutoOrbit(b) {
      autoOrbit = !!b;
      state.autoOrbit = autoOrbit;
      if (autoOrbit) state.touched = false;
    },
    setBounds(fn) {
      boundsProvider = typeof fn === 'function' ? fn : null;
      autoFrameT = 0;
      state.framed = false;
    },
    setDragBlocker(fn) {
      dragBlocker = typeof fn === 'function' ? fn : null;
    },
    setSensitivity(v) {
      sensitivity = clamp(Number(v) || 1, 0.1, 4);
    },
    get() {
      return { azimuth: az.value, polar: pol.value, distance: dist.value, target: target.clone() };
    },
    set(s = {}, immediate = true) {
      if (s.azimuth !== undefined) az.goal = s.azimuth;
      if (s.polar !== undefined) pol.goal = clamp(s.polar, CAMERA.minPolar, CAMERA.maxPolar);
      if (s.distance !== undefined) dist.goal = clamp(s.distance, CAMERA.minDistance, CAMERA.maxDistance);
      if (s.target) {
        tx.goal = s.target.x;
        ty.goal = s.target.y;
        tz.goal = s.target.z;
      }
      clampTarget();
      if (immediate) {
        for (const c of channels) syncChannel(c);
        applyCamera();
      }
    },
    snap(dir = 1) {
      touched();
      az.goal += dir * CAMERA.snapAngle;
    },
  };
}

// Voidworks — boot and frame loop. Wiring only: no gameplay logic lives here.

import * as THREE from 'three';
import { DEBUG } from './config.js';
import { createScene } from './render/scene.js';
import { createOrbit } from './camera/orbit.js';
import { createWorld } from './world/world.js';
import { createHud } from './ui/hud.js';
import { createMenu } from './ui/menu.js';
import { createAudio } from './audio/audio.js';
import { createBuildbar } from './ui/buildbar.js';
import { createNetLink } from './net/net.js';

const canvas = document.getElementById('app');
const boot = document.getElementById('boot');
const bootBar = boot.querySelector('#bar > i');
const bootHint = boot.querySelector('#hint');

function progress(t, label) {
  bootBar.style.width = `${Math.round(t * 100)}%`;
  if (label) bootHint.textContent = label;
}

progress(0.1, 'building the void');

const view = createScene(canvas);
progress(0.35, 'placing the camera');

const orbit = createOrbit(view.camera, canvas);
progress(0.55, 'assembling the factory');

const world = await createWorld(view, orbit);
orbit.setBounds?.(() => world.bounds?.());
progress(0.85, 'wiring the readouts');

const hud = createHud(world);

world.audio = createAudio();
world.audio.setListener(view.camera);

const buildbar = createBuildbar(world);

world.net = createNetLink(world);
addEventListener('pagehide', () => world.net.leave());

const menu = createMenu({
  onPlay: (kind) => world.start?.(kind),
  onHost: (name, code) => world.net?.host?.(name, code),
  onJoin: (name, code) => world.net?.join?.(name, code),
  onSettings: (settings) => {
    view.setQuality?.(settings.quality);
    orbit.setSensitivity?.(settings.sensitivity);
    world.audio?.setLevels?.(settings);
  },
});
menu.show();

progress(1, 'ready');

setTimeout(() => boot.classList.add('hidden'), 260);

const clock = new THREE.Clock();
let raf = 0;

function frame() {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  orbit.update(dt);
  world.update(dt);
  world.net.update(dt);
  world.audio.update(dt);
  hud.update(dt);
  buildbar.update(dt);
  view.render(dt);
}
frame();

addEventListener('resize', () => view.resize());

window.vw = {
  THREE,
  view,
  orbit,
  world,
  hud,
  buildbar,
  menu,
  debug: {
    spawn(n) {
      return world.debugSpawn ? world.debugSpawn(n) : 0;
    },
    stop() {
      cancelAnimationFrame(raf);
    },
  },
};

if (DEBUG.scene) window.vw.debug.sceneName = DEBUG.scene;

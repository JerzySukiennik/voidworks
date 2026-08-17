// Voidworks — renderer, infinite white void, floating-volume light rig and the post chain.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RENDER, CAMERA } from '../config.js';

// Anything on this layer is skipped by the ambient-occlusion g-buffer. A transparent sheet written
// as opaque depth makes GTAO shade a black mass behind it, which is what the upgrader panes hit.
// Other pieces should call markTransparent() on any see-through or glowing object they build.
export const LAYER_NO_AO = 11;

export function markTransparent(object3D) {
  object3D.traverse((o) => o.layers.enable(LAYER_NO_AO));
  return object3D;
}

// Deliberately not restricted to Mesh: Sprites, Points and Lines all land in the g-buffer as
// opaque cards if they are let through, and they are exactly the things people add later.
function excludedFromAO(o) {
  if (o.layers.isEnabled(LAYER_NO_AO)) return true;
  if (o.isSprite || o.isPoints || o.isLine) return true;
  const m = o.material;
  if (!m) return false;
  if (Array.isArray(m)) return m.some((x) => x.transparent || x.depthWrite === false);
  return m.transparent === true || m.depthWrite === false;
}

// The void is 45% of the frame, so it has to read as lit space rather than paper. Three cues, all
// applied after tone mapping: a falloff away from where the key light sits on screen, a radial
// vignette, and a dither that keeps the near-white ramp from banding on 8-bit displays.
const VoidGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: RENDER.vignette.amount },
    softness: { value: RENDER.vignette.softness },
    tilt: { value: RENDER.vignette.tilt },
    warm: { value: new THREE.Vector3(1.0, 0.997, 0.99) },
    cool: { value: new THREE.Vector3(0.986, 0.992, 1.0) },
    lightDir: { value: new THREE.Vector2(-0.5, 0.85) },
    grain: { value: RENDER.vignette.grain },
    aspect: { value: 1 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount, softness, tilt, grain, aspect;
    uniform vec2 lightDir;
    uniform vec3 warm, cool;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      float halfDiag = length(vec2(aspect, 1.0) * 0.5);
      float d = length(p) / halfDiag;

      float away = clamp(dot(p / halfDiag, -normalize(lightDir)) * 0.5 + 0.5, 0.0, 1.0);
      c.rgb *= 1.0 - tilt * away * away;
      c.rgb *= mix(cool, warm, 1.0 - away);

      c.rgb *= 1.0 - amount * smoothstep(softness, 1.30, d);

      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) * grain;
      gl_FragColor = c;
    }
  `,
};

function backdropTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, RENDER.backdrop.top);
  g.addColorStop(0.46, RENDER.backdrop.mid);
  g.addColorStop(1, RENDER.backdrop.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function directional(cfg, distance) {
  const d = new THREE.Vector3().fromArray(cfg.dir).normalize();
  const light = new THREE.DirectionalLight(new THREE.Color(cfg.color), cfg.intensity);
  light.position.copy(d).multiplyScalar(distance);
  return light;
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = RENDER.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.background = backdropTexture();
  scene.fog = new THREE.Fog(new THREE.Color(RENDER.fog.color), 20, 90);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, CAMERA.near, CAMERA.far);
  camera.position.set(16, 14, 20);

  // The build volume floats in the void: no ground, so the shadow camera is fitted to a box in the air.
  const centre = new THREE.Vector3().fromArray(RENDER.volume.center);

  const key = directional(RENDER.light.key, RENDER.shadow.distance);
  key.position.add(centre);
  key.target.position.copy(centre);
  key.castShadow = true;
  const s = key.shadow;
  s.mapSize.set(RENDER.shadow.mapSize, RENDER.shadow.mapSize);
  s.camera.left = -RENDER.shadow.extent;
  s.camera.right = RENDER.shadow.extent;
  s.camera.top = RENDER.shadow.extent;
  s.camera.bottom = -RENDER.shadow.extent;
  s.camera.near = RENDER.shadow.near;
  s.camera.far = RENDER.shadow.far;
  s.bias = RENDER.shadow.bias;
  s.normalBias = RENDER.shadow.normalBias;
  s.radius = RENDER.shadow.radius;
  s.blurSamples = RENDER.shadow.blurSamples;
  s.camera.updateProjectionMatrix();

  const fill = directional(RENDER.light.fill, 40);
  fill.position.add(centre);
  fill.target.position.copy(centre);

  const rim = directional(RENDER.light.rim, 40);
  rim.position.add(centre);
  rim.target.position.copy(centre);

  const hemi = new THREE.HemisphereLight(
    new THREE.Color(RENDER.light.hemi.sky),
    new THREE.Color(RENDER.light.hemi.ground),
    RENDER.light.hemi.intensity,
  );

  scene.add(key, key.target, fill, fill.target, rim, rim.target, hemi);

  const _lightPoint = new THREE.Vector3();
  let shadowPrimed = false;
  let quality = 'high';
  let preset = RENDER.quality.high;
  let composer = null;
  let renderPass = null;
  let gtao = null;
  let bloom = null;
  let smaa = null;
  let grade = null;

  function drawSize() {
    return [innerWidth, innerHeight];
  }

  function buildComposer() {
    if (composer) composer.dispose();
    const [w, h] = drawSize();
    const pr = Math.min(preset.pixelRatioMax, RENDER.pixelRatioMax, devicePixelRatio);
    renderer.setPixelRatio(pr);

    const target = new THREE.WebGLRenderTarget(Math.max(1, w * pr), Math.max(1, h * pr), {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);

    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    if (preset.ao && RENDER.ao.enabled) {
      gtao = new GTAOPass(scene, camera, w, h);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = RENDER.ao.intensity;
      gtao.updateGtaoMaterial({
        radius: RENDER.ao.radius,
        distanceExponent: 1.4,
        thickness: RENDER.ao.thickness,
        scale: RENDER.ao.scaleStrength,
        samples: RENDER.ao.samples,
        distanceFallOff: 1,
        screenSpaceRadius: false,
      });
      const pd = RENDER.ao.denoise;
      gtao.updatePdMaterial({
        lumaPhi: pd.lumaPhi,
        depthPhi: pd.depthPhi,
        normalPhi: pd.normalPhi,
        radius: pd.radius,
        radiusExponent: 1,
        rings: pd.rings,
        samples: pd.samples,
      });
      // Occlusion is low frequency, so it is gathered at half res and bilinearly upsampled —
      // full-res GTAO alone costs more than the rest of the frame put together.
      const full = gtao.setSize.bind(gtao);
      gtao.setSize = (aw, ah) => {
        full(aw, ah);
        const sw = Math.max(1, Math.round(aw * RENDER.ao.scale));
        const sh = Math.max(1, Math.round(ah * RENDER.ao.scale));
        gtao.gtaoRenderTarget.setSize(sw, sh);
        gtao.pdRenderTarget.setSize(sw, sh);
        gtao.gtaoMaterial.uniforms.resolution.value.set(sw, sh);
        gtao.pdMaterial.uniforms.resolution.value.set(sw, sh);
      };
      // Two things must stay out of the AO g-buffer. Transparent sheets, because opaque depth makes
      // GTAO shade a black mass behind them. And the void backdrop, because a screen-space background
      // texture lands in the normal buffer and stamps black bars over the scene.
      const baseVisibility = gtao.overrideVisibility.bind(gtao);
      const baseRestore = gtao.restoreVisibility.bind(gtao);
      let stashedBackground = null;
      gtao.overrideVisibility = () => {
        baseVisibility();
        stashedBackground = scene.background;
        scene.background = null;
        scene.traverse((o) => {
          if (o !== scene && excludedFromAO(o)) o.visible = false;
        });
      };
      gtao.restoreVisibility = () => {
        baseRestore();
        scene.background = stashedBackground;
      };
      gtao.setSize(w, h);
      composer.addPass(gtao);
    } else {
      gtao = null;
    }

    if (preset.bloom && RENDER.bloom.enabled) {
      bloom = new UnrealBloomPass(
        new THREE.Vector2(w * RENDER.bloom.scale, h * RENDER.bloom.scale),
        RENDER.bloom.strength,
        RENDER.bloom.radius,
        RENDER.bloom.threshold,
      );
      const fullBloom = bloom.setSize.bind(bloom);
      bloom.setSize = (bw, bh) => fullBloom(bw * RENDER.bloom.scale, bh * RENDER.bloom.scale);
      composer.addPass(bloom);
    } else {
      bloom = null;
    }

    composer.addPass(new OutputPass());

    // SMAA rather than MSAA: one full-res pass instead of a 4x half-float resolve, which is
    // what actually fits on an integrated GPU. Flat-shaded facets need clean edges above all.
    smaa = preset.smaa ? new SMAAPass(w, h) : null;
    if (smaa) composer.addPass(smaa);

    grade = new ShaderPass(VoidGradeShader);
    grade.uniforms.aspect.value = w / h;
    grade.renderToScreen = true;
    composer.addPass(grade);
  }

  function resize() {
    const [w, h] = drawSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (!composer) return;
    composer.setSize(w, h);
    if (gtao) gtao.setSize(w, h);
    if (bloom) bloom.setSize(w, h);
    if (smaa) smaa.setSize(w, h);
    if (grade) grade.uniforms.aspect.value = w / h;
  }

  function setQuality(q) {
    const next = RENDER.quality[q] ? q : 'high';
    if (next === quality && composer) return;
    quality = next;
    preset = RENDER.quality[next];
    key.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    if (key.shadow.map) {
      key.shadow.map.dispose();
      key.shadow.map = null;
    }
    shadowPrimed = false;
    buildComposer();
    resize();
  }

  setQuality('high');

  return {
    renderer,
    scene,
    camera,
    lights: { key, fill, rim, hemi },
    markTransparent,
    passes() {
      return { renderPass, gtao, bloom, smaa, grade };
    },
    get quality() {
      return quality;
    },
    render(dt = 0.016) {
      // The shadow map allocated on the very first frame comes back empty; forcing one rebuild
      // after that frame is what makes the key light actually cast. Costs one reallocation.
      if (!shadowPrimed && key.shadow.map) {
        shadowPrimed = true;
        key.shadow.map.dispose();
        key.shadow.map = null;
      }
      // Project the key light onto the screen so the void's falloff follows the actual light.
      _lightPoint.copy(key.position).sub(centre).normalize().multiplyScalar(600).add(centre).project(camera);
      grade.uniforms.lightDir.value.set(_lightPoint.x || -0.5, _lightPoint.y || 0.85);

      const d = camera.position.distanceTo(centre);
      const span = RENDER.volume.radius;
      scene.fog.near = Math.max(0.5, d - span * RENDER.fog.leadIn);
      scene.fog.far = d + span * RENDER.fog.reach;
      composer.render(dt);
    },
    resize,
    setQuality,
  };
}

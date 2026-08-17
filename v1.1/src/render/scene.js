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

// The AO g-buffer must only ever see opaque geometry that genuinely occludes. Rather than trusting
// every piece to remember markTransparent(), this is an allow-list: anything that is not a plain
// opaque Mesh/InstancedMesh/BatchedMesh/SkinnedMesh is refused. A Sprite let through stamps an
// opaque card into the normal buffer and GTAO shades a black rectangle behind it — that bug has
// already happened once here, and the fix that survives is the one nobody has to remember.
function opaqueMaterial(m) {
  if (!m) return false;
  if (m.transparent === true) return false;
  if (m.depthWrite === false) return false;
  if (m.blending !== undefined && m.blending !== THREE.NormalBlending) return false;
  if (m.opacity !== undefined && m.opacity < 1) return false;
  return true;
}

function excludedFromAO(o) {
  if (o.layers.isEnabled(LAYER_NO_AO)) return true;
  const isGBufferMesh = o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.isSkinnedMesh;
  if (!isGBufferMesh) {
    // Groups and Object3D containers carry no geometry, so letting them through is harmless and
    // keeps their children visible; anything else drawable (Sprite, Points, Line, LOD proxies)
    // is refused outright.
    return o.isObject3D === true && o.type !== 'Group' && o.type !== 'Object3D' && o.type !== 'Scene';
  }
  const m = o.material;
  if (Array.isArray(m)) return !m.every(opaqueMaterial);
  return !opaqueMaterial(m);
}

// three.js hard-codes VSM's light-bleed reduction at 0.3 and exposes no uniform for it. At 0.3 a
// half-float moment pair carries enough numerical noise that a shadow thrown more than a couple of
// units simply dissolves — which is exactly what a two-level factory needs to work. The chunk is
// patched once, at module load, before any material compiles.
let bleedPatched = false;
function patchShadowBleed(bleed) {
  if (bleedPatched) return;
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const from = '( softness_probability - 0.3 ) / ( 0.95 - 0.3 )';
  if (!src.includes(from)) return; // three changed the chunk; leave it alone rather than corrupt it
  const hi = Math.min(0.995, bleed + (0.95 - 0.3));
  THREE.ShaderChunk.shadowmap_pars_fragment = src.replace(
    from,
    `( softness_probability - ${bleed.toFixed(3)} ) / ( ${hi.toFixed(3)} - ${bleed.toFixed(3)} )`,
  );
  bleedPatched = true;
}

// Half the frame is void, so the void has to read as *space the factory hangs in* rather than
// unused canvas — while staying unmistakably white. Four cues, all applied after tone mapping:
//
//   lobe   a broad bright swell around wherever the key light actually projects on screen, so
//          the emptiness has a direction to it and the centre feels lit rather than filled
//   tilt   the opposite side falls away, and picks up the cool half of the split at the same time
//   edge   the outer frame closes down, which is what makes the middle read as the lit part
//   floor  none of the above may push a white pixel below this — the mud band at L180–220 is
//          where a near-white gradient goes to die, so the void is clamped clear of it
//
// plus a dither, because a 20-value ramp across 1600px WILL band on an 8-bit display.
const VoidGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: RENDER.vignette.amount },
    softness: { value: RENDER.vignette.softness },
    tilt: { value: RENDER.vignette.tilt },
    lobe: { value: RENDER.vignette.lobe },
    floorLevel: { value: RENDER.vignette.floor },
    warm: { value: new THREE.Vector3(1.0, 0.996, 0.986) },
    cool: { value: new THREE.Vector3(0.982, 0.99, 1.0) },
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
    uniform float amount, softness, tilt, lobe, floorLevel, grain, aspect;
    uniform vec2 lightDir;
    uniform vec3 warm, cool;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      float halfDiag = length(vec2(aspect, 1.0) * 0.5);
      float d = length(p) / halfDiag;
      vec2 l = normalize(lightDir);

      // 0 at the light, 1 directly opposite it.
      float away = clamp(dot(p / halfDiag, -l) * 0.5 + 0.5, 0.0, 1.0);

      // A soft swell centred on the light, falling off with distance from it across the frame.
      float toLight = 1.0 - clamp(length(p / halfDiag - l * 0.62) / 1.15, 0.0, 1.0);
      float gain = 1.0 + lobe * toLight * toLight;

      gain *= 1.0 - tilt * away * away;
      gain *= 1.0 - amount * smoothstep(softness, 1.32, d);

      // Everything above darkens; none of it is allowed to drag the void into the mud band.
      gain = max(gain, floorLevel);

      c.rgb *= gain;
      c.rgb *= mix(cool, warm, 1.0 - away);

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
  patchShadowBleed(RENDER.shadow.bleed);

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

  const keyDir = new THREE.Vector3().fromArray(RENDER.light.key.dir).normalize();

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
  // Depth range hugs the fitted box instead of spanning the whole void. VSM keeps two half-float
  // moments, so its light bleed is proportional to how much of [near, far] is wasted; the old
  // 1..110 threw away two thirds of the range and long-throw shadows dissolved because of it.
  // Worst case along the light axis: a corner of the extent box, plus the volume's own height.
  const shadowReach =
    RENDER.shadow.extent * Math.SQRT2 * Math.sqrt(Math.max(0, 1 - keyDir.y * keyDir.y)) +
    RENDER.volume.height * 0.5 +
    RENDER.shadow.depthPad;
  s.camera.near = Math.max(0.5, RENDER.shadow.distance - shadowReach);
  s.camera.far = RENDER.shadow.distance + shadowReach;
  s.bias = RENDER.shadow.bias;
  s.normalBias = RENDER.shadow.normalBias;
  s.radius = RENDER.shadow.radius;
  s.blurSamples = RENDER.shadow.blurSamples;
  s.intensity = RENDER.shadow.intensity;
  s.camera.updateProjectionMatrix();

  // Basis of the light, used to texel-snap the shadow camera as it follows the view. Without the
  // snap, sliding the shadow frustum makes every shadow edge crawl while you orbit.
  const lightBasis = new THREE.Matrix4().lookAt(keyDir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
  const lightBasisInv = lightBasis.clone().invert();
  const _fit = new THREE.Vector3();
  const _fwd = new THREE.Vector3();

  // There is no ground to anchor the shadow camera to, so it is fitted to the point the CAMERA is
  // looking at, projected onto the volume's mid plane and clamped inside the volume. That buys a
  // 17-unit extent (0.017 world units per texel at 2048) instead of covering the whole 26-unit
  // build radius at half the density, without ever losing coverage of what is on screen.
  function fitShadowCamera() {
    camera.getWorldDirection(_fwd);
    const t = Math.abs(_fwd.y) > 1e-3 ? (centre.y - camera.position.y) / _fwd.y : -1;
    if (t > 0 && t < 400) _fit.copy(camera.position).addScaledVector(_fwd, t);
    else _fit.copy(centre);
    _fit.y = centre.y;

    const r = RENDER.volume.radius;
    _fit.x = Math.min(centre.x + r, Math.max(centre.x - r, _fit.x));
    _fit.z = Math.min(centre.z + r, Math.max(centre.z - r, _fit.z));

    const q = (2 * RENDER.shadow.extent) / s.mapSize.x;
    _fit.applyMatrix4(lightBasisInv);
    _fit.x = Math.round(_fit.x / q) * q;
    _fit.y = Math.round(_fit.y / q) * q;
    _fit.applyMatrix4(lightBasis);

    key.target.position.copy(_fit);
    key.position.copy(keyDir).multiplyScalar(RENDER.shadow.distance).add(_fit);
    key.target.updateMatrixWorld();
  }

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

  // Switching shadow map type changes a #define, so every material has to recompile. Only ever
  // called from setQuality, which is a user action, never per frame.
  function recompileMaterials() {
    scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else m.needsUpdate = true;
    });
  }

  function setQuality(q) {
    const next = RENDER.quality[q] ? q : 'high';
    if (next === quality && composer) return;
    quality = next;
    preset = RENDER.quality[next];

    const wantVsm = preset.shadowType !== 'pcf';
    const type = wantVsm ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;
    const typeChanged = renderer.shadowMap.type !== type;
    renderer.shadowMap.type = type;
    key.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    // VSM blurs the shadow map with two extra full-target passes every frame; on low that is the
    // whole point of dropping to PCF, so the sample count goes with it.
    key.shadow.blurSamples = wantVsm ? preset.shadowBlur || RENDER.shadow.blurSamples : 0;
    if (key.shadow.map) {
      key.shadow.map.dispose();
      key.shadow.map = null;
    }
    shadowPrimed = false;
    if (typeChanged) recompileMaterials();
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
      fitShadowCamera();

      // Project the key light onto the screen so the void's falloff follows the actual light.
      _lightPoint.copy(keyDir).multiplyScalar(600).add(centre).project(camera);
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

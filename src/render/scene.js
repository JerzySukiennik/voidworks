// Voidworks — renderer, infinite white void, floating-volume light rig and the post chain.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
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

// NOTE: the AO g-buffer allow-list that used to live here is gone. GTAO no longer renders its own
// g-buffer at all — it reads the depth RenderPass wrote — so "what may enter the g-buffer" is now
// decided by depthWrite, which the transparent pieces already set correctly. LAYER_NO_AO and
// markTransparent stay exported because other pieces call them and because they remain the right
// marker if a future pass ever needs a scene-wide "this is see-through" hint.

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
//
// This pass also does the job OutputPass used to: tone mapping and the sRGB transfer. On this GPU a
// single full-resolution pass over a 2400x1500 half-float buffer costs 2-4 ms, so a pass that exists
// only to convert colour space is a pass worth not having. The order inside the shader reproduces
// the old two-pass chain exactly — tone map, encode, THEN gain — so the grade's tuning still means
// what it meant when it was applied to OutputPass's output.
const VoidGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vwExposure: { value: RENDER.exposure },
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
    // Written out rather than pulled from THREE.ShaderChunk: three already auto-injects the
    // colour-space chunk into every ShaderMaterial, so including it here is a redefinition error,
    // and it injects the tone-mapping chunk only when the pass happens to render to the screen —
    // which changes with quality tier. Owning both functions keeps the pass identical either way.
    vec3 vwNeutralToneMapping(vec3 color) {
      const float StartCompression = 0.8 - 0.04;
      const float Desaturation = 0.15;
      float x = min(color.r, min(color.g, color.b));
      float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
      color -= offset;
      float peak = max(color.r, max(color.g, color.b));
      if (peak < StartCompression) return color;
      float d = 1.0 - StartCompression;
      float newPeak = 1.0 - d * d / (peak + d - StartCompression);
      color *= newPeak / peak;
      float g = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);
      return mix(color, vec3(newPeak), g);
    }
    vec3 vwSRGB(vec3 v) {
      return mix(pow(v, vec3(0.41666)) * 1.055 - vec3(0.055), v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308))));
    }
    // NOT named toneMappingExposure: three injects its own tone-mapping chunk (which declares that
    // exact uniform) into any ShaderMaterial that renders straight to the screen, and this pass is
    // last on the tiers without SMAA. Same name = redefinition = the whole chain fails to compile.
    uniform float vwExposure;
    uniform sampler2D tDiffuse;
    uniform float amount, softness, tilt, lobe, floorLevel, grain, aspect;
    uniform vec2 lightDir;
    uniform vec3 warm, cool;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = vwSRGB(vwNeutralToneMapping(max(c.rgb, 0.0) * vwExposure));
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
    // EffectComposer.dispose() only frees its own two ping-pong targets — the passes keep theirs.
    // GTAO alone holds six render targets, SMAA three, bloom ten; rebuilding the chain on every
    // quality switch without this loop leaks all of them and the GPU cost of a frame climbs with
    // the number of switches, which is exactly the "drift" that made earlier benchmarks worthless.
    if (composer) {
      for (const pass of composer.passes) pass.dispose?.();
      composer.dispose();
    }
    const [w, h] = drawSize();
    const pr = Math.min(preset.pixelRatioMax, RENDER.pixelRatioMax, devicePixelRatio);
    renderer.setPixelRatio(pr);

    // A depth texture on the composer target is what lets GTAO skip re-drawing the entire scene:
    // RenderPass writes depth here, GTAO reads it back. RenderPass has needsSwap = false and draws
    // into readBuffer, so the buffer GTAO receives is exactly the one this depth belongs to.
    const depthTexture = new THREE.DepthTexture(Math.max(1, w * pr), Math.max(1, h * pr));
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;

    const target = new THREE.WebGLRenderTarget(Math.max(1, w * pr), Math.max(1, h * pr), {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthTexture,
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
      // The single biggest render-side win in this file. By default GTAOPass draws the WHOLE scene
      // a second time into its own depth+normal g-buffer — at 171 buildings that is ~750 extra draw
      // calls and two full scene.traverse() walks every frame, and this machine's driver charges
      // ~25 us per draw call. Handing it the depth RenderPass already wrote drops all of it; normals
      // are then reconstructed from depth in the shader, which is exactly right for a scene made of
      // flat-shaded facets.
      //
      // It also retires the visibility hack this pass used to need. The old g-buffer render had to
      // hide transparent sheets (opaque depth made GTAO shade a black mass behind them) and the void
      // backdrop (a screen-space background landed in the normal buffer as black bars). Main-pass
      // depth has neither problem by construction: panes and labels are depthWrite:false and the
      // background never writes depth, so they are already absent.
      gtao.setGBuffer(depthTexture, undefined);
      const full = gtao.setSize.bind(gtao);
      gtao.setSize = (aw, ah) => {
        full(aw, ah);
        // Nothing renders into the g-buffer any more; keep it at 1x1 instead of full-screen.
        gtao.normalRenderTarget.setSize(1, 1);
        const aoScale = preset.aoScale || RENDER.ao.scale;
        const sw = Math.max(1, Math.round(aw * aoScale));
        const sh = Math.max(1, Math.round(ah * aoScale));
        gtao.gtaoRenderTarget.setSize(sw, sh);
        gtao.pdRenderTarget.setSize(sw, sh);
        gtao.gtaoMaterial.uniforms.resolution.value.set(sw, sh);
        gtao.pdMaterial.uniforms.resolution.value.set(sw, sh);
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

    // Tone map, encode and grade in ONE pass, sitting where OutputPass used to. SMAA still runs
    // last, on display-referred pixels, which is where its edge detection is designed to work.
    grade = new ShaderPass(VoidGradeShader);
    grade.uniforms.aspect.value = w / h;
    grade.uniforms.vwExposure.value = RENDER.exposure;
    composer.addPass(grade);

    // SMAA rather than MSAA: one full-res pass instead of a 4x half-float resolve, which is
    // what actually fits on an integrated GPU. Flat-shaded facets need clean edges above all.
    smaa = preset.smaa ? new SMAAPass(w, h) : null;
    if (smaa) composer.addPass(smaa);

    // Whatever ends up last goes straight to the default framebuffer instead of through a copy.
    const lastPass = composer.passes[composer.passes.length - 1];
    lastPass.renderToScreen = true;
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

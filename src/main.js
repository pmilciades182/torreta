import './style.css'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js'
import { OutlinePass }    from 'three/addons/postprocessing/OutlinePass.js'
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js'
import { GLTFLoader }     from 'three/addons/loaders/GLTFLoader.js'
import { Howl, Howler } from 'howler';
import areosaurUrl from '../models/Areosaur.1.glb?url';

// ─── Scene ────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0730);
scene.fog = new THREE.Fog(0x0d0730, 60, 220);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const clock  = new THREE.Clock();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ─── Post Processing ──────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const enemyOutline = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
enemyOutline.edgeStrength = 6; enemyOutline.edgeThickness = 2.0; enemyOutline.edgeGlow = 1.2;
enemyOutline.visibleEdgeColor.set(0xff2200); enemyOutline.hiddenEdgeColor.set(0x880000);
composer.addPass(enemyOutline);

const turretOutline = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
turretOutline.edgeStrength = 5; turretOutline.edgeThickness = 1.8; turretOutline.edgeGlow = 0.9;
turretOutline.visibleEdgeColor.set(0x00ffcc); turretOutline.hiddenEdgeColor.set(0x006655);
composer.addPass(turretOutline);

const crtPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;

    vec3 toonSaturate(vec3 c, float s) {
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      return mix(vec3(lum), c, s);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      // Saturation boost — colores vivos tipo toon
      col = toonSaturate(col, 2.0);

      // Posterize suave (8 pasos) — cel-shading look
      float steps = 8.0;
      col = floor(col * steps + 0.5) / steps;

      // Contrast S-curve (smoothstep)
      col = col * col * (3.0 - 2.0 * col);

      // Brightness
      col *= 1.18;

      // Color grade: sombras frias azuladas, luces cálidas doradas (Zelda)
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 shadow = vec3(0.82, 0.88, 1.15);
      vec3 highlight = vec3(1.10, 1.05, 0.85);
      col *= mix(shadow, highlight, smoothstep(0.0, 0.8, lum));

      col = clamp(col, 0.0, 1.0);

      // Viñeta suave
      vec2 v = vUv * (1.0 - vUv);
      col *= pow(v.x * v.y * 16.0, 0.10);

      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(crtPass);

// ─── Audio ────────────────────────────────────────────────────────────────────
// Howler inicializa el AudioContext; lo usamos para síntesis procedural
const _dummyHowl = new Howl({
  src: ['data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='],
  volume: 0,
});

// ── Master chain: duckGain → masterGain → compressor → ctx.destination ────────
let _masterGain = null, _duckGain = null, _compressor = null;

function ensureMasterChain(ctx) {
  if (_masterGain) return { masterGain: _masterGain, duckGain: _duckGain };

  _compressor = ctx.createDynamicsCompressor();
  _compressor.threshold.value = -18;
  _compressor.knee.value      = 8;
  _compressor.ratio.value     = 4;
  _compressor.attack.value    = 0.003;
  _compressor.release.value   = 0.15;
  _compressor.connect(ctx.destination);

  _masterGain = ctx.createGain();
  _masterGain.gain.value = 0.85;
  _masterGain.connect(_compressor);

  _duckGain = ctx.createGain();
  _duckGain.gain.value = 1.0;
  _duckGain.connect(_masterGain);

  // Si el reverb ya fue creado y conectado a ctx.destination, removerlo y reconectarlo
  if (_reverbNode) { _reverbNode.disconnect(); _reverbNode.connect(_duckGain); }

  return { masterGain: _masterGain, duckGain: _duckGain };
}

// Duck: baja todos los sonidos distintos al disparo del jugador brevemente
function triggerDuck(ctx) {
  const { duckGain } = ensureMasterChain(ctx);
  const t = ctx.currentTime;
  duckGain.gain.cancelScheduledValues(t);
  duckGain.gain.setValueAtTime(duckGain.gain.value, t);
  duckGain.gain.linearRampToValueAtTime(0.18, t + 0.012); // caída rápida
  duckGain.gain.linearRampToValueAtTime(1.0,  t + 0.20);  // recuperación suave
}

// Reverb compartido — conecta a duckGain (parte del bus general)
let _reverbNode = null;
function getReverb(ctx) {
  if (_reverbNode) return _reverbNode;
  const { duckGain } = ensureMasterChain(ctx);
  const sampleRate = ctx.sampleRate;
  const duration   = 1.2;
  const decay      = 3.5;
  const len        = Math.floor(sampleRate * duration);
  const buf        = ctx.createBuffer(2, len, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  _reverbNode = ctx.createConvolver();
  _reverbNode.buffer = buf;
  _reverbNode.connect(duckGain);
  return _reverbNode;
}

// Escala de Fa# menor natural (semitonos desde F#)
const FS_MINOR = [0, 2, 3, 5, 7, 8, 10];

// Devuelve una nota aleatoria de la escala de Fa# menor
// dentro de ±4 semitonos de la frecuencia base
function randPitch(base) {
  const midi       = 69 + 12 * Math.log2(base / 440); // F#4 = MIDI 66
  const centerOct  = Math.round((midi - 66) / 12);
  const candidates = [];
  for (let o = centerOct - 1; o <= centerOct + 1; o++) {
    for (const s of FS_MINOR) {
      const m = 66 + o * 12 + s;
      if (Math.abs(m - midi) <= 4) candidates.push(m);
    }
  }
  const picked = candidates.length
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : Math.round(midi); // fallback: redondear al semitono más cercano
  return 440 * Math.pow(2, (picked - 69) / 12);
}

// Crea un PannerNode situado en worldPos y actualiza el listener con la cámara
// refDistance / rolloffFactor son ajustables por tipo de sonido
function makeSpatialPanner(ctx, worldPos, refDist = 5, rolloff = 1.4) {
  const listener = ctx.listener;
  const cp = new THREE.Vector3(); camera.getWorldPosition(cp);
  const cf = new THREE.Vector3(); camera.getWorldDirection(cf);
  if (listener.positionX) {
    listener.positionX.setValueAtTime(cp.x, ctx.currentTime);
    listener.positionY.setValueAtTime(cp.y, ctx.currentTime);
    listener.positionZ.setValueAtTime(cp.z, ctx.currentTime);
    listener.forwardX.setValueAtTime(cf.x, ctx.currentTime);
    listener.forwardY.setValueAtTime(cf.y, ctx.currentTime);
    listener.forwardZ.setValueAtTime(cf.z, ctx.currentTime);
    listener.upX.setValueAtTime(0, ctx.currentTime);
    listener.upY.setValueAtTime(1, ctx.currentTime);
    listener.upZ.setValueAtTime(0, ctx.currentTime);
  } else {
    listener.setPosition(cp.x, cp.y, cp.z);
    listener.setOrientation(cf.x, cf.y, cf.z, 0, 1, 0);
  }
  const panner = ctx.createPanner();
  panner.panningModel  = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance   = refDist;
  panner.maxDistance   = 140;
  panner.rolloffFactor = rolloff;
  if (panner.positionX) {
    panner.positionX.setValueAtTime(worldPos.x, ctx.currentTime);
    panner.positionY.setValueAtTime(worldPos.y, ctx.currentTime);
    panner.positionZ.setValueAtTime(worldPos.z, ctx.currentTime);
  } else {
    panner.setPosition(worldPos.x, worldPos.y, worldPos.z);
  }
  const { duckGain } = ensureMasterChain(ctx);
  panner.connect(duckGain);
  return panner;
}

// Impacto metálico — resonancia inarmónica + click, espacializado
function playHitSound(worldPos) {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  const panner = makeSpatialPanner(ctx, worldPos, 6, 1.8);
  const reverb = getReverb(ctx);
  const t      = ctx.currentTime;

  // 3 sines inarmónicos = timbre metálico real (ratios no enteros)
  const rings = [
    { f: randPitch(420), g: 0.55, d: 0.28 },
    { f: randPitch(780), g: 0.35, d: 0.20 },
    { f: randPitch(1240), g: 0.18, d: 0.13 },
  ];
  for (const r of rings) {
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    const gW  = ctx.createGain();
    osc.type  = 'sine';
    osc.frequency.value = r.f;
    g.gain.setValueAtTime(r.g, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + r.d);
    gW.gain.value = 0.084; // −30% reverb
    osc.connect(g);
    g.connect(panner);
    g.connect(gW); gW.connect(reverb);
    osc.start(t); osc.stop(t + r.d);
  }

  // Click inicial — transiente breve que activa el "golpe"
  const cLen  = Math.floor(ctx.sampleRate * 0.018);
  const cBuf  = ctx.createBuffer(1, cLen, ctx.sampleRate);
  const cData = cBuf.getChannelData(0);
  for (let i = 0; i < cLen; i++) cData[i] = (Math.random() * 2 - 1) * (1 - i / cLen);
  const cSrc  = ctx.createBufferSource();
  cSrc.buffer = cBuf;
  const gC    = ctx.createGain();
  gC.gain.setValueAtTime(0.9, t);
  gC.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
  cSrc.connect(gC); gC.connect(panner);
  cSrc.start(t);
}

// Explosión — volumen base ×0.6 (−40%), reverb wet ×0.7 (−30%), con delay
function playExplosionSound(worldPos) {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  const panner = makeSpatialPanner(ctx, worldPos, 3, 2.5);
  const reverb = getReverb(ctx);
  const { duckGain } = ensureMasterChain(ctx);
  const t      = ctx.currentTime;
  const V      = 0.6; // factor de volumen global (−40%)
  const RV     = 0.7; // factor de reverb (−30%)

  // ── Delay slapback ─────────────────────────────────────────────────────────
  // Cadena: delay → lpf → feedback → delay (loop)
  //                     ↘ delayOut → duckGain
  const delay    = ctx.createDelay(1.0);
  delay.delayTime.value = 0.19;
  const dlpf     = ctx.createBiquadFilter();
  dlpf.type      = 'lowpass'; dlpf.frequency.value = 520; // ecos más oscuros
  const dfb      = ctx.createGain(); dfb.gain.value = 0.32; // feedback
  const delayOut = ctx.createGain(); delayOut.gain.value = 0.28; // wet del delay
  delay.connect(dlpf); dlpf.connect(dfb); dfb.connect(delay); // loop de feedback
  dlpf.connect(delayOut); delayOut.connect(duckGain);

  // Capa 1: sub-boom — square filtrado, ataque durísimo
  const sub    = ctx.createOscillator();
  const gSub   = ctx.createGain();
  sub.type     = 'square';
  sub.frequency.setValueAtTime(randPitch(68), t);
  sub.frequency.exponentialRampToValueAtTime(14, t + 0.9);
  gSub.gain.setValueAtTime(0, t);
  gSub.gain.linearRampToValueAtTime(2.56 * V, t + 0.008);
  gSub.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  const subLpf = ctx.createBiquadFilter();
  subLpf.type  = 'lowpass'; subLpf.frequency.value = 220;
  sub.connect(subLpf); subLpf.connect(gSub); gSub.connect(panner);
  sub.start(t); sub.stop(t + 0.9);

  // Capa 2: mid-punch — sawtooth medios bajos
  const mid    = ctx.createOscillator();
  const gMid   = ctx.createGain();
  mid.type     = 'sawtooth';
  mid.frequency.setValueAtTime(randPitch(95), t);
  mid.frequency.exponentialRampToValueAtTime(18, t + 0.45);
  gMid.gain.setValueAtTime(1.28 * V, t);
  gMid.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  mid.connect(gMid); gMid.connect(panner); gMid.connect(delay);
  mid.start(t); mid.stop(t + 0.45);

  // Capa 3: noise LPF 900 Hz + reverb + delay
  const nLen   = Math.floor(ctx.sampleRate * 0.9);
  const nBuf   = ctx.createBuffer(1, nLen, ctx.sampleRate);
  const nData  = nBuf.getChannelData(0);
  for (let i = 0; i < nLen; i++) nData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 1.6);
  const nSrc   = ctx.createBufferSource(); nSrc.buffer = nBuf;
  const lpf    = ctx.createBiquadFilter();
  lpf.type     = 'lowpass'; lpf.frequency.value = 900;
  const gN     = ctx.createGain();
  gN.gain.setValueAtTime(1.6 * V, t);
  gN.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  const gNWet  = ctx.createGain(); gNWet.gain.value = 0.36 * RV;
  nSrc.connect(lpf); lpf.connect(gN);
  gN.connect(panner);
  gN.connect(gNWet);  gNWet.connect(reverb);
  gN.connect(delay);
  nSrc.start(t);

  // Capa 4: click de impacto
  const cLen   = Math.floor(ctx.sampleRate * 0.03);
  const cBuf   = ctx.createBuffer(1, cLen, ctx.sampleRate);
  const cData  = cBuf.getChannelData(0);
  for (let i = 0; i < cLen; i++) cData[i] = (Math.random() * 2 - 1) * (1 - i / cLen);
  const cSrc   = ctx.createBufferSource(); cSrc.buffer = cBuf;
  const hpf    = ctx.createBiquadFilter();
  hpf.type     = 'highpass'; hpf.frequency.value = 800;
  const gC     = ctx.createGain();
  gC.gain.setValueAtTime(0.96 * V, t);
  gC.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  cSrc.connect(hpf); hpf.connect(gC); gC.connect(panner);
  cSrc.start(t);

  // Capa 5: bajo melódico Fa# menor
  const bass   = ctx.createOscillator();
  const gBass  = ctx.createGain();
  const bassLpf = ctx.createBiquadFilter();
  bass.type    = 'sine';
  bass.frequency.value = randPitch(46);
  bassLpf.type = 'lowpass'; bassLpf.frequency.value = 180;
  gBass.gain.setValueAtTime(0, t);
  gBass.gain.linearRampToValueAtTime(1.8 * V, t + 0.02);
  gBass.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
  bass.connect(bassLpf); bassLpf.connect(gBass); gBass.connect(panner);
  const gBassWet = ctx.createGain(); gBassWet.gain.value = 0.22 * RV;
  bassLpf.connect(gBassWet); gBassWet.connect(reverb);
  bass.start(t); bass.stop(t + 1.1);

  // Capa 6: cola de reverb sintética
  const rLen   = Math.floor(ctx.sampleRate * 0.4);
  const rBuf   = ctx.createBuffer(1, rLen, ctx.sampleRate);
  const rData  = rBuf.getChannelData(0);
  for (let i = 0; i < rLen; i++) rData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rLen, 2.2);
  const rSrc   = ctx.createBufferSource(); rSrc.buffer = rBuf;
  const gR     = ctx.createGain(); gR.gain.value = 0.56 * V * RV;
  rSrc.connect(gR); gR.connect(reverb);
  rSrc.start(t);
}

// Disparo del jugador — sin espacialización, sonido de cañón pesado
function playShootSound() {
  const ctx = Howler.ctx;
  if (!ctx) return;
  const fire = () => {
    const reverb = getReverb(ctx);
    const t      = ctx.currentTime;
    const { masterGain } = ensureMasterChain(ctx);
    triggerDuck(ctx);

    function makeDistortion(amount) {
      const ws = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i * 2) / 256 - 1;
        curve[i] = (Math.PI + amount) * x / (Math.PI + amount * Math.abs(x));
      }
      ws.curve = curve;
      return ws;
    }

    const dry = ctx.createGain(); dry.connect(masterGain);
    const wet = ctx.createGain(); wet.connect(reverb);
    dry.gain.value = 1.0;
    wet.gain.value = 1.4;

    // Capa 1: sub-boom — descenso largo y pesado (el peso del cañón)
    const sub  = ctx.createOscillator();
    const gSub = ctx.createGain();
    sub.type   = 'sine';
    sub.frequency.setValueAtTime(randPitch(95), t);
    sub.frequency.exponentialRampToValueAtTime(22, t + 0.32);
    gSub.gain.setValueAtTime(0, t);
    gSub.gain.linearRampToValueAtTime(1.0, t + 0.004);
    gSub.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    sub.connect(gSub); gSub.connect(dry);
    sub.start(t); sub.stop(t + 0.32);

    // Capa 2: sawtooth con distorsión — cuerpo y crunch del disparo
    const osc1 = ctx.createOscillator();
    const dist = makeDistortion(130);
    const lpf1 = ctx.createBiquadFilter();
    const g1   = ctx.createGain();
    osc1.type  = 'sawtooth';
    osc1.frequency.setValueAtTime(randPitch(290), t);
    osc1.frequency.exponentialRampToValueAtTime(randPitch(32), t + 0.24);
    lpf1.type  = 'lowpass'; lpf1.frequency.value = 2400;
    g1.gain.setValueAtTime(0.42, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc1.connect(dist); dist.connect(lpf1); lpf1.connect(g1);
    g1.connect(dry); g1.connect(wet);
    osc1.start(t); osc1.stop(t + 0.24);

    // Capa 3: square detuneado — grosor en frecuencias medias
    const osc2 = ctx.createOscillator();
    const g2   = ctx.createGain();
    osc2.type  = 'square';
    osc2.frequency.setValueAtTime(randPitch(145), t);
    osc2.frequency.exponentialRampToValueAtTime(28, t + 0.20);
    g2.gain.setValueAtTime(0.16, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
    osc2.connect(g2); g2.connect(dry); g2.connect(wet);
    osc2.start(t); osc2.stop(t + 0.20);

    // Capa 4: crack inicial — noise HPF intenso y breve
    const nLen  = Math.floor(ctx.sampleRate * 0.038);
    const nBuf  = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nData = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 0.4);
    const nSrc   = ctx.createBufferSource(); nSrc.buffer = nBuf;
    const hpf    = ctx.createBiquadFilter();
    hpf.type     = 'highpass'; hpf.frequency.value = 2800;
    const gCrack = ctx.createGain();
    gCrack.gain.setValueAtTime(0.55, t);
    gCrack.gain.exponentialRampToValueAtTime(0.001, t + 0.038);
    nSrc.connect(hpf); hpf.connect(gCrack); gCrack.connect(dry);
    nSrc.start(t);

    // Capa 5: pressure wave — noise LPF, el "whomp" de la onda de presión
    const pLen  = Math.floor(ctx.sampleRate * 0.12);
    const pBuf  = ctx.createBuffer(1, pLen, ctx.sampleRate);
    const pData = pBuf.getChannelData(0);
    for (let i = 0; i < pLen; i++) pData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / pLen, 1.6);
    const pSrc  = ctx.createBufferSource(); pSrc.buffer = pBuf;
    const lpfP  = ctx.createBiquadFilter();
    lpfP.type   = 'lowpass'; lpfP.frequency.value = 380;
    const gPres = ctx.createGain();
    gPres.gain.setValueAtTime(0.65, t);
    gPres.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    pSrc.connect(lpfP); lpfP.connect(gPres); gPres.connect(dry); gPres.connect(wet);
    pSrc.start(t);
  };
  ctx.state === 'suspended' ? ctx.resume().then(fire) : fire();
}

// Disparo automático — espacial 3D, versión aligerada del cañón principal
function playAutoShootSound(worldPos) {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  const panner = makeSpatialPanner(ctx, worldPos);
  const reverb = getReverb(ctx);
  const t      = ctx.currentTime;

  const ws    = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = (Math.PI + 70) * x / (Math.PI + 70 * Math.abs(x));
  }
  ws.curve = curve;

  // Sub punch espacializado
  const sub  = ctx.createOscillator();
  const gSub = ctx.createGain();
  sub.type   = 'sine';
  sub.frequency.setValueAtTime(randPitch(85), t);
  sub.frequency.exponentialRampToValueAtTime(22, t + 0.24);
  gSub.gain.setValueAtTime(0, t);
  gSub.gain.linearRampToValueAtTime(0.60, t + 0.004);
  gSub.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
  sub.connect(gSub); gSub.connect(panner);
  sub.start(t); sub.stop(t + 0.24);

  // Cuerpo sawtooth con distorsión, espacializado
  const osc  = ctx.createOscillator();
  const lpf  = ctx.createBiquadFilter();
  const gDry = ctx.createGain();
  const gWet = ctx.createGain();
  lpf.type   = 'lowpass'; lpf.frequency.value = 2100;
  osc.type   = 'sawtooth';
  osc.frequency.setValueAtTime(randPitch(270), t);
  osc.frequency.exponentialRampToValueAtTime(randPitch(30), t + 0.20);
  gDry.gain.setValueAtTime(0.26, t);
  gDry.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
  gWet.gain.setValueAtTime(0.10, t);
  gWet.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
  osc.connect(ws); ws.connect(lpf);
  lpf.connect(gDry); gDry.connect(panner);
  lpf.connect(gWet); gWet.connect(reverb);
  osc.start(t); osc.stop(t + 0.20);

  // Crack espacializado
  const nLen  = Math.floor(ctx.sampleRate * 0.030);
  const nBuf  = ctx.createBuffer(1, nLen, ctx.sampleRate);
  const nData = nBuf.getChannelData(0);
  for (let i = 0; i < nLen; i++) nData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 0.5);
  const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf;
  const hpf  = ctx.createBiquadFilter();
  hpf.type   = 'highpass'; hpf.frequency.value = 2400;
  const gCr  = ctx.createGain();
  gCr.gain.setValueAtTime(0.32, t);
  gCr.gain.exponentialRampToValueAtTime(0.001, t + 0.030);
  nSrc.connect(hpf); hpf.connect(gCr); gCr.connect(panner);
  nSrc.start(t);
}

function playThunderSound() {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  const { masterGain } = ensureMasterChain(ctx);
  const t   = ctx.currentTime;
  const dur = 1.6 + Math.random() * 1.4;
  const V   = 0.45 + Math.random() * 0.30;

  // Crack inicial — el "bang" del rayo
  const cLen  = Math.floor(ctx.sampleRate * 0.09);
  const cBuf  = ctx.createBuffer(1, cLen, ctx.sampleRate);
  const cData = cBuf.getChannelData(0);
  for (let i = 0; i < cLen; i++) cData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / cLen, 0.8);
  const cSrc = ctx.createBufferSource(); cSrc.buffer = cBuf;
  const cLpf = ctx.createBiquadFilter(); cLpf.type = 'lowpass'; cLpf.frequency.value = 1800;
  const gC   = ctx.createGain(); gC.gain.value = V * 1.4;
  cSrc.connect(cLpf); cLpf.connect(gC); gC.connect(masterGain);
  cSrc.start(t);

  // Rumble sub — grave largo
  const sub  = ctx.createOscillator();
  const gSub = ctx.createGain();
  sub.type   = 'sine';
  sub.frequency.setValueAtTime(35 + Math.random() * 18, t);
  sub.frequency.exponentialRampToValueAtTime(18, t + dur);
  gSub.gain.setValueAtTime(0, t);
  gSub.gain.linearRampToValueAtTime(V * 0.9, t + 0.04);
  gSub.gain.exponentialRampToValueAtTime(0.001, t + dur);
  sub.connect(gSub); gSub.connect(masterGain);
  sub.start(t); sub.stop(t + dur);

  // Noise rumble — textura del trueno
  const nLen  = Math.floor(ctx.sampleRate * dur);
  const nBuf  = ctx.createBuffer(1, nLen, ctx.sampleRate);
  const nData = nBuf.getChannelData(0);
  for (let i = 0; i < nLen; i++) nData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 0.35);
  const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf;
  const nLpf = ctx.createBiquadFilter(); nLpf.type = 'lowpass'; nLpf.frequency.value = 320;
  const gN   = ctx.createGain();
  gN.gain.setValueAtTime(V * 0.7, t);
  gN.gain.exponentialRampToValueAtTime(0.001, t + dur);
  nSrc.connect(nLpf); nLpf.connect(gN); gN.connect(masterGain);
  nSrc.start(t);
}

// ─── Drum Machine ─────────────────────────────────────────────────────────────
let drumBpm     = 85;
let drumPlaying = false;
let drumStep    = 0;
let drumNextAt  = 0;
let _drumTimer  = null;

// Patrón house de 16 pasos con variación de kick sincopado
//                         1 e + a   2 e + a   3 e + a   4 e + a
const DRUM_KICK = [1,0,0,0, 1,0,0,1, 1,0,0,0, 1,0,1,0]; // kick extra en "a" de 2 y "+" de 4
const DRUM_CLAP = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0]; // 2 y 4
const DRUM_HHC  = [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]; // 16avos completos
const DRUM_HHO  = [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0]; // abierto off-beat
// Velocidades del hi-hat: acento en los tiempos fuertes
const DRUM_HH_VEL = [0.22,0.10,0.14,0.09, 0.20,0.10,0.14,0.09, 0.22,0.10,0.14,0.09, 0.20,0.10,0.14,0.09];

// Swing: 0 = recto, 0.33 = tresillos. ~0.13 = house groove ligero
const SWING = 0.13;

// ── Canal propio de la batería ─────────────────────────────────────────────────
// drumBus → drumLpf (distancia) ──→ drumComp ──→ duckGain
//        ↘ reverbSend → preDelay → drumReverb → reverbReturn → drumComp
let _drumBus = null;

function ensureDrumChain(ctx) {
  if (_drumBus) return _drumBus;
  const { duckGain } = ensureMasterChain(ctx);

  // Compresor de batería — glue suave
  const drumComp       = ctx.createDynamicsCompressor();
  drumComp.threshold.value = -22;
  drumComp.knee.value      = 8;
  drumComp.ratio.value     = 3.5;
  drumComp.attack.value    = 0.004;
  drumComp.release.value   = 0.12;
  drumComp.connect(duckGain);

  // Reverb propio — sala grande, cola larga (~2.4 s)
  const rvLen = Math.floor(ctx.sampleRate * 2.4);
  const rvBuf = ctx.createBuffer(2, rvLen, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = rvBuf.getChannelData(ch);
    for (let i = 0; i < rvLen; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rvLen, 2.2);
  }
  const drumReverb = ctx.createConvolver();
  drumReverb.buffer = rvBuf;

  // Pre-delay 18 ms — separa el directo del reverb (sensación de sala grande)
  const preDly = ctx.createDelay(0.1);
  preDly.delayTime.value = 0.018;

  // Retorno del reverb con LPF (ecos más oscuros = más espacio)
  const rvLpf    = ctx.createBiquadFilter();
  rvLpf.type     = 'lowpass'; rvLpf.frequency.value = 2800;
  const rvReturn = ctx.createGain(); rvReturn.gain.value = 0.72;
  drumReverb.connect(rvLpf); rvLpf.connect(rvReturn); rvReturn.connect(drumComp);

  // Bus de entrada — señal directa con LPF leve para distancia
  _drumBus       = ctx.createGain(); _drumBus.gain.value = 0.084;
  const dryLpf   = ctx.createBiquadFilter();
  dryLpf.type    = 'lowpass'; dryLpf.frequency.value = 7000;
  const rvSend   = ctx.createGain(); rvSend.gain.value = 0.62;

  _drumBus.connect(dryLpf);  dryLpf.connect(drumComp);
  _drumBus.connect(rvSend);  rvSend.connect(preDly); preDly.connect(drumReverb);

  return _drumBus;
}

// Buffers de ruido reutilizables
let _hhcBuf = null, _hhoBuf = null, _clapBuf = null;
function getHhcBuf(ctx) {
  if (_hhcBuf) return _hhcBuf;
  const len = Math.floor(ctx.sampleRate * 0.025);
  _hhcBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = _hhcBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return _hhcBuf;
}
function getHhoBuf(ctx) {
  if (_hhoBuf) return _hhoBuf;
  const len = Math.floor(ctx.sampleRate * 0.20);
  _hhoBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = _hhoBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return _hhoBuf;
}
function getClapBuf(ctx) {
  if (_clapBuf) return _clapBuf;
  const len = Math.floor(ctx.sampleRate * 0.12);
  _clapBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = _clapBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return _clapBuf;
}

function drumKick(ctx, t) {
  const bus  = ensureDrumChain(ctx);
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type   = 'sine';
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(35, t + 0.45);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1.5, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(gain); gain.connect(bus);
  osc.start(t); osc.stop(t + 0.5);
}

function drumClap(ctx, t) {
  const bus = ensureDrumChain(ctx);
  const buf = getClapBuf(ctx);
  for (const off of [0, 0.011]) {
    const src  = ctx.createBufferSource(); src.buffer = buf;
    const bpf  = ctx.createBiquadFilter();
    bpf.type   = 'bandpass'; bpf.frequency.value = 1500; bpf.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, t + off);
    gain.gain.exponentialRampToValueAtTime(0.001, t + off + 0.09);
    src.connect(bpf); bpf.connect(gain); gain.connect(bus);
    src.start(t + off);
  }
}

function drumHhc(ctx, t, vel = 0.16) {
  const bus  = ensureDrumChain(ctx);
  const src  = ctx.createBufferSource(); src.buffer = getHhcBuf(ctx);
  const hpf  = ctx.createBiquadFilter();
  hpf.type   = 'highpass'; hpf.frequency.value = 8500;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vel, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
  src.connect(hpf); hpf.connect(gain); gain.connect(bus);
  src.start(t);
}

function drumHho(ctx, t) {
  const bus  = ensureDrumChain(ctx);
  const src  = ctx.createBufferSource(); src.buffer = getHhoBuf(ctx);
  const hpf  = ctx.createBiquadFilter();
  hpf.type   = 'highpass'; hpf.frequency.value = 7500;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.20, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
  src.connect(hpf); hpf.connect(gain); gain.connect(bus);
  src.start(t);
}

function drumSchedule() {
  const ctx = Howler.ctx;
  if (!ctx || !drumPlaying) return;
  const step16 = 60 / drumBpm / 4;
  while (drumNextAt < ctx.currentTime + 0.12) {
    const s = drumStep % 16;
    if (DRUM_KICK[s]) drumKick(ctx, drumNextAt);
    if (DRUM_CLAP[s]) drumClap(ctx, drumNextAt);
    if (DRUM_HHC[s])  drumHhc(ctx, drumNextAt, DRUM_HH_VEL[s]);
    if (DRUM_HHO[s])  drumHho(ctx, drumNextAt);
    // Swing: los pasos pares duran más, los impares menos
    // even→odd: step16*(1+SWING), odd→even: step16*(1-SWING)
    drumNextAt += (drumStep % 2 === 0)
      ? step16 * (1 + SWING)
      : step16 * (1 - SWING);
    drumStep++;
  }
}

function startDrum() {
  const ctx = Howler.ctx;
  if (!ctx || drumPlaying) return;
  drumPlaying = true;
  drumStep    = 0;
  drumNextAt  = ctx.currentTime + 0.05;
  _drumTimer  = setInterval(drumSchedule, 40);
}

function stopDrum() {
  drumPlaying = false;
  if (_drumTimer) { clearInterval(_drumTimer); _drumTimer = null; }
}

// ─── Game State ───────────────────────────────────────────────────────────────
let score = 0, wave = 1, coreHealth = 100;
let gameOver = false, gameStarted = false, shopOpen = false;
let killStreak = 0, lastKillTime = 0;
let waveEnemiesLeft = 0, waveCooldown = 0;
const WAVE_COOLDOWN_DURATION = 4;
const enemies = [], bullets = [], particles = [];

// ─── UI References ────────────────────────────────────────────────────────────
const hud          = document.getElementById('hud');
const scoreEl      = document.getElementById('score');
const waveEl       = document.getElementById('wave');
const streakEl     = document.getElementById('streak');
const gameOverEl   = document.getElementById('game-over');
const finalScoreEl = document.getElementById('final-score');
const finalWaveEl  = document.getElementById('final-wave');
const restartBtn   = document.getElementById('restart-btn');
const startScreen  = document.getElementById('start-screen');
const startBtn     = document.getElementById('start-btn');
const waveAnnounce = document.getElementById('wave-announce');
const hexMapSvg    = document.getElementById('hex-map');
const turretLabel  = document.getElementById('turret-label');
const shopEl       = document.getElementById('shop');
const stateFlash   = document.getElementById('state-flash');
const typeEffectEl = document.getElementById('type-effect');

// ─── Lights ───────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x6644cc, 1.4));
// Hemisphere: cielo azul-violeta arriba, suelo cálido abajo
scene.add(new THREE.HemisphereLight(0x4466ff, 0xffaa44, 0.9));
const dirLight = new THREE.DirectionalLight(0xfff0cc, 2.2);
dirLight.position.set(5, 20, 10); dirLight.castShadow = true;
dirLight.shadow.mapSize.width = dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);
const purpleLight = new THREE.PointLight(0xaa44ff, 2.5, 40);
purpleLight.position.set(0, 5, 0); scene.add(purpleLight);

// ─── Lightning System ─────────────────────────────────────────────────────────
const lightningLight = new THREE.PointLight(0xbbd4ff, 0, 2000);
lightningLight.position.set(0, 140, 0);
scene.add(lightningLight);

const lightningFill = new THREE.PointLight(0x8899ff, 0, 3000);
lightningFill.position.set(0, 60, 0);
scene.add(lightningFill);

let _lightningTimer = 1.5 + Math.random() * 3;
let _flashTimer     = 0;
let _flashPeak      = 0;
const _boltLines    = []; // { line: Mesh, life, maxLife, initOpacity }
const _beams        = []; // { beam, halo, impact, life, maxLife }

function makeBoltPoints(ox, oz, startY) {
  const pts = [];
  let y = startY, x = ox, z = oz;
  pts.push(new THREE.Vector3(x, y, z));
  while (y > 2) {
    y -= 4 + Math.random() * 9;
    x += (Math.random() - 0.5) * 22;
    z += (Math.random() - 0.5) * 22;
    pts.push(new THREE.Vector3(x, Math.max(2, y), z));
  }
  return pts;
}

// Tubo brillante por CatmullRom — da grosor real al rayo
function _addBoltTube(pts, radius, color, opacity, life) {
  if (pts.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo   = new THREE.TubeGeometry(curve, Math.max(pts.length * 3, 16), radius, 5, false);
  const mat   = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  _boltLines.push({ line: mesh, life, maxLife: life, initOpacity: opacity });
}

function spawnBolt(ox, oz) {
  const startY   = 120 + Math.random() * 50;
  const mainPts  = makeBoltPoints(ox, oz, startY);
  const mainLife = 0.22 + Math.random() * 0.07;

  // Tres capas: outer glow azul, mid cyan, core blanco puro
  _addBoltTube(mainPts, 2.4,  0x1133ff, 0.10, mainLife);
  _addBoltTube(mainPts, 1.0,  0x66aaff, 0.38, mainLife - 0.02);
  _addBoltTube(mainPts, 0.22, 0xffffff, 1.00, mainLife - 0.04);

  // Ramificaciones desde puntos del rayo principal
  const branches = 3 + Math.floor(Math.random() * 4);
  for (let b = 0; b < branches; b++) {
    const splitIdx = 1 + Math.floor(Math.random() * (mainPts.length - 2));
    const origin   = mainPts[splitIdx].clone();
    const brPts    = [origin];
    let bx = origin.x, by = origin.y, bz = origin.z;
    const brLen = 2 + Math.floor(Math.random() * 4);
    for (let s = 0; s < brLen; s++) {
      by -= 4 + Math.random() * 8;
      bx += (Math.random() - 0.5) * 20;
      bz += (Math.random() - 0.5) * 20;
      brPts.push(new THREE.Vector3(bx, Math.max(4, by), bz));
    }
    if (brPts.length < 2) continue;
    const brLife = 0.10 + Math.random() * 0.08;
    _addBoltTube(brPts, 0.9,  0x2244ee, 0.10, brLife);
    _addBoltTube(brPts, 0.30, 0xaaccff, 0.60, brLife - 0.01);
    _addBoltTube(brPts, 0.10, 0xffffff, 0.85, brLife - 0.02);
  }

  // Haz volumétrico cónico desde el cielo
  const beamGeo = new THREE.CylinderGeometry(0.15, 9, startY, 8, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x7799ff, transparent: true, opacity: 0.40,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(ox, startY / 2, oz);
  scene.add(beam);

  // Halo esférico en lo alto
  const haloGeo = new THREE.SphereGeometry(24, 14, 10);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.13,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(ox, startY, oz);
  scene.add(halo);

  // Destello de impacto en el suelo
  const impGeo = new THREE.SphereGeometry(12, 10, 8);
  const impMat = new THREE.MeshBasicMaterial({
    color: 0x99ccff, transparent: true, opacity: 0.30,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const impact = new THREE.Mesh(impGeo, impMat);
  impact.position.set(ox, 2, oz);
  scene.add(impact);

  const beamLife = 0.24 + Math.random() * 0.06;
  _beams.push({ beam, halo, impact, life: beamLife, maxLife: beamLife });
}

function triggerLightning() {
  const bx = (Math.random() - 0.5) * 220;
  const bz = (Math.random() - 0.5) * 220;
  spawnBolt(bx, bz);
  lightningLight.position.set(bx, 140, bz);
  lightningFill.position.set(bx * 0.5, 50, bz * 0.5);
  _flashPeak  = 600 + Math.random() * 400;
  _flashTimer = 0.10 + Math.random() * 0.05;
  lightningLight.intensity = _flashPeak;
  lightningFill.intensity  = _flashPeak * 0.4;
  const flashes = 1 + Math.floor(Math.random() * 3);
  for (let f = 1; f < flashes; f++) {
    setTimeout(() => {
      lightningLight.intensity = _flashPeak * (0.8 - f * 0.2);
      lightningFill.intensity  = _flashPeak * (0.3 - f * 0.08);
      _flashTimer = 0.06;
    }, 60 * f + Math.random() * 50);
  }
  setTimeout(playThunderSound, 300 + Math.random() * 2200);
}

function updateLightning(delta) {
  _lightningTimer -= delta;
  if (_lightningTimer <= 0) {
    triggerLightning();
    _lightningTimer = 2 + Math.random() * 6;
  }
  if (_flashTimer > 0) {
    _flashTimer -= delta;
    const decay = Math.pow(0.0002, delta / 0.10);
    lightningLight.intensity *= decay;
    lightningFill.intensity  *= decay;
    if (_flashTimer <= 0) { lightningLight.intensity = 0; lightningFill.intensity = 0; }
  }
  for (let i = _boltLines.length - 1; i >= 0; i--) {
    const b = _boltLines[i];
    b.life -= delta;
    b.line.material.opacity = Math.max(0, b.initOpacity * (b.life / b.maxLife));
    if (b.life <= 0) {
      scene.remove(b.line); b.line.geometry.dispose();
      _boltLines.splice(i, 1);
    }
  }
  for (let i = _beams.length - 1; i >= 0; i--) {
    const b = _beams[i];
    b.life -= delta;
    const r = Math.max(0, b.life / b.maxLife);
    b.beam.material.opacity   = r * 0.40;
    b.halo.material.opacity   = r * 0.13;
    b.impact.material.opacity = r * 0.30;
    if (b.life <= 0) {
      scene.remove(b.beam);   b.beam.geometry.dispose();
      scene.remove(b.halo);   b.halo.geometry.dispose();
      scene.remove(b.impact); b.impact.geometry.dispose();
      _beams.splice(i, 1);
    }
  }
}

// ─── Shooting Stars ───────────────────────────────────────────────────────────
const _shootingStars   = [];
let   _shootingStarTimer = 3 + Math.random() * 10;

function spawnShootingStar() {
  const angle = Math.random() * Math.PI * 2;
  const r     = 170 + Math.random() * 40;
  const sx    = Math.cos(angle) * r;
  const sz    = Math.sin(angle) * r;
  const sy    = 72 + Math.random() * 80;

  const dAngle = angle + Math.PI * (0.3 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1);
  const dir    = new THREE.Vector3(
    Math.cos(dAngle), -(0.03 + Math.random() * 0.20), Math.sin(dAngle)
  ).normalize();

  const speed   = 85 + Math.random() * 145;
  const tailLen = 16 + Math.random() * 32;
  const maxLife = (260 + Math.random() * 120) / speed;

  // Núcleo brillante
  const hGeo = new THREE.SphereGeometry(1.5, 8, 6);
  const hMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const head = new THREE.Mesh(hGeo, hMat);
  head.position.set(sx, sy, sz);
  scene.add(head);

  // Halo exterior azul-blanco
  const oGeo = new THREE.SphereGeometry(5, 8, 6);
  const oMat = new THREE.MeshBasicMaterial({
    color: 0x88aaff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Mesh(oGeo, oMat);
  glow.position.set(sx, sy, sz);
  scene.add(glow);

  // Cola blanca core
  const tPos0 = new THREE.Vector3(sx, sy, sz);
  const tPos1 = tPos0.clone().addScaledVector(dir, -tailLen);
  function makeTailGeo() {
    return new THREE.BufferGeometry().setFromPoints([tPos0.clone(), tPos1.clone()]);
  }
  const tGeo  = makeTailGeo();
  const tMat  = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tailCore = new THREE.Line(tGeo, tMat);
  scene.add(tailCore);

  // Cola glow azulada (más larga)
  const tGeo2 = makeTailGeo();
  const tMat2 = new THREE.LineBasicMaterial({
    color: 0x5588ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tailGlow = new THREE.Line(tGeo2, tMat2);
  scene.add(tailGlow);

  _shootingStars.push({
    head, glow, tailCore, tailGlow, tGeo, tGeo2,
    pos: new THREE.Vector3(sx, sy, sz),
    dir, speed, tailLen, life: 0, maxLife,
  });
}

function updateShootingStars(delta) {
  _shootingStarTimer -= delta;
  if (_shootingStarTimer <= 0) {
    const count = 1 + (Math.random() > 0.6 ? 1 : 0);
    for (let i = 0; i < count; i++)
      setTimeout(() => spawnShootingStar(), i * (100 + Math.random() * 500));
    _shootingStarTimer = 5 + Math.random() * 14;
  }
  for (let i = _shootingStars.length - 1; i >= 0; i--) {
    const s = _shootingStars[i];
    s.life += delta;
    const t = s.life / s.maxLife;
    const alpha = Math.max(0, Math.min(1,
      t < 0.12 ? t / 0.12 : t > 0.85 ? (1 - t) / 0.15 : 1
    ));
    s.pos.addScaledVector(s.dir, s.speed * delta);
    s.head.position.copy(s.pos);
    s.glow.position.copy(s.pos);
    const tail1End = s.pos.clone().addScaledVector(s.dir, -s.tailLen);
    const tail2End = s.pos.clone().addScaledVector(s.dir, -s.tailLen * 1.6);
    for (const [tg, te] of [[s.tGeo, tail1End], [s.tGeo2, tail2End]]) {
      const pa = tg.attributes.position;
      pa.setXYZ(0, s.pos.x, s.pos.y, s.pos.z);
      pa.setXYZ(1, te.x, te.y, te.z);
      pa.needsUpdate = true;
    }
    s.head.material.opacity      = alpha * 0.95;
    s.glow.material.opacity      = alpha * 0.22;
    s.tailCore.material.opacity  = alpha * 0.88;
    s.tailGlow.material.opacity  = alpha * 0.30;
    if (s.life >= s.maxLife) {
      scene.remove(s.head);      s.head.geometry.dispose();
      scene.remove(s.glow);      s.glow.geometry.dispose();
      scene.remove(s.tailCore);  s.tGeo.dispose();
      scene.remove(s.tailGlow);  s.tGeo2.dispose();
      _shootingStars.splice(i, 1);
    }
  }
}

// ─── Terrain Height ───────────────────────────────────────────────────────────
// Terreno plano en el centro, se eleva progresivamente hacia los bordes.
// wx, wz = coordenadas mundo. Devuelve altura Y en ese punto.
function terrainHeight(wx, wz) {
  const dist = Math.sqrt(wx * wx + wz * wz);
  const flat = 14, maxH = 28, maxD = 160;
  if (dist <= flat) return 0;
  return Math.pow((dist - flat) / (maxD - flat), 1.7) * maxH;
}

// ─── Environment ──────────────────────────────────────────────────────────────
// Plano grande con vértices elevados según terrainHeight
const floorGeo = new THREE.PlaneGeometry(320, 320, 100, 100);
const fpos = floorGeo.attributes.position;
for (let i = 0; i < fpos.count; i++) {
  const lx = fpos.getX(i), ly = fpos.getY(i); // local XY → world XZ después de rotation.x
  fpos.setZ(i, terrainHeight(lx, ly));          // local Z → world Y (altura)
}
fpos.needsUpdate = true;
floorGeo.computeVertexNormals();

const floor = new THREE.Mesh(
  floorGeo,
  new THREE.MeshStandardMaterial({ color: 0x1a0d4a, roughness: 0.85, metalness: 0.1 })
);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

// Grid solo en zona central plana
const gridHelper = new THREE.GridHelper(28, 14, 0x8844ff, 0x4422aa);
gridHelper.position.y = .02; scene.add(gridHelper);

// Anillo de spawn en radio 60, elevado según el terreno
const SPAWN_RADIUS = 120;
const spawnRingY = terrainHeight(SPAWN_RADIUS, 0) + 0.1;
const spawnRing = new THREE.Mesh(
  new THREE.RingGeometry(SPAWN_RADIUS - .5, SPAWN_RADIUS + .5, 64),
  new THREE.MeshBasicMaterial({ color: 0xff0044, side: THREE.DoubleSide, transparent: true, opacity: .3 })
);
spawnRing.rotation.x = -Math.PI / 2; spawnRing.position.y = spawnRingY; scene.add(spawnRing);

// ─── Starfield Parallax ───────────────────────────────────────────────────────
const STAR_COUNT = 1000;
const STARFIELD_RANGE_X = 200;
const STARFIELD_RANGE_Y = 100;
const STARFIELD_RANGE_Z = 300;
const STAR_SPEED_FACTOR = 10;
let starfield;

function initStarfield() {
  const starVertices = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = (Math.random() - 0.5) * STARFIELD_RANGE_X;
    const y = (Math.random() - 0.5) * STARFIELD_RANGE_Y;
    const z = (Math.random() - 0.5) * STARFIELD_RANGE_Z;
    starVertices.push(x, y, z);
  }

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));

  const starMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.2,
    map: new THREE.TextureLoader().load('/public/vite.svg'), // Use a simple vite.svg as a placeholder texture
    transparent: true,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    opacity: 0.8
  });

  starfield = new THREE.Points(starGeometry, starMaterial);
  scene.add(starfield);
}

// ─── Core ─────────────────────────────────────────────────────────────────────
const coreGroup = new THREE.Group(); coreGroup.position.set(0, 1.2, 0); scene.add(coreGroup);
const coreMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ccff, emissiveIntensity: 1.0 });
const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(.8, 1), coreMat);
coreMesh.castShadow = true; coreGroup.add(coreMesh);
const glowRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.2, .08, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: .6 })
);
coreGroup.add(glowRing);
const coreLight = new THREE.PointLight(0x00ffff, 2, 10); coreGroup.add(coreLight);

// ─── Core Health Label (3D billboard) ─────────────────────────────────────────
const LABEL_W = 512, LABEL_H = 80;
const coreLabelCanvas = document.createElement('canvas');
coreLabelCanvas.width = LABEL_W; coreLabelCanvas.height = LABEL_H;
const coreLabelCtx = coreLabelCanvas.getContext('2d');
const coreLabelTex = new THREE.CanvasTexture(coreLabelCanvas);

const coreLabelMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(4.2, 4.2 * (LABEL_H / LABEL_W)),
  new THREE.MeshBasicMaterial({ map: coreLabelTex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
);
// Posición en espacio mundial (no hijo del coreGroup para que no rote con él)
coreLabelMesh.position.set(0, 3.8, 0);
scene.add(coreLabelMesh);

function updateCoreLabel() {
  const hp  = Math.max(0, coreHealth);
  const pct = hp / 100;
  const ctx = coreLabelCtx;
  const W = LABEL_W, H = LABEL_H;
  const col   = hp > 50 ? '#00ff88' : hp > 25 ? '#ffaa00' : '#ff3300';
  const colRgb= hp > 50 ? '0,255,136' : hp > 25 ? '255,170,0' : '255,51,0';

  ctx.clearRect(0, 0, W, H);

  // Fondo
  ctx.fillStyle = 'rgba(4, 0, 18, 0.80)';
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 7); ctx.fill();

  // Borde con glow
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.shadowColor = col; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.roundRect(1, 1, W - 2, H - 2, 7); ctx.stroke();
  ctx.shadowBlur = 0;

  // Etiqueta "◈ NÚCLEO"
  ctx.fillStyle = `rgba(${colRgb},0.55)`;
  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('◈  NÚCLEO', 14, 21);

  // Porcentaje
  ctx.fillStyle = col;
  ctx.shadowColor = col; ctx.shadowBlur = 8;
  ctx.font = 'bold 14px "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(hp)}%`, W - 14, 21);
  ctx.shadowBlur = 0;

  // Barra segmentada
  const SEG = 20, segW = (W - 28) / SEG;
  const filled = Math.ceil(pct * SEG);
  for (let i = 0; i < SEG; i++) {
    const x  = 14 + i * segW + 1;
    const sw = segW - 2;
    if (i < filled) {
      const intensity = i === filled - 1 ? 0.75 : 1;
      ctx.fillStyle = col;
      ctx.globalAlpha = intensity;
      ctx.shadowColor = col; ctx.shadowBlur = i === filled - 1 ? 10 : 4;
    } else {
      ctx.fillStyle = `rgba(${colRgb},0.10)`;
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    ctx.beginPath(); ctx.roundRect(x, 30, sw, 40, 3); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;

  coreLabelTex.needsUpdate = true;
}
updateCoreLabel();

// ─── Bullet Types ─────────────────────────────────────────────────────────────
const BULLET_TYPES = {
  basic:       { name: 'BÁSICA',      color: 0xffff00, speed: 60, baseDamage: 1, unlockCost:   0, special: null },
  explosive: { name: 'EXPLOSIVA', color: 0xff6600, speed: 45, baseDamage: 2, unlockCost: 150, special: 'aoe', aoeRadius: 2.5, aoeDamage: 1 },
  penetrating: { name: 'PENETRANTE',  color: 0x00ccff, speed: 70, baseDamage: 1, unlockCost: 100, special: 'pierce' },
  slowing:     { name: 'LENTIZANTE',  color: 0x4488ff, speed: 50, baseDamage: 1, unlockCost: 120, special: 'slow',   slowFactor: 0.35, slowTime: 2.5 },
  burning:     { name: 'QUEMANTE',    color: 0xff4400, speed: 55, baseDamage: 1, unlockCost: 130, special: 'burn',   burnDPS: 0.8,     burnTime: 3.0 },
};

// ─── Pokemon Type Resistance System (Opción 3) ────────────────────────────────
// Tabla de efectividad derivada de PokeAPI /type/{name}/damage_relations
// Cada bala mapea a un tipo Pokemon; la efectividad modifica el daño aplicado.
const BULLET_POKE_TYPE = {
  basic:       'normal',
  explosive:   'rock',
  penetrating: 'steel',
  slowing:     'ice',
  burning:     'fire',
};

// type_chart[atacante][defensor] = multiplicador de daño
// 2 = súper efectivo, 0.5 = poco efectivo, 0 = sin efecto, 1 = normal
const TYPE_CHART = {
  normal:  { rock:0.5, steel:0.5, ghost:0 },
  rock:    { flying:2, bug:2, fire:2, ice:2,  fighting:0.5, ground:0.5, steel:0.5 },
  steel:   { ice:2, rock:2, fairy:2,          steel:0.5, fire:0.5, water:0.5, electric:0.5 },
  ice:     { flying:2, ground:2, grass:2, dragon:2,  water:0.5, ice:0.5, steel:0.5, fire:0.5 },
  fire:    { grass:2, ice:2, bug:2, steel:2,   fire:0.5, water:0.5, rock:0.5, dragon:0.5 },
};

function getTypeMultiplier(bulletKey, enemyTypes) {
  const attackType = BULLET_POKE_TYPE[bulletKey];
  if (!attackType || !TYPE_CHART[attackType]) return 1;
  const chart = TYPE_CHART[attackType];
  let mult = 1;
  for (const defType of enemyTypes) {
    if (chart[defType] !== undefined) mult *= chart[defType];
  }
  return mult;
}

// Cached geo/mat per bullet type
const _bGeo = {}, _bMat = {};
for (const [k, bt] of Object.entries(BULLET_TYPES)) {
  _bGeo[k] = new THREE.SphereGeometry(.12, 6, 6);
  _bMat[k] = new THREE.MeshStandardMaterial({ color: bt.color, emissive: bt.color, emissiveIntensity: 1.5 });
}

// ─── Upgrade Definitions ──────────────────────────────────────────────────────
const UPGRADE_DEFS = {
  autoRate: { label: 'Cadencia Auto', costs: [80,  160, 280],  values: [2.5, 1.8, 1.2, 0.8] },
  damage:   { label: 'Daño',          costs: [100, 200, 350],  values: [1,   1.5, 2,   3  ] },
  burst:    { label: 'Ráfaga',        costs: [120, 240],       values: [2,   3,   4       ] },
};
const getAutoRate  = t => UPGRADE_DEFS.autoRate.values[t.upgrades.autoRate];
const getDamageMult = t => UPGRADE_DEFS.damage.values[t.upgrades.damage];
const getBurstSize = t => UPGRADE_DEFS.burst.values[t.upgrades.burst];

// ─── Turret Construction ──────────────────────────────────────────────────────
const TURRET_COUNT = 6;
let activeTurretIndex = 0;
const turretData = [];

// Define specific positions and orientations for each turret
const TURRET_POSITIONS = [
  // Front Group (aiming generally towards negative Z)
  { x: -8, z: -10, yaw: Math.PI + Math.PI / 8 }, // Left-Front, pointing slightly left-forward
  { x:  0, z: -10, yaw: Math.PI             }, // Center-Front, pointing straight forward
  { x:  8, z: -10, yaw: Math.PI - Math.PI / 8 }, // Right-Front, pointing slightly right-forward

  // Back Group (aiming generally towards positive Z)
  { x: -8, z:  10, yaw: Math.PI / 8     }, // Left-Rear, pointing slightly left-backward
  { x:  0, z:  10, yaw: 0               }, // Center-Rear, pointing straight backward
  { x:  8, z:  10, yaw: -Math.PI / 8    }, // Right-Rear, pointing slightly right-backward
];

function buildTurret(index) {
  const posData = TURRET_POSITIONS[index];
  const x = posData.x;
  const z = posData.z;
  const facingYaw = posData.yaw;

  const base = new THREE.Group();
  base.position.set(x, 0, z); base.rotation.y = facingYaw; scene.add(base);

  const baseMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1.3, .6, 16),
    new THREE.MeshStandardMaterial({ color: 0x334455, metalness: .7, roughness: .3 })
  );
  baseMesh.position.y = .3; baseMesh.castShadow = true; base.add(baseMesh);

  const ringMesh = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, .06, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0x00ff44 })
  );
  ringMesh.rotation.x = Math.PI / 2; ringMesh.position.y = .5; base.add(ringMesh);

  // Bullet-type color indicator (small sphere above ring)
  const bulletIndicator = new THREE.Mesh(
    new THREE.SphereGeometry(.15, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffff00 })
  );
  bulletIndicator.position.set(0, 1.0, 0); base.add(bulletIndicator);

  const pitch = new THREE.Group(); pitch.position.y = 1.5; base.add(pitch);
  const headGroup = new THREE.Group(); pitch.add(headGroup);

  // Head mesh — material único opaco, recibe outline normal
  const headMesh = new THREE.Mesh(
    new THREE.BoxGeometry(.9, .7, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x445566, metalness: .6, roughness: .4 })
  );
  headMesh.position.z = -.5; headMesh.castShadow = true; headGroup.add(headMesh);

  // Etiqueta "T1" — plano independiente flotando sobre la cara superior
  const topCanvas = document.createElement('canvas');
  topCanvas.width = 256; topCanvas.height = 128;
  const tc = topCanvas.getContext('2d');
  tc.clearRect(0, 0, 256, 128);
  tc.shadowColor = '#00ffcc'; tc.shadowBlur = 18;
  tc.fillStyle = '#00ffcc';
  tc.font = 'bold 100px monospace';
  tc.textAlign = 'center'; tc.textBaseline = 'middle';
  tc.fillText(`T${index + 1}`, 128, 64);
  const labelPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(.85, .42),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(topCanvas), transparent: true, depthWrite: false })
  );
  labelPlane.position.set(0, .36, -.5);
  labelPlane.rotation.x = -Math.PI / 2;
  headGroup.add(labelPlane);

  for (const side of [-.25, .25]) {
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(.1, .1, 2.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x111122, metalness: .9 })
    );
    b.rotation.x = -Math.PI / 2; b.position.set(side, 0, -1.8); b.castShadow = true; headGroup.add(b);
  }

  const barrelRef = new THREE.Object3D(); barrelRef.position.set(0, 0, -3.2); headGroup.add(barrelRef);

  turretData.push({
    base, pitch, headGroup, barrelRef, ringMesh, bulletIndicator,
    initialYaw: facingYaw,
    // State
    baseState: 'auto',          // 'auto' | 'inactive' when not controlled
    equippedBullet: 'basic',
    unlockedBullets: new Set(['basic']),
    upgrades: { autoRate: 0, damage: 0, burst: 0 },
    // Auto-fire runtime
    autoCooldown: 0,
    autoBurstLeft: 0,
    autoBurstTimer: 0,
  });
}

for (let i = 0; i < TURRET_COUNT; i++) buildTurret(i);

// Turret outlines (only MeshStandardMaterial meshes)
turretOutline.selectedObjects = turretData.flatMap(t => {
  const m = [];
  t.base.traverse(c => { if (c.isMesh && c.material.type === 'MeshStandardMaterial') m.push(c); });
  return m;
});

// Camera on turret 0
turretData[0].pitch.add(camera);
camera.position.set(0, 1.1, 2.8);
updateActiveTurretVisuals();

// ─── Turret Switching & State ─────────────────────────────────────────────────
function switchToTurret(newIdx) {
  turretData[activeTurretIndex].pitch.remove(camera);
  turretData[newIdx].pitch.add(camera);
  activeTurretIndex = newIdx;
  updateActiveTurretVisuals();
  updateHexMap();
}

function updateActiveTurretVisuals() {
  for (let i = 0; i < TURRET_COUNT; i++) {
    const t = turretData[i];
    const isActive = i === activeTurretIndex;
    if (isActive)                  t.ringMesh.material.color.set(0x00ffcc);
    else if (t.baseState==='auto') t.ringMesh.material.color.set(0x00ff44);
    else                           t.ringMesh.material.color.set(0x333333);
  }
  if (turretLabel) turretLabel.textContent = `TORRETA ${activeTurretIndex + 1}`;
}

function toggleTurretState() {
  const t = turretData[activeTurretIndex];
  t.baseState = t.baseState === 'auto' ? 'inactive' : 'auto';
  updateActiveTurretVisuals();
  updateHexMap();
  if (stateFlash) {
    stateFlash.textContent = t.baseState === 'auto' ? '● AUTO' : '○ INACTIVA';
    stateFlash.style.color  = t.baseState === 'auto' ? '#00ff44' : '#888888';
    stateFlash.style.opacity = '1';
    clearTimeout(stateFlash._t);
    stateFlash._t = setTimeout(() => stateFlash.style.opacity = '0', 1600);
  }
}

// ─── Hex Map ──────────────────────────────────────────────────────────────────
// Define specific positions for each turret on the 2D map
const TURRET_MAP_POSITIONS = [
  { cx: -30, cy: -30 }, // Left-Front
  { cx:   0, cy: -30 }, // Center-Front
  { cx:  30, cy: -30 }, // Right-Front
  { cx: -30, cy:  30 }, // Left-Rear
  { cx:   0, cy:  30 }, // Center-Rear
  { cx:  30, cy:  30 }, // Right-Rear
];

(function buildHexMapSvg() {
  const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  core.setAttribute('cx','0'); core.setAttribute('cy','0'); core.setAttribute('r','5');
  core.setAttribute('fill','#00ffff'); core.setAttribute('opacity','.9');
  hexMapSvg.appendChild(core);

  for (let i=0; i<TURRET_COUNT; i++) { // Use TURRET_COUNT instead of fixed 6
    const pos = TURRET_MAP_POSITIONS[i];
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('class',`tnode tnode-${i}`);
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx',pos.cx); c.setAttribute('cy',pos.cy); c.setAttribute('r','7');
    c.setAttribute('class','tnode-circle'); g.appendChild(c);
    const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
    tx.setAttribute('x',pos.cx); tx.setAttribute('y',pos.cy);
    tx.setAttribute('text-anchor','middle'); tx.setAttribute('dominant-baseline','middle');
    tx.setAttribute('font-size','7'); tx.setAttribute('font-family','monospace');
    tx.setAttribute('class','tnode-text'); tx.textContent = i+1; g.appendChild(tx);
    hexMapSvg.appendChild(g);
  }
})();

function updateHexMap() {
  for (let i=0; i<6; i++) {
    const isActive = i===activeTurretIndex;
    const t = turretData[i];
    const g = hexMapSvg.querySelector(`.tnode-${i}`);
    let fill = isActive ? '#00ffcc' : t.baseState==='auto' ? 'rgba(0,200,80,.5)' : 'rgba(60,60,60,.5)';
    g.querySelector('.tnode-circle').setAttribute('fill', fill);
    g.querySelector('.tnode-circle').setAttribute('stroke', isActive ? '#fff' : '#224433');
    g.querySelector('.tnode-circle').setAttribute('stroke-width', isActive ? '2' : '1');
    g.querySelector('.tnode-circle').setAttribute('r', isActive ? '9' : '6');
    g.querySelector('.tnode-text').setAttribute('fill', isActive ? '#000' : '#aaa');
  }
}
updateHexMap();

// ─── Pointer Lock ─────────────────────────────────────────────────────────────
let isLocked = false;
function lockPointer() { renderer.domElement.requestPointerLock(); }

document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === renderer.domElement;
  if (isLocked) {
    startScreen.style.display = 'none';
    hud.style.display = 'block';
    if (!gameStarted) { gameStarted = true; waveCooldown = 0.5; updateHUD(); }
    startDrum();
  } else {
    if (!gameOver && !shopOpen) { startScreen.style.display = 'flex'; hud.style.display = 'none'; }
  }
});

startBtn.addEventListener('click', lockPointer);
restartBtn.addEventListener('click', () => { restartGame(); lockPointer(); });

// ─── Aiming ───────────────────────────────────────────────────────────────────
const SENSITIVITY = 0.0018;
const PITCH_UP    =  Math.PI / 9;
const PITCH_DOWN  = -Math.PI / 5;

// Click mecánico al rotar — cada CLICK_STEP radianes
const CLICK_STEP = 0.36;
let _rotAccum = 0;
let _lastClickTime = 0;

function playRotateClick() {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  const now = ctx.currentTime;
  if (now - _lastClickTime < 0.10) return;
  _lastClickTime = now;

  const { masterGain } = ensureMasterChain(ctx);
  const t = now;

  // Cuerpo de madera: sine grave con decay rápido
  const freq = 180 + Math.random() * 60;
  const osc  = ctx.createOscillator();
  const gOsc = ctx.createGain();
  osc.type   = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.055);
  gOsc.gain.setValueAtTime(0.38 + Math.random() * 0.08, t);
  gOsc.gain.exponentialRampToValueAtTime(0.001, t + 0.060);
  osc.connect(gOsc); gOsc.connect(masterGain);
  osc.start(t); osc.stop(t + 0.060);

  // Ataque seco de madera: noise LPF 700Hz — textura del golpe sin brillo
  const nLen  = Math.floor(ctx.sampleRate * 0.016);
  const nBuf  = ctx.createBuffer(1, nLen, ctx.sampleRate);
  const nData = nBuf.getChannelData(0);
  for (let i = 0; i < nLen; i++) nData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 0.3);
  const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf;
  const lpf  = ctx.createBiquadFilter();
  lpf.type   = 'lowpass'; lpf.frequency.value = 700;
  const gN   = ctx.createGain(); gN.gain.value = 0.22;
  nSrc.connect(lpf); lpf.connect(gN); gN.connect(masterGain);
  nSrc.start(t);
}

document.addEventListener('mousemove', e => {
  if (!isLocked || !gameStarted || gameOver || shopOpen) return;
  const t = turretData[activeTurretIndex];
  t.base.rotation.y  -= e.movementX * SENSITIVITY;
  t.pitch.rotation.x  = Math.max(PITCH_DOWN, Math.min(PITCH_UP, t.pitch.rotation.x - e.movementY * SENSITIVITY));

  _rotAccum += Math.abs(e.movementX * SENSITIVITY) + Math.abs(e.movementY * SENSITIVITY);
  if (_rotAccum >= CLICK_STEP) {
    _rotAccum -= CLICK_STEP;
    playRotateClick();
  }
});

document.addEventListener('keydown', e => {
  if (!gameStarted || gameOver) return;
  if (shopOpen) { if (e.key==='b'||e.key==='B'||e.key==='Escape') closeShop(); return; }
  if (e.key==='ArrowLeft'||e.key==='ArrowUp')
    switchToTurret((activeTurretIndex - 1 + TURRET_COUNT) % TURRET_COUNT);
  else if (e.key==='ArrowRight'||e.key==='ArrowDown')
    switchToTurret((activeTurretIndex + 1) % TURRET_COUNT);
  else if (e.key==='i'||e.key==='I') toggleTurretState();
  else if (e.key==='b'||e.key==='B') openShop();
});

// ─── Shooting ─────────────────────────────────────────────────────────────────
let shootCooldown = 0;
const SHOOT_RATE = 0.12;
let isMouseDown = false;
document.addEventListener('mousedown', e => { if (e.button===0) isMouseDown=true; });
document.addEventListener('mouseup',   e => { if (e.button===0) isMouseDown=false; });

function spawnBullet(turretIdx, dir, startPos) {
  const t = turretData[turretIdx];
  const btype = BULLET_TYPES[t.equippedBullet];
  const bullet = new THREE.Mesh(_bGeo[t.equippedBullet], _bMat[t.equippedBullet]);
  bullet.position.copy(startPos);
  bullet.velocity = dir.clone().multiplyScalar(btype.speed);
  bullet.lifetime = 2.5;
  bullet.bdata = {
    type: t.equippedBullet,
    damage: btype.baseDamage * getDamageMult(t),
    hitEnemies: new Set(),
  };

  spawnMuzzleFlash(startPos, btype.color);
  bullets.push(bullet);
  scene.add(bullet);
}

function shoot() {
  if (!isLocked || !gameStarted || gameOver || shopOpen) return;
  const t = turretData[activeTurretIndex];
  const pos = new THREE.Vector3(); t.barrelRef.getWorldPosition(pos);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  spawnBullet(activeTurretIndex, dir, pos);
  playShootSound();
}

function autoShoot(turretIdx, enemy) {
  const t = turretData[turretIdx];
  const pos = new THREE.Vector3(); t.barrelRef.getWorldPosition(pos);
  const dir = new THREE.Vector3().subVectors(enemy.position, pos).normalize();
  dir.x += (Math.random()-.5)*.04; dir.y += (Math.random()-.5)*.04; dir.z += (Math.random()-.5)*.04;
  dir.normalize();
  spawnBullet(turretIdx, dir, pos);
  playAutoShootSound(pos);
}

// ─── Auto-fire System ─────────────────────────────────────────────────────────
const AUTO_AIM_SPEED = 3.5;

function updateAutoTurrets(delta) {
  if (!enemies.length) return;
  for (let i=0; i<TURRET_COUNT; i++) {
    if (i===activeTurretIndex) continue;
    const t = turretData[i];
    if (t.baseState==='inactive') continue;

    // Find nearest enemy
    let closest=null, cDist=Infinity;
    for (const e of enemies) {
      const d = e.position.distanceTo(t.base.position);
      if (d<cDist) { cDist=d; closest=e; }
    }
    if (!closest) continue;

    // Aim
    const dx = closest.position.x - t.base.position.x;
    const dy = closest.position.y - (t.base.position.y + 1.5);
    const dz = closest.position.z - t.base.position.z;
    const hd = Math.sqrt(dx*dx+dz*dz);
    const tYaw   = Math.atan2(-dx, -dz);
    const tPitch = Math.max(PITCH_DOWN, Math.min(PITCH_UP, Math.atan2(dy, hd)));

    let yawDiff = ((tYaw - t.base.rotation.y + Math.PI) % (Math.PI*2)) - Math.PI;
    t.base.rotation.y  += yawDiff * AUTO_AIM_SPEED * delta;
    t.pitch.rotation.x += (tPitch - t.pitch.rotation.x) * AUTO_AIM_SPEED * delta;

    const aligned = Math.abs(yawDiff)<0.12 && Math.abs(tPitch-t.pitch.rotation.x)<0.12;

    if (t.autoBurstLeft > 0) {
      t.autoBurstTimer -= delta;
      if (t.autoBurstTimer<=0) { autoShoot(i, closest); t.autoBurstLeft--; t.autoBurstTimer=0.12; }
    } else {
      t.autoCooldown -= delta;
      if (t.autoCooldown<=0 && aligned) {
        t.autoBurstLeft = getBurstSize(t);
        t.autoCooldown  = getAutoRate(t);
      }
    }
  }
}

// ─── Muzzle Flash & Particles ─────────────────────────────────────────────────
function spawnMuzzleFlash(pos, color=0xffffaa) {
  const f = new THREE.Mesh(
    new THREE.SphereGeometry(.25,6,6),
    new THREE.MeshBasicMaterial({ color, transparent:true, opacity:1 })
  );
  f.position.copy(pos); f.life=0.06; f.maxLife=0.06;
  particles.push({mesh:f,type:'flash'}); scene.add(f);
}

// ── Shared explosion geometries — created once, reused every explosion ─────
const _EXP_GEO_SPHERE = new THREE.SphereGeometry(1, 7, 6);
const _EXP_GEO_FB     = new THREE.SphereGeometry(1, 8, 7);
const _EXP_GEO_RING   = new THREE.TorusGeometry(1, 0.30, 6, 20);
const _EXP_GEO_SMOKE  = new THREE.SphereGeometry(1, 6, 5);
const _EXP_GEO_DEBRIS = new THREE.BoxGeometry(1, 1, 1);
const _EXP_MAX_CONCURRENT = 3; // drop new explosions beyond this

function spawnHitParticles(pos, color=0xff4400) {
  // 8 hit sparks as a single Points object (1 draw call)
  const n = 8;
  const pArr = new Float32Array(n*3);
  const vArr = new Float32Array(n*3);
  for (let i=0; i<n; i++) {
    pArr[i*3]=pos.x; pArr[i*3+1]=pos.y; pArr[i*3+2]=pos.z;
    const sp=10+Math.random()*14;
    vArr[i*3]=(Math.random()-.5)*sp; vArr[i*3+1]=Math.random()*sp*0.8; vArr[i*3+2]=(Math.random()-.5)*sp;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pArr,3));
  const pts = new THREE.Points(geo,
    new THREE.PointsMaterial({color, size:0.35, sizeAttenuation:true,
      transparent:true, opacity:1, blending:THREE.AdditiveBlending, depthWrite:false})
  );
  pts.velocities=vArr; pts.life=0.6; pts.maxLife=0.6;
  particles.push({mesh:pts, type:'expSparks'}); scene.add(pts);
}

function spawnExplosion(pos, scale=1.0) {
  // Hard cap — skip if too many active to protect FPS
  if (particles.filter(p=>p.isExplosion).length >= _EXP_MAX_CONCURRENT) return;
  const s = scale;

  const addMat = (color, opacity=1) => new THREE.MeshBasicMaterial(
    {color, transparent:true, opacity, depthWrite:false, blending:THREE.AdditiveBlending}
  );

  // 1. Flash central
  const flash = new THREE.Mesh(_EXP_GEO_SPHERE, addMat(0xffffff));
  flash.position.copy(pos); flash.scale.setScalar(3.5*s);
  flash.life=0.09; flash.maxLife=0.09; flash.baseScale=3.5*s;
  particles.push({mesh:flash, type:'expFlash', isExplosion:true}); scene.add(flash);

  // 2. Fireball naranja
  const fb1 = new THREE.Mesh(_EXP_GEO_FB, addMat(0xff5500, 0.92));
  fb1.position.copy(pos); fb1.scale.setScalar(2.0*s);
  fb1.life=0.55; fb1.maxLife=0.55; fb1.baseScale=2.0*s;
  particles.push({mesh:fb1, type:'expFireball', isExplosion:true}); scene.add(fb1);

  // 3. Fireball amarillo
  const fb2 = new THREE.Mesh(_EXP_GEO_FB, addMat(0xffdd00, 0.88));
  fb2.position.copy(pos); fb2.scale.setScalar(1.2*s);
  fb2.life=0.35; fb2.maxLife=0.35; fb2.baseScale=1.2*s;
  particles.push({mesh:fb2, type:'expFireball', isExplosion:true}); scene.add(fb2);

  // 4. Shockwave ring
  const ring = new THREE.Mesh(_EXP_GEO_RING, addMat(0xffaa44, 0.80));
  ring.position.copy(pos); ring.rotation.x=Math.PI/2; ring.scale.setScalar(s);
  ring.life=0.40; ring.maxLife=0.40; ring.baseScale=s;
  particles.push({mesh:ring, type:'expRing', isExplosion:true}); scene.add(ring);

  // 5. Humo
  const smoke = new THREE.Mesh(_EXP_GEO_SMOKE,
    new THREE.MeshBasicMaterial({color:0x442211, transparent:true, opacity:0.68, depthWrite:false})
  );
  smoke.position.copy(pos); smoke.scale.setScalar(2.2*s);
  smoke.life=1.6; smoke.maxLife=1.6; smoke.baseScale=2.2*s;
  particles.push({mesh:smoke, type:'expSmoke', isExplosion:true}); scene.add(smoke);

  // 6. Chispas — un solo Points (1 draw call)
  const sparkN = Math.min(Math.floor(14*s+6), 18);
  const spPos = new Float32Array(sparkN*3);
  const spVel = new Float32Array(sparkN*3);
  for (let i=0; i<sparkN; i++) {
    spPos[i*3]=pos.x; spPos[i*3+1]=pos.y; spPos[i*3+2]=pos.z;
    const spd=(14+Math.random()*18)*s;
    spVel[i*3]=(Math.random()-.5)*spd;
    spVel[i*3+1]=(Math.random()*0.6+0.3)*spd;
    spVel[i*3+2]=(Math.random()-.5)*spd;
  }
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos,3));
  const sparks = new THREE.Points(spGeo,
    new THREE.PointsMaterial({color:0xffaa22, size:0.5*s, sizeAttenuation:true,
      transparent:true, opacity:1, blending:THREE.AdditiveBlending, depthWrite:false})
  );
  sparks.velocities=spVel; sparks.life=1.2; sparks.maxLife=1.2;
  particles.push({mesh:sparks, type:'expSparks', isExplosion:true}); scene.add(sparks);

  // 7. Debris — geometría compartida, escala por instancia
  const debN = Math.min(Math.floor(3*s+2), 5);
  for (let i=0; i<debN; i++) {
    const sz=(0.3+Math.random()*0.4)*s;
    const deb = new THREE.Mesh(_EXP_GEO_DEBRIS,
      new THREE.MeshBasicMaterial({color:0x331100, transparent:true, opacity:1})
    );
    deb.position.copy(pos); deb.scale.setScalar(sz);
    const spd=(7+Math.random()*10)*s;
    deb.velocity=new THREE.Vector3((Math.random()-.5)*spd,(Math.random()*0.5+0.1)*spd,(Math.random()-.5)*spd);
    deb.rotVel=new THREE.Vector3(Math.random()*10-5,Math.random()*10-5,Math.random()*10-5);
    deb.life=1.1+Math.random()*0.6; deb.maxLife=deb.life;
    particles.push({mesh:deb, type:'expDebris', isExplosion:true}); scene.add(deb);
  }

  // 8. Luz puntual
  const lHost = new THREE.Object3D();
  lHost.position.copy(pos);
  lHost.add(new THREE.PointLight(0xff8800, 10*s, 35*s));
  lHost.initIntensity=10*s; lHost.life=0.5; lHost.maxLife=0.5;
  scene.add(lHost);
  particles.push({mesh:lHost, type:'expLight', isExplosion:true});
}

// ─── Bullet Hit Effects ───────────────────────────────────────────────────────
let _typeEffectTimer = null;
function showTypeEffect(mult) {
  if (mult === 1) return;
  clearTimeout(_typeEffectTimer);
  if (mult >= 2) {
    typeEffectEl.textContent = '¡SÚPER EFECTIVO! ×' + mult;
    typeEffectEl.style.color = '#ffee00';
    typeEffectEl.style.textShadow = '0 0 18px #ffcc00, 0 0 36px rgba(255,200,0,.5)';
  } else if (mult === 0) {
    typeEffectEl.textContent = '¡NO AFECTA!';
    typeEffectEl.style.color = '#888888';
    typeEffectEl.style.textShadow = '0 0 8px #555555';
  } else {
    typeEffectEl.textContent = 'POCO EFECTIVO ×' + mult;
    typeEffectEl.style.color = '#aaaaff';
    typeEffectEl.style.textShadow = '0 0 10px #6666ff';
  }
  typeEffectEl.style.opacity = '1';
  _typeEffectTimer = setTimeout(() => { typeEffectEl.style.opacity = '0'; }, 900);
}

function applyBulletHit(bullet, enemy) {
  const btype = BULLET_TYPES[bullet.bdata.type];
  const enemyTypes = enemy.userData.pokeTypes ?? ['normal'];
  const typeMult = getTypeMultiplier(bullet.bdata.type, enemyTypes);
  const finalDmg = bullet.bdata.damage * typeMult;
  enemy.userData.hp -= finalDmg;
  refreshHealthBar(enemy);
  showTypeEffect(typeMult);

  if (btype.special==='slow') {
    enemy.userData.slowTimer  = btype.slowTime;
    enemy.userData.slowFactor = btype.slowFactor;
  }
  if (btype.special==='burn') {
    enemy.userData.burnTimer = btype.burnTime;
    enemy.userData.burnDPS   = btype.burnDPS;
  }
  if (btype.special==='aoe') {
    spawnExplosion(enemy.position.clone());
    for (const other of enemies) {
      if (other===enemy) continue;
      if (other.position.distanceTo(enemy.position) < btype.aoeRadius) {
        other.userData.hp -= btype.aoeDamage;
        refreshHealthBar(other);
      }
    }
  }
  spawnHitParticles(bullet.position.clone(), btype.color);
  playHitSound(enemy.position.clone());
}

function refreshHealthBar(enemy) {
  const r = Math.max(enemy.userData.hp / enemy.userData.maxHp, 0.001);
  enemy.userData.hbFill.scale.x = r;
  enemy.userData.hbFill.position.x = -(1-r)*enemy.userData.type.size;
}

// ─── Toon gradient (3 bandas de iluminación tipo cel-shading) ─────────────────
const _toonGrad = (() => {
  const data = new Uint8Array([60, 140, 220]);
  const tex  = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

// ─── Enemies ──────────────────────────────────────────────────────────────────
const ENEMY_BASE_STATS = [
  { speed:3.5, hp:1, size:.5,  score:10, color:0xff2200, growthRate:'fast'    }, // Rojo: glass cannon
  { speed:2.0, hp:3, size:.8,  score:25, color:0xff6600, growthRate:'medium'  }, // Naranja: equilibrado
  { speed:5.0, hp:1, size:.35, score:20, color:0xcc00ff, growthRate:'fast'    }, // Morado: velocista
  { speed:1.2, hp:6, size:1.1, score:50, color:0xff0077, growthRate:'slow'    }, // Rosa: tanque
  { speed:4.0, hp:1, size:.6,  score:15, color:0x00ff00, growthRate:'erratic' }, // Verde: surge (débil→explosivo)
  { speed:2.5, hp:4, size:.9,  score:30, color:0x0000ff, growthRate:'medium'  }, // Azul: generalista
  { speed:3.0, hp:2, size:.7,  score:20, color:0xffff00, growthRate:'slow'    }, // Amarillo: slow-build
];

const ENEMY_GEOMETRIES = [
  (size) => new THREE.OctahedronGeometry(size, 0),
  (size) => new THREE.BoxGeometry(size * 1.2, size * 1.2, size * 1.2), // Adjust multiplier
  (size) => new THREE.DodecahedronGeometry(size, 0),
  (size) => new THREE.TetrahedronGeometry(size, 0),
  (size) => new THREE.CylinderGeometry(size * 0.8, size * 0.8, size * 1.5, 8),
  (size) => new THREE.TorusGeometry(size * 0.8, size * 0.3, 8, 16),
  (size) => new THREE.ConeGeometry(size, size * 1.5, 8),
];

const ENEMY_SIZE_TIERS = [
    { sizeMult: 1.0, speedMult: 1.0, hpMult: 1.0, rarity: 0.5 },
    { sizeMult: 2.0, speedMult: 0.8, hpMult: 2.0, rarity: 0.4 },
    { sizeMult: 4.0, speedMult: 0.6, hpMult: 4.0, rarity: 0.1 },
];

// ─── Pokemon Growth Rate Curves ───────────────────────────────────────────────
// Basado en las fórmulas de PokeAPI /growth-rate.
// Cada curva refleja cómo distintos Pokemon escalan de nivel:
//   fast    → 4L³/5  : se vuelven peligrosos rápido
//   medium  → L³     : progresión balanceada estándar
//   slow    → 5L³/4  : curva suave, techo alto en olas tardías
//   erratic → tramos : débil hasta ola 4, luego pico repentino
const POKEMON_GROWTH = {
  fast:    w => 1 + w * 0.28 + w * w * 0.010,
  medium:  w => 1 + w * 0.16 + w * w * 0.005,
  slow:    w => 1 + w * 0.09 + w * w * 0.002,
  erratic: w => w < 5 ? 1 + w * 0.05 : 1 + (w - 4) * 0.38,
};

// ─── PokeAPI Local Data — Enemy Templates (Opción 1) ─────────────────────────
// Datos obtenidos de https://pokeapi.co/api/v2/pokemon/{id} y embebidos localmente.
// speed  = pokeSpeed / 20        (rango 40-180 → 2-9)
// hp     = ceil(pokeHp / 18)     (rango 20-160 → 1-9)
// size   = clamp(height/14, 0.3, 1.4)
// score  = max(10, round(baseExp/5))
// color  = color del tipo primario (tabla de 18 tipos)
// pokeTypes = tipos del Pokemon (usado por el sistema de resistencias en Opción 3)
const POKE_TYPE_COLORS = {
  normal:0xA8A878, fire:0xF08030, water:0x6890F0, electric:0xF8D030,
  grass:0x78C850,  ice:0x98D8D8,  fighting:0xC03028, poison:0xA040A0,
  ground:0xE0C068, flying:0xA890F0, psychic:0xF85888, bug:0xA8B820,
  rock:0xB8A038,   ghost:0x705898, dragon:0x7038F8,  dark:0x705848,
  steel:0xB8B8D0,  fairy:0xEE99AC,
};

const POKE_WAVE_POOLS = [
  // Pool 0 — Olas 1-3: Gen 1 básicos
  [
    {name:'charmander', speed:3.25,hp:3,size:0.43,score:12,color:0xF08030,growthRate:'medium',pokeTypes:['fire']},
    {name:'squirtle',   speed:2.15,hp:3,size:0.36,score:13,color:0x6890F0,growthRate:'medium',pokeTypes:['water']},
    {name:'pikachu',    speed:4.50,hp:2,size:0.30,score:22,color:0xF8D030,growthRate:'fast',  pokeTypes:['electric']},
    {name:'jigglypuff', speed:1.00,hp:7,size:0.36,score:19,color:0xA8A878,growthRate:'slow',  pokeTypes:['normal','fairy']},
    {name:'meowth',     speed:4.50,hp:3,size:0.30,score:12,color:0xA8A878,growthRate:'fast',  pokeTypes:['normal']},
    {name:'abra',       speed:4.50,hp:2,size:0.64,score:12,color:0xF85888,growthRate:'fast',  pokeTypes:['psychic']},
    {name:'geodude',    speed:1.00,hp:3,size:0.30,score:12,color:0xB8A038,growthRate:'medium',pokeTypes:['rock','ground']},
    {name:'gastly',     speed:4.00,hp:2,size:0.93,score:12,color:0x705898,growthRate:'fast',  pokeTypes:['ghost','poison']},
  ],
  // Pool 1 — Olas 4-6: Gen 1 intermedios
  [
    {name:'mankey',     speed:3.50,hp:3,size:0.36,score:12,color:0xC03028,growthRate:'medium',pokeTypes:['fighting']},
    {name:'growlithe',  speed:3.00,hp:4,size:0.50,score:14,color:0xF08030,growthRate:'medium',pokeTypes:['fire']},
    {name:'machop',     speed:1.75,hp:4,size:0.57,score:12,color:0xC03028,growthRate:'medium',pokeTypes:['fighting']},
    {name:'ponyta',     speed:4.50,hp:3,size:0.71,score:16,color:0xF08030,growthRate:'fast',  pokeTypes:['fire']},
    {name:'grimer',     speed:1.25,hp:5,size:0.64,score:13,color:0xA040A0,growthRate:'slow',  pokeTypes:['poison']},
    {name:'rhyhorn',    speed:1.25,hp:5,size:0.71,score:14,color:0xE0C068,growthRate:'slow',  pokeTypes:['ground','rock']},
    {name:'eevee',      speed:2.75,hp:4,size:0.30,score:13,color:0xA8A878,growthRate:'medium',pokeTypes:['normal']},
    {name:'dragonite',  speed:4.00,hp:6,size:1.40,score:54,color:0x7038F8,growthRate:'fast',  pokeTypes:['dragon','flying']},
  ],
  // Pool 2 — Olas 7-9: Gen 1 avanzados
  [
    {name:'hitmonlee',  speed:4.35,hp:3,size:1.07,score:32,color:0xC03028,growthRate:'fast',  pokeTypes:['fighting']},
    {name:'tangela',    speed:3.00,hp:4,size:0.71,score:17,color:0x78C850,growthRate:'medium',pokeTypes:['grass']},
    {name:'pinsir',     speed:4.25,hp:4,size:1.07,score:35,color:0xA8B820,growthRate:'fast',  pokeTypes:['bug']},
    {name:'lapras',     speed:3.00,hp:8,size:1.40,score:37,color:0x6890F0,growthRate:'slow',  pokeTypes:['water','ice']},
    {name:'snorlax',    speed:1.50,hp:9,size:1.40,score:38,color:0xA8A878,growthRate:'slow',  pokeTypes:['normal']},
    {name:'dratini',    speed:2.50,hp:3,size:1.29,score:12,color:0x7038F8,growthRate:'medium',pokeTypes:['dragon']},
    {name:'omanyte',    speed:1.75,hp:2,size:0.30,score:14,color:0xB8A038,growthRate:'medium',pokeTypes:['rock','water']},
    {name:'kabuto',     speed:2.75,hp:2,size:0.36,score:14,color:0xB8A038,growthRate:'medium',pokeTypes:['rock','water']},
  ],
  // Pool 3 — Olas 10-14: Gen 2
  [
    {name:'chikorita',  speed:2.25,hp:3,size:0.64,score:13,color:0x78C850,growthRate:'medium',pokeTypes:['grass']},
    {name:'togepi',     speed:1.00,hp:2,size:0.30,score:10,color:0xEE99AC,growthRate:'medium',pokeTypes:['fairy']},
    {name:'marill',     speed:2.00,hp:4,size:0.30,score:18,color:0x6890F0,growthRate:'medium',pokeTypes:['water','fairy']},
    {name:'wooper',     speed:1.00,hp:4,size:0.30,score:10,color:0x6890F0,growthRate:'erratic',pokeTypes:['water','ground']},
    {name:'slugma',     speed:1.00,hp:3,size:0.50,score:10,color:0xF08030,growthRate:'medium',pokeTypes:['fire']},
    {name:'larvitar',   speed:2.05,hp:3,size:0.43,score:12,color:0xB8A038,growthRate:'medium',pokeTypes:['rock','ground']},
    {name:'hoothoot',   speed:2.50,hp:4,size:0.50,score:10,color:0xA890F0,growthRate:'medium',pokeTypes:['normal','flying']},
    {name:'umbreon',    speed:3.25,hp:6,size:0.71,score:37,color:0x705848,growthRate:'slow',  pokeTypes:['dark']},
  ],
  // Pool 4 — Olas 15+: Gen 3-4
  [
    {name:'treecko',    speed:3.50,hp:3,size:0.36,score:12,color:0x78C850,growthRate:'medium',pokeTypes:['grass']},
    {name:'ralts',      speed:2.00,hp:2,size:0.30,score:10,color:0xF85888,growthRate:'medium',pokeTypes:['psychic','fairy']},
    {name:'aron',       speed:1.50,hp:3,size:0.30,score:13,color:0xB8B8D0,growthRate:'medium',pokeTypes:['steel','rock']},
    {name:'gulpin',     speed:2.00,hp:4,size:0.30,score:12,color:0xA040A0,growthRate:'medium',pokeTypes:['poison']},
    {name:'spoink',     speed:3.00,hp:4,size:0.50,score:13,color:0xF85888,growthRate:'medium',pokeTypes:['psychic']},
    {name:'feebas',     speed:4.00,hp:2,size:0.43,score:10,color:0x6890F0,growthRate:'fast',  pokeTypes:['water']},
    {name:'buneary',    speed:4.25,hp:4,size:0.30,score:14,color:0xA8A878,growthRate:'fast',  pokeTypes:['normal']},
    {name:'gible',      speed:2.10,hp:4,size:0.50,score:12,color:0x7038F8,growthRate:'medium',pokeTypes:['dragon','ground']},
    {name:'rotom',      speed:4.55,hp:3,size:0.30,score:31,color:0xF8D030,growthRate:'fast',  pokeTypes:['electric','ghost']},
    {name:'whismur',    speed:1.40,hp:4,size:0.43,score:10,color:0xA8A878,growthRate:'erratic',pokeTypes:['normal']},
  ],
];

function getWavePool(waveNum) {
  if (waveNum >= 15) return POKE_WAVE_POOLS[4];
  if (waveNum >= 10) return POKE_WAVE_POOLS[3];
  if (waveNum >=  7) return POKE_WAVE_POOLS[2];
  if (waveNum >=  4) return POKE_WAVE_POOLS[1];
  return POKE_WAVE_POOLS[0];
}

// Helper to pick a tier based on rarity
function pickEnemyTier() {
    const rand = Math.random();
    let cumulativeRarity = 0;
    for (const tier of ENEMY_SIZE_TIERS) {
        cumulativeRarity += tier.rarity;
        if (rand < cumulativeRarity) {
            return tier;
        }
    }
    return ENEMY_SIZE_TIERS[0]; // Fallback to smallest
}

function spawnEnemy(typeIndex) {
  const pool = getWavePool(wave);
  const baseType = pool[typeIndex % pool.length];
  const tier = pickEnemyTier();

  const growthMult = POKEMON_GROWTH[baseType.growthRate || 'medium'](wave);
  const type = {
    speed:     Math.min(14, baseType.speed * growthMult * tier.speedMult * 0.8),
    hp:        Math.ceil(baseType.hp * growthMult * tier.hpMult),
    size:      baseType.size * tier.sizeMult,
    score:     Math.ceil(baseType.score * growthMult * tier.hpMult),
    color:     baseType.color,
    pokeTypes: baseType.pokeTypes ?? ['normal'],
    pokeName:  baseType.name ?? '',
  };
  const angle = Math.random()*Math.PI*2;

  // Randomized spawn proximity
  const actualSpawnRadius = SPAWN_RADIUS - (Math.random() * SPAWN_RADIUS * 0.5); // Between 50% and 100% of SPAAWN_RADIUS
  const sx = Math.cos(angle) * actualSpawnRadius, sz = Math.sin(angle) * actualSpawnRadius;

  // Randomized spawn height
  const randomYOffset = Math.random() * 10 - 5; // Random offset between -5 and 5 units
  const group = new THREE.Group();
  group.position.set(sx, terrainHeight(sx, sz) + type.size + randomYOffset, sz);

  const geometryFn = ENEMY_GEOMETRIES[Math.floor(Math.random() * ENEMY_GEOMETRIES.length)];
  const mesh = new THREE.Mesh(
    geometryFn(type.size),
    new THREE.MeshToonMaterial({color:type.color, emissive:type.color, emissiveIntensity:.25, gradientMap:_toonGrad})
  );
  mesh.castShadow=true; group.add(mesh);

  const eye = new THREE.Mesh(new THREE.SphereGeometry(type.size*.3,8,8), new THREE.MeshBasicMaterial({color:0xffffff}));
  eye.position.z = -type.size*.7; group.add(eye);

  const hbBg = new THREE.Mesh(new THREE.PlaneGeometry(type.size*2,.15), new THREE.MeshBasicMaterial({color:0x440000,side:THREE.DoubleSide}));
  hbBg.position.y = type.size+.3; group.add(hbBg);

  const hbFill = new THREE.Mesh(new THREE.PlaneGeometry(type.size*2,.15), new THREE.MeshBasicMaterial({color:0x00ff44,side:THREE.DoubleSide}));
  hbFill.position.y = type.size+.3; hbFill.position.z=.01; group.add(hbFill);

  group.userData = {
    type, mesh, hbFill,
    hp:type.hp, maxHp:type.hp,
    speed: type.speed,
    pokeTypes: type.pokeTypes,
    rotSpeed:(Math.random()-.5)*4,
    bobOffset:Math.random()*Math.PI*2,
    slowTimer:0, slowFactor:1,
    burnTimer:0, burnDPS:0,
  };
  scene.add(group);
  enemies.push(group);
  enemyOutline.selectedObjects.push(group);
  waveEnemiesLeft++;
}

// ─── Areosaur (volador) ───────────────────────────────────────────────────────
// Geometría compartida para partículas de propulsión
const _thrusterGeo = new THREE.SphereGeometry(1, 5, 4);

// ── Sonido de motor: drone grave sierra constante espacializado ───────────────
function startAreosaurEngine(x, y, z) {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return null;
  const { masterGain } = ensureMasterChain(ctx);

  const panner = ctx.createPanner();
  panner.panningModel  = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance   = 12;
  panner.maxDistance   = 280;
  panner.rolloffFactor = 1.2;
  panner.setPosition(x, y, z);
  panner.connect(masterGain);

  const baseFreq = 58 + Math.random() * 18;

  // Tres osciladores desafinados para grosor "sierra"
  const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
  osc1.frequency.value = baseFreq;
  const osc2 = ctx.createOscillator(); osc2.type = 'sawtooth';
  osc2.frequency.value = baseFreq * 1.015;
  const osc3 = ctx.createOscillator(); osc3.type = 'square';
  osc3.frequency.value = baseFreq * 2.97;  // 3er armónico ligeramente detuneado

  // LFO — modulación de frecuencia lenta para efecto de motor vivo
  const lfo = ctx.createOscillator(); lfo.type = 'sine';
  lfo.frequency.value = 3.5 + Math.random() * 2;
  const lfoG = ctx.createGain(); lfoG.gain.value = 5;
  lfo.connect(lfoG); lfoG.connect(osc1.frequency); lfoG.connect(osc2.frequency);

  // Filtros: LPF oscuro + BPF resonante en graves
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = 420; lpf.Q.value = 1.2;
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass'; bpf.frequency.value = 110; bpf.Q.value = 3;

  const g1 = ctx.createGain(); g1.gain.value = 0.55;
  const g2 = ctx.createGain(); g2.gain.value = 0.40;
  const g3 = ctx.createGain(); g3.gain.value = 0.18;
  const gMix = ctx.createGain(); gMix.gain.value = 0.22;

  osc1.connect(g1); g1.connect(lpf);
  osc2.connect(g2); g2.connect(lpf);
  osc3.connect(g3); g3.connect(bpf);
  lpf.connect(gMix); bpf.connect(gMix);
  gMix.connect(panner);

  osc1.start(); osc2.start(); osc3.start(); lfo.start();
  return { osc1, osc2, osc3, lfo, panner };
}

function stopAreosaurEngine(eng) {
  if (!eng) return;
  try { eng.osc1.stop(); eng.osc2.stop(); eng.osc3.stop(); eng.lfo.stop(); } catch(_) {}
  eng.panner.disconnect();
}

function updateAreosaurEnginePos(eng, pos) {
  if (!eng?.panner) return;
  eng.panner.setPosition(pos.x, pos.y, pos.z);
}

let _areosaurModel = null;
const _gltfLoader  = new GLTFLoader();
_gltfLoader.load(areosaurUrl, (gltf) => {
  _areosaurModel = gltf.scene;
  // materiales más brillantes/emissive para destacar en el cielo
  _areosaurModel.traverse(child => {
    if (child.isMesh) {
      child.material = child.material.clone();
      child.material.emissive     = new THREE.Color(0xff4400);
      child.material.emissiveIntensity = 0.5;
      child.castShadow = true;
    }
  });
});

// ── Bombas aéreas ─────────────────────────────────────────────────────────────
const aeroBombs = [];
const BOMB_GRAVITY   = 1.8;  // caída muy lenta
const BOMB_AOE_RAD   = 10;
const BOMB_CORE_DMG  = 12;

function dropBomb(fromPos) {
  const geo  = new THREE.SphereGeometry(0.55, 8, 6);
  const mat  = new THREE.MeshStandardMaterial({
    color: 0x222222, emissive: 0xff3300, emissiveIntensity: 0.8, metalness: 0.7,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(fromPos);
  mesh.castShadow = true;

  // Aleta trasera visual
  const finGeo = new THREE.ConeGeometry(0.25, 0.8, 4);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.9 });
  const fin    = new THREE.Mesh(finGeo, finMat);
  fin.rotation.x = Math.PI; fin.position.y = -0.65;
  mesh.add(fin);

  // Luz de advertencia parpadeante
  const bLight = new THREE.PointLight(0xff4400, 1.5, 8);
  mesh.add(bLight);

  // Velocidad inicial: leve deriva horizontal hacia el núcleo
  const toCore = new THREE.Vector3(-fromPos.x, 0, -fromPos.z).normalize();
  const vel    = toCore.clone().multiplyScalar(3 + Math.random() * 2);
  vel.y        = 0;  // sin velocidad vertical inicial, solo cae por gravedad

  scene.add(mesh);
  aeroBombs.push({ mesh, bLight, vel, life: 0 });
}

function updateAeroBombs(delta) {
  for (let i = aeroBombs.length - 1; i >= 0; i--) {
    const b = aeroBombs[i];
    b.life += delta;

    // Gravedad lenta
    b.vel.y -= BOMB_GRAVITY * delta;
    b.mesh.position.addScaledVector(b.vel, delta);

    // Rotación de la bomba en caída
    b.mesh.rotation.x += delta * 1.5;

    // Parpadeo de la luz de advertencia
    b.bLight.intensity = 1.0 + Math.sin(b.life * 18) * 0.8;

    const pos       = b.mesh.position;
    const groundY   = terrainHeight(pos.x, pos.z);
    const coreDist  = pos.distanceTo(coreGroup.position);
    const hitGround = pos.y <= groundY + 0.4;
    const hitCore   = coreDist < BOMB_AOE_RAD * 0.6;
    const timeout   = b.life > 14;

    if (hitGround || hitCore || timeout) {
      // Explosión grande
      spawnExplosion(pos.clone());
      spawnExplosion(pos.clone().add(new THREE.Vector3((Math.random()-.5)*3, 1, (Math.random()-.5)*3)));
      playExplosionSound(pos.clone());

      // Daño al núcleo si está en rango
      if (coreDist < BOMB_AOE_RAD) {
        coreHealth -= BOMB_CORE_DMG * (1 - coreDist / BOMB_AOE_RAD);
        spawnHitParticles(coreGroup.position.clone(), 0xff4400);
        if (coreHealth <= 0) { coreHealth = 0; triggerGameOver(); }
        updateHUD();
      }

      // Daño AOE a enemigos terrestres cercanos (fuego amigo de la bomba)
      for (let ei = enemies.length - 1; ei >= 0; ei--) {
        const e = enemies[ei];
        if (e.userData.isFlyer) continue;
        const d = pos.distanceTo(e.position);
        if (d < BOMB_AOE_RAD) {
          e.userData.hp -= 4 * (1 - d / BOMB_AOE_RAD);
          refreshHealthBar(e);
          if (e.userData.hp <= 0) killEnemy(e, ei);
        }
      }

      scene.remove(b.mesh); b.mesh.geometry.dispose();
      aeroBombs.splice(i, 1);
    }
  }
}

// ── Spawn Areosaur ────────────────────────────────────────────────────────────
function spawnAreosaur() {
  const angle    = Math.random() * Math.PI * 2;
  const dist     = 280 + Math.random() * 50;   // arranca muy lejos
  const sx       = Math.cos(angle) * dist;
  const sz       = Math.sin(angle) * dist;
  const altitude = 10 + Math.random() * 6;     // mucho más bajo

  // Destino: lado opuesto — el núcleo queda en el medio de la trayectoria
  const tx     = -sx;
  const tz     = -sz;
  const flyDir = new THREE.Vector3(tx - sx, 0, tz - sz).normalize();

  const hp    = 10 + wave * 2;
  const speed = (18 + wave * 0.5) * 0.7;
  const size  = 3.5;

  const group = new THREE.Group();
  group.position.set(sx, altitude, sz);
  group.rotation.y = Math.atan2(flyDir.x, flyDir.z);

  // Modelo GLB o fallback
  let modelMesh;
  if (_areosaurModel) {
    modelMesh = _areosaurModel.clone();
    modelMesh.scale.setScalar(18.0);
    modelMesh.rotation.y = Math.PI; // corrige orientación: frente hacia adelante
    group.add(modelMesh);
  } else {
    modelMesh = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 5, 5),
      new THREE.MeshStandardMaterial({ color: 0x884422, emissive: 0x441100, emissiveIntensity: 0.5 })
    );
    modelMesh.rotation.x = Math.PI / 2;
    group.add(modelMesh);
  }

  // Motor glow
  const engineLight = new THREE.PointLight(0xff6600, 2, 15);
  engineLight.position.set(0, 0, 1.5);
  group.add(engineLight);

  // Barra de vida oculta para aviones (objeto dummy, no se añade a la escena)
  const hbFill = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 2, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xff8800, side: THREE.DoubleSide })
  );

  // Motor: sonido grave sierra constante espacializado
  const engineSound = startAreosaurEngine(sx, altitude, sz);

  group.userData = {
    type:        { speed, hp, size, score: 150 + wave * 10, color: 0xff8800 },
    mesh:        modelMesh,
    hbFill,
    engineLight,
    engineSound,
    hp, maxHp:   hp,
    speed,
    flyDir,
    flyTarget:   new THREE.Vector3(tx, altitude, tz),
    flyAltitude: altitude,
    bobOffset:   Math.random() * Math.PI * 2,
    bombCooldown: 1.5 + Math.random(),
    rotSpeed:    0,
    burnTimer: 0, burnDPS: 0,
    slowTimer: 0, slowFactor: 1,
    isFlyer: true,
  };

  scene.add(group);
  enemies.push(group);
  enemyOutline.selectedObjects.push(group);
  waveEnemiesLeft++;
}

function _cleanFlyerPath(enemy) {
  const d = enemy.userData;
  if (d.pathLine)   { scene.remove(d.pathLine);   d.pathLine.geometry.dispose();   d.pathLine   = null; }
  if (d.groundLine) { scene.remove(d.groundLine); d.groundLine.geometry.dispose(); d.groundLine = null; }
}

// Flash de oleada — iluminación estroboscópica de 2 segundos
let _waveFlashTimer = 0;
let _waveFlashPhase = 0;

function triggerWaveFlash() {
  _waveFlashTimer = 2.0;
  _waveFlashPhase = 0;

  // Ráfaga inicial de múltiples bolts en círculo
  const boltsN = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < boltsN; i++) {
    const angle = (i / boltsN) * Math.PI * 2;
    const r     = 40 + Math.random() * 80;
    setTimeout(() => spawnBolt(Math.cos(angle) * r, Math.sin(angle) * r), i * 120);
  }

  // Pico de luz máximo — blanquea toda la escena
  lightningLight.position.set(0, 140, 0);
  lightningFill.position.set(0, 60, 0);
  lightningLight.intensity = 1800;
  lightningFill.intensity  = 900;
  _flashTimer = 2.0;
  _flashPeak  = 1800;
}

function updateWaveFlash(delta) {
  if (_waveFlashTimer <= 0) return;
  _waveFlashTimer -= delta;
  _waveFlashPhase += delta;

  // Estrobos cada ~0.18s durante los 2 segundos
  const strobeRate = 0.18;
  if (Math.floor(_waveFlashPhase / strobeRate) > Math.floor((_waveFlashPhase - delta) / strobeRate)) {
    const intensity = 400 + Math.random() * 600;
    lightningLight.intensity = intensity;
    lightningFill.intensity  = intensity * 0.5;
    _flashTimer = strobeRate * 0.7;

    // bolt aleatorio ocasional durante el flash
    if (Math.random() > 0.5) {
      const bx = (Math.random() - 0.5) * 200;
      const bz = (Math.random() - 0.5) * 200;
      spawnBolt(bx, bz);
    }
  }
}

function spawnWave(waveNum) {
  drumBpm = 84 + waveNum;
  const count = 5+waveNum*3;
  const pool  = getWavePool(waveNum);
  const types = Math.min(waveNum, pool.length);
  for (let i=0; i<count; i++) {
    const t = Math.floor(Math.random()*types);
    setTimeout(()=>spawnEnemy(t), i*300);
  }
  // Areosaurs a partir de la oleada 2, cantidad creciente
  if (waveNum >= 2) {
    const areosaurCount = Math.min(1 + Math.floor((waveNum - 2) / 2), 4);
    for (let i = 0; i < areosaurCount; i++) {
      setTimeout(() => spawnAreosaur(), 1500 + i * 2500);
    }
  }
  triggerWaveFlash();
  waveAnnounce.textContent = `OLA ${waveNum}`;
  waveAnnounce.style.opacity='1'; waveAnnounce.style.transform='translate(-50%,-50%) scale(1.2)';
  setTimeout(()=>{ waveAnnounce.style.opacity='0'; waveAnnounce.style.transform='translate(-50%,-50%) scale(1)'; }, 2000);
}

// ─── Collision Detection ──────────────────────────────────────────────────────
function killEnemy(enemy, idx) {
  if (enemy.userData.isFlyer && enemy.userData.engineSound) stopAreosaurEngine(enemy.userData.engineSound);
  playExplosionSound(enemy.position.clone());
  spawnExplosion(enemy.position.clone(), enemy.userData.isFlyer ? 2.0 : 1.0);
  scene.remove(enemy); enemies.splice(idx, 1);
  const oi = enemyOutline.selectedObjects.indexOf(enemy);
  if (oi!==-1) enemyOutline.selectedObjects.splice(oi,1);
  waveEnemiesLeft--;
  const now = clock.getElapsedTime();
  killStreak = now-lastKillTime<1.5 ? killStreak+1 : 1;
  lastKillTime = now;
  score += enemy.userData.type.score * (killStreak>2 ? killStreak : 1);
  updateHUD();
}

function removeEnemy(enemy, idx) {
  if (enemy.userData.isFlyer && enemy.userData.engineSound) stopAreosaurEngine(enemy.userData.engineSound);
  scene.remove(enemy); enemies.splice(idx,1);
  const oi = enemyOutline.selectedObjects.indexOf(enemy);
  if (oi!==-1) enemyOutline.selectedObjects.splice(oi,1);
  waveEnemiesLeft--;
}

function checkBulletEnemyCollisions() {
  for (let bi=bullets.length-1; bi>=0; bi--) {
    const b = bullets[bi];
    const isPierce = BULLET_TYPES[b.bdata.type].special==='pierce';
    let hit = false;

    for (let ei=enemies.length-1; ei>=0; ei--) {
      const e = enemies[ei];
      if (isPierce && b.bdata.hitEnemies.has(e)) continue;
      if (b.position.distanceTo(e.position) < e.userData.type.size*1.5) {
        if (isPierce) b.bdata.hitEnemies.add(e);
        applyBulletHit(b, e);
        if (e.userData.hp<=0) killEnemy(e, ei);
        if (!isPierce) { scene.remove(b); bullets.splice(bi,1); hit=true; break; }
      }
    }
  }
}

function checkEnemyCoreCollisions() {
  for (let ei=enemies.length-1; ei>=0; ei--) {
    const e = enemies[ei];
    if (e.position.distanceTo(coreGroup.position)<1.5) {
      coreHealth -= 10+e.userData.type.hp*5;
      spawnHitParticles(e.position.clone(), 0x00ffff);
      removeEnemy(e, ei);
      if (coreHealth<=0) { coreHealth=0; triggerGameOver(); }
      updateHUD();
    }
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function updateHUD() {
  scoreEl.textContent = score;
  waveEl.textContent  = wave;
  streakEl.style.opacity = killStreak>2 ? '1' : '0';
  if (killStreak>2) streakEl.textContent = `x${killStreak} STREAK!`;
  updateCoreLabel();
}

function triggerGameOver() {
  gameOver=true; document.exitPointerLock(); stopDrum();
  gameOverEl.style.display='flex'; finalScoreEl.textContent=score; finalWaveEl.textContent=wave;
  hud.style.display='none';
}

function restartGame() {
  for (const e of enemies) scene.remove(e); enemies.length=0; enemyOutline.selectedObjects.length=0;
  for (const b of bullets) scene.remove(b); bullets.length=0;
  for (const p of particles) scene.remove(p.mesh); particles.length=0;
  for (const b of aeroBombs) scene.remove(b.mesh); aeroBombs.length=0;
  score=0; wave=1; coreHealth=100; gameOver=false; killStreak=0; waveEnemiesLeft=0; waveCooldown=0.5; drumBpm=85;
  for (const t of turretData) { t.base.rotation.y=t.initialYaw; t.pitch.rotation.x=0; t.autoCooldown=0; t.autoBurstLeft=0; }
  turretData[activeTurretIndex].pitch.remove(camera);
  activeTurretIndex=0; turretData[0].pitch.add(camera);
  updateActiveTurretVisuals(); updateHexMap(); updateHUD();
  gameOverEl.style.display='none'; hud.style.display='block';
}

// ─── Shop ─────────────────────────────────────────────────────────────────────
let shopTurretIdx = 0;

function openShop() {
  if (gameOver) return;
  shopOpen=true; document.exitPointerLock();
  shopEl.style.display='flex'; shopTurretIdx=activeTurretIndex; renderShop();
}
function closeShop() {
  shopOpen=false; shopEl.style.display='none';
  if (gameStarted && !gameOver) lockPointer();
}
function bulletHex(key) { return '#'+((BULLET_TYPES[key]?.color??0xffffff)).toString(16).padStart(6,'0'); }

function renderShop() {
  const t = turretData[shopTurretIdx];
  shopEl.innerHTML = `
  <div class="shop-panel">
    <div class="shop-header">
      <span class="shop-title">⚙ TIENDA</span>
      <span class="shop-pts">${score} <em>pts</em></span>
      <button class="shop-close" onclick="window._closeShop()">✕</button>
    </div>
    <div class="shop-body">
      <div class="shop-turrets">
        ${turretData.map((td,i)=>`
          <button class="stt-btn${i===shopTurretIdx?' stt-active':''}" onclick="window._selTurret(${i})">
            <span class="stt-num">T${i+1}</span>
            <span class="stt-dot" style="background:${bulletHex(td.equippedBullet)}"></span>
            <span class="stt-st">${i===activeTurretIndex?'CTRL':td.baseState==='auto'?'AUTO':'INACT'}</span>
          </button>`).join('')}
      </div>
      <div class="shop-right">
        <div class="shop-sec">TIPO DE BALA — TORRETA ${shopTurretIdx+1}</div>
        <div class="bullet-grid">
          ${Object.entries(BULLET_TYPES).map(([k,bt])=>{
            const owned=t.unlockedBullets.has(k), eq=t.equippedBullet===k;
            const canBuy=!owned&&score>=bt.unlockCost;
            return `<button class="bb${eq?' bb-eq':owned?' bb-owned':canBuy?'':' bb-lock'}"
              onclick="window.${owned?'_equip':'_buy'}(${shopTurretIdx},'${k}')">
              <span class="bb-dot" style="background:${bulletHex(k)}"></span>
              <span class="bb-name">${bt.name}</span>
              <span class="bb-cost">${eq?'ACTIVA':owned?'EQUIPAR':bt.unlockCost===0?'GRATIS':bt.unlockCost+' pts'}</span>
            </button>`;
          }).join('')}
        </div>
        <div class="shop-sec" style="margin-top:14px">MEJORAS</div>
        <div class="upg-list">
          ${Object.entries(UPGRADE_DEFS).map(([k,def])=>{
            const lvl=t.upgrades[k], max=def.costs.length, atMax=lvl>=max;
            const cost=atMax?null:def.costs[lvl], canBuy=!atMax&&score>=cost;
            const pips=Array.from({length:max},(_,i)=>`<span class="pip${i<lvl?' pip-on':''}"></span>`).join('');
            return `<div class="upg-row">
              <span class="upg-lbl">${def.label}</span>
              <div class="upg-pips">${pips}</div>
              <button class="upg-btn${atMax?' upg-max':canBuy?'':' upg-lock'}"
                ${(atMax||!canBuy)?'disabled':''} onclick="window._upg(${shopTurretIdx},'${k}')">
                ${atMax?'MAX':cost+' pts'}
              </button>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

// Shop actions exposed to inline onclick
window._closeShop = closeShop;
window._selTurret = i => { shopTurretIdx=i; renderShop(); };
window._buy = (ti, key) => {
  const t=turretData[ti], bt=BULLET_TYPES[key];
  if (t.unlockedBullets.has(key)||score<bt.unlockCost) return;
  score-=bt.unlockCost; t.unlockedBullets.add(key);
  t.equippedBullet=key; t.bulletIndicator.material.color.set(bt.color);
  updateHUD(); renderShop();
};
window._equip = (ti, key) => {
  const t=turretData[ti];
  if (!t.unlockedBullets.has(key)) return;
  t.equippedBullet=key; t.bulletIndicator.material.color.set(BULLET_TYPES[key].color);
  renderShop();
};
window._upg = (ti, key) => {
  const t=turretData[ti], def=UPGRADE_DEFS[key], lvl=t.upgrades[key];
  if (lvl>=def.costs.length) return;
  const cost=def.costs[lvl]; if (score<cost) return;
  score-=cost; t.upgrades[key]++; updateHUD(); renderShop();
};

// ─── Animation Loop ───────────────────────────────────────────────────────────
let elapsed=0;
const _camWP = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), .05);
  elapsed += delta;
  crtPass.uniforms.time.value = elapsed;

  if (!gameStarted || gameOver || shopOpen) { composer.render(); return; }

  // Controlled turret: auto-shoot on hold
  if (isMouseDown) { shootCooldown-=delta; if(shootCooldown<=0){shoot();shootCooldown=SHOOT_RATE;} }

  // Auto turrets
  updateAutoTurrets(delta);

  // Bullets
  for (let i=bullets.length-1; i>=0; i--) {
    const b=bullets[i];
    b.position.addScaledVector(b.velocity,delta);
    b.lifetime-=delta;
    if(b.lifetime<=0){scene.remove(b);bullets.splice(i,1);}
  }

  // Particles
  for (let i=particles.length-1; i>=0; i--) {
    const p=particles[i];
    p.mesh.life-=delta;
    const r=p.mesh.life/p.mesh.maxLife;

    if(p.type==='hit'){
      p.mesh.material.opacity=r;
      p.mesh.position.addScaledVector(p.mesh.velocity,delta);
      p.mesh.velocity.y-=12*delta;
    } else if(p.type==='explosion'){
      p.mesh.material.opacity=r;
      p.mesh.scale.setScalar(1+(1-r)*8);
    } else if(p.type==='thruster'){
      p.mesh.position.addScaledVector(p.mesh.velocity,delta);
      p.mesh.scale.setScalar(r * p.mesh.maxLife * 3.5);
      p.mesh.material.opacity = r * 0.9;
    } else if(p.type==='expFlash'){
      p.mesh.scale.setScalar(p.mesh.baseScale * (1+(1-r)*3));
      p.mesh.material.opacity = r * r;
    } else if(p.type==='expFireball'){
      p.mesh.scale.setScalar(p.mesh.baseScale * (1+(1-r)*10));
      p.mesh.material.opacity = Math.pow(r, 0.5) * 0.85;
    } else if(p.type==='expRing'){
      p.mesh.scale.setScalar(p.mesh.baseScale * (1+(1-r)*15));
      p.mesh.material.opacity = r * 0.75;
    } else if(p.type==='expSmoke'){
      p.mesh.scale.setScalar(p.mesh.baseScale * (1+(1-r)*5));
      p.mesh.position.y += 1.5*delta;
      p.mesh.material.opacity = Math.pow(r, 0.4) * 0.55;
    } else if(p.type==='expSparks'){
      // Points — update buffer positions with gravity
      const pa = p.mesh.geometry.attributes.position.array;
      const va = p.mesh.velocities;
      for(let j=0, n=va.length/3; j<n; j++){
        va[j*3+1] -= 14*delta;
        pa[j*3]   += va[j*3]   * delta;
        pa[j*3+1] += va[j*3+1] * delta;
        pa[j*3+2] += va[j*3+2] * delta;
      }
      p.mesh.geometry.attributes.position.needsUpdate = true;
      p.mesh.material.opacity = r;
    } else if(p.type==='expDebris'){
      p.mesh.position.addScaledVector(p.mesh.velocity, delta);
      p.mesh.velocity.y -= 9*delta;
      p.mesh.rotation.x += p.mesh.rotVel.x*delta;
      p.mesh.rotation.y += p.mesh.rotVel.y*delta;
      p.mesh.rotation.z += p.mesh.rotVel.z*delta;
      p.mesh.material.opacity = r * 0.8;
    } else if(p.type==='expLight'){
      const light = p.mesh.children[0];
      if(light) light.intensity = p.mesh.initIntensity * r * r;
    }

    if(p.mesh.life<=0){
      if(p.type==='thruster' || p.type==='expSparks' ||
         p.type==='expFlash' || p.type==='expFireball' ||
         p.type==='expRing'  || p.type==='expSmoke'    ||
         p.type==='expDebris'){
        p.mesh.material.dispose();
      }
      if(p.type==='expSparks') p.mesh.geometry.dispose();
      scene.remove(p.mesh);
      particles.splice(i,1);
    }
  }

  // Starfield Parallax
  if (starfield) {
    const positions = starfield.geometry.attributes.position;
    for (let i = 0; i < STAR_COUNT; i++) {
      let z = positions.getZ(i);
      z += STAR_SPEED_FACTOR * delta;
      if (z > STARFIELD_RANGE_Z / 2) {
        z = -STARFIELD_RANGE_Z / 2; // Reset to the far end
      }
      positions.setZ(i, z);
    }
    positions.needsUpdate = true;
  }

  // Enemies
  camera.getWorldPosition(_camWP);
  // Listener 3D para motores espacializados
  const _al = Howler.ctx?.listener;
  if (_al) {
    if (_al.positionX) { _al.positionX.value=_camWP.x; _al.positionY.value=_camWP.y; _al.positionZ.value=_camWP.z; }
    else _al.setPosition(_camWP.x, _camWP.y, _camWP.z);
  }
  for (let ei=enemies.length-1; ei>=0; ei--) {
    const e=enemies[ei]; const d=e.userData;

    // Burn DoT
    if(d.burnTimer>0){
      d.burnTimer-=delta;
      d.hp-=d.burnDPS*delta;
      refreshHealthBar(e);
      if(d.hp<=0){killEnemy(e,ei);continue;}
    }

    // Slow decay
    if(d.slowTimer>0) d.slowTimer-=delta;
    const speedMult = d.slowTimer>0 ? d.slowFactor : 1;

    if (d.isFlyer) {
      // ── Areosaur: vuelo recto A→B sobre el núcleo ──────────────────────────
      e.position.addScaledVector(d.flyDir, d.speed * speedMult * delta);
      e.position.y = d.flyAltitude + Math.sin(elapsed * 1.4 + d.bobOffset) * 1.0;

      // Alabeo suave del modelo
      if (d.mesh) d.mesh.rotation.z = Math.sin(elapsed * 0.9 + d.bobOffset) * 0.12;

      // Motor pulsa
      if (d.engineLight) d.engineLight.intensity = 1.8 + Math.sin(elapsed * 6 + d.bobOffset) * 0.5;

      // Bombardeo cuando está sobre el núcleo (distancia horizontal)
      const hd2 = e.position.x * e.position.x + e.position.z * e.position.z;
      d.bombCooldown -= delta;
      if (hd2 < 50 * 50 && d.bombCooldown <= 0) {
        dropBomb(e.position.clone());
        d.bombCooldown = 0.9 + Math.random() * 1.0;
      }

      // Actualizar posición del sonido de motor
      if (d.engineSound) updateAreosaurEnginePos(d.engineSound, e.position);

      // Partículas de propulsión — chorros desde la cola del avión
      const exhaustPos = e.position.clone().addScaledVector(d.flyDir, -7);
      const pCount = Math.random() > 0.4 ? 3 : 2;
      for (let p = 0; p < pCount; p++) {
        const sz2  = 0.5 + Math.random() * 0.9;
        const mesh = new THREE.Mesh(
          _thrusterGeo,
          new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.58 + Math.random() * 0.12, 1.0, 0.65 + Math.random() * 0.25),
            transparent: true, opacity: 1,
            depthWrite: false, blending: THREE.AdditiveBlending,
          })
        );
        mesh.scale.setScalar(sz2);
        mesh.position.copy(exhaustPos).addScaledVector(
          new THREE.Vector3((Math.random()-.5), (Math.random()-.5)*0.4, (Math.random()-.5)), 1.5
        );
        const spd = 10 + Math.random() * 8;
        mesh.velocity = d.flyDir.clone().negate().multiplyScalar(spd)
          .add(new THREE.Vector3((Math.random()-.5)*3, (Math.random()-.5)*1.5, (Math.random()-.5)*3));
        mesh.life = 0.25 + Math.random() * 0.25;
        mesh.maxLife = mesh.life;
        scene.add(mesh);
        particles.push({ mesh, type: 'thruster' });
      }

      // Llegó al destino — sale del mapa sin puntos
      if (e.position.distanceTo(d.flyTarget) < 10) {
        if (d.engineSound) stopAreosaurEngine(d.engineSound);
        removeEnemy(e, ei); continue;
      }

      // Barra de vida siempre mira a la cámara
      e.children[e.children.length - 2]?.lookAt(_camWP);
      e.children[e.children.length - 1]?.lookAt(_camWP);
      continue;
    }

    const dir=new THREE.Vector3().subVectors(coreGroup.position,e.position).normalize();
    e.position.addScaledVector(dir, d.speed*speedMult*delta);
    e.position.y=terrainHeight(e.position.x,e.position.z)+d.type.size+Math.sin(elapsed*3+d.bobOffset)*.15;

    d.mesh.rotation.y+=d.rotSpeed*delta; d.mesh.rotation.x+=d.rotSpeed*.5*delta;
    e.children[2]?.lookAt(_camWP); e.children[3]?.lookAt(_camWP);
  }

  // Label billboards for inactive turrets

  checkBulletEnemyCollisions();
  checkEnemyCoreCollisions();

  // Wave management
  if(waveEnemiesLeft<=0&&enemies.length===0){
    waveCooldown-=delta;
    if(waveCooldown<=0){waveCooldown=WAVE_COOLDOWN_DURATION;spawnWave(wave);wave++;updateHUD();}
  }

  updateLightning(delta);
  updateWaveFlash(delta);
  updateShootingStars(delta);
  updateAeroBombs(delta);

  // Core label billboard — siempre mira a la cámara
  coreLabelMesh.quaternion.copy(camera.quaternion);

  // Core animation
  coreMesh.rotation.y+=.012; coreMesh.rotation.z+=.008;
  glowRing.rotation.z+=.015; glowRing.rotation.x=Math.sin(elapsed)*.3;
  coreLight.intensity=1.5+Math.sin(elapsed*4)*.5;
  coreMat.emissiveIntensity=coreHealth>0?(0.8+Math.sin(elapsed*4)*.3)*(coreHealth/100):0;
  purpleLight.intensity=1.0+Math.sin(elapsed*2)*.5;

  composer.render();
}

window.addEventListener('resize',()=>{
  camera.aspect=window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);
  composer.setSize(window.innerWidth,window.innerHeight);
});

animate();

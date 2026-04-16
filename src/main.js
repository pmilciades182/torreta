import './style.css'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js'
import { OutlinePass }    from 'three/addons/postprocessing/OutlinePass.js'
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js'
import { Howl, Howler } from 'howler';

// ─── Scene ────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0a2e);
scene.fog = new THREE.Fog(0x1a0a2e, 40, 160);
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
enemyOutline.edgeStrength = 4; enemyOutline.edgeThickness = 1.5; enemyOutline.edgeGlow = 0.6;
enemyOutline.visibleEdgeColor.set(0xff3300); enemyOutline.hiddenEdgeColor.set(0x550000);
composer.addPass(enemyOutline);

const turretOutline = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
turretOutline.edgeStrength = 3; turretOutline.edgeThickness = 1.2; turretOutline.edgeGlow = 0.4;
turretOutline.visibleEdgeColor.set(0x00ffcc); turretOutline.hiddenEdgeColor.set(0x004433);
composer.addPass(turretOutline);

const crtPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `
    uniform sampler2D tDiffuse;uniform float time;varying vec2 vUv;
    vec2 barrel(vec2 u){vec2 c=u-.5;return u+c*dot(c,c)*.10;}
    float noise(vec2 u){return fract(sin(dot(u*300.+time*6.1,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec2 uv=barrel(vUv);
      if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.){gl_FragColor=vec4(0,0,0,1);return;}
      float ca=.002;
      vec3 col=vec3(texture2D(tDiffuse,uv+vec2(ca,0.)).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-vec2(ca,0.)).b);
      col*=1.-.13*pow(sin(uv.y*480.*3.14159),2.);
      vec2 v=uv*(1.-uv);col*=pow(v.x*v.y*16.,.30);
      col+=(noise(uv)-.5)*.030;col*=.972+.028*sin(time*22.);
      gl_FragColor=vec4(col,1.);}`,
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

// Disparo del jugador — sin espacialización, volumen normal
function playShootSound() {
  const ctx = Howler.ctx;
  if (!ctx) return;
  const fire = () => {
    const reverb = getReverb(ctx);
    const t      = ctx.currentTime;
    const freqHi = randPitch(320);
    const freqLo = randPitch(38);

    // Bus de mezcla — seco va directo a masterGain (no pasa por duck)
    const { masterGain } = ensureMasterChain(ctx);
    triggerDuck(ctx);
    const dry = ctx.createGain(); dry.connect(masterGain);
    const wet = ctx.createGain(); wet.connect(reverb);
    dry.gain.value = 1; wet.gain.value = 0.7; // −30% reverb

    // Capa 1: sawtooth principal — el cuerpo del disparo
    const osc1 = ctx.createOscillator();
    const g1   = ctx.createGain();
    osc1.type  = 'sawtooth';
    osc1.frequency.setValueAtTime(freqHi, t);
    osc1.frequency.exponentialRampToValueAtTime(freqLo, t + 0.12);
    g1.gain.setValueAtTime(0.18, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc1.connect(g1); g1.connect(dry); g1.connect(wet);
    osc1.start(t); osc1.stop(t + 0.13);

    // Capa 2: square ligeramente desafinado — añade grosor y armónicos pares
    const osc2 = ctx.createOscillator();
    const g2   = ctx.createGain();
    osc2.type  = 'square';
    osc2.frequency.setValueAtTime(freqHi * 0.985, t);
    osc2.frequency.exponentialRampToValueAtTime(freqLo * 0.985, t + 0.10);
    g2.gain.setValueAtTime(0.06, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    osc2.connect(g2); g2.connect(dry);
    osc2.start(t); osc2.stop(t + 0.10);

    // Capa 3: noise burst en el transiente — el "crack" inicial del disparo
    const nLen  = Math.floor(ctx.sampleRate * 0.028);
    const nBuf  = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nData = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nData[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
    const noise = ctx.createBufferSource();
    noise.buffer = nBuf;
    const hpf   = ctx.createBiquadFilter();
    hpf.type    = 'highpass'; hpf.frequency.value = 1800;
    const gNoise = ctx.createGain();
    gNoise.gain.setValueAtTime(0.20, t);
    gNoise.gain.exponentialRampToValueAtTime(0.001, t + 0.028);
    noise.connect(hpf); hpf.connect(gNoise); gNoise.connect(dry);
    noise.start(t);

    // Capa 4: sub-sine brevísimo — punch de baja frecuencia
    const sub  = ctx.createOscillator();
    const gSub = ctx.createGain();
    sub.type   = 'sine';
    sub.frequency.setValueAtTime(randPitch(60), t);
    sub.frequency.exponentialRampToValueAtTime(20, t + 0.06);
    gSub.gain.setValueAtTime(0.28, t);
    gSub.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    sub.connect(gSub); gSub.connect(dry);
    sub.start(t); sub.stop(t + 0.06);
  };
  ctx.state === 'suspended' ? ctx.resume().then(fire) : fire();
}

// Disparo automático — 30% más bajo, audio espacial 3D desde la posición de la torreta
function playAutoShootSound(worldPos) {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  const panner  = makeSpatialPanner(ctx, worldPos);
  const reverb  = getReverb(ctx);
  const freqHi  = randPitch(320);
  const freqLo  = randPitch(38);
  const osc     = ctx.createOscillator();
  const gainDry = ctx.createGain();
  const gainWet = ctx.createGain();
  osc.connect(gainDry); gainDry.connect(panner);
  osc.connect(gainWet); gainWet.connect(reverb);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freqHi, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(freqLo, ctx.currentTime + 0.12);
  gainDry.gain.setValueAtTime(0.154, ctx.currentTime);
  gainDry.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
  gainWet.gain.setValueAtTime(0.029, ctx.currentTime); // −30% reverb
  gainWet.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.13);
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

// ─── Lights ───────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x220044, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(5, 20, 10); dirLight.castShadow = true;
dirLight.shadow.mapSize.width = dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);
const purpleLight = new THREE.PointLight(0x8800ff, 1.5, 30);
purpleLight.position.set(0, 5, 0); scene.add(purpleLight);

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
  new THREE.MeshStandardMaterial({ color: 0x0d0d2b, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

// Grid solo en zona central plana
const gridHelper = new THREE.GridHelper(28, 14, 0x330066, 0x220044);
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

document.addEventListener('mousemove', e => {
  if (!isLocked || !gameStarted || gameOver || shopOpen) return;
  const t = turretData[activeTurretIndex];
  t.base.rotation.y  -= e.movementX * SENSITIVITY;
  t.pitch.rotation.x  = Math.max(PITCH_DOWN, Math.min(PITCH_UP, t.pitch.rotation.x - e.movementY * SENSITIVITY));
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

function spawnHitParticles(pos, color=0xff4400) {
  for (let i=0; i<30; i++) { // Increased particle count
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(.2, .2, .2), // Changed to BoxGeometry and increased size
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:1})
    );
    p.position.copy(pos);
    const sp = 8+Math.random()*12; // Increased initial speed
    p.velocity = new THREE.Vector3((Math.random()-.5)*sp, Math.random()*sp, (Math.random()-.5)*sp);
    p.life=1.0+Math.random()*.5; p.maxLife=p.life; // Increased lifetime
    particles.push({mesh:p,type:'hit'}); scene.add(p);
  }
}

function spawnExplosion(pos) {
  // Expanding ring
  const ring = new THREE.Mesh(
    new THREE.SphereGeometry(.8, 8, 8), // Increased size
    new THREE.MeshBasicMaterial({ color:0xff8800, transparent:true, opacity:.9, wireframe:true })
  );
  ring.position.copy(pos); ring.life=0.8; ring.maxLife=0.8; // Increased lifetime
  particles.push({mesh:ring, type:'explosion'}); scene.add(ring);
  // Debris
  spawnHitParticles(pos, 0xff6600);
  spawnHitParticles(pos, 0xffaa00);
}

// ─── Bullet Hit Effects ───────────────────────────────────────────────────────
function applyBulletHit(bullet, enemy) {
  const btype = BULLET_TYPES[bullet.bdata.type];
  enemy.userData.hp -= bullet.bdata.damage;
  refreshHealthBar(enemy);

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

// ─── Enemies ──────────────────────────────────────────────────────────────────
const ENEMY_BASE_STATS = [
  { speed:3.5, hp:1, size:.5,  score:10, color:0xff2200 }, // Original Type 0 (Red)
  { speed:2.0, hp:3, size:.8,  score:25, color:0xff6600 }, // Original Type 1 (Orange)
  { speed:5.0, hp:1, size:.35, score:20, color:0xcc00ff }, // Original Type 2 (Purple)
  { speed:1.2, hp:6, size:1.1, score:50, color:0xff0077 }, // Original Type 3 (Pink)
  { speed:4.0, hp:1, size:.6,  score:15, color:0x00ff00 }, // New Type 4 (Green)
  { speed:2.5, hp:4, size:.9,  score:30, color:0x0000ff }, // New Type 5 (Blue)
  { speed:3.0, hp:2, size:.7,  score:20, color:0xffff00 }, // New Type 6 (Yellow)
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
    { sizeMult: 1.0, speedMult: 1.0, hpMult: 1.0, rarity: 0.5 }, // Small (50% chance)
    { sizeMult: 2.0, speedMult: 0.8, hpMult: 2.0, rarity: 0.4 }, // Medium (40% chance)
    { sizeMult: 4.0, speedMult: 0.6, hpMult: 4.0, rarity: 0.1 }, // Large (10% chance)
];
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
  const baseType = ENEMY_BASE_STATS[typeIndex % ENEMY_BASE_STATS.length];
  const tier = pickEnemyTier(); // Pick a size tier

  const type = { // Create a new type object with applied multipliers
      speed: baseType.speed * tier.speedMult * (1 - 0.2), // Apply overall 20% slow
      hp: baseType.hp * tier.hpMult,
      size: baseType.size * tier.sizeMult,
      score: baseType.score * tier.hpMult, // Scale score with HP for larger enemies
      color: baseType.color
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
    new THREE.MeshStandardMaterial({color:type.color, emissive:type.color, emissiveIntensity:.4, metalness:.3})
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
    speed: type.speed + wave*.15,
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

function spawnWave(waveNum) {
  const count = 5+waveNum*3;
  const types = Math.min(waveNum, ENEMY_BASE_STATS.length);
  for (let i=0; i<count; i++) {
    const t = Math.floor(Math.random()*types);
    setTimeout(()=>spawnEnemy(t), i*300);
  }
  waveAnnounce.textContent = `OLA ${waveNum}`;
  waveAnnounce.style.opacity='1'; waveAnnounce.style.transform='translate(-50%,-50%) scale(1.2)';
  setTimeout(()=>{ waveAnnounce.style.opacity='0'; waveAnnounce.style.transform='translate(-50%,-50%) scale(1)'; }, 2000);
}

// ─── Collision Detection ──────────────────────────────────────────────────────
function killEnemy(enemy, idx) {
  playExplosionSound(enemy.position.clone());
  spawnHitParticles(enemy.position.clone(), 0xffff00);
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
  gameOver=true; document.exitPointerLock();
  gameOverEl.style.display='flex'; finalScoreEl.textContent=score; finalWaveEl.textContent=wave;
  hud.style.display='none';
}

function restartGame() {
  for (const e of enemies) scene.remove(e); enemies.length=0; enemyOutline.selectedObjects.length=0;
  for (const b of bullets) scene.remove(b); bullets.length=0;
  for (const p of particles) scene.remove(p.mesh); particles.length=0;
  score=0; wave=1; coreHealth=100; gameOver=false; killStreak=0; waveEnemiesLeft=0; waveCooldown=0.5;
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
    p.mesh.material.opacity=r;
    if(p.type==='hit'){
      p.mesh.position.addScaledVector(p.mesh.velocity,delta);
      p.mesh.velocity.y-=12*delta;
    }
    if(p.type==='explosion') p.mesh.scale.setScalar(1+(1-r)*8);
    if(p.mesh.life<=0){scene.remove(p.mesh);particles.splice(i,1);}
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

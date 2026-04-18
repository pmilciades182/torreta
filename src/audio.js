import * as THREE from 'three';
import { Howl, Howler } from 'howler';

let camera;

export function initAudio(cam) {
  camera = cam;
}

export let drumBpm = 85;
export function setDrumBpm(bpm) {
  drumBpm = bpm;
}

// Howler inicializa el AudioContext; lo usamos para síntesis procedural
const _dummyHowl = new Howl({
  src: ['data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='],
  volume: 0,
});

// ── Master chain: duckGain → masterGain → compressor → ctx.destination ────────
let _masterGain = null, _duckGain = null, _compressor = null;

export function ensureMasterChain(ctx) {
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

  if (_reverbNode) { _reverbNode.disconnect(); _reverbNode.connect(_duckGain); }

  return { masterGain: _masterGain, duckGain: _duckGain };
}

export function triggerDuck(ctx) {
  const { duckGain } = ensureMasterChain(ctx);
  const t = ctx.currentTime;
  duckGain.gain.cancelScheduledValues(t);
  duckGain.gain.setValueAtTime(duckGain.gain.value, t);
  duckGain.gain.linearRampToValueAtTime(0.18, t + 0.012);
  duckGain.gain.linearRampToValueAtTime(1.0,  t + 0.20);
}

let _reverbNode = null;
export function getReverb(ctx) {
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

const FS_MINOR = [0, 2, 3, 5, 7, 8, 10];
export function randPitch(base) {
  const midi       = 69 + 12 * Math.log2(base / 440);
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
    : Math.round(midi);
  return 440 * Math.pow(2, (picked - 69) / 12);
}

export function makeSpatialPanner(ctx, worldPos, refDist = 5, rolloff = 1.4) {
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

export function playHitSound(worldPos) {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  const panner = makeSpatialPanner(ctx, worldPos, 6, 1.8);
  const reverb = getReverb(ctx);
  const t      = ctx.currentTime;

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
    gW.gain.value = 0.084;
    osc.connect(g);
    g.connect(panner);
    g.connect(gW); gW.connect(reverb);
    osc.start(t); osc.stop(t + r.d);
  }

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

export function playExplosionSound(worldPos) {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  const panner = makeSpatialPanner(ctx, worldPos, 3, 2.5);
  const reverb = getReverb(ctx);
  const { duckGain } = ensureMasterChain(ctx);
  const t      = ctx.currentTime;
  const V      = 0.6;
  const RV     = 0.7;

  const delay    = ctx.createDelay(1.0);
  delay.delayTime.value = 0.19;
  const dlpf     = ctx.createBiquadFilter();
  dlpf.type      = 'lowpass'; dlpf.frequency.value = 520;
  const dfb      = ctx.createGain(); dfb.gain.value = 0.32;
  const delayOut = ctx.createGain(); delayOut.gain.value = 0.28;
  delay.connect(dlpf); dlpf.connect(dfb); dfb.connect(delay);
  dlpf.connect(delayOut); delayOut.connect(duckGain);

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

  const mid    = ctx.createOscillator();
  const gMid   = ctx.createGain();
  mid.type     = 'sawtooth';
  mid.frequency.setValueAtTime(randPitch(95), t);
  mid.frequency.exponentialRampToValueAtTime(18, t + 0.45);
  gMid.gain.setValueAtTime(1.28 * V, t);
  gMid.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  mid.connect(gMid); gMid.connect(panner); gMid.connect(delay);
  mid.start(t); mid.stop(t + 0.45);

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

  const rLen   = Math.floor(ctx.sampleRate * 0.4);
  const rBuf   = ctx.createBuffer(1, rLen, ctx.sampleRate);
  const rData  = rBuf.getChannelData(0);
  for (let i = 0; i < rLen; i++) rData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rLen, 2.2);
  const rSrc   = ctx.createBufferSource(); rSrc.buffer = rBuf;
  const gR     = ctx.createGain(); gR.gain.value = 0.56 * V * RV;
  rSrc.connect(gR); gR.connect(reverb);
  rSrc.start(t);
}

export function playShootSound() {
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

    const osc2 = ctx.createOscillator();
    const g2   = ctx.createGain();
    osc2.type  = 'square';
    osc2.frequency.setValueAtTime(randPitch(145), t);
    osc2.frequency.exponentialRampToValueAtTime(28, t + 0.20);
    g2.gain.setValueAtTime(0.16, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
    osc2.connect(g2); g2.connect(dry); g2.connect(wet);
    osc2.start(t); osc2.stop(t + 0.20);

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

export function playAutoShootSound(worldPos) {
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

export function playThunderSound() {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  const { masterGain } = ensureMasterChain(ctx);
  const t   = ctx.currentTime;
  const dur = 1.6 + Math.random() * 1.4;
  const V   = 0.45 + Math.random() * 0.30;

  const cLen  = Math.floor(ctx.sampleRate * 0.09);
  const cBuf  = ctx.createBuffer(1, cLen, ctx.sampleRate);
  const cData = cBuf.getChannelData(0);
  for (let i = 0; i < cLen; i++) cData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / cLen, 0.8);
  const cSrc = ctx.createBufferSource(); cSrc.buffer = cBuf;
  const cLpf = ctx.createBiquadFilter(); cLpf.type = 'lowpass'; cLpf.frequency.value = 1800;
  const gC   = ctx.createGain(); gC.gain.value = V * 1.4;
  cSrc.connect(cLpf); cLpf.connect(gC); gC.connect(masterGain);
  cSrc.start(t);

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
let drumPlaying = false;
let drumStep    = 0;
let drumNextAt  = 0;
let _drumTimer  = null;

const DRUM_KICK = [1,0,0,0, 1,0,0,1, 1,0,0,0, 1,0,1,0];
const DRUM_CLAP = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
const DRUM_HHC  = [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1];
const DRUM_HHO  = [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0];
const DRUM_HH_VEL = [0.22,0.10,0.14,0.09, 0.20,0.10,0.14,0.09, 0.22,0.10,0.14,0.09, 0.20,0.10,0.14,0.09];
const SWING = 0.13;

let _drumBus = null;

export function ensureDrumChain(ctx) {
  if (_drumBus) return _drumBus;
  const { duckGain } = ensureMasterChain(ctx);

  const drumComp       = ctx.createDynamicsCompressor();
  drumComp.threshold.value = -22;
  drumComp.knee.value      = 8;
  drumComp.ratio.value     = 3.5;
  drumComp.attack.value    = 0.004;
  drumComp.release.value   = 0.12;
  drumComp.connect(duckGain);

  const rvLen = Math.floor(ctx.sampleRate * 2.4);
  const rvBuf = ctx.createBuffer(2, rvLen, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = rvBuf.getChannelData(ch);
    for (let i = 0; i < rvLen; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rvLen, 2.2);
  }
  const drumReverb = ctx.createConvolver();
  drumReverb.buffer = rvBuf;

  const preDly = ctx.createDelay(0.1);
  preDly.delayTime.value = 0.018;

  const rvLpf    = ctx.createBiquadFilter();
  rvLpf.type     = 'lowpass'; rvLpf.frequency.value = 2800;
  const rvReturn = ctx.createGain(); rvReturn.gain.value = 0.72;
  drumReverb.connect(rvLpf); rvLpf.connect(rvReturn); rvReturn.connect(drumComp);

  _drumBus       = ctx.createGain(); _drumBus.gain.value = 0.084;
  const dryLpf   = ctx.createBiquadFilter();
  dryLpf.type    = 'lowpass'; dryLpf.frequency.value = 7000;
  const rvSend   = ctx.createGain(); rvSend.gain.value = 0.62;

  _drumBus.connect(dryLpf);  dryLpf.connect(drumComp);
  _drumBus.connect(rvSend);  rvSend.connect(preDly); preDly.connect(drumReverb);

  return _drumBus;
}

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

export function drumSchedule() {
  const ctx = Howler.ctx;
  if (!ctx || !drumPlaying) return;
  const step16 = 60 / drumBpm / 4;
  while (drumNextAt < ctx.currentTime + 0.12) {
    const s = drumStep % 16;
    if (DRUM_KICK[s]) drumKick(ctx, drumNextAt);
    if (DRUM_CLAP[s]) drumClap(ctx, drumNextAt);
    if (DRUM_HHC[s])  drumHhc(ctx, drumNextAt, DRUM_HH_VEL[s]);
    if (DRUM_HHO[s])  drumHho(ctx, drumNextAt);
    drumNextAt += (drumStep % 2 === 0)
      ? step16 * (1 + SWING)
      : step16 * (1 - SWING);
    drumStep++;
  }
}

export function startDrum() {
  const ctx = Howler.ctx;
  if (!ctx || drumPlaying) return;
  drumPlaying = true;
  drumStep    = 0;
  drumNextAt  = ctx.currentTime + 0.05;
  _drumTimer  = setInterval(drumSchedule, 40);
}

export function stopDrum() {
  drumPlaying = false;
  if (_drumTimer) { clearInterval(_drumTimer); _drumTimer = null; }
}

export function startAreosaurEngine(x, y, z) {
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

  const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
  osc1.frequency.value = baseFreq;
  const osc2 = ctx.createOscillator(); osc2.type = 'sawtooth';
  osc2.frequency.value = baseFreq * 1.015;
  const osc3 = ctx.createOscillator(); osc3.type = 'square';
  osc3.frequency.value = baseFreq * 2.97;

  const lfo = ctx.createOscillator(); lfo.type = 'sine';
  lfo.frequency.value = 3.5 + Math.random() * 2;
  const lfoG = ctx.createGain(); lfoG.gain.value = 5;
  lfo.connect(lfoG); lfoG.connect(osc1.frequency); lfoG.connect(osc2.frequency);

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

export function stopAreosaurEngine(eng) {
  if (!eng) return;
  try { eng.osc1.stop(); eng.osc2.stop(); eng.osc3.stop(); eng.lfo.stop(); } catch(_) {}
  eng.panner.disconnect();
}

export function updateAreosaurEnginePos(eng, pos) {
  if (!eng?.panner) return;
  eng.panner.setPosition(pos.x, pos.y, pos.z);
}

// Click mecánico al rotar
let _lastClickTime = 0;
export function playRotateClick() {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'suspended') return;
  const now = ctx.currentTime;
  if (now - _lastClickTime < 0.10) return;
  _lastClickTime = now;

  const { masterGain } = ensureMasterChain(ctx);
  const t = now;

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

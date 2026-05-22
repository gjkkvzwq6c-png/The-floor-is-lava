/* ═══════════════════════════════════════════════════════════
   THE FLOOR IS LAVA: RISE OF THE INFERNO
   script.js — Full game engine
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ─── Constants ───────────────────────────────────────────────
const GRAVITY        = 0.55;
const JUMP_FORCE     = -13.5;
const DOUBLE_JUMP_FORCE = -12;
const WALL_JUMP_X    = 8;
const WALL_JUMP_Y    = -12;
const MOVE_SPEED     = 5.5;
const SPEED_BOOST    = 9;
const PLATFORM_H     = 14;
const LAVA_RISE_BASE = 1.1;    // px per frame at level 1 — always threatening
const CANVAS_W       = 480;    // logical width
const FRICTION       = 0.82;
const CRUMBLE_DELAY  = 400;    // ms before crumble starts
const FIREBALL_INTERVAL_BASE = 3500; // ms
const ROCKET_BOOST       = -30;   // upward velocity from rocket pad

// ─── State ───────────────────────────────────────────────────
let canvas, ctx;
let gameState = 'title'; // title | playing | paused | gameover
let score = 0, hiScore = 0, combo = 1, maxCombo = 1;
let level = 1, levelTimer = 0;
let lavaY = 0, lavaRise = LAVA_RISE_BASE;
let lastTime = 0, deltaTime = 0;
let cameraY = 0;           // world Y of top of screen (grows upward)
let screenShake = {x:0, y:0, dur:0};
let dangerMode = false;
let fireballTimer = 0;
let gameTime = 0;
let comboTimer = 0;

// Input state
const keys = {};
const mobile = { left: false, right: false, jump: false, jumpPressed: false };

// Entities
let player, platforms, powerups, gems, fireballs, particles, smokeParticles;

// ─── Audio ───────────────────────────────────────────────────
let audioCtx = null;
let musicNodes = {};
let musicStarted = false;
let alarmOsc = null, alarmGain = null;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

/* ── Epic Rock & Roll — electric guitar (Web Audio API) ───── */
function startMusic() {
  if (musicStarted || !audioCtx) return;
  musicStarted = true;

  // Master gain → compressor → output
  const master = audioCtx.createGain();
  master.gain.value = 0.13;
  const comp = audioCtx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value      = 8;
  comp.ratio.value     = 5;
  comp.attack.value    = 0.003;
  comp.release.value   = 0.2;
  master.connect(comp);
  comp.connect(audioCtx.destination);
  musicNodes.master = master;

  const BPM  = 140;             // driving rock tempo
  const beat = 60 / BPM;
  const bar  = beat * 4;

  // 2-second white-noise buffer shared by all drum voices
  const noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  // Tube-amp soft-clipping (tanh saturation — smoother than hard clip)
  function tanhCurve(gain) {
    const n = 1024, c = new Float32Array(n), th = Math.tanh(gain);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      c[i] = Math.tanh(x * gain) / th;
    }
    return c;
  }

  // Pre-built curves (reuse to save allocations)
  const heavyCurve = tanhCurve(7);   // rhythm guitar — thick saturation
  const leadCurve  = tanhCurve(4.5); // lead guitar  — singing tone

  // ── Drum voices ───────────────────────────────────────────
  function kick(t) {
    // Sub-bass body
    const osc = audioCtx.createOscillator();
    const g   = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.07);
    g.gain.setValueAtTime(1.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + 0.4);
    // Click transient for punch
    const ck = audioCtx.createOscillator();
    const cg = audioCtx.createGain();
    ck.type = 'triangle'; ck.frequency.value = 1100;
    cg.gain.setValueAtTime(0.35, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    ck.connect(cg); cg.connect(master);
    ck.start(t); ck.stop(t + 0.015);
  }

  function snare(t) {
    // Noisy body
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.7;
    const ng = audioCtx.createGain();
    ng.gain.setValueAtTime(0.65, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(bp); bp.connect(ng); ng.connect(master);
    src.start(t); src.stop(t + 0.18);
    // Tight tone snap
    const osc = audioCtx.createOscillator();
    const og  = audioCtx.createGain();
    osc.type = 'triangle'; osc.frequency.value = 250;
    og.gain.setValueAtTime(0.28, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    osc.connect(og); og.connect(master);
    osc.start(t); osc.stop(t + 0.06);
  }

  function hihat(t, open) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 9500;
    const g  = audioCtx.createGain();
    const dc = open ? 0.28 : 0.032;
    g.gain.setValueAtTime(open ? 0.14 : 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dc);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dc + 0.01);
  }

  function crash(t) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 4500;
    const g  = audioCtx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 1.45);
  }

  // ── Bass guitar (overdriven, tight low-pass) ──────────────
  function bass(freq, t, dur) {
    const osc  = audioCtx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = freq;
    const dist = audioCtx.createWaveShaper();
    dist.curve = tanhCurve(3);
    const lp   = audioCtx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 450;
    const g    = audioCtx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.88);
    osc.connect(dist); dist.connect(lp); lp.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur);
  }

  // ── Electric rhythm guitar ────────────────────────────────
  // Power chord (root + perfect 5th) through tube-amp saturation.
  // 3 detuned oscillators per note (±5 cents) create the chorus
  // thickness of a real double-tracked guitar.
  function guitar(rootHz, t, dur, vol) {
    const ws = audioCtx.createWaveShaper();
    ws.curve = heavyCurve; ws.oversample = '4x';
    // Cabinet simulation: bandpass around speaker mid-range
    const cab = audioCtx.createBiquadFilter();
    cab.type = 'bandpass'; cab.frequency.value = 2400; cab.Q.value = 0.5;
    // Presence boost for bite
    const pre = audioCtx.createBiquadFilter();
    pre.type = 'peaking'; pre.frequency.value = 3800;
    pre.gain.value = 5; pre.Q.value = 1.5;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.6, t + 0.015); // pick attack decay
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    ws.connect(cab); cab.connect(pre); pre.connect(g); g.connect(master);
    // Root + perfect 5th, each spread across ±5 cent detuned pair
    [rootHz, rootHz * 1.4983].forEach(freq => {
      [-5, 0, 5].forEach(cents => {
        const osc = audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq * Math.pow(2, cents / 1200);
        osc.connect(ws);
        osc.start(t); osc.stop(t + dur + 0.06);
      });
    });
  }

  // ── Lead guitar (singing single-note with sustain) ────────
  function lead(freq, t, dur, vol) {
    const ws = audioCtx.createWaveShaper();
    ws.curve = leadCurve; ws.oversample = '4x';
    const cab = audioCtx.createBiquadFilter();
    cab.type = 'bandpass'; cab.frequency.value = 3000; cab.Q.value = 0.6;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);    // sharp pick attack
    g.gain.setValueAtTime(vol * 0.72, t + 0.025);      // decay to sustain level
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.92);
    ws.connect(cab); cab.connect(g); g.connect(master);
    // Slight chorus detune on lead too
    [-3, 0, 3].forEach(cents => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq * Math.pow(2, cents / 1200);
      osc.connect(ws);
      osc.start(t); osc.stop(t + dur + 0.04);
    });
  }

  // ── Song data — E minor, cinematic epic rock ──────────────
  // Chord roots (guitar register): Em=82.41, C=130.81, G=98, D=146.83
  const Em = 82.41, C3 = 130.81, G2 = 98.00, D3 = 146.83;
  // Chord loop: Em | C | G | D
  const chords = [Em, C3, G2, D3];

  // Bass roots (one octave below)
  const bassLines = [
    [82.41, 98.00, 110.00, 123.47],  // Em:  E2 G2 A2 B2
    [65.41, 82.41, 98.00,  65.41 ],  // C:   C2 E2 G2 C2
    [49.00, 61.74, 73.42,  98.00 ],  // G:   G1 B1 D2 G2
    [73.42, 92.50, 110.00, 73.42 ],  // D:   D2 F#2 A2 D2
  ];

  // Epic lead melody (8th notes per bar)
  // Note freq constants
  const E4=329.63, D4=293.66, B3=246.94, A3=220.00,
        G3=196.00, G4=392.00, F4=349.23, A4=440.00,
        B4=493.88, D5=587.33, C4=261.63, E3=164.81;
  const melodies = [
    // Em bar — dramatic descending run
    [{f:E4,b:0},{f:E4,b:0.5},{f:G4,b:1},{f:E4,b:1.5},
     {f:D4,b:2},{f:B3,b:2.5},{f:A3,b:3},{f:G3,b:3.5}],
    // C bar — soaring climb
    [{f:C4,b:0},{f:E4,b:0.5},{f:G4,b:1},{f:A4,b:1.5},
     {f:G4,b:2},{f:E4,b:2.5},{f:D4,b:3},{f:E4,b:3.5}],
    // G bar — triumphant arpeggio
    [{f:G3,b:0},{f:B3,b:0.5},{f:D4,b:1},{f:G4,b:1.5},
     {f:D4,b:2},{f:B3,b:2.5},{f:G3,b:3},{f:B3,b:3.5}],
    // D bar — building tension, ends on high E
    [{f:D4,b:0},{f:F4,b:0.5},{f:A4,b:1},{f:D5,b:1.5},
     {f:A4,b:2},{f:F4,b:2.5},{f:E4,b:3},{f:D4,b:3.5}],
  ];

  // ── Scheduler ─────────────────────────────────────────────
  let barStart = audioCtx.currentTime + 0.05;
  let barIdx   = 0;

  function scheduleBar() {
    if (!musicStarted) return;
    const t   = barStart;
    const ci  = barIdx % 4;
    const root = chords[ci];

    // Crash cymbal every 4 bars (top of the loop)
    if (barIdx % 4 === 0) crash(t);

    // ── Drums — driving 140 BPM rock pattern ──
    kick(t);                          // beat 1
    kick(t + beat * 2);               // beat 3
    kick(t + beat * 2.75);            // syncopated pre-4 kick
    snare(t + beat);                  // beat 2
    snare(t + beat * 3);              // beat 4
    for (let i = 0; i < 8; i++) {
      hihat(t + i * beat * 0.5, i === 5); // open hat on "and of 3"
    }

    // ── Bass ──
    bassLines[ci].forEach((hz, i) => bass(hz, t + beat * i, beat * 0.84));

    // ── Rhythm guitar — big chord on 1, chunky chug pattern ──
    guitar(root, t,               beat * 1.7, 0.32); // downstroke beat 1
    guitar(root, t + beat * 0.5,  beat * 0.3, 0.20); // upstroke "and 1"
    guitar(root, t + beat * 2,    beat * 1.5, 0.30); // downstroke beat 3
    guitar(root, t + beat * 3,    beat * 0.9, 0.26); // downstroke beat 4

    // ── Lead melody ──
    melodies[ci].forEach(n =>
      lead(n.f, t + beat * n.b, beat * 0.46, 0.19)
    );

    barStart += bar;
    barIdx++;
    musicNodes.scheduleTimeout = setTimeout(scheduleBar, (bar - 0.08) * 1000);
  }

  scheduleBar();
}

function updateMusicIntensity() {} // intensity handled passively

function stopMusic() {
  if (!musicStarted) return;
  musicStarted = false;
  clearTimeout(musicNodes.scheduleTimeout);
  if (musicNodes.master) {
    try {
      musicNodes.master.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);
      setTimeout(() => { try { musicNodes.master.disconnect(); } catch (e) {} }, 500);
    } catch (e) {}
  }
  musicNodes = {};
}

/* ── Sound effects ──────────────────────────────────────── */
function sfxJump(double_j = false) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'square';
  const t = audioCtx.currentTime;
  osc.frequency.setValueAtTime(double_j ? 660 : 440, t);
  osc.frequency.exponentialRampToValueAtTime(double_j ? 1200 : 880, t + 0.12);
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.15);
}

function sfxWallJump() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sawtooth';
  const t = audioCtx.currentTime;
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.15);
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.15);
}

function sfxCoin() {
  if (!audioCtx) return;
  [0, 0.06].forEach((delay, i) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    const t = audioCtx.currentTime + delay;
    osc.frequency.setValueAtTime(i === 0 ? 880 : 1320, t);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.18);
  });
}

function sfxPowerup() {
  if (!audioCtx) return;
  const freqs = [440, 660, 880, 1100];
  freqs.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    const t = audioCtx.currentTime + i * 0.08;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.12);
  });
}

function sfxGameOver() {
  if (!audioCtx) return;
  const freqs = [440, 330, 220, 110];
  freqs.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sawtooth';
    const t = audioCtx.currentTime + i * 0.18;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.4);
  });
}

function sfxCrumble() {
  if (!audioCtx) return;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.3, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = audioCtx.createBufferSource();
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 400;
  const g = audioCtx.createGain();
  g.gain.value = 0.15;
  src.buffer = buf;
  src.connect(lp); lp.connect(g); g.connect(audioCtx.destination);
  src.start();
}

function sfxRocket() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  // Rising whoosh tone
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(90, t);
  osc.frequency.exponentialRampToValueAtTime(2200, t + 0.45);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.5);
  // Noise blast
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.35, audioCtx.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = audioCtx.createBufferSource();
  const hp  = audioCtx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 800;
  const ng  = audioCtx.createGain();
  ng.gain.setValueAtTime(0.18, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  src.buffer = buf;
  src.connect(hp); hp.connect(ng); ng.connect(audioCtx.destination);
  src.start(t);
}

function sfxFireball() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sawtooth';
  const t = audioCtx.currentTime;
  osc.frequency.setValueAtTime(80, t);
  osc.frequency.exponentialRampToValueAtTime(400, t + 0.05);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.3);
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.3);
}

function sfxMuscles() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  // Deep power thud
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(55, t);
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.3);
  g.gain.setValueAtTime(0.28, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.5);
  // Heroic ascending notes
  [220, 330, 440, 660].forEach((freq, i) => {
    const o = audioCtx.createOscillator();
    const gg = audioCtx.createGain();
    o.type = 'square';
    const tt = t + i * 0.07;
    o.frequency.value = freq;
    gg.gain.setValueAtTime(0.1, tt);
    gg.gain.exponentialRampToValueAtTime(0.001, tt + 0.18);
    o.connect(gg); gg.connect(audioCtx.destination);
    o.start(tt); o.stop(tt + 0.2);
  });
}

function sfxMusclesLost() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  // Deflating descend
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(440, t);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.7);
  g.gain.setValueAtTime(0.2, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.75);
}

function startAlarm() {}
function stopAlarm() {}

// ─── Player ──────────────────────────────────────────────────
function createPlayer() {
  return {
    x: CANVAS_W / 2 - 14,
    y: 0,        // world Y (top = lower number in screen coords)
    w: 28,
    h: 36,
    vx: 0,
    vy: 0,
    onGround: false,
    jumpsLeft: 2,
    touchingWall: 0,  // -1 left, 1 right, 0 none
    hasShield: false,
    shieldTimer: 0,
    hasSpeed: false,
    speedTimer: 0,
    hasMuscles: false,
    trail: [],        // for speed trail effect
    invincible: 0,    // frames of invincibility after hit
  };
}

// ─── Platform factory ────────────────────────────────────────
let pidCounter = 0;
function createPlatform(x, worldY, w, type) {
  return {
    id: pidCounter++,
    x, y: worldY, w,
    h: PLATFORM_H,
    type,                       // 'solid' | 'moving' | 'crumble'
    // moving
    moveDir: Math.random() < .5 ? 1 : -1,
    moveSpeed: 1 + Math.random() * 1.5,
    moveRange: 60 + Math.random() * 80,
    startX: x,
    // crumble
    crumbling: false,
    crumbleTimer: 0,
    opacity: 1,
    active: true,
    // rocket
    hasRocket: false,
    rocketFired: false,
  };
}

// ─── Gem factory ─────────────────────────────────────────────
function createGem(x, worldY) {
  return { x, y: worldY, w: 16, h: 16, collected: false, bobOffset: Math.random() * Math.PI * 2 };
}

// ─── Power-up factory ────────────────────────────────────────
function createPowerup(x, worldY, kind) {
  return { x, y: worldY, w: 22, h: 22, kind, collected: false, bobOffset: Math.random() * Math.PI * 2 };
}

// ─── Fireball factory ────────────────────────────────────────
function createFireball(x, worldY) {
  const angle = -Math.PI / 2 + (Math.random() - .5) * 0.8; // roughly upward
  const spd = 4 + Math.random() * 3 + level * 0.3;
  return {
    x, y: worldY,
    vx: Math.cos(angle) * spd,
    vy: Math.sin(angle) * spd,
    r: 10,
    active: true,
    trail: [],
  };
}

// ─── Particle factory ────────────────────────────────────────
function spawnParticles(x, worldY, count, color, opts = {}) {
  for (let i = 0; i < count; i++) {
    const angle = opts.angle !== undefined ? opts.angle + (Math.random()-.5)*opts.spread : Math.random()*Math.PI*2;
    const spd = (opts.speed || 2) + Math.random() * (opts.speedVar || 2);
    particles.push({
      x, y: worldY,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      life: 1,
      decay: .02 + Math.random() * .03,
      r: (opts.r || 4) + Math.random() * 4,
      color,
      gravity: opts.gravity !== undefined ? opts.gravity : 0.1,
    });
  }
}

function spawnSmoke(x, worldY) {
  smokeParticles.push({
    x: x + (Math.random()-.5)*10,
    y: worldY,
    vx: (Math.random()-.5)*.5,
    vy: -(.3 + Math.random()*.5),
    life: 1,
    decay: .005 + Math.random()*.008,
    r: 12 + Math.random()*18,
    alpha: .18,
  });
}

// ─── Platform generation ─────────────────────────────────────
let highestPlatformY = 0; // world Y (lower = higher on screen)

function generateInitialPlatforms() {
  platforms = [];
  // Starting platform under player
  platforms.push(createPlatform(CANVAS_W/2 - 60, 50, 120, 'solid'));
  highestPlatformY = 50;

  // Generate upward (lower world Y = higher on screen)
  for (let i = 0; i < 14; i++) {
    generateNextPlatform();
  }
}

function generateNextPlatform() {
  const gapY = 70 + Math.random() * 45;  // vertical gap — tight enough to always be reachable
  const newY  = highestPlatformY - gapY;
  const w     = Math.max(60, 140 - level * 6 - Math.random() * 40);
  const x     = Math.random() * (CANVAS_W - w - 20) + 10;

  // Platform type probability by level
  let type = 'solid';
  const r = Math.random();
  if (level >= 2 && r < 0.25) type = 'moving';
  if (level >= 3 && r < 0.15) type = 'crumble';

  const pl = createPlatform(x, newY, w, type);
  // ~18% of non-crumble platforms get a rocket pad
  if (type !== 'crumble' && Math.random() < 0.18) pl.hasRocket = true;
  platforms.push(pl);
  highestPlatformY = newY;

  // Occasionally add a gem or power-up on top
  if (Math.random() < 0.55) {
    gems.push(createGem(x + w/2 - 8, newY - 26));
  }
  if (Math.random() < 0.08) {
    const roll = Math.random();
    const kind = roll < 0.38 ? 'shield' : roll < 0.76 ? 'speed' : 'muscles';
    powerups.push(createPowerup(x + w/2 - 11, newY - 36, kind));
  }
}

// ─── Initialize game ─────────────────────────────────────────
function initGame() {
  score = 0; combo = 1; maxCombo = 1; level = 1; levelTimer = 0; gameTime = 0;
  comboTimer = 0; fireballTimer = 0;
  lavaRise = LAVA_RISE_BASE;
  particles = []; smokeParticles = []; fireballs = []; powerups = []; gems = [];
  dangerMode = false;
  screenShake = {x:0, y:0, dur:0};
  pidCounter = 0;

  generateInitialPlatforms();

  // Start player on first platform
  const sp = platforms[0];
  player = createPlayer();
  player.x = sp.x + sp.w/2 - player.w/2;
  player.y = sp.y - player.h;

  // Camera: place player near the bottom third of the screen
  cameraY = player.y - canvas.height * 0.7;

  // Lava starts right at the bottom of the screen — immediately visible and rising
  lavaY = cameraY + canvas.height - 10;

  updateScoreDisplay();
  updateHUD();
}

// ─── Physics ─────────────────────────────────────────────────
function updatePlayer(dt) {
  const p = player;

  // Speed/shield timers
  if (p.hasSpeed) { p.speedTimer -= dt; if (p.speedTimer <= 0) p.hasSpeed = false; }
  if (p.hasShield) { p.shieldTimer -= dt; if (p.shieldTimer <= 0) p.hasShield = false; }
  if (p.invincible > 0) p.invincible -= dt;

  // Horizontal
  const spd = p.hasSpeed ? SPEED_BOOST : MOVE_SPEED;
  let moveX = 0;
  if (keys['ArrowLeft'] || keys['a'] || keys['A'] || mobile.left) moveX = -1;
  if (keys['ArrowRight'] || keys['d'] || keys['D'] || mobile.right) moveX = 1;
  p.vx += moveX * spd * 0.4;
  p.vx *= FRICTION;

  // Wall detection pre-move
  p.touchingWall = 0;
  if (p.vx < -0.5 && p.x <= 2) { p.touchingWall = -1; p.vx = 0; p.x = 2; }
  if (p.vx >  0.5 && p.x + p.w >= CANVAS_W - 2) { p.touchingWall = 1; p.vx = 0; p.x = CANVAS_W - p.w - 2; }

  // Gravity
  p.vy += GRAVITY;
  if (p.touchingWall !== 0 && p.vy > 0) p.vy *= 0.7; // wall slide

  // Move
  p.x += p.vx;
  p.x = Math.max(0, Math.min(CANVAS_W - p.w, p.x));
  p.y += p.vy;

  // Clamp vx
  p.vx = Math.max(-12, Math.min(12, p.vx));

  // Platform collision
  p.onGround = false;
  platforms.forEach(pl => {
    if (!pl.active) return;
    const prevBottom = (p.y - p.vy) + p.h;
    const curBottom  = p.y + p.h;
    if (
      curBottom >= pl.y &&
      prevBottom <= pl.y + 2 &&
      p.x + p.w > pl.x + 2 &&
      p.x < pl.x + pl.w - 2 &&
      p.vy >= 0
    ) {
      p.y = pl.y - p.h;
      p.vy = 0;
      p.onGround = true;
      p.jumpsLeft = 2;
      p.touchingWall = 0;

      if (pl.type === 'crumble' && !pl.crumbling) {
        pl.crumbling = true;
        pl.crumbleTimer = CRUMBLE_DELAY;
        sfxCrumble();
      }

      // Rocket launch — blasts player upward with a big boost
      if (pl.hasRocket && !pl.rocketFired) {
        pl.rocketFired = true;
        p.vy = ROCKET_BOOST;
        p.onGround = false;
        p.jumpsLeft = 2;
        sfxRocket();
        screenShake.dur = 300;
        // Exhaust blast downward from the rocket pad
        spawnParticles(p.x + p.w/2, p.y + p.h, 28, '#ff6600',
          { angle: Math.PI/2, spread: 0.8, speed: 10, gravity: 0.25, r: 5 });
        spawnParticles(p.x + p.w/2, p.y + p.h, 14, '#ffee00',
          { angle: Math.PI/2, spread: 0.5, speed: 16, gravity: 0.3, r: 3 });
        floatingText(p.x + p.w/2, p.y - 14, 'ROCKET!', '#ffee00');
      }

      // Combo: if lava very close, reward risky jump
      const lavaScreenY = lavaY - cameraY;
      const playerScreenY = p.y - cameraY;
      if (lavaScreenY - playerScreenY < canvas.height * 0.35) {
        combo = Math.min(combo + 1, 10);
        comboTimer = 3000;
        if (combo > maxCombo) maxCombo = combo;
      }
    }
  });

  // Trail for speed boost
  if (p.hasSpeed) {
    p.trail.push({ x: p.x + p.w/2, y: p.y + p.h/2, life: 1 });
    if (p.trail.length > 8) p.trail.shift();
  } else {
    p.trail = [];
  }
  p.trail.forEach(t => t.life -= 0.15);
  p.trail = p.trail.filter(t => t.life > 0);
}

function handleJump() {
  const p = player;
  if (p.onGround) {
    p.vy = JUMP_FORCE;
    p.jumpsLeft = 1;
    sfxJump(false);
    spawnParticles(p.x + p.w/2, p.y + p.h, 6, '#ffaa44', { angle: Math.PI/2, spread: 1, speed: 2, gravity: 0.2, r: 3 });
  } else if (p.touchingWall !== 0) {
    p.vy = WALL_JUMP_Y;
    p.vx = -p.touchingWall * WALL_JUMP_X;
    p.jumpsLeft = 1;
    p.touchingWall = 0;
    sfxWallJump();
    spawnParticles(p.x + p.w/2, p.y + p.h/2, 8, '#ff8844', { angle: Math.PI/2, spread: 0.8, speed: 3, r: 3 });
  } else if (p.jumpsLeft > 0) {
    p.vy = DOUBLE_JUMP_FORCE;
    p.jumpsLeft--;
    sfxJump(true);
    spawnParticles(p.x + p.w/2, p.y + p.h/2, 10, '#ffcc88', { angle: Math.PI/2, spread: 1.2, speed: 3, r: 3 });
  }
}

// ─── Lava & camera ───────────────────────────────────────────
function updateLava(dt) {
  lavaY -= lavaRise * (dt / 16.67); // normalize to 60fps
}

function updateCamera(dt) {
  const risePerFrame = lavaRise * (dt / 16.67);

  // Camera always scrolls upward with the lava — this is the core pressure mechanic.
  // Platforms continuously scroll past; standing still means falling into lava.
  cameraY -= risePerFrame;

  // Also snap toward the player if they jump above the 62% mark on screen
  const targetCamY = player.y - canvas.height * 0.62;
  if (targetCamY < cameraY) {
    cameraY += (targetCamY - cameraY) * 0.1;
  }

  // Screen shake
  if (screenShake.dur > 0) {
    screenShake.dur -= dt;
    const mag = screenShake.dur * 0.03;
    screenShake.x = (Math.random()-.5) * mag;
    screenShake.y = (Math.random()-.5) * mag;
  } else {
    screenShake.x = 0; screenShake.y = 0;
  }
}

// ─── Platforms update ────────────────────────────────────────
function updatePlatforms(dt) {
  platforms.forEach(pl => {
    if (!pl.active) return;
    if (pl.type === 'moving') {
      pl.x += pl.moveDir * pl.moveSpeed;
      if (pl.x < pl.startX - pl.moveRange || pl.x + pl.w > pl.startX + pl.moveRange + pl.w) {
        pl.moveDir *= -1;
      }
    }
    if (pl.crumbling) {
      pl.crumbleTimer -= dt;
      pl.opacity = pl.crumbleTimer / CRUMBLE_DELAY;
      if (pl.crumbleTimer <= 0) {
        pl.active = false;
        spawnParticles(pl.x + pl.w/2, pl.y, 12, '#8b5a2b', { spread: Math.PI, speed: 3, r: 4 });
      }
    }
  });

  // Remove platforms consumed by lava + off-camera below
  platforms = platforms.filter(pl => pl.y < lavaY + 100);

  // Generate more platforms above
  while (highestPlatformY > cameraY - 200) {
    generateNextPlatform();
  }
}

// ─── Gems & Power-ups ────────────────────────────────────────
function updateCollectibles(dt) {
  const t = Date.now() / 1000;

  gems.forEach(g => {
    if (g.collected) return;
    g.y += Math.sin(t * 2 + g.bobOffset) * 0.03; // gentle bob (tiny float)
    const dx = g.x + g.w/2 - (player.x + player.w/2);
    const dy = g.y + g.h/2 - (player.y + player.h/2);
    if (Math.abs(dx) < (g.w + player.w)/2 && Math.abs(dy) < (g.h + player.h)/2) {
      g.collected = true;
      const pts = 50 * combo;
      score += pts;
      sfxCoin();
      spawnParticles(g.x + g.w/2, g.y + g.h/2, 10, '#ff44ff', { spread: Math.PI*2, speed: 3, gravity: 0.05 });
      floatingText(g.x, g.y, `+${pts}`, '#ff88ff');
    }
  });
  gems = gems.filter(g => !g.collected && g.y < lavaY + 50);

  powerups.forEach(pu => {
    if (pu.collected) return;
    const dx = pu.x + pu.w/2 - (player.x + player.w/2);
    const dy = pu.y + pu.h/2 - (player.y + player.h/2);
    if (Math.abs(dx) < (pu.w + player.w)/2 && Math.abs(dy) < (pu.h + player.h)/2) {
      pu.collected = true;
      sfxPowerup();
      if (pu.kind === 'shield') {
        player.hasShield = true;
        player.shieldTimer = 8000;
        document.getElementById('pu-shield').classList.remove('hidden');
        floatingText(pu.x, pu.y, 'SHIELD!', '#00ccff');
        spawnParticles(pu.x + pu.w/2, pu.y + pu.h/2, 14, '#00ccff', { spread: Math.PI*2, speed: 4 });
      } else if (pu.kind === 'speed') {
        player.hasSpeed = true;
        player.speedTimer = 5000;
        document.getElementById('pu-speed').classList.remove('hidden');
        floatingText(pu.x, pu.y, 'SPEED!', '#aaff00');
        spawnParticles(pu.x + pu.w/2, pu.y + pu.h/2, 14, '#aaff00', { spread: Math.PI*2, speed: 4 });
      } else if (pu.kind === 'muscles') {
        player.hasMuscles = true;
        sfxMuscles();
        document.getElementById('pu-muscles').classList.remove('hidden');
        floatingText(pu.x, pu.y, 'SWOLE MODE!', '#ff2244');
        spawnParticles(pu.x + pu.w/2, pu.y + pu.h/2, 22, '#ff2244', { spread: Math.PI*2, speed: 5, r: 5 });
        spawnParticles(pu.x + pu.w/2, pu.y + pu.h/2, 12, '#ffaa00', { spread: Math.PI*2, speed: 3, r: 3 });
      }
    }
  });
  powerups = powerups.filter(pu => !pu.collected && pu.y < lavaY + 50);

  // Update HUD powerup indicators
  if (!player.hasShield)  document.getElementById('pu-shield').classList.add('hidden');
  if (!player.hasSpeed)   document.getElementById('pu-speed').classList.add('hidden');
  if (!player.hasMuscles) document.getElementById('pu-muscles').classList.add('hidden');
}

// ─── Floating text ───────────────────────────────────────────
const floatingTexts = [];
function floatingText(wx, wy, text, color) {
  floatingTexts.push({ x: wx, y: wy, text, color, life: 1, vy: -1.2 });
}

// ─── Fireballs ───────────────────────────────────────────────
function updateFireballs(dt) {
  fireballTimer -= dt;
  if (fireballTimer <= 0) {
    const interval = Math.max(800, FIREBALL_INTERVAL_BASE - level * 200);
    fireballTimer = interval + Math.random() * interval * 0.5;
    // Spawn from lava surface at random X
    const fx = 20 + Math.random() * (CANVAS_W - 40);
    fireballs.push(createFireball(fx, lavaY - 10));
    sfxFireball();
  }

  fireballs.forEach(fb => {
    fb.trail.push({ x: fb.x, y: fb.y, life: 1 });
    if (fb.trail.length > 10) fb.trail.shift();
    fb.trail.forEach(t => t.life -= 0.1);

    fb.vy += GRAVITY * 0.3;
    fb.x += fb.vx;
    fb.y += fb.vy;
  });

  // Check fireball-player collision
  fireballs.forEach(fb => {
    if (!fb.active) return;
    const dx = (fb.x) - (player.x + player.w/2);
    const dy = (fb.y) - (player.y + player.h/2);
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < fb.r + player.w/2 - 4) {
      fb.active = false;
      spawnParticles(fb.x, fb.y, 16, '#ff6600', { spread: Math.PI*2, speed: 5, r: 5 });
      hitPlayer();
    }
  });

  fireballs = fireballs.filter(fb => fb.active && fb.y > cameraY - 100 && fb.y < lavaY + 200);
}

function loseMusclePower() {
  player.hasMuscles = false;
  player.invincible = 2000;
  sfxMusclesLost();
  screenShake.dur = 550;
  spawnParticles(player.x + player.w/2, player.y + player.h/2, 30, '#ff2244', { spread: Math.PI*2, speed: 7, r: 6 });
  spawnParticles(player.x + player.w/2, player.y + player.h/2, 16, '#ffaa00', { spread: Math.PI*2, speed: 4, r: 4 });
  floatingText(player.x + player.w/2, player.y - 24, 'MUSCLES GONE!', '#ff2244');
}

function hitPlayer() {
  if (player.invincible > 0) return;
  if (player.hasMuscles) { loseMusclePower(); return; }
  if (player.hasShield) {
    player.hasShield = false;
    player.invincible = 1500;
    spawnParticles(player.x + player.w/2, player.y + player.h/2, 20, '#00ccff', { spread: Math.PI*2, speed: 5, r: 5 });
    screenShake.dur = 400;
    floatingText(player.x, player.y - 20, 'SHIELD BLOCKED!', '#00ccff');
    return;
  }
  triggerGameOver();
}

// ─── Lava touch detection ────────────────────────────────────
function checkLavaDeath() {
  const fellOffScreen = player.y > cameraY + canvas.height + player.h;
  if (player.y + player.h >= lavaY || fellOffScreen) {
    if (fellOffScreen) { triggerGameOver(); return; }
    if (player.hasMuscles) {
      loseMusclePower();
      player.y = lavaY - player.h - 2;
      player.vy = JUMP_FORCE * 1.3; // muscles bounce you high off lava
    } else if (player.hasShield) {
      hitPlayer();
      player.y = lavaY - player.h - 2;
      player.vy = JUMP_FORCE * 1.1;
    } else {
      triggerGameOver();
    }
  }
}

// ─── Score & levels ──────────────────────────────────────────
function updateScore(dt) {
  // Passive score for surviving
  score += dt * 0.01 * level * combo;

  // Combo decay
  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) combo = 1;
  }

  // Level up every 30 seconds
  levelTimer += dt;
  if (levelTimer >= 30000) {
    levelTimer = 0;
    level++;
    lavaRise = LAVA_RISE_BASE + (level - 1) * 0.15;
    updateMusicIntensity();
    screenShake.dur = 600;
    floatingText(CANVAS_W/2 - 40, player.y - 60, `LEVEL ${level}!`, '#ff8800');
    spawnParticles(CANVAS_W/2, player.y, 20, '#ff8800', { spread: Math.PI*2, speed: 5 });
  }
}

function updateHUD() {
  document.getElementById('score-val').textContent = Math.floor(score);
  document.getElementById('level-val').textContent  = level;
  document.getElementById('hi-val').textContent     = Math.max(hiScore, Math.floor(score));
  document.getElementById('combo-val').textContent  = combo;
  const comboEl = document.getElementById('hud-combo');
  if (combo > 1) comboEl.classList.remove('hidden');
  else comboEl.classList.add('hidden');
}

function updateScoreDisplay() { updateHUD(); }

// ─── Danger detection ────────────────────────────────────────
function updateDanger() {
  // Lava is always at the bottom — danger vignette intensity scales with how close it is
  const lavaScreenY = lavaY - cameraY;
  const nearDanger  = lavaScreenY > canvas.height * 0.5;
  if (nearDanger && !dangerMode) {
    dangerMode = true;
    document.getElementById('danger-warning').classList.remove('hidden');
  } else if (!nearDanger && dangerMode) {
    dangerMode = false;
    document.getElementById('danger-warning').classList.add('hidden');
  }
}

// ─── Smoke ambiance ──────────────────────────────────────────
function updateSmoke(dt) {
  if (Math.random() < 0.2) {
    spawnSmoke(Math.random() * CANVAS_W, lavaY - 10);
  }
  smokeParticles.forEach(s => {
    s.x += s.vx; s.y += s.vy; s.life -= s.decay; s.r += 0.3;
  });
  smokeParticles = smokeParticles.filter(s => s.life > 0);
}

// ─── Particles update ────────────────────────────────────────
function updateParticles(dt) {
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    p.vy += p.gravity;
    p.life -= p.decay;
  });
  particles = particles.filter(p => p.life > 0);

  floatingTexts.forEach(ft => { ft.y += ft.vy; ft.life -= 0.018; });
  floatingTexts.splice(0, floatingTexts.length, ...floatingTexts.filter(ft => ft.life > 0));
}

// ─── Game over ───────────────────────────────────────────────
function triggerGameOver() {
  if (gameState !== 'playing') return;
  gameState = 'gameover';
  sfxGameOver();
  stopAlarm();
  stopMusic();
  screenShake.dur = 800;

  spawnParticles(player.x + player.w/2, player.y + player.h/2, 30, '#ff4400', { spread: Math.PI*2, speed: 6, r: 5 });

  const finalScore = Math.floor(score);
  const newRecord = finalScore > hiScore;
  if (newRecord) hiScore = finalScore;
  localStorage.setItem('lavaHiScore', hiScore);

  setTimeout(() => {
    document.getElementById('go-score').textContent  = finalScore;
    document.getElementById('go-hi').textContent     = hiScore;
    document.getElementById('go-level').textContent  = level;
    document.getElementById('go-combo').textContent  = `x${maxCombo}`;
    if (newRecord) document.getElementById('new-record').classList.remove('hidden');
    else document.getElementById('new-record').classList.add('hidden');
    document.getElementById('gameover-screen').classList.remove('hidden');
  }, 900);
}

// ═══════════════════════════════════════════════════════════════
//   RENDERING
// ═══════════════════════════════════════════════════════════════
function render() {
  const W = canvas.width;
  const H = canvas.height;

  ctx.save();
  ctx.translate(Math.round(screenShake.x), Math.round(screenShake.y));

  // ── Background ──
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#050001');
  bgGrad.addColorStop(1, '#150302');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Cave wall texture (subtle vertical lines)
  ctx.globalAlpha = 0.07;
  for (let x = 0; x < W; x += 40) {
    ctx.strokeStyle = '#331100';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(x) * 8, 0);
    ctx.lineTo(x + Math.sin(x+1) * 8, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // ── Smoke particles ──
  smokeParticles.forEach(s => {
    const sy = s.y - cameraY;
    ctx.globalAlpha = s.life * s.alpha;
    ctx.fillStyle = '#331100';
    ctx.beginPath();
    ctx.arc(s.x, sy, s.r, 0, Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // ── Platforms ──
  platforms.forEach(pl => drawPlatform(pl));

  // ── Gems ──
  gems.forEach(g => {
    if (g.collected) return;
    const sy = g.y - cameraY;
    if (sy < -30 || sy > H + 30) return;
    const t = Date.now() / 600;
    ctx.save();
    ctx.translate(g.x + g.w/2, sy + g.h/2 + Math.sin(t + g.bobOffset) * 4);
    drawGem(ctx, g.w/2);
    ctx.restore();
  });

  // ── Power-ups ──
  powerups.forEach(pu => {
    if (pu.collected) return;
    const sy = pu.y - cameraY;
    if (sy < -40 || sy > H + 40) return;
    const t = Date.now() / 700;
    ctx.save();
    ctx.translate(pu.x + pu.w/2, sy + pu.h/2 + Math.sin(t + pu.bobOffset) * 5);
    drawPowerup(ctx, pu.kind, pu.w/2);
    ctx.restore();
  });

  // ── Fireball trails & fireballs ──
  fireballs.forEach(fb => {
    fb.trail.forEach((tr, i) => {
      const sy = tr.y - cameraY;
      ctx.globalAlpha = tr.life * 0.5;
      ctx.fillStyle = '#ff6600';
      ctx.beginPath();
      ctx.arc(tr.x, sy, fb.r * tr.life * 0.8, 0, Math.PI*2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    const sy = fb.y - cameraY;
    const radGrad = ctx.createRadialGradient(fb.x, sy, 0, fb.x, sy, fb.r);
    radGrad.addColorStop(0, '#ffffff');
    radGrad.addColorStop(0.3, '#ffcc00');
    radGrad.addColorStop(0.7, '#ff4400');
    radGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = radGrad;
    ctx.beginPath();
    ctx.arc(fb.x, sy, fb.r, 0, Math.PI*2);
    ctx.fill();
  });

  // ── Particles ──
  particles.forEach(p => {
    const sy = p.y - cameraY;
    ctx.globalAlpha = p.life * 0.85;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, sy, p.r * p.life, 0, Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // ── Player ──
  drawPlayer();

  // ── Lava ──
  drawLava(W, H);

  // ── Lava glow overlay at bottom ──
  const lavaScreenY = lavaY - cameraY;
  if (lavaScreenY < H + 80) {
    const glowH = Math.min(H, H - lavaScreenY + 60);
    const lavaGlow = ctx.createLinearGradient(0, lavaScreenY - 80, 0, H);
    lavaGlow.addColorStop(0, 'rgba(255,60,0,0)');
    lavaGlow.addColorStop(1, 'rgba(255,60,0,0.22)');
    ctx.fillStyle = lavaGlow;
    ctx.fillRect(0, lavaScreenY - 80, W, glowH + 80);
  }

  // ── Floating texts ──
  floatingTexts.forEach(ft => {
    const sy = ft.y - cameraY;
    ctx.globalAlpha = ft.life;
    ctx.fillStyle = ft.color;
    ctx.font = 'bold 16px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(ft.text, ft.x, sy);
    ctx.globalAlpha = 1;
  });

  // ── Warning vignette when danger ──
  if (dangerMode) {
    const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
    const vign = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.8);
    vign.addColorStop(0, 'rgba(255,0,0,0)');
    vign.addColorStop(1, `rgba(255,0,0,${0.08 + pulse * 0.1})`);
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();
}

function drawPlatform(pl) {
  const sy = pl.y - cameraY;
  if (sy < -40 || sy > canvas.height + 10) return;

  ctx.save();
  ctx.globalAlpha = pl.opacity;

  // Color by type
  let topColor, sideColor, glowColor;
  if (pl.type === 'moving') {
    topColor = '#2a5a18'; sideColor = '#1a3a0a'; glowColor = '#44ff22';
  } else if (pl.type === 'crumble') {
    topColor = '#6a3a10'; sideColor = '#3a1a06'; glowColor = '#ffaa44';
  } else {
    topColor = '#5a3a1a'; sideColor = '#2a1a0a'; glowColor = '#ff8844';
  }

  if (pl.crumbling) {
    // Crack shake effect
    ctx.translate((Math.random()-.5)*3, (Math.random()-.5)*2);
  }

  // Side
  ctx.fillStyle = sideColor;
  ctx.fillRect(pl.x, sy + 4, pl.w, pl.h);

  // Top face
  const topGrad = ctx.createLinearGradient(pl.x, sy, pl.x, sy + pl.h);
  topGrad.addColorStop(0, pl.crumbling ? '#aa5500' : topColor);
  topGrad.addColorStop(1, sideColor);
  ctx.fillStyle = topGrad;
  ctx.fillRect(pl.x, sy, pl.w, pl.h);

  // Edge glow
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = pl.crumbling ? 15 * pl.opacity : 8;
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(pl.x + 0.5, sy + 0.5, pl.w - 1, pl.h - 1);
  ctx.shadowBlur = 0;

  // Stone texture lines
  ctx.globalAlpha = (pl.type === 'crumble' ? 0.5 : 0.2) * pl.opacity;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  for (let bx = pl.x + 12; bx < pl.x + pl.w - 5; bx += 22) {
    ctx.beginPath();
    ctx.moveTo(bx, sy + 2);
    ctx.lineTo(bx, sy + pl.h - 2);
    ctx.stroke();
  }

  ctx.restore();

  // Draw rocket pad on top of platform (after restore so opacity doesn't affect it)
  if (pl.hasRocket) drawRocketPad(pl.x + pl.w / 2, sy, pl.rocketFired);
}

function drawRocketPad(cx, platformSy, fired) {
  const t = Date.now() / 1000;
  ctx.save();
  ctx.translate(cx, platformSy); // origin at centre-top of platform

  if (fired) {
    // Scorch mark left behind
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#220800';
    ctx.beginPath();
    ctx.ellipse(0, -1, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // ── Exhaust flame (animated) ──
  const flicker = 0.7 + Math.sin(t * 18) * 0.3;
  ctx.globalAlpha = 0.85 * flicker;
  const flameGrad = ctx.createRadialGradient(0, 4, 0, 0, 4, 10 * flicker);
  flameGrad.addColorStop(0, '#ffffff');
  flameGrad.addColorStop(0.3, '#ffee00');
  flameGrad.addColorStop(0.7, '#ff5500');
  flameGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = flameGrad;
  ctx.beginPath();
  ctx.ellipse(0, 4, 6 * flicker, 10 * flicker, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;

  // ── Fins (two triangles at base) ──
  ctx.fillStyle = '#cc3300';
  // Left fin
  ctx.beginPath();
  ctx.moveTo(-5, -2);
  ctx.lineTo(-12, 4);
  ctx.lineTo(-5, -10);
  ctx.closePath();
  ctx.fill();
  // Right fin
  ctx.beginPath();
  ctx.moveTo(5, -2);
  ctx.lineTo(12, 4);
  ctx.lineTo(5, -10);
  ctx.closePath();
  ctx.fill();

  // ── Rocket body ──
  const bodyGrad = ctx.createLinearGradient(-5, -28, 5, -28);
  bodyGrad.addColorStop(0, '#ff6633');
  bodyGrad.addColorStop(0.5, '#ffcc44');
  bodyGrad.addColorStop(1, '#ff4400');
  ctx.fillStyle = bodyGrad;
  // Cylinder body
  ctx.beginPath();
  ctx.rect(-5, -26, 10, 22);
  ctx.fill();
  ctx.strokeStyle = '#ff8800';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Nose cone ──
  ctx.fillStyle = '#ffee88';
  ctx.beginPath();
  ctx.moveTo(0, -38);
  ctx.lineTo(-5, -26);
  ctx.lineTo(5, -26);
  ctx.closePath();
  ctx.fill();

  // ── Window ──
  ctx.fillStyle = '#88eeff';
  ctx.shadowColor = '#00ccff';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(0, -19, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // ── Glow halo ──
  ctx.globalAlpha = 0.22 + Math.sin(t * 4) * 0.08;
  ctx.shadowColor = '#ffaa00';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = '#ffaa00';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -18, 10, 22, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.restore();
}

function drawGem(ctx, r) {
  ctx.shadowColor = '#ff44ff';
  ctx.shadowBlur = 15;
  ctx.fillStyle = '#ff44ff';
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.6, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.6, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(-r*0.1, -r*0.6);
  ctx.lineTo(r*0.3, -r*0.1);
  ctx.lineTo(0, r*0.2);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawPowerup(ctx, kind, r) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (kind === 'shield') {
    ctx.shadowColor = '#00ccff'; ctx.shadowBlur = 18;
    ctx.font = `${r * 2}px serif`;
    ctx.fillText('🛡', 0, 0);
  } else if (kind === 'speed') {
    ctx.shadowColor = '#aaff00'; ctx.shadowBlur = 18;
    ctx.font = `${r * 2}px serif`;
    ctx.fillText('⚡', 0, 0);
  } else if (kind === 'muscles') {
    ctx.shadowColor = '#ff2244'; ctx.shadowBlur = 22;
    ctx.font = `${r * 2.2}px serif`;
    ctx.fillText('💪', 0, 0);
  }
  ctx.shadowBlur = 0;
}

function drawPlayer() {
  const p  = player;
  const sy = p.y - cameraY;
  const t  = Date.now() / 1000;

  // Speed trail
  p.trail.forEach(tr => {
    const tsy = tr.y - cameraY;
    ctx.globalAlpha = tr.life * 0.35;
    ctx.fillStyle = '#aaff00';
    ctx.fillRect(tr.x - p.w/2, tsy - p.h/2, p.w, p.h);
  });
  ctx.globalAlpha = 1;

  // Muscles power aura
  if (p.hasMuscles) {
    const pulse = (Math.sin(t * 4) + 1) / 2;
    ctx.save();
    ctx.globalAlpha = 0.3 + pulse * 0.25;
    ctx.shadowColor = '#ff1133';
    ctx.shadowBlur = 28;
    ctx.strokeStyle = '#ff3355';
    ctx.lineWidth = 3 + pulse * 3;
    ctx.beginPath();
    ctx.ellipse(p.x + p.w/2, sy + p.h/2, p.w/2 + 20, p.h/2 + 16, 0, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }

  // Shield aura
  if (p.hasShield) {
    const pulse = (Math.sin(t * 8) + 1) / 2;
    ctx.save();
    ctx.globalAlpha = 0.25 + pulse * 0.2;
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 3 + pulse * 2;
    ctx.shadowColor = '#00ccff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.ellipse(p.x + p.w/2, sy + p.h/2, p.w/2 + 10, p.h/2 + 12, 0, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }

  // Invincibility flash
  if (p.invincible > 0 && Math.floor(t * 12.5) % 2 === 0) {
    ctx.globalAlpha = 0.3;
  }

  // Draw muscle arms behind body so they appear to extend outward
  if (p.hasMuscles) drawMuscleArms(p.x, sy, p.w, p.h, t);

  // Body colour
  const bodyGrad = ctx.createLinearGradient(p.x, sy, p.x + p.w, sy + p.h);
  if (p.hasSpeed) {
    bodyGrad.addColorStop(0, '#aaff00'); bodyGrad.addColorStop(1, '#558800');
  } else if (p.hasMuscles) {
    bodyGrad.addColorStop(0, '#cc1122'); bodyGrad.addColorStop(1, '#770011');
  } else {
    bodyGrad.addColorStop(0, '#ff8844'); bodyGrad.addColorStop(1, '#cc4400');
  }
  ctx.fillStyle = bodyGrad;

  // Rounded body
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, p.x, sy, p.w, p.h, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Visor
  ctx.fillStyle = p.hasMuscles ? '#ff8888' : '#88eeff';
  ctx.globalAlpha = 0.9;
  ctx.save();
  roundRect(ctx, p.x + p.w * 0.15, sy + p.h * 0.12, p.w * 0.7, p.h * 0.28, 4);
  ctx.fill();
  ctx.restore();

  // Jetpack glow when moving up
  if (p.vy < -2) {
    ctx.globalAlpha = 0.6;
    const color = p.hasMuscles ? '#ff2244' : '#ff8800';
    const jGrad = ctx.createRadialGradient(p.x + p.w/2, sy + p.h, 0, p.x + p.w/2, sy + p.h, 14);
    jGrad.addColorStop(0, '#ffffff');
    jGrad.addColorStop(0.4, color);
    jGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = jGrad;
    ctx.beginPath();
    ctx.arc(p.x + p.w/2, sy + p.h, 14, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function drawMuscleArms(px, psy, pw, ph, t) {
  const flex = Math.sin(t * 5) * 0.12; // subtle flex animation
  ctx.save();

  // ── Left arm ──
  // Upper arm
  ctx.fillStyle = '#bb1020';
  ctx.beginPath();
  ctx.ellipse(px - 9, psy + ph * 0.38 + flex * 4, 8, 13, -0.25 + flex, 0, Math.PI * 2);
  ctx.fill();
  // Bicep peak
  ctx.fillStyle = '#ee1133';
  ctx.beginPath();
  ctx.arc(px - 14, psy + ph * 0.27 + flex * 6, 7, 0, Math.PI * 2);
  ctx.fill();
  // Forearm
  ctx.fillStyle = '#991010';
  ctx.beginPath();
  ctx.ellipse(px - 7, psy + ph * 0.62, 5, 9, 0.18, 0, Math.PI * 2);
  ctx.fill();

  // ── Right arm ──
  ctx.fillStyle = '#bb1020';
  ctx.beginPath();
  ctx.ellipse(px + pw + 9, psy + ph * 0.38 + flex * 4, 8, 13, 0.25 - flex, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ee1133';
  ctx.beginPath();
  ctx.arc(px + pw + 14, psy + ph * 0.27 + flex * 6, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#991010';
  ctx.beginPath();
  ctx.ellipse(px + pw + 7, psy + ph * 0.62, 5, 9, -0.18, 0, Math.PI * 2);
  ctx.fill();

  // ── Vein details ──
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#ff6677';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(px - 15, psy + ph * 0.22);
  ctx.quadraticCurveTo(px - 18, psy + ph * 0.4, px - 13, psy + ph * 0.58);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px + pw + 15, psy + ph * 0.22);
  ctx.quadraticCurveTo(px + pw + 18, psy + ph * 0.4, px + pw + 13, psy + ph * 0.58);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawLava(W, H) {
  const sy = lavaY - cameraY;
  if (sy > H + 10) return;

  const t = Date.now() / 1000;

  // Lava surface wave
  ctx.save();
  ctx.fillStyle = '#cc2200';

  // Draw from surface to bottom of screen with wavy top
  ctx.beginPath();
  ctx.moveTo(0, sy);
  for (let x = 0; x <= W; x += 8) {
    const wave = Math.sin(x * 0.04 + t * 2) * 5 + Math.sin(x * 0.08 - t * 1.5) * 3;
    ctx.lineTo(x, sy + wave);
  }
  ctx.lineTo(W, H + 10);
  ctx.lineTo(0, H + 10);
  ctx.closePath();

  // Lava gradient
  const lavaGrad = ctx.createLinearGradient(0, sy, 0, H + 10);
  lavaGrad.addColorStop(0, '#ff4500');
  lavaGrad.addColorStop(0.1, '#dd2200');
  lavaGrad.addColorStop(0.5, '#990000');
  lavaGrad.addColorStop(1, '#330000');
  ctx.fillStyle = lavaGrad;
  ctx.fill();

  // Bright surface line
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = '#ff8800';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ff8800';
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.moveTo(0, sy);
  for (let x = 0; x <= W; x += 8) {
    const wave = Math.sin(x * 0.04 + t * 2) * 5 + Math.sin(x * 0.08 - t * 1.5) * 3;
    ctx.lineTo(x, sy + wave);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Hot spots / lava bubbles
  for (let i = 0; i < 5; i++) {
    const bx = ((i * 97 + t * 30) % (W - 20)) + 10;
    const by = sy + 8 + Math.sin(t * 1.5 + i) * 4;
    const bubbleR = 4 + Math.sin(t * 2 + i * 1.3) * 2;
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ffaa00';
    ctx.beginPath();
    ctx.arc(bx, by, bubbleR, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// ─── Title screen embers ─────────────────────────────────────
function spawnTitleEmber() {
  const el = document.createElement('div');
  el.className = 'ember';
  const size = 3 + Math.random() * 6;
  el.style.cssText = `
    width:${size}px; height:${size}px;
    left:${Math.random() * 100}%;
    bottom:0;
    animation-duration:${3 + Math.random() * 5}s;
    animation-delay:${Math.random() * 2}s;
  `;
  document.getElementById('ember-container').appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

// ─── Screen management ───────────────────────────────────────
function showScreen(name) {
  document.getElementById('title-screen').classList.add('hidden');
  document.getElementById('howto-screen').classList.add('hidden');
  document.getElementById('game-canvas').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('pause-overlay').classList.add('hidden');
  document.getElementById('mobile-controls').classList.add('hidden');
  document.getElementById('btn-pause').classList.add('hidden');
  document.getElementById('danger-warning').classList.add('hidden');

  if (name === 'title') {
    document.getElementById('title-screen').classList.remove('hidden');
    const hs = localStorage.getItem('lavaHiScore') || 0;
    document.getElementById('title-hs').textContent = hs;
    hiScore = parseInt(hs) || 0;
  } else if (name === 'howto') {
    document.getElementById('howto-screen').classList.remove('hidden');
  } else if (name === 'game') {
    document.getElementById('game-canvas').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');
    if (isMobile()) {
      document.getElementById('mobile-controls').classList.remove('hidden');
      document.getElementById('btn-pause').classList.remove('hidden');
    }
  }
}

function isMobile() {
  return ('ontouchstart' in window) || (window.innerWidth < 700);
}

// ─── Game loop ───────────────────────────────────────────────
function gameLoop(timestamp) {
  if (gameState !== 'playing') return;

  deltaTime = Math.min(timestamp - lastTime, 50); // cap at 50ms
  lastTime = timestamp;
  gameTime += deltaTime;

  // Update
  updatePlayer(deltaTime);
  updatePlatforms(deltaTime);
  updateLava(deltaTime);
  updateCamera(deltaTime);
  updateCollectibles(deltaTime);
  updateFireballs(deltaTime);
  updateParticles(deltaTime);
  updateSmoke(deltaTime);
  updateScore(deltaTime);
  updateDanger();
  checkLavaDeath();
  updateHUD();

  // Render
  render();

  requestAnimationFrame(gameLoop);
}

function startGame() {
  resizeCanvas();
  initGame();
  showScreen('game');
  gameState = 'playing';
  lastTime = performance.now();
  initAudio();
  resumeAudio();
  startMusic();
  requestAnimationFrame(gameLoop);
}

function restartGame() {
  stopMusic();
  stopAlarm();
  gameState = 'playing';
  initGame();
  showScreen('game');
  lastTime = performance.now();
  initAudio();
  resumeAudio();
  startMusic();
  requestAnimationFrame(gameLoop);
}

// ─── Canvas resize ───────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

// ─── Input ───────────────────────────────────────────────────
let jumpPressedThisFrame = false;

function onKeyDown(e) {
  keys[e.key] = true;
  if (['Space','ArrowUp','w','W'].includes(e.code) ||
      e.key === 'ArrowUp' || e.key === ' ' || e.key === 'w' || e.key === 'W') {
    if (gameState === 'playing') handleJump();
    e.preventDefault();
  }
  if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && gameState === 'playing') togglePause();
  if ((e.key === 'Escape') && gameState === 'paused') togglePause();
}
function onKeyUp(e) {
  keys[e.key] = false;
}

function togglePause() {
  if (gameState === 'playing') {
    gameState = 'paused';
    document.getElementById('pause-overlay').classList.remove('hidden');
    stopAlarm();
  } else if (gameState === 'paused') {
    gameState = 'playing';
    document.getElementById('pause-overlay').classList.add('hidden');
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
    resumeAudio();
  }
}

// Mobile button listeners
function setupMobileControls() {
  const btnLeft  = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnJump  = document.getElementById('btn-jump');

  function hold(flag, val) {
    return {
      start: (e) => { e.preventDefault(); mobile[flag] = val; },
      end:   (e) => { e.preventDefault(); mobile[flag] = false; },
    };
  }

  const leftH  = hold('left', true);
  const rightH = hold('right', true);

  btnLeft.addEventListener('touchstart', leftH.start, { passive: false });
  btnLeft.addEventListener('touchend',   leftH.end,   { passive: false });
  btnRight.addEventListener('touchstart', rightH.start, { passive: false });
  btnRight.addEventListener('touchend',   rightH.end,   { passive: false });

  btnJump.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (gameState === 'playing') handleJump();
  }, { passive: false });
}

// ─── Boot ────────────────────────────────────────────────────
window.addEventListener('load', () => {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');

  window.addEventListener('resize', () => {
    if (gameState === 'playing' || gameState === 'paused') resizeCanvas();
  });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Title ember animation
  setInterval(spawnTitleEmber, 300);

  // Button wiring
  document.getElementById('btn-start').addEventListener('click', () => {
    initAudio();
    resumeAudio();
    startGame();
  });
  document.getElementById('btn-howto').addEventListener('click', () => showScreen('howto'));
  document.getElementById('btn-back').addEventListener('click', () => showScreen('title'));
  document.getElementById('btn-restart').addEventListener('click', () => {
    document.getElementById('gameover-screen').classList.add('hidden');
    restartGame();
  });
  document.getElementById('btn-menu').addEventListener('click', () => {
    stopMusic(); stopAlarm();
    gameState = 'title';
    showScreen('title');
  });
  document.getElementById('btn-resume').addEventListener('click', togglePause);
  document.getElementById('btn-quit').addEventListener('click', () => {
    stopMusic(); stopAlarm();
    gameState = 'title';
    document.getElementById('pause-overlay').classList.add('hidden');
    showScreen('title');
  });
  document.getElementById('btn-pause').addEventListener('click', togglePause);

  setupMobileControls();
  showScreen('title');
});

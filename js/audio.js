import { state } from './store.js';
import { getLang, t } from './i18n.js';

// Sound effects are synthesised. Spoken lines are pre-recorded German clips
// (ElevenLabs voice "Timon") in audio/de/, played through Web Audio so
// they start instantly on iOS once the first tap has unlocked audio.
let ctx = null;

export const CLIP_KEYS = [
  'calibSay', 'calibRetry', 'statueSay', 'noFace', 'pursuitSay', 'saccadeSay', 'spotterSay',
  'noPeek', 'great1', 'great2', 'great3', 'great4', 'great5', 'breakSay', 'n1', 'n2', 'n3', 'n4', 'n5',
  'breakDone', 'roundDone', 'dailyDone', 'newSticker', 'setupGood',
  'basketSay', 'score1', 'score2', 'three', 'lookHoop', 'comeCloser', 'recenterSay',
  'pendelSay', 'combo', 'golden', 'mega',
];
const buffers = {};
let clipsLoading = null;

function loadClips() {
  if (clipsLoading || !ctx) return clipsLoading;
  clipsLoading = Promise.all(CLIP_KEYS.map(async (k) => {
    try {
      const res = await fetch(`audio/de/${k}.mp3`);
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      buffers[k] = await new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail));
    } catch { /* fall back to system speech for this line */ }
  }));
  return clipsLoading;
}

// Create the audio context and start decoding the voice clips right at page
// load (it starts "suspended" and is resumed on the first tap), so the
// recorded voice is ready before the first sentence is needed.
export const clipReady = (k) => !!buffers[k];

export function preloadAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  loadClips();
}

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  loadClips();
}

function out(pan = 0, vol = 1) {
  const g = ctx.createGain();
  g.gain.value = vol;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(ctx.destination);
  } else g.connect(ctx.destination);
  return g;
}

function tone(freq, start, dur, { type = 'sine', vol = 0.18, pan = 0, slide = 0 } = {}) {
  const o = ctx.createOscillator();
  const g = out(pan);
  o.type = type;
  const t0 = ctx.currentTime + start;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

export const sfx = {
  appear(pan = 0) { if (ok()) tone(660, 0, 0.18, { type: 'triangle', pan, slide: 1.5, vol: 0.12 }); },
  pop(pan = 0) { if (ok()) { tone(880, 0, 0.12, { pan, slide: 1.8 }); tone(1320, 0.06, 0.16, { pan, vol: 0.1 }); } },
  chime() { if (ok()) [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.08, 0.3, { type: 'triangle', vol: 0.12 })); },
  soft() { if (ok()) tone(392, 0, 0.25, { type: 'sine', vol: 0.08 }); },
  miss(pan = 0) { if (ok()) tone(330, 0, 0.3, { type: 'sine', pan, slide: 0.6, vol: 0.1 }); },
  tick() { if (ok()) tone(1200, 0, 0.05, { type: 'square', vol: 0.03 }); },
  hum(pan = 0) { if (ok()) tone(520, 0, 0.09, { type: 'sine', pan, vol: 0.04 }); },
  // basketball
  bounce(pan = 0) { if (ok()) { tone(140, 0, 0.12, { type: 'sine', pan, slide: 0.55, vol: 0.32 }); noise(0, 0.05, { pan, vol: 0.08, freq: 900, q: 1.2 }); } },
  swish(pan = 0) { if (ok()) noise(0, 0.45, { pan, vol: 0.22, freq: 3200, q: 0.8, sweep: 0.4 }); },
  rim(pan = 0) { if (ok()) { tone(980, 0, 0.25, { type: 'triangle', pan, vol: 0.08 }); tone(1470, 0.01, 0.2, { type: 'sine', pan, vol: 0.05 }); } },
  cheer() { if (ok()) { noise(0, 1.6, { vol: 0.16, freq: 1400, q: 0.5, swell: true }); [523, 659, 784].forEach((f, i) => tone(f, 0.05 + i * 0.07, 0.35, { type: 'triangle', vol: 0.08 })); } },
  whoosh(pan = 0) { if (ok()) noise(0, 0.35, { pan, vol: 0.07, freq: 600, q: 0.7, sweep: 3 }); },
};

let noiseBuf = null;
function noise(start, dur, { pan = 0, vol = 0.1, freq = 1000, q = 1, sweep = 0, swell = false } = {}) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = q;
  const t0 = ctx.currentTime + start;
  f.frequency.setValueAtTime(freq, t0);
  if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t0 + dur);
  const g = out(pan);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + (swell ? dur * 0.35 : 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g);
  src.start(t0, Math.random());
  src.stop(t0 + dur + 0.05);
}

function ok() { return ctx && state.settings.sound; }

// ---- Speech queue -------------------------------------------------------
// Lines never cut each other off by accident. Each call picks a mode:
//   'queue'     wait until the current line has finished (default)
//   'interrupt' stop whatever is playing and say this now
//   'ifIdle'    say it only if nothing is playing (praise, reminders)
// speak() returns a promise that resolves when the line has finished.
let current = null;          // { stop(), done: Promise }
const queue = [];
let lastKey = '';
let lastAt = 0;

export function isSpeaking() { return !!current || queue.length > 0; }

export function speak(key, { force = false, mode = 'queue' } = {}) {
  if (!state.settings.voice) return wait(clipSeconds(key) * 1000);
  const now = performance.now();
  if (!force && key === lastKey && now - lastAt < 6000) return Promise.resolve();
  if (mode === 'ifIdle' && isSpeaking()) return Promise.resolve();
  lastKey = key; lastAt = now;
  if (mode === 'interrupt') stopSpeech();
  return new Promise((resolve) => {
    queue.push({ key, resolve });
    if (!current) next();
  });
}

function next() {
  const item = queue.shift();
  if (!item) { current = null; return; }
  const me = play(item.key);
  current = me;
  me.done.then(() => {
    item.resolve();
    if (current === me) { current = null; next(); } // an interrupt may have replaced us
  });
}

function clipSeconds(key) { return buffers[key]?.duration ?? 1.2; }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function play(key) {
  // A recorded clip that is still loading: wait for it (max 4 s) rather than
  // falling back to the device's own voice.
  if (getLang() === 'de' && !buffers[key] && CLIP_KEYS.includes(key) && clipsLoading) {
    let finish, inner = null, stopped = false;
    const done = new Promise((r) => { finish = r; });
    Promise.race([clipsLoading, wait(4000)]).then(() => {
      if (stopped) return finish();
      inner = playNow(key);
      inner.done.then(finish);
    });
    return { stop() { stopped = true; inner?.stop(); finish(); }, done };
  }
  return playNow(key);
}

function playNow(key) {
  if (getLang() === 'de' && ctx && buffers[key]) {
    const src = ctx.createBufferSource();
    src.buffer = buffers[key];
    src.connect(out(0, 1));
    let finish;
    const done = new Promise((r) => { finish = r; });
    src.onended = () => finish();
    // safety net in case onended never fires (e.g. audio context suspended)
    const timer = setTimeout(finish, buffers[key].duration * 1000 + 800);
    done.then(() => clearTimeout(timer));
    src.start();
    return { stop() { try { src.stop(); } catch { /* already stopped */ } finish(); }, done };
  }
  return sayText(t(key === 'newSticker' ? 'newStickerSay' : key));
}

function sayText(text) {
  let finish;
  const done = new Promise((r) => { finish = r; });
  if (!text || !('speechSynthesis' in window)) { setTimeout(finish, 300); return { stop: finish, done }; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = getLang() === 'de' ? 'de-AT' : 'en-US';
  const voices = speechSynthesis.getVoices();
  const v = voices.find((x) => x.lang === u.lang) || voices.find((x) => x.lang.startsWith(getLang()));
  if (v) u.voice = v;
  u.rate = 0.95; u.pitch = 1.1;
  u.onend = finish; u.onerror = finish;
  setTimeout(finish, 1500 + text.length * 90);
  speechSynthesis.speak(u);
  return { stop() { speechSynthesis.cancel(); finish(); }, done };
}

export function stopSpeech() {
  queue.splice(0).forEach((q) => q.resolve());
  if (current) { const c = current; current = null; c.stop(); }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

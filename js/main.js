import { Tracker } from './tracker.js';
import { GAMES, drawOwl } from './games.js';
import * as art from './art.js';
import { loadArt, sprite, glow, twinkle } from './art.js';
import { BasketballGame } from './basketball.js';
import { PendelGame } from './pendel.js';
GAMES.basket = BasketballGame;
GAMES.pendel = PendelGame;
import { DEVICES, detectDevice, longSideCm, cmPerCssPx } from './devices.js';
import { state, save, addSession, minutesToday, resetProgress, STICKERS, STICKER_FILTERS, STARS_PER_STICKER, stickersOwned, todayKey, clamp } from './store.js';
import { setLang, t, applyI18n } from './i18n.js';
import { unlockAudio, preloadAudio, sfx, speak, stopSpeech } from './audio.js';

const $ = (s) => document.querySelector(s);
const screens = ['home', 'setup', 'play', 'done', 'parent'];
function show(name) {
  screens.forEach((s) => { $('#' + s).hidden = s !== name; });
  document.body.dataset.screen = name;
}

setLang(state.settings.lang);
applyI18n();

// ---------- canvas + environment ----------
const canvas = $('#stage');
const ctx = canvas.getContext('2d');
const video = $('#cam');
const tracker = new Tracker(video);

// Demo mode (?demo): the mouse/finger stands in for the eyes, no camera needed.
// Handy for trying the games yourself and for testing.
let lastCalibAt = -Infinity;
// A round may only start with a working calibration from the last 10 minutes.
const calibFresh = () => !!tracker.calib && performance.now() - lastCalibAt < 10 * 60 * 1000;
const DEMO = new URLSearchParams(location.search).has('demo');
if (DEMO) {
  const mouse = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => { mouse.x = (e.clientX - env.cx) / env.hw; mouse.y = (e.clientY - env.cy) / env.hh; });
  Object.defineProperty(tracker, 'ready', { get: () => true });
  tracker.stream = true;
  tracker.update = (now) => (tracker.frame = { face: true, t: now, headOk: true, headDev: 0, dist: 45, blink: !!window.__closed, blinkScore: window.__closed ? 1 : 0, gaze: { ...mouse }, feat: { irisH: mouse.x, irisV: mouse.y, bsH: 0, bsV: 0 } });
  tracker.nudgeTowards = () => {};
  // hold C to simulate closed eyes (eye break)
  window.addEventListener('keydown', (e) => { if (e.key === 'c') window.__closed = true; });
  window.addEventListener('keyup', (e) => { if (e.key === 'c') window.__closed = false; });
  tracker.calibrate = () => ({ ok: true });
  tracker.calib = { demo: true };
  lastCalibAt = performance.now();
}

// Test mode (?test): the real head-stillness and re-centre logic runs, but on
// a simulated head (window.__pose) instead of the camera. For checking only.
const TEST = new URLSearchParams(location.search).has('test');
if (TEST) {
  window.__pose = { yaw: 0, pitch: 0, tx: 0, ty: 0, gx: 0, gy: 0, face: true };
  Object.defineProperty(tracker, 'ready', { get: () => true });
  tracker.stream = true;
  tracker.calibrate = function (points) { this.setBaseline(points.flatMap((p) => p.samples)); this.calibPose = { ...this.baseline }; this.calib = { wx: [0, 1, 0], wy: [0, 1, 0] }; this.offset = { x: 0, y: 0 }; return { ok: true }; };
  tracker.update = function (now) {
    const p = window.__pose;
    if (!p.face) { this.frame = { face: false, t: now }; this._updateHead(now, false); return this.frame; }
    // the simulated eye reading shifts with head yaw, like the real one does
    const gaze = { x: p.gx + p.yaw * 0.03 + this.offset.x, y: p.gy + p.pitch * 0.03 + this.offset.y };
    this.smooth = gaze;
    this.frame = { face: true, t: now, yaw: p.yaw, pitch: p.pitch, tx: p.tx, ty: p.ty, tz: -35, dist: 35, blink: false, blinkScore: 0, feat: { irisH: 0, irisV: 0, bsH: 0, bsV: 0 }, gaze };
    this._updateHead(now, true);
    return this.frame;
  };
}

const env = {
  W: 0, H: 0, cx: 0, cy: 0, hw: 0, hh: 0, now: 0, safeBottom: 0, tracker,
  addStar, toast, praise,
};

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  env.W = window.innerWidth; env.H = window.innerHeight;
  canvas.width = env.W * dpr; canvas.height = env.H * dpr;
  canvas.style.width = env.W + 'px'; canvas.style.height = env.H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  env.safeBottom = safeInset('bottom');
  env.safeTop = safeInset('top');
  env.safeLeft = safeInset('left');
  const margin = Math.max(36, Math.min(env.W, env.H) * 0.07);
  env.cx = env.W / 2; env.cy = env.H / 2;
  env.hw = env.W / 2 - margin; env.hh = env.H / 2 - margin;
  // Physical size of one CSS pixel: from the parent's screen-width setting if
  // given, otherwise ~0.019 cm (iPhone, iPad and Mac are all close to this).
  const cmPerPx = cmPerCssPx(state.settings.device, state.settings.screenCm);
  tracker.screenHalfCm = { x: env.hw * cmPerPx, y: env.hh * cmPerPx };
  buildBackground();
}
function safeInset(side) {
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;visibility:hidden;padding-${side}:env(safe-area-inset-${side},0px)`;
  document.body.appendChild(d);
  const v = parseFloat(getComputedStyle(d)[`padding${side[0].toUpperCase()}${side.slice(1)}`]) || 0;
  d.remove();
  return v;
}
let bg = null;
let bgName = 'meadow';
function setBackground(name) { if (name !== bgName) { bgName = name; buildBackground(); } }
function buildBackground() {
  bg = document.createElement('canvas');
  bg.width = env.W; bg.height = env.H;
  const b = bg.getContext('2d');
  b.fillStyle = '#0b1633'; b.fillRect(0, 0, env.W, env.H);
  const image = bgName === 'arena' ? art.arena : art.background;
  if (image) {
    // cover-fit, anchored to the bottom so the ground always shows
    const s = Math.max(env.W / image.naturalWidth, env.H / image.naturalHeight);
    const w = image.naturalWidth * s, h = image.naturalHeight * s;
    b.drawImage(image, (env.W - w) / 2, env.H - h, w, h);
  }
  // soft vignette keeps the eye drawn to the play area
  const v = b.createRadialGradient(env.cx, env.cy, Math.min(env.W, env.H) * 0.3, env.cx, env.cy, Math.hypot(env.W, env.H) * 0.62);
  v.addColorStop(0, 'rgba(5,10,30,0)'); v.addColorStop(1, 'rgba(5,10,30,0.55)');
  b.fillStyle = v; b.fillRect(0, 0, env.W, env.H);
}
window.addEventListener('resize', resize);
resize();

// ---------- HUD helpers ----------
let sessionStars = 0;
let newStickers = [];
function addStar() {
  sessionStars++;
  state.progress.stars++;
  const owned = stickersOwned();
  if (owned > stickersOwned(state.progress.stars - 1)) newStickers.push(STICKERS[owned - 1]);
  $('#hud-stars-n').textContent = sessionStars;
  $('#hud-stars').classList.remove('bump'); void $('#hud-stars').offsetWidth; $('#hud-stars').classList.add('bump');
}
function praise() {
  const i = 1 + Math.floor(Math.random() * 5);
  toast(t('great' + i));
  speak('great' + i, { force: true, mode: 'ifIdle' });
}
let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text; el.hidden = false;
  el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1100);
}

// ---------- scene machine ----------
let scene = null;           // { kind: 'calib' | 'game' | 'break', ... }
let selectedGame = 'saccade';
let paused = false;
let calibThen = null;   // what to do after a calibration started from the pause menu
let wakeLock = null;

async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
}

// ---------- home ----------
function stickerImg(st, cls = '') {
  return `<img class="${cls}" src="img/${st.k}.png" alt="" style="filter:${STICKER_FILTERS[st.v]}">`;
}
function renderHome() {
  const s = state.progress;
  const owned = stickersOwned();
  $('#sticker-row').innerHTML = STICKERS.map((st, i) => (i < owned
    ? `<span class="sticker got">${stickerImg(st)}</span>`
    : `<span class="sticker" aria-hidden="true"></span>`)).join('');
  const toNext = STARS_PER_STICKER - (s.stars % STARS_PER_STICKER);
  $('#stars-total-n').textContent = s.stars;
  $('#stars-next').textContent = owned >= STICKERS.length ? '' : t('starsToNext', toNext);
  $('#stars-meter').style.setProperty('--p', owned >= STICKERS.length ? 1 : (s.stars % STARS_PER_STICKER) / STARS_PER_STICKER);
  const limitReached = minutesToday() >= state.settings.dailyMin;
  $('#daily-note').hidden = !limitReached;
  $('#daily-note').textContent = t('dailyDone');
  const on = state.settings.games;
  const cards = [...document.querySelectorAll('.game-card')];
  cards.forEach((b) => { b.disabled = limitReached; b.hidden = !on[b.dataset.game]; });
  document.querySelector('.cards').classList.toggle('single', cards.filter((b) => !b.hidden).length === 1);
  show('home');
}

document.querySelectorAll('.game-card').forEach((btn) => {
  btn.addEventListener('click', () => {
    unlockAudio();
    selectedGame = btn.dataset.game;
    if (tracker.ready && tracker.stream && calibFresh()) startRound();
    else openSetup();
  });
});

// Parent button: press and hold so a child does not wander in by accident.
(() => {
  const btn = $('#parent-btn');
  let timer = 0;
  const start = (e) => { e.preventDefault(); btn.classList.add('holding'); timer = setTimeout(() => { btn.classList.remove('holding'); openParent(); }, 1200); };
  const stop = () => { clearTimeout(timer); btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openParent(); });
})();

// ---------- setup ----------
let setupLoop = false;
let setupSaidGood = false;
let setupStarting = false;
async function openSetup() {
  if (setupLoop || setupStarting) return show('setup');
  setupStarting = true;
  try { await openSetupInner(); } finally { setupStarting = false; }
}
async function openSetupInner() {
  setupSaidGood = false;
  show('setup');
  $('#setup-start').disabled = true;
  $('#setup-status').textContent = t('setupLoading');
  $('#setup-status').className = 'status';
  try {
    if (!tracker.stream) await tracker.startCamera();
  } catch (err) {
    $('#setup-status').textContent = err && err.name === 'NotAllowedError' ? t('camDenied') : `${t('camError')} (${err?.name || err})`;
    $('#setup-status').className = 'status bad';
    return;
  }
  if (tracker.stream instanceof MediaStream) $('#preview').srcObject = tracker.stream;
  $('#preview').play().catch(() => {});
  if (!tracker.ready) {
    $('#setup-status').textContent = t('setupModel');
    try { await tracker.loadModel(); } catch (err) {
      $('#setup-status').textContent = `${t('camError')} (${err?.message || err})`;
      $('#setup-status').className = 'status bad';
      return;
    }
  }
  setupLoop = true;
  requestAnimationFrame(setupTick);
}

function setupTick(now) {
  if (!setupLoop) return;
  const f = tracker.update(now);
  const st = $('#setup-status');
  let good = false;
  if (!f.face) { st.textContent = t('setupNoFace'); st.className = 'status warn'; }
  else if (f.dist < 20) { st.textContent = t('setupTooClose'); st.className = 'status warn'; }
  else if (f.dist > 45) { st.textContent = t('setupTooFar'); st.className = 'status warn'; speak('comeCloser', { mode: 'ifIdle' }); }
  else { st.textContent = t('setupGood'); st.className = 'status good'; good = true; if (!setupSaidGood) { setupSaidGood = true; speak('setupGood'); } }
  $('#setup-start').disabled = !good;
  const rot = $('#rotate-hint');
  rot.hidden = !(env.H > env.W && state.settings.focus !== 'v');
  requestAnimationFrame(setupTick);
}

$('#setup-start').addEventListener('click', () => {
  unlockAudio();
  setupLoop = false;
  tryFullscreen();
  startCalibration();
});
$('#setup-back').addEventListener('click', () => { setupLoop = false; renderHome(); });

function tryFullscreen() {
  const el = document.documentElement;
  try { (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el).catch?.(() => {}); } catch { /* iPhone Safari has no fullscreen API */ }
}

// ---------- calibration ----------
const CAL_POINTS = [[0, 0], [-0.8, 0], [0.8, 0], [0, -0.8], [0, 0.8], [-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]];
function startCalibration(retry = false) {
  setBackground('meadow');
  tracker.baseline = null;
  scene = { kind: 'calib', idx: 0, t: 0, points: CAL_POINTS.map(([x, y]) => ({ x, y, samples: [] })), retry };
  show('play');
  $('#hud').hidden = true;
  speak(retry ? 'calibRetry' : 'calibSay', { force: true, mode: 'interrupt' });
  keepAwake();
}

function updateCalib(dt, f) {
  const s = scene;
  const p = s.points[s.idx];
  s.t += dt;
  if (s.t > 0.8 && s.t < 1.7 && f.face && !f.blink) p.samples.push(f);
  if (s.t >= 1.7) {
    if (s.idx === 0 && p.samples.length) tracker.setBaseline(p.samples);
    if (p.samples.length < 4 && s.t < 3.5) return; // wait for usable frames
    sfx.pop(p.x);
    s.idx++; s.t = 0;
    if (s.idx >= s.points.length) {
      const res = tracker.calibrate(s.points);
      // Retry once if the fit is poor; always retry if there was no usable
      // data at all (otherwise the games would run without any gaze).
      if ((!res.ok && !s.retry) || !tracker.calib) { startCalibration(true); return; }
      lastCalibAt = performance.now();
      state.calibration = { ...tracker.calib, at: Date.now() };
      save();
      if (calibThen) { const k = calibThen; calibThen = null; k(); } else startRound();
    }
  }
}

function drawCalib(c) {
  const s = scene;
  const p = s.points[s.idx];
  if (!p) return;
  const P = { x: env.cx + p.x * env.hw, y: env.cy + p.y * env.hh };
  const grow = Math.min(1, s.t * 4);
  const r = Math.min(env.W, env.H) * 0.045 * grow * (s.t > 0.8 ? 1 - (s.t - 0.8) * 0.35 : 1);
  glow(c, P.x, P.y, r * 4, '255,210,90', grow);
  for (let i = 0; i < 4; i++) {
    const a = env.now / 450 + (i * Math.PI) / 2;
    twinkle(c, P.x + Math.cos(a) * r * 1.9, P.y + Math.sin(a) * r * 1.9, r * 0.18, '#fff3c0', grow * 0.8, a);
  }
  sprite(c, 'star', P.x, P.y, r * 2.6, { rot: Math.sin(env.now / 300) * 0.1 });
  // progress dots
  c.fillStyle = 'rgba(255,255,255,0.5)';
  s.points.forEach((_, i) => {
    c.globalAlpha = i < s.idx ? 0.9 : 0.25;
    c.beginPath(); c.arc(env.cx - (s.points.length - 1) * 9 + i * 18, env.H - 30 - env.safeBottom, 4, 0, Math.PI * 2); c.fill();
  });
  c.globalAlpha = 1;
}

// ---------- rounds ----------
let game = null;
let roundT = 0;
let roundLen = 60;
let roundStart = 0;
function startRound() {
  if (minutesToday() >= state.settings.dailyMin) { renderHome(); return; }
  tracker.headTolDeg = { strict: 5, normal: 8, relaxed: 12 }[state.settings.headTol] || 8;
  tracker.headComp = state.settings.headComp !== false;
  tracker.resetSessionStats();
  sessionStars = 0; newStickers = [];
  $('#hud-stars-n').textContent = '0';
  setBackground(['basket', 'saccade', 'pendel'].includes(selectedGame) ? 'arena' : 'meadow');
  game = new GAMES[selectedGame](env);
  roundT = 0; roundLen = +state.settings.roundSec || 60; roundStart = Date.now();
  scene = { kind: 'game' };
  show('play');
  $('#hud').hidden = false;
  paused = false;
  $('#pause-menu').hidden = true;
  $('#break-ui').hidden = true;
  keepAwake();
  // Show how the game works first (basketball), then adopt where he sits now.
  showIntro(selectedGame, () => beginRecenter('start'));
}

// ---------- how-to screen ----------
const INTROS = {
  pendel: {
    title: 'pendelIntroTitle',
    steps: [
      { pic: '<span class="glow"></span><img class="bounce" src="img/ball.png" alt=""><span class="eye">👀</span>', h: 'pendelStep1', txt: 'pendelStep1Txt' },
      { pic: '<span class="pendel-pic"><i class="rope"></i><i class="rim"></i></span>', h: 'pendelStep2', txt: 'pendelStep2Txt' },
      { pic: '<span class="glow"></span><img src="img/star.png" alt="">', h: 'pendelStep3', txt: 'pendelStep3Txt' },
    ],
  },
  basket: {
    title: 'basketIntroTitle',
    steps: [
      { pic: '<span class="glow"></span><img class="bounce" src="img/ball.png" alt=""><span class="eye">👀</span>', h: 'basketStep1', txt: 'basketStep1Txt' },
      { pic: '<span class="glow"></span><img src="img/hoop.png" alt="">', h: 'basketStep2', txt: 'basketStep2Txt' },
      { pic: '<img src="img/player.png" alt="">', h: 'basketStep3', txt: 'basketStep3Txt' },
    ],
  },
};
function showIntro(gameId, then) {
  const intro = INTROS[gameId];
  if (!intro) { then(); return; }
  scene = { kind: 'intro' };
  $('#hud').hidden = true;
  $('#intro-title').textContent = t(intro.title);
  $('#intro-steps').innerHTML = intro.steps.map((st, i) => `<li><span class="num">${i + 1}</span><span class="pic">${st.pic}</span><b>${t(st.h)}</b><span class="txt">${t(st.txt)}</span></li>`).join('');
  $('#intro').hidden = false;
  game.introDone = true; // the intro speaks the instructions, the game need not repeat them
  speak(gameId + 'Say', { force: true, mode: 'interrupt' });
  $('#intro-go').onclick = () => {
    unlockAudio();
    $('#intro').hidden = true;
    $('#hud').hidden = false;
    stopSpeech();
    then();
  };
}

// ---------- re-centre: adopt a new head position, re-aim the gaze ----------
// Used at the start of every round and whenever the head has come to rest
// somewhere new during play, so a moved head never locks the game.
function beginRecenter(after) {
  const g = game;
  if (DEMO) { scene = { kind: 'game' }; if (after === 'start' && !g?.introDone) setTimeout(() => { if (game === g) g.start(); }, 300); return; }
  const s = { kind: 'recenter', after, t: 0, samples: [], ready: after === 'start' };
  scene = s;
  $('#statue').hidden = true;
  if (after === 'start' && game?.introDone) s.quietStart = true;
  if (after !== 'start') {
    // mid-game: tell him why we pause, then measure once the line is done
    speak('recenterSay', { force: true, mode: 'interrupt' }).then(() => { s.ready = true; s.t = 0; });
    setTimeout(() => { if (!s.ready) { s.ready = true; s.t = 0; } }, 4500);
  }
}
function updateRecenter(dt, f) {
  const s = scene;
  s.t += dt;
  if (!s.ready) return;
  if (s.t > 0.4 && f.face && !f.blink) s.samples.push(f);
  if (s.t >= 1.5 && s.samples.length >= 8) {
    // straight after a calibration the gaze model is fresh: only adopt the head
    tracker.recenter(s.samples, { gaze: s.after !== 'start' || performance.now() - lastCalibAt > 15000 });
    if (tracker.poseChangeSinceCalibration() > 18) { startCalibration(true); return; }
    scene = { kind: 'game' };
    if (s.after === 'start' && !s.quietStart) { const g = game; setTimeout(() => { if (game === g) g.start(); }, 200); }
  }
}
function drawRecenter(c) {
  drawOwl(c, env, { glow: 1 });
  c.save();
  c.font = `800 ${Math.round(Math.min(env.W, env.H) * 0.05)}px "Baloo 2", ui-rounded, system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#fff3c4'; c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 12;
  c.fillText(t('lookAtOllie'), env.cx, env.cy + Math.min(env.W, env.H) * 0.17);
  c.restore();
}

function finishRound() {
  game.finish?.();
  const sum = game.summary();
  const rec = {
    date: new Date().toISOString(),
    game: selectedGame,
    seconds: Math.round(roundT),
    trials: sum.trials, hits: sum.hits,
    accuracy: +sum.accuracy.toFixed(2),
    rt: sum.rt, peeks: sum.peeks,
    headMoves: tracker.headMoveCount,
    dist: tracker.medianDistance() ? Math.round(tracker.medianDistance()) : null,
    reach: { ...state.progress.reach },
    pursuitSpeed: state.progress.pursuitSpeed,
    spotterMs: state.progress.spotterMs,
    screen: `${env.W}x${env.H}`,
  };
  addSession(rec);
  save();
  startBreak();
}

// ---------- eye break: close eyes, the voice counts to five ----------
// The intro sentence plays to the end first. Then each number is spoken only
// after the previous one has finished AND the eyes have been closed for about
// another second, so counting pauses while the eyes are open.
function startBreak() {
  scene = { kind: 'break', stage: 'intro', closedSince: 0, count: 0, busy: false, t: 0 };
  $('#hud').hidden = true;
  $('#break-ui').hidden = false;
  $('#break-moon').style.setProperty('--fill', 0);
  const s = scene;
  speak('breakSay', { force: true, mode: 'interrupt' }).then(() => { if (scene === s) s.stage = 'count'; });
}
function updateBreak(dt, f) {
  const s = scene;
  s.t += dt;
  if (s.stage === 'count' && !s.busy) {
    const closed = f.face && f.blinkScore > 0.45;
    s.closedSince = closed ? s.closedSince + dt : Math.max(0, s.closedSince - dt * 0.5);
    if (s.closedSince >= 0.5) {
      s.count++; s.closedSince = 0; s.busy = true;
      $('#break-moon').style.setProperty('--fill', s.count / 5);
      speak('n' + s.count, { force: true }).then(() => {
        if (scene !== s) return;
        s.busy = false;
        if (s.count >= 5) endBreak();
      });
    }
  }
  if (s.t > 45) endBreak();
}
function endBreak() {
  if (scene?.kind !== 'break') return;
  scene = { kind: 'idle' };
  $('#break-ui').hidden = true;
  sfx.chime();
  const go = () => { if (scene?.kind === 'idle') showDone(); };
  speak('breakDone', { force: true }).then(go);
  setTimeout(go, 4000);
}
$('#break-skip').addEventListener('click', () => { stopSpeech(); endBreak(); });

function showDone() {
  scene = null;
  $('#done-stars-n').textContent = sessionStars;
  $('#done-sticker').hidden = !newStickers.length;
  $('#done-sticker').innerHTML = newStickers.length ? `<span>${t('newSticker')}</span><span class="new-stickers">${newStickers.map((st) => stickerImg(st, 'pop')).join('')}</span>` : '';
  const limit = minutesToday() >= state.settings.dailyMin;
  $('#done-limit').hidden = !limit;
  $('#done-limit').textContent = t('dailyDone');
  $('#done-again').hidden = limit;
  show('done');
  speak(limit ? 'dailyDone' : 'roundDone', { force: true });
  if (newStickers.length) speak('newSticker', { force: true });
  try { wakeLock?.release(); } catch { /* ignore */ }
}
$('#done-again').addEventListener('click', () => { unlockAudio(); if (calibFresh()) startRound(); else startCalibration(); });
$('#done-home').addEventListener('click', renderHome);

// ---------- pause ----------
$('#pause-btn').addEventListener('click', () => { paused = true; $('#pause-menu').hidden = false; stopSpeech(); });
$('#resume-btn').addEventListener('click', () => { paused = false; $('#pause-menu').hidden = true; });
$('#recal-btn').addEventListener('click', () => {
  $('#pause-menu').hidden = true; paused = false;
  if (DEMO) return;
  const g = game;
  startCalibration();
  calibThen = () => { scene = { kind: 'game' }; $('#hud').hidden = false; game = g; };
});
$('#quit-btn').addEventListener('click', () => {
  $('#pause-menu').hidden = true; paused = false;
  $('#intro').hidden = true;
  if ((scene?.kind === 'game' || scene?.kind === 'recenter') && roundT > 10) finishRound();
  else { scene = null; renderHome(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (scene?.kind === 'game' || scene?.kind === 'recenter')) { paused = true; $('#pause-menu').hidden = false; stopSpeech(); }
});

// ---------- input ----------
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (scene?.kind === 'game' && !paused) game.onPointer(e.clientX, e.clientY);
});
window.addEventListener('keydown', (e) => {
  if (scene?.kind === 'game' && !paused) {
    if (e.key.startsWith('Arrow')) e.preventDefault();
    game.onKey(e.key);
  }
  if (e.key === 'Escape' && scene?.kind === 'game') $('#pause-btn').click();
});

// ---------- main loop ----------
let last = performance.now();
let noFaceFor = 0;
let farFor = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  env.now = now;
  if (!scene || document.body.dataset.screen !== 'play' && scene.kind !== 'break') return;
  const f = tracker.update(now);

  // Head must stay still and the face must be visible; otherwise freeze.
  noFaceFor = f.face ? 0 : noFaceFor + dt;
  const lostFace = noFaceFor > 0.5;
  const moved = f.face && f.headOk === false && (scene.kind === 'calib' || scene.kind === 'game');

  // Head came to rest at a new place: adopt it instead of waiting forever.
  if (tracker.settled) {
    tracker.settled = false;
    if (scene.kind === 'game' && !paused) { beginRecenter('resume'); return; }
    if (scene.kind === 'calib') { startCalibration(true); return; }
  }
  const statue = $('#statue');
  const frozen = paused || lostFace || moved;
  if ((lostFace || moved) && !paused && (scene.kind === 'calib' || scene.kind === 'game' || scene.kind === 'recenter')) {
    statue.hidden = false;
    $('#statue-text').textContent = lostFace ? t('noFace') : t('statue');
    if (moved) speak('statueSay', { mode: 'ifIdle' });
    else speak('noFace', { mode: 'ifIdle' });
  } else statue.hidden = true;

  // Sitting too far back makes the eye movements small: remind gently.
  farFor = f.face && f.dist > 50 && scene.kind === 'game' ? farFor + dt : 0;
  if (farFor > 3) { farFor = -12; speak('comeCloser', { mode: 'ifIdle', force: true }); toast(t('setupTooFar')); }

  if (!frozen) {
    if (scene.kind === 'calib') updateCalib(dt, f);
    else if (scene.kind === 'game') {
      roundT += dt;
      game.update(dt, f);
      $('#hud-time').style.setProperty('--p', Math.min(1, roundT / roundLen));
      if (roundT >= roundLen) { finishRound(); }
    } else if (scene.kind === 'break') updateBreak(dt, f);
    else if (scene.kind === 'recenter') updateRecenter(dt, f);
  } else if (scene.kind === 'calib' && moved) {
    // restart the current calibration point after a head movement
    scene.t = 0; scene.points[scene.idx].samples = [];
  }

  // draw
  ctx.drawImage(bg, 0, 0, env.W, env.H);
  if (!scene) return;
  if (scene.kind === 'calib') drawCalib(ctx);
  else if (scene.kind === 'game') game.draw(ctx);
  else if (scene.kind === 'recenter') drawRecenter(ctx);
  else if (scene.kind === 'break' || scene.kind === 'idle') drawOwl(ctx, env, { glow: 0.3, alpha: 0.6 });
  if (state.settings.debugGaze && f.gaze) {
    const gx = env.cx + f.gaze.x * env.hw, gy = env.cy + f.gaze.y * env.hh;
    ctx.strokeStyle = 'rgba(255,120,160,0.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(gx, gy, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px ui-monospace,monospace'; ctx.textAlign = 'left';
    ctx.fillText(`head ${f.headDev?.toFixed(1)}°  dist ${f.dist?.toFixed(0)}cm`, 12 + env.safeLeft, env.H - 14 - env.safeBottom);
  }
}
if (DEMO || TEST) window.__ff = { get game() { return game; }, get scene() { return scene; }, tracker, env };
requestAnimationFrame(loop);

// ---------- parent area ----------
function openParent() {
  renderParent();
  show('parent');
}
$('#parent-back').addEventListener('click', () => { setLang(state.settings.lang); applyI18n(); renderHome(); });
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  $('#tab-progress').hidden = b.dataset.tab !== 'progress';
  $('#tab-settings').hidden = b.dataset.tab !== 'settings';
}));

function degrees(reachFrac, axis) {
  const last = [...state.sessions].reverse().find((s) => s.dist);
  const dist = last?.dist || 45;
  const cmPerPx = cmPerCssPx(state.settings.device, state.settings.screenCm);
  const half = axis === 'h' ? env.hw : env.hh;
  return Math.atan((reachFrac * half * cmPerPx) / dist) * 180 / Math.PI;
}

function renderParent() {
  const r = state.progress.reach;
  const cell = (dir, axis) => {
    const d = degrees(r[dir], axis);
    return `<div class="reach-cell reach-${dir}"><span class="lbl">${t(dir)}</span><span class="val">${Math.round(r[dir] * 100)}%</span>${d ? `<span class="deg">≈ ${d.toFixed(0)}°</span>` : ''}</div>`;
  };
  $('#reach-grid').innerHTML = `
    ${cell('up', 'v')}${cell('left', 'h')}
    <svg class="reach-svg" viewBox="-100 -100 200 200" aria-hidden="true">
      <circle r="96" fill="none" stroke="var(--line)" stroke-dasharray="3 5"/>
      <circle r="48" fill="none" stroke="var(--line)" stroke-dasharray="3 5"/>
      <polygon points="${-r.left * 96},0 0,${-r.up * 96} ${r.right * 96},0 0,${r.down * 96}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
      <text x="0" y="5" text-anchor="middle" font-size="18">🦉</text>
    </svg>
    ${cell('right', 'h')}${cell('down', 'v')}`;
  $('#speed-line').textContent = `Tempo Verfolgung ${state.progress.pursuitSpeed.toFixed(2)} rad/s · Basketball ${(state.progress.basketSpeed ?? 1).toFixed(2)} · Späher-Anzeige ${state.progress.spotterMs} ms`;

  const names = { pursuit: t('gamePursuit'), saccade: t('gameSaccade'), spotter: t('gameSpotter'), basket: t('gameBasket'), pendel: t('gamePendel') };
  const rows = [...state.sessions].reverse().slice(0, 40);
  $('#sessions-body').innerHTML = rows.length ? rows.map((s) => {
    const d = new Date(s.date);
    return `<tr><td>${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td>${names[s.game] || s.game}</td><td>${(s.seconds / 60).toFixed(1)}</td><td>${s.hits}/${s.trials}</td><td>${Math.round(s.accuracy * 100)}%</td><td>${s.rt ? s.rt + ' ms' : '–'}</td><td>${s.headMoves}</td><td>${Math.round(s.reach.left * 100)}/${Math.round(s.reach.right * 100)}/${Math.round(s.reach.up * 100)}/${Math.round(s.reach.down * 100)}</td></tr>`;
  }).join('') : `<tr><td colspan="8" class="empty">${t('noSessions')}</td></tr>`;
  $('#today-min').textContent = `${t('today')}: ${minutesToday().toFixed(1)} / ${state.settings.dailyMin} min`;
  drawTrend();
  renderSettings();
}

function drawTrend() {
  const svg = $('#trend');
  const pts = state.sessions.slice(-30);
  if (pts.length < 2) { svg.innerHTML = ''; svg.hidden = true; return; }
  svg.hidden = false;
  const W = 300, H = 80;
  const series = { h: (s) => (s.reach.left + s.reach.right) / 2, v: (s) => (s.reach.up + s.reach.down) / 2 };
  const path = (fn) => pts.map((s, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * W},${H - fn(s) * H}`).join(' ');
  svg.innerHTML = `
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)" stroke-dasharray="2 4"/>
    <path d="${path(series.h)}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    <path d="${path(series.v)}" fill="none" stroke="var(--accent-2)" stroke-width="2.5"/>`;
}

function renderDeviceSelect() {
  const det = detectDevice();
  const groups = ['iPhone', 'iPad', 'MacBook'];
  $('#s-device').innerHTML = `<option value="auto">${t('sDeviceAuto')} (${det ? det.name : t('sDeviceUnknown')})</option>`
    + groups.map((g) => `<optgroup label="${g}">${DEVICES.filter((d) => d.group === g).map((d) => `<option value="${d.id}">${d.name} · ${longSideCm(d).toFixed(1)} cm</option>`).join('')}</optgroup>`).join('')
    + `<option value="custom">${t('sDeviceCustom')}</option>`;
}

function renderSettings() {
  const s = state.settings;
  const form = $('#settings-form');
  renderDeviceSelect();
  $('#s-screen-wrap').hidden = s.device !== 'custom';
  form.querySelectorAll('[name]').forEach((el) => {
    const v = s[el.name];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  });
  document.querySelectorAll('#game-vis [data-game]').forEach((el) => { el.checked = !!s.games[el.dataset.game]; });
  ['left', 'right', 'up', 'down'].forEach((d) => {
    $('#reach-' + d).value = Math.round(state.progress.reach[d] * 100);
    $('#reach-' + d + '-out').textContent = Math.round(state.progress.reach[d] * 100) + '%';
  });
}

$('#settings-form').addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.game) {
    const g = state.settings.games;
    g[el.dataset.game] = el.checked;
    if (!Object.values(g).some(Boolean)) { g[el.dataset.game] = true; el.checked = true; }
  } else if (el.name) {
    state.settings[el.name] = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.tagName === 'SELECT' && /^\d+$/.test(el.value) ? (el.value === '' ? '' : +el.value) : el.value);
    if (el.name === 'lang') { setLang(el.value); applyI18n(); renderParent(); }
    if (el.name === 'headComp') tracker.headComp = el.checked;
    if (el.name === 'screenCm' || el.name === 'device') resize();
    if (el.name === 'device') $('#s-screen-wrap').hidden = el.value !== 'custom';
  } else if (el.id?.startsWith('reach-')) {
    const d = el.id.split('-')[1];
    state.progress.reach[d] = clamp(+el.value / 100, 0.15, 0.95);
    $('#reach-' + d + '-out').textContent = el.value + '%';
  }
  save();
});
$('#settings-form').addEventListener('submit', (e) => e.preventDefault());

$('#export-btn').addEventListener('click', () => {
  const head = ['date', 'game', 'seconds', 'trials', 'hits', 'accuracy', 'reaction_ms', 'peeks', 'head_moves', 'distance_cm', 'reach_left', 'reach_right', 'reach_up', 'reach_down', 'pursuit_speed', 'spotter_ms', 'screen_px'];
  const lines = state.sessions.map((s) => [s.date, s.game, s.seconds, s.trials, s.hits, s.accuracy, s.rt ?? '', s.peeks ?? '', s.headMoves, s.dist ?? '', s.reach.left, s.reach.right, s.reach.up, s.reach.down, s.pursuitSpeed, s.spotterMs, s.screen].join(','));
  const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `firefly-eyes-${todayKey()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

let resetArmed = 0;
$('#reset-btn').addEventListener('click', (e) => {
  if (Date.now() - resetArmed < 4000) { resetProgress(); resetArmed = 0; e.target.textContent = t('resetAll'); renderParent(); return; }
  resetArmed = Date.now();
  e.target.textContent = t('resetConfirm');
  setTimeout(() => { e.target.textContent = t('resetAll'); }, 4000);
});

// ---------- boot ----------
preloadAudio();
renderHome();
loadArt().then(() => { buildBackground(); document.body.classList.add('art-ready'); });
if ('speechSynthesis' in window) speechSynthesis.getVoices();

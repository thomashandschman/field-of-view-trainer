// The three training games. Each game works in normalised screen space:
// (0,0) is the centre, x/y = ±1 is the edge of the play area.
import { state, nudgeReach, clamp } from './store.js';
import { sfx, speak } from './audio.js';
import { t } from './i18n.js';
import { sprite, glow, twinkle, ring, easeOutBack, Sparks, CRITTERS } from './art.js';

const TOL = { strict: 0.8, normal: 1, relaxed: 1.3 };
const rand = (a, b) => a + Math.random() * (b - a);

function directions() {
  const f = state.settings.focus;
  if (f === 'h') return ['left', 'right'];
  if (f === 'v') return ['up', 'down'];
  return ['left', 'right', 'up', 'down'];
}

function vecFor(dir, extra = 0) {
  const r = state.progress.reach;
  const j = rand(-0.12, 0.12);
  switch (dir) {
    case 'left': return { x: -(r.left + extra), y: j };
    case 'right': return { x: r.right + extra, y: j };
    case 'up': return { x: j, y: -(r.up + extra) };
    case 'down': return { x: j, y: r.down + extra };
    default: { // diagonal e.g. 'left-up'
      const [h, v] = dir.split('-');
      return { x: (h === 'left' ? -r.left : r.right) * 0.8, y: (v === 'up' ? -r.up : r.down) * 0.8 };
    }
  }
}

function adjust(dir, delta) {
  if (dir.includes('-')) dir.split('-').forEach((d) => nudgeReach(d, delta / 2));
  else nudgeReach(dir, delta);
}

function len(v) { return Math.hypot(v.x, v.y); }

// ---------- shared drawing ----------
export function drawOwl(ctx, env, { glow: g = 0, wiggle = 0, alpha = 1 } = {}) {
  const s = Math.min(env.W, env.H) * 0.2;
  const { cx, cy, now } = env;
  // warm halo that pulses while Ollie wants to be looked at
  glow(ctx, cx, cy, s * 1.15, '255,196,110', 0.25 + 0.55 * g * (0.75 + 0.25 * Math.sin(now / 260)));
  if (g > 0.5) {
    ctx.save();
    ctx.strokeStyle = `rgba(255,225,160,${0.18 * g})`;
    ctx.lineWidth = 2;
    const rr = s * (0.62 + 0.05 * ((now / 900) % 1));
    ctx.globalAlpha = 1 - ((now / 900) % 1);
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  const breathe = 1 + 0.018 * Math.sin(now / 520);
  const rot = wiggle ? Math.sin(now / 70) * 0.1 * wiggle : Math.sin(now / 1700) * 0.025;
  if (!sprite(ctx, 'owl', cx, cy + Math.sin(now / 900) * s * 0.015, s, { rot, sx: breathe, sy: 2 - breathe, alpha })) {
    drawEmoji(ctx, '🦉', cx, cy, s * 0.6);
  }
}

export function drawEmoji(ctx, ch, x, y, size) {
  ctx.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, x, y);
}

function drawStar(ctx, x, y, r, rot = 0, color = '#ffd34d') {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  const g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.2);
  g.addColorStop(0, 'rgba(255,220,110,0.55)'); g.addColorStop(1, 'rgba(255,220,110,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = r * 0.08; ctx.strokeStyle = '#fff3c4'; ctx.stroke();
  ctx.restore();
}

const Particles = Sparks;

class BaseGame {
  constructor(env) {
    this.env = env;
    this.tol = TOL[state.settings.gazeTol] || 1;
    this.particles = new Particles();
    this.stats = { trials: 0, hits: 0, rts: [], onTime: 0, total: 0, peeks: 0 };
  }
  px(v) { return { x: this.env.cx + v.x * this.env.hw, y: this.env.cy + v.y * this.env.hh }; }
  gazeNear(gaze, target, radius) {
    if (!gaze) return false;
    const dx = gaze.x - target.x, dy = (gaze.y - target.y) * 0.85;
    return Math.hypot(dx, dy) < radius * this.tol;
  }
  onPointer() {}
  onKey() {}
  summary() {
    const s = this.stats;
    return {
      trials: s.trials, hits: s.hits,
      accuracy: s.total > 0 ? s.onTime / s.total : (s.trials ? s.hits / s.trials : 0),
      rt: s.rts.length ? Math.round(s.rts.reduce((a, b) => a + b, 0) / s.rts.length) : null,
      peeks: s.peeks,
    };
  }
}

// ---------- 1. Firefly Chase: smooth pursuit ----------
export class PursuitGame extends BaseGame {
  static id = 'pursuit';
  constructor(env) {
    super(env);
    this.theta = 0;
    this.patternIdx = 0;
    this.patternTime = 0;
    this.pos = { x: 0, y: 0 };
    this.blendFrom = null; this.blendT = 1;
    this.jar = 0;
    this.lostFor = 0;
    this.trail = [];
    this.onTarget = false;
    this.patterns = state.settings.focus === 'h' ? ['h'] : state.settings.focus === 'v' ? ['v'] : ['h', 'v', 'circle', 'diag', 'eight', 'diag2'];
  }
  start() { speak('pursuitSay', { mode: 'interrupt' }); }
  pathAt(theta, pattern) {
    const r = state.progress.reach;
    const sx = (s) => (s >= 0 ? s * (r.right + 0.03) : s * (r.left + 0.03));
    const sy = (s) => (s >= 0 ? s * (r.down + 0.03) : s * (r.up + 0.03));
    const s = Math.sin(theta), c = Math.cos(theta);
    switch (pattern) {
      case 'h': return { x: sx(s), y: 0.06 * Math.sin(theta * 3) };
      case 'v': return { x: 0.06 * Math.sin(theta * 3), y: sy(s) };
      case 'circle': return { x: sx(s), y: sy(-c) };
      case 'diag': return { x: sx(s), y: sy(s) };
      case 'diag2': return { x: sx(s), y: sy(-s) };
      case 'eight': return { x: sx(s), y: sy(Math.sin(theta * 2)) };
      default: return { x: 0, y: 0 };
    }
  }
  update(dt, f) {
    const gaze = f.gaze;
    this.onTarget = this.gazeNear(gaze, this.pos, 0.36);
    if (f.face && !f.blink) {
      this.stats.total += dt;
      if (this.onTarget) this.stats.onTime += dt;
    }
    // The firefly waits (moves slowly) while the eyes are not on it.
    const speed = state.progress.pursuitSpeed * (this.onTarget ? 1 : 0.22);
    this.theta += speed * dt;
    this.patternTime += dt;
    if (this.patterns.length > 1 && this.patternTime > 14) {
      this.patternTime = 0;
      this.blendFrom = { ...this.pos }; this.blendT = 0;
      this.patternIdx = (this.patternIdx + 1) % this.patterns.length;
    }
    let p = this.pathAt(this.theta, this.patterns[this.patternIdx]);
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / 1.2);
      const k = this.blendT * this.blendT * (3 - 2 * this.blendT);
      p = { x: this.blendFrom.x + (p.x - this.blendFrom.x) * k, y: this.blendFrom.y + (p.y - this.blendFrom.y) * k };
    }
    this.pos = p;
    const P = this.px(p);
    this.vel = { x: (P.x - (this.lastP?.x ?? P.x)) / Math.max(dt, 1e-3), y: (P.y - (this.lastP?.y ?? P.y)) / Math.max(dt, 1e-3) };
    this.lastP = P;
    const size = Math.min(this.env.W, this.env.H) * 0.14;
    if (Math.random() < (this.onTarget ? 0.9 : 0.35)) this.particles.trail(P.x, P.y + size * 0.19, this.onTarget ? '#f2ffb0' : '#c8e870');

    if (this.onTarget) {
      this.lostFor = 0;
      this.jar += dt / 6; // 6 s of following fills the jar
      if (Math.random() < dt * 4) sfx.hum(p.x);
      if (this.jar >= 1) {
        this.jar = 0; this.stats.hits++; this.stats.trials++;
        this.env.addStar(P.x, P.y);
        this.particles.burst(P.x, P.y, '#eaff9a', 34, 320);
        sfx.chime();
        this.env.praise();
      }
    } else {
      this.lostFor += dt;
      if (this.lostFor > 2.2) { this.lostFor = 0; sfx.appear(p.x); }
    }
    this.particles.update(dt);
  }
  finish() {
    const acc = this.stats.total ? this.stats.onTime / this.stats.total : 0;
    const pr = state.progress;
    if (acc > 0.65) {
      pr.pursuitSpeed = clamp(+(pr.pursuitSpeed * 1.12).toFixed(3), 0.6, 2.6);
      directions().forEach((d) => nudgeReach(d, 0.02));
    } else if (acc < 0.4) {
      pr.pursuitSpeed = clamp(+(pr.pursuitSpeed * 0.92).toFixed(3), 0.6, 2.6);
    }
  }
  draw(ctx) {
    const env = this.env;
    const P = this.px(this.pos);
    const size = Math.min(env.W, env.H) * 0.14;
    const on = this.onTarget ? 1 : 0;
    this.glowLvl = (this.glowLvl ?? 0) + (on - (this.glowLvl ?? 0)) * 0.12;
    const k = this.glowLvl;
    const pulse = 0.85 + 0.15 * Math.sin(env.now / 140);
    const lx = P.x, ly = P.y + size * 0.19; // the glowing tail lantern
    this.particles.draw(ctx);
    glow(ctx, lx, ly, size * (1.3 + 0.9 * k), '214,255,110', (0.45 + 0.55 * k) * pulse);
    glow(ctx, lx, ly, size * 0.45, '255,255,215', 0.5 + 0.5 * k);
    // calling ring when the eyes have wandered off
    if (!this.onTarget) {
      const ph = (env.now / 1100) % 1;
      ctx.save();
      ctx.strokeStyle = `rgba(214,255,110,${0.5 * (1 - ph)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(P.x, P.y, size * (0.55 + ph * 0.6), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    const flutter = 1 + 0.05 * Math.sin(env.now / 28);
    const tilt = Math.max(-0.35, Math.min(0.35, (this.vel?.x || 0) / (env.W * 1.2)));
    sprite(ctx, 'firefly', P.x, P.y + Math.sin(env.now / 260) * size * 0.04, size, { rot: tilt, sx: 1 / flutter, sy: flutter, alpha: 0.82 + 0.18 * k });
    if (k > 0.3) {
      for (let i = 0; i < 3; i++) {
        const a = env.now / 600 + (i * Math.PI * 2) / 3;
        twinkle(ctx, P.x + Math.cos(a) * size * 0.75, P.y + Math.sin(a) * size * 0.6, size * 0.08, '#fbffd0', k * (0.6 + 0.4 * Math.sin(env.now / 90 + i)), a);
      }
    }
    // firefly jar meter, bottom centre
    const jw = Math.min(env.W * 0.34, 260), jh = 14, jx = env.cx - jw / 2, jy = env.H - env.safeBottom - 40;
    ctx.save();
    ctx.fillStyle = 'rgba(10,20,45,0.55)'; roundRect(ctx, jx - 4, jy - 4, jw + 8, jh + 8, 11); ctx.fill();
    ctx.strokeStyle = 'rgba(200,230,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    const grad = ctx.createLinearGradient(jx, 0, jx + jw, 0);
    grad.addColorStop(0, '#9fdc4a'); grad.addColorStop(1, '#f4ffb0');
    ctx.shadowColor = '#d8ff7a'; ctx.shadowBlur = 14;
    ctx.fillStyle = grad; roundRect(ctx, jx, jy, Math.max(jh, jw * this.jar), jh, 7); ctx.globalAlpha = this.jar > 0.01 ? 1 : 0.25; ctx.fill();
    ctx.restore();
    sprite(ctx, 'star', jx + jw + 26, jy + jh / 2, 34, { alpha: 0.5 + 0.5 * this.jar });
  }
}

// ---------- 2. Star Hop: saccades ----------
export class SaccadeGame extends BaseGame {
  static id = 'saccade';
  constructor(env) {
    super(env);
    this.phase = 'center';
    this.phaseT = 0;
    this.centerHold = 0;
    this.target = null;
    this.dwell = 0;
    this.firstMove = null;
    this.streak = {}; this.fails = {};
    this.lastDirs = [];
    this.wait = 0.3;
    this.message = null;
  }
  start() { speak('saccadeSay', { mode: 'interrupt' }); }
  nextDir() {
    let dirs = directions();
    if (state.settings.focus === 'both' && Math.random() < 0.25) {
      dirs = ['left-up', 'right-up', 'left-down', 'right-down'];
    }
    // avoid more than two in a row in the same direction
    let d;
    do { d = dirs[Math.floor(Math.random() * dirs.length)]; }
    while (dirs.length > 1 && this.lastDirs.length >= 2 && this.lastDirs.slice(-2).every((x) => x === d));
    this.lastDirs.push(d);
    return d;
  }
  update(dt, f) {
    this.phaseT += dt;
    const gaze = f.gaze;
    if (this.phase === 'center') {
      if (this.gazeNear(gaze, { x: 0, y: 0 }, 0.3)) this.centerHold += dt;
      else this.centerHold = Math.max(0, this.centerHold - dt * 0.5);
      // If the eyes look steady but slightly off, assume drift and correct a bit.
      if (this.phaseT > 1.8 && gaze && Math.hypot(gaze.x, gaze.y) < 0.6) this.env.tracker.nudgeTowards({ x: 0, y: 0 }, 0.015);
      if (this.centerHold > 0.2 + this.wait || this.phaseT > 3.5) {
        const dir = this.nextDir();
        const v = vecFor(dir);
        this.target = { dir, v, emoji: null, born: this.env.now };
        this.phase = 'target'; this.phaseT = 0; this.dwell = 0; this.firstMove = null;
        sfx.appear(v.x);
      }
    } else if (this.phase === 'target') {
      const v = this.target.v, L = len(v);
      let along = 0, perp = 9;
      if (gaze) {
        along = (gaze.x * v.x + gaze.y * v.y) / L;
        perp = Math.abs(gaze.x * v.y - gaze.y * v.x) / L;
      }
      if (this.firstMove === null && along > L * 0.35) this.firstMove = this.phaseT;
      const hit = along > Math.max(0.15, L * (0.62 / this.tol)) && perp < 0.45 * this.tol;
      this.dwell = hit ? this.dwell + dt : Math.max(0, this.dwell - dt);
      if (this.dwell > 0.22) this.success();
      else if (this.phaseT > 3) this.fail();
    } else if (this.phase === 'return') {
      if (this.phaseT > 0.3) { this.phase = 'center'; this.phaseT = 0; this.centerHold = 0; this.wait = rand(0.1, 0.5); }
    }
    this.particles.update(dt);
  }
  success() {
    const { dir, v } = this.target;
    const P = this.px(v);
    this.stats.trials++; this.stats.hits++;
    this.stats.rts.push(Math.round((this.firstMove ?? this.phaseT) * 1000));
    this.particles.burst(P.x, P.y, '#ff9d3a', 30, 340); this.particles.burst(P.x, P.y, '#ffe27a', 14, 220); sfx.bounce(v.x);
    sfx.pop(v.x);
    this.env.addStar(P.x, P.y);
    if (Math.random() < 0.35) this.env.praise();
    this.streak[dir] = (this.streak[dir] || 0) + 1; this.fails[dir] = 0;
    if (this.streak[dir] >= 2) { adjust(dir, 0.03); this.streak[dir] = 0; }
    this.target = null;
    this.phase = 'return'; this.phaseT = 0;
  }
  fail() {
    const { dir, v } = this.target;
    this.stats.trials++;
    sfx.miss(v.x);
    this.fails[dir] = (this.fails[dir] || 0) + 1; this.streak[dir] = 0;
    if (this.fails[dir] >= 2) { adjust(dir, -0.04); this.fails[dir] = 0; }
    this.target = null;
    this.phase = 'return'; this.phaseT = 0;
  }
  onPointer(x, y) {
    if (!state.settings.allowTap || this.phase !== 'target') return;
    const P = this.px(this.target.v);
    if (Math.hypot(x - P.x, y - P.y) < Math.min(this.env.W, this.env.H) * 0.12) this.success();
  }
  draw(ctx) {
    const env = this.env;
    const waiting = this.phase === 'center' || this.phase === 'return';
    drawOwl(ctx, env, { glow: waiting ? 1 : 0.15 });
    this.particles.draw(ctx);
    if (this.target) {
      const P = this.px(this.target.v);
      const age = (env.now - this.target.born) / 1000;
      const pop = easeOutBack(Math.min(1, age * 3.2));
      const size = Math.min(env.W, env.H) * 0.11 * pop * (1 + this.dwell * 0.5);
      // the basketball bounces on the spot and spins; it shakes if ignored
      const hop = Math.abs(Math.sin(age * 5.5)) * size * 0.28 * (this.phaseT > 2 ? 1.6 : 1);
      const squash = hop < size * 0.04 ? 0.9 : 1;
      const shake = this.phaseT > 2 ? Math.sin(env.now / 45) * size * 0.06 : 0;
      glow(ctx, P.x, P.y, size * 1.6, '255,150,60', 0.75);
      for (let i = 0; i < 4; i++) {
        const a = env.now / 500 + (i * Math.PI) / 2;
        twinkle(ctx, P.x + Math.cos(a) * size * 0.85, P.y + Math.sin(a) * size * 0.85, size * 0.07, '#ffd9a8', 0.5 + 0.5 * Math.sin(env.now / 120 + i), a);
      }
      sprite(ctx, 'ball', P.x + shake, P.y - hop + size * 0.05 * (1 - squash), size, { rot: age * 3, sx: 1 / squash, sy: squash });
      ring(ctx, P.x, P.y, size * 0.75, this.dwell / 0.22, '#ffb35c', 5);
    }
  }
}

// ---------- 3. Secret Spotter: peripheral detection while fixating ----------
export class SpotterGame extends BaseGame {
  static id = 'spotter';
  constructor(env) {
    super(env);
    this.phase = 'fixate';
    this.phaseT = 0;
    this.hold = 0;
    this.critter = null;
    this.answered = false;
    this.feedback = null;
    this.holdNeed = rand(0.7, 1.6);
  }
  start() { speak('spotterSay', { mode: 'interrupt' }); }
  update(dt, f) {
    this.phaseT += dt;
    const gaze = f.gaze;
    if (this.phase === 'fixate') {
      if (this.gazeNear(gaze, { x: 0, y: 0 }, 0.3)) this.hold += dt;
      else this.hold = Math.max(0, this.hold - dt);
      if (this.phaseT > 2 && gaze && Math.hypot(gaze.x, gaze.y) < 0.6) this.env.tracker.nudgeTowards({ x: 0, y: 0 }, 0.015);
      if (this.hold > this.holdNeed || this.phaseT > 5) {
        const dir = directions()[Math.floor(Math.random() * directions().length)];
        this.critter = { dir, v: vecFor(dir, 0.05), emoji: CRITTERS[Math.floor(Math.random() * CRITTERS.length)], peeked: false };
        this.phase = 'show'; this.phaseT = 0; this.answered = false;
      }
    } else if (this.phase === 'show') {
      const c = this.critter, L = len(c.v);
      if (gaze && !c.peeked) {
        const along = (gaze.x * c.v.x + gaze.y * c.v.y) / L;
        if (along > L * 0.5 && this.phaseT > 0.12) c.peeked = true;
      }
      if (this.phaseT > 2.6 && !this.answered) this.resolve(null);
    } else if (this.phase === 'feedback') {
      if (this.phaseT > 0.9) { this.phase = 'fixate'; this.phaseT = 0; this.hold = 0; this.critter = null; this.feedback = null; this.holdNeed = rand(0.7, 1.6); }
    }
    this.particles.update(dt);
  }
  visible() {
    return this.phase === 'show' && this.phaseT * 1000 < state.progress.spotterMs;
  }
  answer(dir) {
    if (this.phase !== 'show' || this.answered) return;
    this.resolve(dir);
  }
  resolve(dir) {
    this.answered = true;
    const c = this.critter;
    const pr = state.progress;
    this.stats.trials++;
    if (dir === c.dir && !c.peeked) {
      this.stats.hits++;
      this.stats.rts.push(Math.round(this.phaseT * 1000));
      const P = this.px(c.v);
      this.particles.burst(P.x, P.y, '#bfe9ff', 30, 300);
      sfx.pop(c.v.x);
      this.env.addStar(P.x, P.y);
      this.feedback = 'hit';
      adjust(c.dir, 0.025);
      pr.spotterMs = clamp(Math.round(pr.spotterMs * 0.95), 400, 2500);
    } else if (dir === c.dir && c.peeked) {
      this.stats.peeks++;
      this.feedback = 'peek';
      this.env.toast(t('noPeek')); speak('noPeek', { force: true, mode: 'interrupt' });
      sfx.soft();
    } else {
      this.feedback = 'miss';
      sfx.miss(c.v.x);
      if (dir === null) pr.spotterMs = clamp(Math.round(pr.spotterMs * 1.06), 400, 2500);
      adjust(c.dir, -0.02);
    }
    this.phase = 'feedback'; this.phaseT = 0;
  }
  onPointer(x, y) {
    const dx = x - this.env.cx, dy = y - this.env.cy;
    if (Math.hypot(dx, dy) < 30) return;
    const f = state.settings.focus;
    let dir;
    if (f === 'h') dir = dx < 0 ? 'left' : 'right';
    else if (f === 'v') dir = dy < 0 ? 'up' : 'down';
    else if (Math.abs(dx) / this.env.hw > Math.abs(dy) / this.env.hh) dir = dx < 0 ? 'left' : 'right';
    else dir = dy < 0 ? 'up' : 'down';
    this.answer(dir);
  }
  onKey(k) {
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (map[k]) this.answer(map[k]);
  }
  draw(ctx) {
    const env = this.env;
    drawOwl(ctx, env, { glow: this.phase === 'fixate' ? 1 : 0.45, wiggle: this.feedback === 'peek' ? 1 : 0 });
    this.particles.draw(ctx);
    if (this.critter && (this.visible() || (this.phase === 'feedback' && this.feedback !== 'hit'))) {
      const P = this.px(this.critter.v);
      const size = Math.min(env.W, env.H) * 0.13;
      const shownMs = this.phase === 'show' ? this.phaseT * 1000 : state.progress.spotterMs;
      const pop = easeOutBack(Math.min(1, shownMs / 220));
      const left = state.progress.spotterMs - shownMs;
      let alpha = this.phase === 'feedback' ? 0.35 : Math.min(1, left / 160);
      glow(ctx, P.x, P.y, size * 1.1, '170,220,255', 0.35 * alpha);
      sprite(ctx, this.critter.emoji, P.x, P.y - Math.abs(Math.sin(env.now / 180)) * size * 0.06, size * pop, { rot: Math.sin(env.now / 160) * 0.08, alpha: Math.max(0, alpha) });
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  r = Math.min(r, h / 2, Math.max(w, 0) / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const GAMES = { pursuit: PursuitGame, saccade: SaccadeGame, spotter: SpotterGame };
export { drawStar, BaseGame, directions, adjust, roundRect, rand };

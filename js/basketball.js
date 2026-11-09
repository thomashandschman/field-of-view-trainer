// Basketball: a player dribbles across the court (smooth pursuit of the
// bouncing ball). When the shot meter is full a hoop lights up at the edge
// (saccade to the hoop). Looking at it makes the player shoot; the ball flies
// in an arc into the basket (pursuit again). Hoops sit at the child's current
// reach, so they move further out as he improves.
import { state, clamp } from './store.js';
import { sfx, speak } from './audio.js';
import { t } from './i18n.js';
import { BaseGame, adjust, roundRect, rand } from './games.js';
import { sprite, glow, twinkle, ring, has, spriteSize, Sparks } from './art.js';

const FLOOR = 0.62;          // where the ball hits the floor (normalised y)
const HAND = 0.26;           // ball height at the top of a dribble, above the floor
const METER_SECONDS = 3.2;   // time on the ball needed to fill the shot meter
const RIM = { x: 0.41, y: 0.5 }; // rim centre inside the trimmed hoop sprite (0..1)

export class BasketballGame extends BaseGame {
  static id = 'basket';
  constructor(env) {
    super(env);
    this.particles = new Sparks();
    this.phase = 'dribble';
    this.phaseT = 0;
    this.theta = rand(0, Math.PI * 2);
    this.bounceT = 0;
    this.meter = 0;
    this.score = 0;
    this.ball = { x: 0, y: FLOOR };
    this.playerX = 0;
    this.facing = 1;
    this.onBall = false;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.netWobble = { '-1': 0, '1': 0 };
    this.dwell = 0;
    this.firstMove = null;
    this.flash = 0;
    this.lastSide = 0;
    this.scoreBump = 0;
  }
  start() { speak('basketSay', { mode: 'interrupt' }); }

  // Hoop rim position for a side (-1 left, +1 right), at the current reach.
  hoop(side) {
    const r = state.progress.reach;
    const f = state.settings.focus;
    const x = side < 0 ? -r.left : r.right;
    if (f === 'h') return { x: x * 0.95, y: -0.2 };
    if (f === 'v') return { x: side * 0.32, y: -r.up };
    return { x: x * 0.92, y: -r.up * 0.85 };
  }

  dribbleX(theta) {
    const r = state.progress.reach;
    const s = Math.sin(theta);
    return s >= 0 ? s * r.right * 0.8 : s * r.left * 0.8;
  }

  update(dt, f) {
    this.phaseT += dt;
    const gaze = f.gaze;
    const unit = Math.min(this.env.W, this.env.H);
    const handOff = (unit * 0.165) / this.env.hw; // ball sits under the front hand

    if (this.phase === 'dribble') {
      // the ball's average height is what the eyes should hold
      const mid = { x: this.ball.x, y: FLOOR - HAND / 2 };
      this.onBall = !!gaze && Math.abs(gaze.x - mid.x) < 0.34 * this.tol && Math.abs(gaze.y - mid.y) < 0.5 * this.tol;
      if (f.face && !f.blink) { this.stats.total += dt; if (this.onBall) this.stats.onTime += dt; }
      const speed = (state.progress.basketSpeed ?? 1) * (this.onBall ? 1 : 0.25);
      this.theta += speed * dt;
      const bx = this.dribbleX(this.theta);
      const dir = Math.cos(this.theta) >= 0 ? 1 : -1;
      this.facing += (dir - this.facing) * Math.min(1, dt * 8);
      this.ball.x = bx;
      this.playerX = bx - Math.sign(this.facing || 1) * handOff;
      this.dribble(dt, 1.7);
      if (this.onBall) this.meter = Math.min(1, this.meter + dt / METER_SECONDS);
      if (this.meter >= 1) this.startAim();
    } else if (this.phase === 'aim') {
      this.dribble(dt, 0); // hold the ball, step round so it is in front, toward the hoop
      this.playerX += (this.ball.x - this.side * handOff - this.playerX) * Math.min(1, dt * 6);
      const h = this.hoop(this.side);
      const from = { x: this.ball.x, y: this.ball.y };
      const d = { x: h.x - from.x, y: h.y - from.y };
      const L = Math.hypot(d.x, d.y);
      let along = 0, perp = 9;
      if (gaze) {
        const g = { x: gaze.x - from.x, y: gaze.y - from.y };
        along = (g.x * d.x + g.y * d.y) / L;
        perp = Math.abs(g.x * d.y - g.y * d.x) / L;
      }
      if (this.firstMove === null && along > L * 0.35) this.firstMove = this.phaseT;
      const hit = along > L * (0.62 / this.tol) && perp < 0.45 * this.tol;
      this.dwell = hit ? this.dwell + dt : Math.max(0, this.dwell - dt);
      if (this.phaseT > 1.8 && !this.saidLook) { this.saidLook = true; speak('lookHoop', { mode: 'ifIdle', force: true }); }
      if (this.dwell > 0.2) this.shoot();
      else if (this.phaseT > 3.5) this.missAim();
    } else if (this.phase === 'shot') {
      const u = Math.min(1, this.phaseT / this.shot.T);
      const s = this.shot;
      this.ball.x = s.from.x + (s.to.x - s.from.x) * u;
      this.ball.y = s.from.y + (s.to.y - s.from.y) * u - s.arc * 4 * u * (1 - u);
      this.spin += dt * 9;
      if (u >= 1) this.score2();
    } else if (this.phase === 'through') {
      // ball drops through the net, then rolls back to the player
      const u = Math.min(1, this.phaseT / 1.1);
      const h = this.hoop(this.side);
      if (u < 0.35) { this.ball.x = h.x; this.ball.y = h.y + (u / 0.35) * 0.22; }
      else {
        const v = (u - 0.35) / 0.65;
        this.ball.x = h.x + (this.playerX + Math.sign(this.facing) * 0.08 - h.x) * v;
        this.ball.y = h.y + 0.22 + (FLOOR - HAND - h.y - 0.22) * v - 0.25 * 4 * v * (1 - v);
      }
      if (u >= 1) { this.phase = 'dribble'; this.phaseT = 0; this.meter = 0; }
    }

    for (const k of ['-1', '1']) this.netWobble[k] = Math.max(0, this.netWobble[k] - dt * 1.6);
    this.flash = Math.max(0, this.flash - dt);
    this.scoreBump = Math.max(0, this.scoreBump - dt * 2.5);
    this.particles.update(dt);
  }

  // Ball bouncing between hand and floor; freq 0 = holding it.
  dribble(dt, freq) {
    if (freq > 0) {
      const before = Math.floor(this.bounceT * 2);
      this.bounceT += dt * freq;
      if (Math.floor(this.bounceT * 2) !== before && (Math.floor(this.bounceT * 2) % 2 === 1)) sfx.bounce(this.ball.x);
      const ph = this.bounceT * Math.PI * 2;
      this.ball.y = FLOOR - HAND * Math.abs(Math.cos(ph / 2));
    } else {
      this.ball.y += (FLOOR - HAND - 0.04 - this.ball.y) * Math.min(1, dt * 10);
    }
    this.spin = (this.spin || 0) + dt * 2;
  }

  startAim() {
    // mostly alternate sides, sometimes repeat to stay unpredictable
    this.side = Math.random() < 0.7 ? -this.lastSide || (Math.random() < 0.5 ? -1 : 1) : this.side;
    this.lastSide = this.side;
    this.phase = 'aim'; this.phaseT = 0; this.dwell = 0; this.firstMove = null; this.saidLook = false;
    this.facing = this.side;
    this.stats.trials++;
    sfx.appear(this.side * 0.8);
  }

  shoot() {
    this.stats.rts.push(Math.round((this.firstMove ?? this.phaseT) * 1000));
    const h = this.hoop(this.side);
    const from = { x: this.ball.x, y: this.ball.y };
    const dist = Math.hypot(h.x - from.x, h.y - from.y);
    this.shot = { from, to: { x: h.x, y: h.y - 0.02 }, T: 0.65 + dist * 0.25, arc: 0.28 + dist * 0.18, three: Math.abs(h.x) >= 0.62 };
    this.phase = 'shot'; this.phaseT = 0;
    sfx.whoosh(this.side * 0.6);
  }

  score2() {
    const s = this.shot;
    const P = this.px(s.to);
    const pts = s.three ? 3 : 2;
    this.score += pts;
    this.scoreBump = 1;
    this.stats.hits++;
    this.netWobble[String(this.side)] = 1;
    this.flash = 0.5;
    this.particles.burst(P.x, P.y, '#ff9d3a', 30, 320);
    this.particles.burst(P.x, P.y, '#ffe27a', 18, 240);
    sfx.swish(this.side * 0.8);
    setTimeout(() => sfx.cheer(), 120);
    this.env.addStar(P.x, P.y);
    if (pts === 3) this.env.addStar(P.x, P.y);
    this.env.toast(pts === 3 ? 'Dreier! +3' : '+2');
    speak(pts === 3 ? 'three' : (Math.random() < 0.5 ? 'score1' : 'score2'), { mode: 'ifIdle', force: true });
    adjust(this.side < 0 ? 'left' : 'right', 0.03);
    if (state.settings.focus !== 'h') adjust('up', 0.02);
    this.phase = 'through'; this.phaseT = 0;
  }

  missAim() {
    sfx.rim(this.side * 0.8);
    adjust(this.side < 0 ? 'left' : 'right', -0.04);
    this.phase = 'dribble'; this.phaseT = 0; this.meter = 0.5;
  }

  finish() {
    const acc = this.stats.total ? this.stats.onTime / this.stats.total : 0;
    const p = state.progress;
    if (acc > 0.65) p.basketSpeed = clamp(+((p.basketSpeed ?? 1) * 1.12).toFixed(3), 0.6, 2.6);
    else if (acc < 0.4) p.basketSpeed = clamp(+((p.basketSpeed ?? 1) * 0.92).toFixed(3), 0.6, 2.6);
    p.basketScore = Math.max(p.basketScore || 0, this.score);
  }

  // ---------------- drawing ----------------
  draw(ctx) {
    const env = this.env;
    const unit = Math.min(env.W, env.H);
    const floorPx = env.cy + FLOOR * env.hh;

    // hoops (both visible, the active one glows)
    for (const side of [-1, 1]) {
      const h = this.px(this.hoop(side));
      const active = this.phase === 'aim' && side === this.side;
      const size = unit * 0.3;
      if (active) {
        const pulse = 0.7 + 0.3 * Math.sin(env.now / 120);
        glow(ctx, h.x, h.y, size * 0.95, '255,170,60', pulse);
        const ph = (env.now / 700) % 1;
        ctx.save(); ctx.strokeStyle = `rgba(255,200,110,${0.7 * (1 - ph)})`; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(h.x, h.y, size * (0.2 + ph * 0.35), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      } else if (this.flash > 0 && side === this.side) {
        glow(ctx, h.x, h.y, size, '255,220,120', this.flash * 2);
      }
      this.drawHoop(ctx, h, size, side, active ? 1 : 0.7);
      if (active) ring(ctx, h.x, h.y, size * 0.32, this.dwell / 0.2, '#ffcf6a', 5);
    }

    // player
    const pSize = unit * 0.4;
    const px = env.cx + this.playerX * env.hw;
    const bob = Math.abs(Math.sin(this.bounceT * Math.PI)) * unit * 0.008;
    const flip = this.facing >= 0 ? 1 : -1;
    const ps = spriteSize('player');
    const ph = ps ? pSize * (ps.h / Math.max(ps.w, ps.h)) : pSize;
    // floor shadow
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(px, floorPx + unit * 0.01, pSize * 0.3, unit * 0.018, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    if (!sprite(ctx, 'player', px, floorPx - ph / 2 + bob, pSize, { sx: flip })) {
      ctx.fillStyle = '#3a6fd8'; ctx.fillRect(px - 20, floorPx - 120, 40, 120);
    }

    // ball (+ shadow on the floor)
    const B = this.px(this.ball);
    const bSize = unit * 0.085;
    const hgt = Math.max(0, Math.min(1, (floorPx - B.y) / (env.hh * 0.9)));
    ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.3 * (1 - hgt)})`;
    ctx.beginPath(); ctx.ellipse(B.x, floorPx + bSize * 0.45, bSize * 0.45 * (1 - hgt * 0.5), bSize * 0.12, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    const lit = this.phase === 'dribble' ? (this.onBall ? 1 : 0.35) : 0.8;
    glow(ctx, B.x, B.y, bSize * 1.6, '255,150,60', 0.45 * lit);
    const squash = this.phase === 'dribble' && B.y > floorPx - bSize * 0.6 ? 0.88 : 1;
    if (!sprite(ctx, 'ball', B.x, B.y + bSize * 0.45 * (1 - squash), bSize, { rot: this.spin || 0, sx: 1 / squash, sy: squash })) {
      ctx.fillStyle = '#f08a24'; ctx.beginPath(); ctx.arc(B.x, B.y, bSize / 2, 0, Math.PI * 2); ctx.fill();
    }
    if (this.phase === 'dribble' && !this.onBall) {
      const ph2 = (env.now / 1000) % 1;
      ctx.save(); ctx.strokeStyle = `rgba(255,170,80,${0.55 * (1 - ph2)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(B.x, B.y, bSize * (0.7 + ph2 * 0.8), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (this.phase === 'dribble' && this.onBall && Math.random() < 0.5) this.particles.trail(B.x, B.y, '#ffc27a');

    // guide arc from the ball to the glowing hoop (after a moment, if needed)
    if (this.phase === 'aim' && this.phaseT > 0.7) {
      const H = this.px(this.hoop(this.side));
      const a = Math.min(1, (this.phaseT - 0.7) * 2);
      ctx.save();
      ctx.strokeStyle = `rgba(255,214,140,${0.75 * a})`; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.setLineDash([2, 14]); ctx.lineDashOffset = -env.now / 25;
      const mx = (B.x + H.x) / 2, my = Math.min(B.y, H.y) - unit * 0.18;
      ctx.beginPath(); ctx.moveTo(B.x, B.y - bSize * 0.6); ctx.quadraticCurveTo(mx, my, H.x, H.y); ctx.stroke();
      ctx.restore();
    }

    this.particles.draw(ctx);
    this.drawScoreboard(ctx);
    this.drawMeter(ctx);

    // short text hints for what to do right now
    if (this.phase === 'aim') this.hint(ctx, t('hintLookHoop'), env.safeTop + 170, 1);
    else if (this.phase === 'dribble' && !this.onBall && this.stats.total > 0.8) {
      this.hint(ctx, t('hintFollowBall'), B.y - bSize * 1.4, 0.75 + 0.25 * Math.sin(env.now / 180), B.x);
    }
  }

  hint(ctx, text, y, alpha, x = this.env.cx) {
    const unit = Math.min(this.env.W, this.env.H);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${Math.round(unit * 0.042)}px "Baloo 2", ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 36, h = unit * 0.07;
    const cx = Math.max(w / 2 + 8, Math.min(this.env.W - w / 2 - 8, x));
    ctx.fillStyle = 'rgba(8,12,30,0.72)'; roundRect(ctx, cx - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
    ctx.fillStyle = '#ffe2a8'; ctx.fillText(text, cx, y + 1);
    ctx.restore();
  }

  drawHoop(ctx, h, size, side, alpha) {
    // the sprite has the backboard on the right; mirror it for the left hoop
    const s = spriteSize('hoop');
    if (!s) return;
    const scale = size / Math.max(s.w, s.h);
    // rim centre inside the trimmed sprite (measured from the art)
    const rimX = (RIM.x - 0.5) * s.w * scale, rimY = (RIM.y - 0.5) * s.h * scale;
    const wob = this.netWobble[String(side)];
    sprite(ctx, 'hoop', h.x - (side > 0 ? rimX : -rimX), h.y - rimY, size, {
      sx: side > 0 ? 1 : -1, sy: 1 + Math.sin(wob * 18) * 0.05 * wob, alpha,
    });
  }

  drawScoreboard(ctx) {
    const env = this.env;
    const w = 190, h = 64, x = env.cx - w / 2, y = env.safeTop + 54;
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,28,0.82)'; roundRect(ctx, x, y, w, h, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,190,90,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,200,120,0.75)';
    ctx.font = '700 12px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('PUNKTE', env.cx, y + 7);
    const bump = 1 + this.scoreBump * 0.25;
    ctx.translate(env.cx, y + 41); ctx.scale(bump, bump);
    ctx.font = '800 34px "Baloo 2", ui-rounded, system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffd27a';
    ctx.fillText(String(this.score).padStart(2, '0'), 0, 0);
    ctx.restore();
  }

  drawMeter(ctx) {
    const env = this.env;
    const jw = Math.min(env.W * 0.34, 260), jh = 14, jx = env.cx - jw / 2, jy = env.H - env.safeBottom - 34;
    ctx.save();
    ctx.fillStyle = 'rgba(10,14,30,0.6)'; roundRect(ctx, jx - 4, jy - 4, jw + 8, jh + 8, 11); ctx.fill();
    ctx.strokeStyle = 'rgba(255,200,140,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
    const g = ctx.createLinearGradient(jx, 0, jx + jw, 0);
    g.addColorStop(0, '#ff7a1a'); g.addColorStop(1, '#ffd36b');
    ctx.shadowColor = '#ff9a3a'; ctx.shadowBlur = this.meter >= 1 ? 22 : 10;
    ctx.fillStyle = g; ctx.globalAlpha = this.meter > 0.01 ? 1 : 0.25;
    roundRect(ctx, jx, jy, Math.max(jh, jw * this.meter), jh, 7); ctx.fill();
    ctx.restore();
    sprite(ctx, 'ball', jx - 26, jy + jh / 2, 30, { rot: this.spin || 0 });
    ctx.save();
    ctx.font = '700 13px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,214,160,0.85)';
    ctx.fillText(t('hintPower').toUpperCase(), env.cx, jy - 8);
    ctx.restore();
    if (this.meter >= 1) twinkle(ctx, jx + jw, jy + jh / 2, 14, '#fff3c0', 0.9, env.now / 300);
  }
}

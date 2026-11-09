// Pendel-Fänger: a basket hangs from a rope and swings like a pendulum to
// wherever the eyes look. Basketballs (and now and then a golden star) drop
// from the top, alternating sides, so the eyes jump out to them (saccade) and
// ride them down (pursuit). Catching builds combos with big, showy points.
import { state, clamp, nudgeReach } from './store.js';
import { sfx, speak } from './audio.js';
import { t } from './i18n.js';
import { BaseGame, roundRect, rand } from './games.js';
import { sprite, glow, twinkle, Sparks } from './art.js';

const MULTS = [[10, 5], [6, 3], [3, 2], [0, 1]]; // combo >= n -> multiplier

export class PendelGame extends BaseGame {
  static id = 'pendel';
  constructor(env) {
    super(env);
    this.particles = new Sparks();
    this.theta = 0; this.omega = 0; this.thetaT = 0;
    this.items = [];
    this.spawnT = 1.2;
    this.spawnCount = 0;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.score = 0; this.shownScore = 0;
    this.combo = 0; this.mult = 1;
    this.floaters = [];   // "+20" texts
    this.banner = null;   // big "KOMBO x3!" text
    this.flash = 0; this.shake = 0;
    this.trail = [];
    this.starsGiven = 0;
  }
  start() { if (!this.introDone) speak('pendelSay', { mode: 'interrupt' }); }

  geom() {
    const env = this.env;
    const unit = Math.min(env.W, env.H);
    const pivot = { x: env.cx, y: (env.safeTop || 0) + 34 };
    const L = (env.H - pivot.y) * 0.7;
    return { unit, pivot, L, rimW: unit * 0.17, rimH: unit * 0.045 };
  }
  basket() {
    const { pivot, L } = this.geom();
    return { x: pivot.x + L * Math.sin(this.theta), y: pivot.y + L * Math.cos(this.theta) };
  }

  update(dt, f) {
    const env = this.env;
    const { unit, pivot, L, rimW } = this.geom();
    // pendulum steered by the eyes: the rest angle follows the gaze, the
    // spring and light damping make it swing over and settle like a pendulum
    if (f.gaze) {
      const gx = clamp(f.gaze.x * env.hw / L, -0.95, 0.95);
      this.thetaT = Math.asin(gx);
    }
    const acc = 26 * (this.thetaT - this.theta) - 4.2 * this.omega;
    this.omega += acc * dt; this.theta += this.omega * dt;
    const B = this.basket();
    this.trail.push({ x: B.x, y: B.y, life: 1 });
    this.trail.forEach((p) => { p.life -= dt * 4; });
    this.trail = this.trail.filter((p) => p.life > 0);

    // spawn: alternate sides at the current reach so the eyes travel far
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.items.length < 2) {
      this.spawnCount++;
      const r = state.progress.reach;
      const reach = this.side < 0 ? r.left : r.right;
      const frac = Math.random() < 0.25 ? rand(0.1, 0.4) : rand(0.65, 1);
      const x = env.cx + this.side * frac * reach * env.hw;
      const gold = this.spawnCount % 6 === 0;
      const fallT = 2.7 / (state.progress.pendelSpeed ?? 1);
      const y0 = pivot.y + unit * 0.05;
      this.items.push({ x, y: y0, vy: (B.y - y0) / fallT, gold, rot: 0, born: env.now, side: this.side, seen: null, state: 'fall', t: 0 });
      this.side = Math.random() < 0.75 ? -this.side : this.side;
      this.spawnT = rand(1.1, 1.9) / (state.progress.pendelSpeed ?? 1);
      sfx.appear((x - env.cx) / env.hw);
    }

    for (const it of this.items) {
      it.t += dt;
      if (it.state === 'fall') {
        it.y += it.vy * dt; it.rot += dt * 4;
        if (it.seen === null && f.gaze && Math.abs(env.cx + f.gaze.x * env.hw - it.x) < env.hw * 0.25) it.seen = it.t;
        const inRim = Math.abs(it.x - B.x) < rimW * 0.55;
        if (it.y >= B.y - unit * 0.02 && it.y <= B.y + unit * 0.05 && inRim) this.catch(it, B);
        else if (it.y > B.y + unit * 0.07) this.miss(it);
      } else if (it.state === 'caught') {
        it.y += unit * 0.5 * dt; it.x += (B.x - it.x) * Math.min(1, dt * 12);
        if (it.t > 0.35) it.state = 'gone';
      } else if (it.state === 'missed') {
        it.vy += unit * 2.6 * dt; it.y += it.vy * dt; it.x += it.vx * dt; it.rot += dt * 6;
        const floor = env.H * 0.9;
        if (it.y > floor && it.vy > 0) { it.y = floor; it.vy *= -0.45; it.bounces = (it.bounces || 0) + 1; if (it.bounces === 1) sfx.bounce((it.x - env.cx) / env.hw); }
        if (it.t > 2.2) it.state = 'gone';
      }
    }
    this.items = this.items.filter((it) => it.state !== 'gone');

    this.floaters.forEach((p) => { p.t += dt; p.y -= unit * 0.12 * dt; });
    this.floaters = this.floaters.filter((p) => p.t < 1.3);
    if (this.banner) { this.banner.t += dt; if (this.banner.t > 1.8) this.banner = null; }
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.shownScore += (this.score - this.shownScore) * Math.min(1, dt * 8);
    this.particles.update(dt);
  }

  catch(it, B) {
    it.state = 'caught'; it.t = 0;
    this.combo++;
    const before = this.mult;
    this.mult = MULTS.find(([n]) => this.combo >= n)[1];
    const pts = (it.gold ? 50 : 10) * this.mult;
    this.score += pts;
    this.stats.trials++; this.stats.hits++;
    if (it.seen !== null) this.stats.rts.push(Math.round(it.seen * 1000));
    const pan = (B.x - this.env.cx) / this.env.hw;
    this.particles.burst(B.x, B.y, it.gold ? '#ffe27a' : '#ff9d3a', it.gold ? 60 : 30, it.gold ? 460 : 320);
    this.particles.burst(B.x, B.y, '#fff3c0', 12, 200);
    this.floaters.push({ x: B.x, y: B.y - this.geom().unit * 0.08, text: `+${pts}`, t: 0, big: it.gold || this.mult > 1, gold: it.gold });
    sfx.swish(pan);
    if (it.gold) {
      this.flash = 1; this.shake = 1;
      this.fireworks(3);
      sfx.cheer();
      speak('golden', { mode: 'interrupt', force: true });
    }
    if (this.mult > before) {
      this.banner = { text: this.mult >= 5 ? 'MEGA-KOMBO ×5!' : `KOMBO ×${this.mult}!`, t: 0, mult: this.mult };
      this.flash = Math.max(this.flash, 0.7);
      this.fireworks(this.mult >= 5 ? 5 : 2);
      sfx.cheer();
      speak(this.mult >= 5 ? 'mega' : 'combo', { mode: it.gold ? 'queue' : 'interrupt', force: true });
    }
    // reward stars for points, and widen the reach on that side
    while (this.score >= (this.starsGiven + 1) * 250) { this.starsGiven++; this.env.addStar(B.x, B.y); }
    if (this.combo % 3 === 0) nudgeReach(it.side < 0 ? 'left' : 'right', 0.02);
  }

  miss(it) {
    it.state = 'missed'; it.t = 0; it.vx = (it.x - this.basket().x > 0 ? 1 : -1) * this.geom().unit * 0.15; it.vy = Math.abs(it.vy) * 0.6;
    this.stats.trials++;
    if (this.combo >= 3) this.floaters.push({ x: it.x, y: it.y - 30, text: t('comboLost'), t: 0, big: false, lost: true });
    this.combo = 0; this.mult = 1;
    sfx.miss((it.x - this.env.cx) / this.env.hw);
    nudgeReach(it.side < 0 ? 'left' : 'right', -0.015);
  }

  fireworks(n) {
    const env = this.env;
    const colors = ['#ff9d3a', '#ffe27a', '#9fe3ff', '#ff7ab8', '#b9ec4f'];
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const x = rand(env.W * 0.15, env.W * 0.85), y = rand(env.H * 0.12, env.H * 0.4);
        this.particles.burst(x, y, colors[i % colors.length], 34, 380);
        this.particles.burst(x, y, '#ffffff', 10, 200);
        sfx.pop((x - env.cx) / env.hw);
      }, i * 160);
    }
  }

  finish() {
    const rate = this.stats.trials ? this.stats.hits / this.stats.trials : 0;
    const p = state.progress;
    if (rate > 0.75) p.pendelSpeed = clamp(+((p.pendelSpeed ?? 1) * 1.1).toFixed(3), 0.6, 2.4);
    else if (rate < 0.45) p.pendelSpeed = clamp(+((p.pendelSpeed ?? 1) * 0.9).toFixed(3), 0.6, 2.4);
    p.pendelBest = Math.max(p.pendelBest || 0, this.score);
  }

  // ---------------- drawing ----------------
  draw(ctx) {
    const env = this.env;
    const { unit, pivot, rimW, rimH } = this.geom();
    const B = this.basket();
    ctx.save();
    if (this.shake > 0) ctx.translate(Math.sin(env.now / 20) * 8 * this.shake, Math.cos(env.now / 27) * 6 * this.shake);

    // rope + pivot
    ctx.strokeStyle = 'rgba(230,220,200,0.85)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(pivot.x, pivot.y); ctx.lineTo(B.x, B.y - rimH * 0.4); ctx.stroke();
    glow(ctx, pivot.x, pivot.y, 22, '255,220,150', 0.6);
    ctx.fillStyle = '#d9c9a8'; ctx.beginPath(); ctx.arc(pivot.x, pivot.y, 6, 0, Math.PI * 2); ctx.fill();

    // motion trail of the swinging basket
    for (const p of this.trail) {
      ctx.globalAlpha = p.life * 0.18;
      ctx.strokeStyle = '#ff9d3a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rimW / 2, rimH / 2, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // falling items
    for (const it of this.items) {
      const size = unit * (it.gold ? 0.1 : 0.085) * (it.state === 'caught' ? Math.max(0.2, 1 - it.t * 2) : 1);
      const alpha = it.state === 'missed' ? Math.max(0, 1 - it.t / 2.2) : 1;
      glow(ctx, it.x, it.y, size * 1.5, it.gold ? '255,220,90' : '255,150,60', 0.55 * alpha);
      if (it.gold) {
        for (let i = 0; i < 3; i++) { const a = env.now / 300 + i * 2.1; twinkle(ctx, it.x + Math.cos(a) * size * 0.8, it.y + Math.sin(a) * size * 0.8, size * 0.1, '#fff3c0', alpha, a); }
        sprite(ctx, 'star', it.x, it.y, size, { rot: Math.sin(it.rot) * 0.2, alpha });
      } else sprite(ctx, 'ball', it.x, it.y, size, { rot: it.rot, alpha });
    }

    this.drawBasket(ctx, B, rimW, rimH);
    this.particles.draw(ctx);
    ctx.restore();

    // floating points
    for (const p of this.floaters) {
      const k = Math.min(1, p.t * 5);
      const scale = (p.big ? 1.5 : 1) * (0.6 + 0.6 * k) * (1 - Math.max(0, p.t - 1) * 0.5);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, p.t - 0.8) / 0.5);
      ctx.translate(p.x, p.y); ctx.scale(scale, scale);
      ctx.font = `800 ${Math.round(unit * 0.06)}px "Baloo 2", ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(30,10,0,0.6)'; ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.lost ? '#ffb0b0' : p.gold ? '#fff09a' : '#ffc061';
      ctx.shadowColor = p.lost ? 'transparent' : '#ff9d3a'; ctx.shadowBlur = 18;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }

    // combo banner
    if (this.banner) {
      const bt = this.banner.t;
      const s = bt < 0.25 ? 0.3 + (bt / 0.25) * 1.0 : 1.3 - Math.min(0.3, (bt - 0.25) * 0.6);
      ctx.save();
      ctx.globalAlpha = bt > 1.4 ? Math.max(0, 1 - (bt - 1.4) / 0.4) : 1;
      ctx.translate(env.cx, env.H * 0.32); ctx.scale(s, s); ctx.rotate(Math.sin(bt * 8) * 0.03);
      ctx.font = `800 ${Math.round(unit * 0.1)}px "Baloo 2", ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const g = ctx.createLinearGradient(0, -unit * 0.05, 0, unit * 0.05);
      g.addColorStop(0, '#fff6c8'); g.addColorStop(1, this.banner.mult >= 5 ? '#ff5fa2' : '#ff9d3a');
      ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(40,10,0,0.55)'; ctx.strokeText(this.banner.text, 0, 0);
      ctx.fillStyle = g; ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 30;
      ctx.fillText(this.banner.text, 0, 0);
      ctx.restore();
    }

    // flash
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,240,200,${0.28 * this.flash})`; ctx.fillRect(0, 0, env.W, env.H); }

    this.drawScore(ctx);
  }

  drawBasket(ctx, B, rimW, rimH) {
    const tilt = -this.omega * 0.04;
    ctx.save();
    ctx.translate(B.x, B.y); ctx.rotate(tilt);
    glow(ctx, 0, rimH, rimW * 0.9, '255,150,60', 0.35 + 0.15 * Math.min(1, this.combo / 6));
    // net
    const netH = rimW * 0.55;
    ctx.strokeStyle = 'rgba(245,245,250,0.9)'; ctx.lineWidth = 2;
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x0 = -rimW / 2 + u * rimW, x1 = -rimW * 0.3 + u * rimW * 0.6;
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.quadraticCurveTo((x0 + x1) / 2, netH * 0.6, x1, netH); ctx.stroke();
    }
    for (let j = 1; j <= 3; j++) {
      const v = j / 3.2, w = rimW * (1 - v * 0.42);
      ctx.beginPath(); ctx.ellipse(0, netH * v, w / 2, rimH * 0.25, 0, 0, Math.PI); ctx.stroke();
    }
    // rim
    ctx.lineWidth = Math.max(5, rimH * 0.28);
    ctx.strokeStyle = '#ff7a1a'; ctx.shadowColor = '#ff9d3a'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.ellipse(0, 0, rimW / 2, rimH / 2, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  drawScore(ctx) {
    const env = this.env;
    const w = 200, h = 70, x = (env.safeLeft || 0) + 16, y = (env.safeTop || 0) + 60;
    const cx = x + w / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,28,0.82)'; roundRect(ctx, x, y, w, h, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(255,190,90,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = '800 36px "Baloo 2", ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 16; ctx.fillStyle = '#ffd27a';
    ctx.fillText(String(Math.round(this.shownScore)), cx - (this.mult > 1 ? 26 : 0), y + h / 2 + 2);
    if (this.mult > 1) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = this.mult >= 5 ? '#ff5fa2' : '#ff8a2a';
      roundRect(ctx, x + w - 64, y + 16, 50, 38, 12); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 22px "Baloo 2", ui-rounded, system-ui, sans-serif';
      ctx.fillText(`×${this.mult}`, x + w - 39, y + 36);
    }
    ctx.restore();
    if (this.combo >= 2) {
      ctx.save();
      ctx.font = '700 14px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,214,160,0.9)';
      ctx.fillText(`${t('comboLabel')} ${this.combo}`, cx, y + h + 18);
      ctx.restore();
    }
  }
}

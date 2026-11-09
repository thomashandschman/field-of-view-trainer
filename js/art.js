// Illustrated sprites (img/*.png) plus the glow, sparkle and motion effects
// drawn around them on the canvas.

export const CRITTERS = ['fox', 'wolf', 'shark', 'panther', 'eagle', 'raccoon'];
export const SPRITES = ['owl', 'firefly', 'star', ...CRITTERS, 'player', 'hoop', 'ball'];

const img = {};
export let background = null;
export let arena = null;

// Load each sprite and trim its transparent margin so sizes are comparable.
function trim(image) {
  const c = document.createElement('canvas');
  c.width = image.naturalWidth; c.height = image.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(image, 0, 0);
  const { data, width, height } = x.getImageData(0, 0, c.width, c.height);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y += 2) {
    for (let xx = 0; xx < width; xx += 2) {
      if (data[(y * width + xx) * 4 + 3] > 24) {
        if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX) return c;
  const w = maxX - minX + 2, h = maxY - minY + 2;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').drawImage(c, minX, minY, w, h, 0, 0, w, h);
  return out;
}

function load(src) {
  return new Promise((ok) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => ok(null);
    i.src = src;
  });
}

export async function loadArt() {
  await Promise.all(SPRITES.map(async (k) => {
    const i = await load(`img/${k}.png`);
    if (i) img[k] = trim(i);
  }));
  [background, arena] = await Promise.all([load('img/background.jpg'), load('img/arena.jpg')]);
}

export function has(k) { return !!img[k]; }
export function spriteSize(k) { return img[k] ? { w: img[k].width, h: img[k].height } : null; }

// Draw sprite k centred at (x, y), `size` = the longer side in px.
export function sprite(ctx, k, x, y, size, { rot = 0, sx = 1, sy = 1, alpha = 1 } = {}) {
  const s = img[k];
  if (!s) return false;
  const scale = size / Math.max(s.width, s.height);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(scale * sx, scale * sy);
  ctx.drawImage(s, -s.width / 2, -s.height / 2);
  ctx.restore();
  return true;
}

// Soft additive glow.
export function glow(ctx, x, y, r, color, alpha = 1) {
  if (r <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${color},${0.55 * alpha})`);
  g.addColorStop(0.25, `rgba(${color},${0.28 * alpha})`);
  g.addColorStop(0.6, `rgba(${color},${0.08 * alpha})`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Four-point twinkle used for sparkles.
export function twinkle(ctx, x, y, r, color, alpha = 1, rot = 0) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.22 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Progress ring (e.g. how long the eyes have rested on a target).
export function ring(ctx, x, y, r, p, color, width = 5) {
  if (p <= 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowColor = color; ctx.shadowBlur = 12;
  ctx.strokeStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p)); ctx.stroke();
  ctx.restore();
}

export const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

// Sparkle particles with additive blending.
export class Sparks {
  constructor() { this.list = []; }
  burst(x, y, color, n = 24, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.35 + Math.random() * 0.8);
      this.list.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: 0.9 + Math.random() * 0.8, color, r: 3 + Math.random() * 6, rot: Math.random() * 6, kind: Math.random() < 0.5 ? 'tw' : 'dot' });
    }
  }
  trail(x, y, color) {
    this.list.push({ x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 20, vy: 10 + Math.random() * 20, life: 1, decay: 1.3 + Math.random(), color, r: 1.5 + Math.random() * 3, rot: 0, kind: 'dot' });
  }
  update(dt) {
    for (const p of this.list) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 1.8 * dt; p.vy = p.vy * (1 - 1.8 * dt) + 40 * dt;
      p.life -= dt * p.decay; p.rot += dt * 3;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
  draw(ctx) {
    for (const p of this.list) {
      const a = Math.max(0, p.life);
      if (p.kind === 'tw') twinkle(ctx, p.x, p.y, p.r * 1.6, p.color, a, p.rot);
      else {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }
}

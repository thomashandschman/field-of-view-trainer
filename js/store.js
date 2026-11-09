// Everything is kept on this device only (localStorage). Nothing leaves it.
const KEY = 'fireflyEyes.v1';

export const DEFAULT_SETTINGS = {
  lang: 'de',
  focus: 'both',          // both | h | v
  roundSec: 60,
  dailyMin: 12,
  headTol: 'normal',      // strict | normal | relaxed
  gazeTol: 'normal',
  allowTap: false,
  voice: true,
  sound: true,
  debugGaze: false,
  screenCm: '',
};

// Reach = how far from centre a target appears, as a fraction of the
// half-screen (0 = centre, 1 = edge). Kept per direction.
const DEFAULT_PROGRESS = {
  reach: { left: 0.55, right: 0.55, up: 0.5, down: 0.5 },
  pursuitSpeed: 1.0,      // rad/s of the moving target's path
  basketSpeed: 1.0,       // how fast the player dribbles across the court
  basketScore: 0,         // best score in one basketball round
  pendelSpeed: 1.0,       // how fast balls fall in the pendulum game
  pendelBest: 0,
  spotterMs: 1500,        // how long the bug stays visible
  stars: 0,
  stickers: [],
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      progress: { ...DEFAULT_PROGRESS, ...(raw.progress || {}), reach: { ...DEFAULT_PROGRESS.reach, ...(raw.progress?.reach || {}) } },
      sessions: raw.sessions || [],
      calibration: raw.calibration || null,
    };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, progress: structuredClone(DEFAULT_PROGRESS), sessions: [], calibration: null };
  }
}

export const state = load();

// v2 (Nov 2026): faster movement and wider starting reach, so the eyes are
// moved further. Lift older, slower progress once.
if ((state.progress.v || 1) < 2) {
  const p = state.progress;
  p.pursuitSpeed = Math.max(p.pursuitSpeed, DEFAULT_PROGRESS.pursuitSpeed);
  for (const d of Object.keys(DEFAULT_PROGRESS.reach)) p.reach[d] = Math.max(p.reach[d], DEFAULT_PROGRESS.reach[d]);
  p.v = 2;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: keep in memory */ }
}

export function resetProgress() {
  state.progress = structuredClone(DEFAULT_PROGRESS);
  state.sessions = [];
  save();
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function minutesToday() {
  const k = todayKey();
  return state.sessions.filter((s) => s.date.startsWith(k)).reduce((a, s) => a + s.seconds / 60, 0);
}

export function addSession(s) {
  state.sessions.push(s);
  if (state.sessions.length > 500) state.sessions.shift();
  save();
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function nudgeReach(dir, delta) {
  const r = state.progress.reach;
  r[dir] = clamp(+(r[dir] + delta).toFixed(3), 0.15, 0.95);
}

// Sticker book: every illustrated character in three colourways (27 stickers).
const STICKER_ART = ['owl', 'firefly', 'star', 'ladybug', 'butterfly', 'frog', 'hedgehog', 'bee', 'squirrel'];
export const STICKERS = [0, 1, 2].flatMap((v) => STICKER_ART.map((k) => ({ k, v })));
export const STICKER_FILTERS = ['none', 'hue-rotate(150deg) saturate(1.2)', 'sepia(1) saturate(4) hue-rotate(-12deg) brightness(1.15)'];
export const STARS_PER_STICKER = 12;
export const stickersOwned = (stars = state.progress.stars) => Math.min(STICKERS.length, Math.floor(stars / STARS_PER_STICKER));

// Face, head-pose and gaze tracking from the selfie camera using
// MediaPipe Face Landmarker (478 landmarks incl. irises, 52 blendshapes,
// and a 3D head transform). Runs fully on the device.
import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const DEG = 180 / Math.PI;

// Landmark indices (MediaPipe face mesh, image-space, not mirrored)
const EYE_A = { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 };
const EYE_B = { outer: 263, inner: 362, top: 386, bottom: 374, iris: 473 };

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Ridge least squares: y ≈ w0 + w1*x1 + w2*x2 (+ …)
function fitLinear(X, y, lambda = 0.002) {
  const n = X[0].length + 1;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  X.forEach((row, i) => {
    const r = [1, ...row];
    for (let a = 0; a < n; a++) {
      b[a] += r[a] * y[i];
      for (let c = 0; c < n; c++) A[a][c] += r[a] * r[c];
    }
  });
  for (let a = 1; a < n; a++) A[a][a] += lambda * X.length;
  // Gaussian elimination
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    const d = A[i][i] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i] / d;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  return b.map((v, i) => v / (A[i][i] || 1e-9));
}

const apply = (w, x) => w[0] + x.reduce((a, v, i) => a + v * w[i + 1], 0);
const featVec = (f) => [f.irisH, f.bsH, f.irisV, f.bsV];
// Features have very different ranges (iris ±0.1, blendshapes ±0.6), so they
// are standardised before the fit; otherwise regularisation mutes the iris.
const normFeat = (f, n) => featVec(f).map((v, i) => (v - n.mu[i]) / n.sd[i]);

export class Tracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.frame = { face: false };
    this.baseline = null;       // head pose captured during calibration
    this.calib = null;          // { wx, wy }
    this.offset = { x: 0, y: 0 }; // slow drift correction
    this.smooth = null;
    this.headTolDeg = 8;
    this.movedSince = 0;
    this.stillSince = 0;
    this.headMoved = false;
    this.headMoveCount = 0;
    this.distances = [];
    this.recent = [];
    this.settled = false;
    this.calibPose = null;
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    this.video.srcObject = stream;
    await this.video.play();
    this.stream = stream;
  }

  async loadModel() {
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  }

  get ready() { return !!this.landmarker; }

  // Call once per animation frame. Returns the latest frame object.
  update(now = performance.now()) {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || v.currentTime === this.lastVideoTime) return this.frame;
    this.lastVideoTime = v.currentTime;
    let res;
    try { res = this.landmarker.detectForVideo(v, now); } catch { return this.frame; }
    if (!res.faceLandmarks || !res.faceLandmarks.length) {
      this.frame = { face: false, t: now };
      this._updateHead(now, false);
      return this.frame;
    }
    const lm = res.faceLandmarks[0];
    const bs = {};
    (res.faceBlendshapes?.[0]?.categories || []).forEach((c) => { bs[c.categoryName] = c.score; });

    // --- Head pose from the 4x4 transform. Layout is detected so we do not
    // depend on row- vs column-major order; we only use deviations anyway.
    const m = res.facialTransformationMatrixes?.[0]?.data;
    let yaw = 0, pitch = 0, tx = 0, ty = 0, tz = -45;
    if (m) {
      const colMajor = Math.abs(m[14]) > Math.abs(m[11]);
      const f = colMajor ? [m[8], m[9], m[10]] : [m[2], m[6], m[10]];
      yaw = Math.atan2(f[0], f[2]) * DEG;
      pitch = Math.asin(Math.max(-1, Math.min(1, f[1]))) * DEG;
      [tx, ty, tz] = colMajor ? [m[12], m[13], m[14]] : [m[3], m[7], m[11]];
    }
    const dist = Math.abs(tz); // cm, approximate (adult face model)

    // --- Gaze features
    const eyeRatio = (e) => {
      const o = lm[e.outer], i = lm[e.inner], ir = lm[e.iris], tp = lm[e.top], bt = lm[e.bottom];
      // horizontal: project iris onto the image-left→image-right corner axis
      const L = o.x < i.x ? o : i, R = o.x < i.x ? i : o;
      const ax = R.x - L.x, ay = R.y - L.y;
      const h = ((ir.x - L.x) * ax + (ir.y - L.y) * ay) / (ax * ax + ay * ay);
      const v = (ir.y - tp.y) / Math.max(1e-4, bt.y - tp.y);
      return { h: h - 0.5, v: v - 0.5, open: Math.hypot(bt.x - tp.x, bt.y - tp.y) / Math.hypot(ax, ay) };
    };
    const a = eyeRatio(EYE_A), b = eyeRatio(EYE_B);
    const g = (k) => bs[k] || 0;
    const feat = {
      irisH: (a.h + b.h) / 2,
      irisV: (a.v + b.v) / 2,
      bsH: ((g('eyeLookOutLeft') - g('eyeLookInLeft')) + (g('eyeLookInRight') - g('eyeLookOutRight'))) / 2,
      bsV: ((g('eyeLookUpLeft') + g('eyeLookUpRight')) - (g('eyeLookDownLeft') + g('eyeLookDownRight'))) / 2,
    };
    const blinkScore = (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2;
    const blink = blinkScore > 0.45 || (a.open + b.open) / 2 < 0.12;

    const frame = { face: true, t: now, yaw, pitch, tx, ty, tz, dist, feat, blink, blinkScore, gaze: null };

    // --- Gaze in screen space (-1..1 from centre), once calibrated
    if (this.calib && !blink) {
      const raw = {
        x: apply(this.calib.wx, normFeat(feat, this.calib.norm)) + this.offset.x,
        y: apply(this.calib.wy, normFeat(feat, this.calib.norm)) + this.offset.y,
      };
      const k = 0.35;
      this.smooth = this.smooth ? { x: this.smooth.x + (raw.x - this.smooth.x) * k, y: this.smooth.y + (raw.y - this.smooth.y) * k } : raw;
      this.smooth.x = Math.max(-1.4, Math.min(1.4, this.smooth.x));
      this.smooth.y = Math.max(-1.4, Math.min(1.4, this.smooth.y));
    }
    frame.gaze = this.calib ? this.smooth : null;

    this.frame = frame;
    this._updateHead(now, true);
    if (dist > 10 && dist < 200 && this.distances.length < 5000) this.distances.push(dist);
    return frame;
  }

  // Head stillness with hysteresis, relative to the calibrated baseline.
  _updateHead(now, face) {
    const f = this.frame;
    if (!face || !this.baseline) {
      f.headDev = 0; f.headOk = face;
      return;
    }
    const dy = f.yaw - this.baseline.yaw;
    const dp = f.pitch - this.baseline.pitch;
    const dt = Math.hypot(f.tx - this.baseline.tx, f.ty - this.baseline.ty);
    // ~1.5 cm of sideways shift counts like ~4°, since it shifts the view the same way
    const dev = Math.max(Math.abs(dy), Math.abs(dp), dt * 2.6);
    f.headDev = dev;
    const tol = this.headTolDeg;
    if (!this.headMoved && dev > tol) {
      this.headMoved = true; this.movedSince = now; this.stillSince = 0; this.headMoveCount++;
      this.recent = [];
    } else if (this.headMoved) {
      if (dev < tol * 0.7) {
        if (!this.stillSince) this.stillSince = now;
        if (now - this.stillSince > 450) this.headMoved = false;
      } else this.stillSince = 0;
      // Settled somewhere new? If the head has been steady for a while at a
      // different place, report it so the app can adopt the new position
      // instead of waiting forever for the old one.
      this.recent.push({ t: now, yaw: f.yaw, pitch: f.pitch, tx: f.tx, ty: f.ty });
      while (this.recent.length && now - this.recent[0].t > 1400) this.recent.shift();
      if (this.headMoved && now - this.movedSince > 1500 && this.recent.length > 8 && now - this.recent[0].t > 1100) {
        const spread = (k) => Math.max(...this.recent.map((r) => r[k])) - Math.min(...this.recent.map((r) => r[k]));
        if (spread('yaw') < 3 && spread('pitch') < 3 && Math.hypot(spread('tx'), spread('ty')) < 1.5) this.settled = true;
      }
    }
    f.headOk = !this.headMoved;
  }

  // Degrees between the current head pose and the pose at calibration time.
  poseChangeSinceCalibration() {
    const c = this.calibPose, f = this.frame;
    if (!c || !f.face) return 0;
    return Math.max(Math.abs(f.yaw - c.yaw), Math.abs(f.pitch - c.pitch), Math.hypot(f.tx - c.tx, f.ty - c.ty) * 2.6);
  }

  // Adopt the current head position and re-aim the gaze so that what the
  // child looked at during `samples` (Ollie, in the centre) reads as centre.
  recenter(samples, { gaze = true } = {}) {
    const withGaze = samples.filter((s) => s.gaze).map((s) => ({ ...s.gaze }));
    if (samples.length) this.setBaseline(samples);
    // Only re-aim when the eyes were clearly resting on one spot (Ollie);
    // a wandering look would otherwise shift everything by mistake.
    const iqr = (a) => { const v = [...a].sort((p, q) => p - q); return v[Math.floor(v.length * 0.75)] - v[Math.floor(v.length * 0.25)]; };
    if (gaze && withGaze.length >= 8) {
      const xs = withGaze.map((g) => g.x), ys = withGaze.map((g) => g.y);
      const mx = median(xs), my = median(ys);
      if (iqr(xs) < 0.22 && iqr(ys) < 0.3 && Math.hypot(mx, my) < 0.8) {
        this.offset.x = Math.max(-0.7, Math.min(0.7, this.offset.x - mx * 0.85));
        this.offset.y = Math.max(-0.7, Math.min(0.7, this.offset.y - my * 0.85));
        this.smooth = null;
      }
    }
    this.settled = false;
    this.recent = [];
  }

  setBaseline(samples) {
    this.baseline = {
      yaw: median(samples.map((s) => s.yaw)),
      pitch: median(samples.map((s) => s.pitch)),
      tx: median(samples.map((s) => s.tx)),
      ty: median(samples.map((s) => s.ty)),
    };
    this.headMoved = false;
    this.settled = false;
    this.recent = [];
  }

  // points: [{x, y, samples:[frame…]}] with x,y in -1..1 screen space
  calibrate(points) {
    const rows = points.filter((p) => p.samples.length >= 4).map((p) => ({
      x: p.x, y: p.y,
      irisH: median(p.samples.map((s) => s.feat.irisH)),
      irisV: median(p.samples.map((s) => s.feat.irisV)),
      bsH: median(p.samples.map((s) => s.feat.bsH)),
      bsV: median(p.samples.map((s) => s.feat.bsV)),
    }));
    if (rows.length < 5) return { ok: false, reason: 'samples' };
    // Each screen axis uses all four eye readings, so a slightly tilted head
    // or camera (which mixes horizontal and vertical) is fitted too.
    const raw = rows.map(featVec);
    const mu = [0, 1, 2, 3].map((i) => raw.reduce((a, r) => a + r[i], 0) / raw.length);
    const sd = [0, 1, 2, 3].map((i) => Math.max(1e-3, Math.sqrt(raw.reduce((a, r) => a + (r[i] - mu[i]) ** 2, 0) / raw.length)));
    const norm = { mu, sd };
    const X = rows.map((r) => normFeat(r, norm));
    const wx = fitLinear(X, rows.map((r) => r.x), 0.03);
    const wy = fitLinear(X, rows.map((r) => r.y), 0.03);
    let ex = 0, ey = 0;
    rows.forEach((r, i) => {
      ex += (apply(wx, X[i]) - r.x) ** 2;
      ey += (apply(wy, X[i]) - r.y) ** 2;
    });
    const rmsX = Math.sqrt(ex / rows.length), rmsY = Math.sqrt(ey / rows.length);
    this.calib = { wx, wy, rmsX, rmsY, norm };
    this.offset = { x: 0, y: 0 };
    this.smooth = null;
    this.setBaseline(points.flatMap((p) => p.samples));
    this.calibPose = { ...this.baseline };
    return { ok: rmsX < 0.38 && rmsY < 0.5, rmsX, rmsY };
  }


  // Gentle drift correction while the child is known to be looking at a point.
  nudgeTowards(target, amount = 0.015) {
    const g = this.smooth;
    if (!g) return;
    amount = Math.min(amount, 0.015);
    this.offset.x += (target.x - g.x) * amount;
    this.offset.y += (target.y - g.y) * amount;
    this.offset.x = Math.max(-0.3, Math.min(0.3, this.offset.x));
    this.offset.y = Math.max(-0.3, Math.min(0.3, this.offset.y));
  }

  medianDistance() { return this.distances.length ? median(this.distances) : null; }

  resetSessionStats() { this.headMoveCount = 0; this.distances = []; }
}

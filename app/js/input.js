// GeoGrasp — unified pointer: hand tracking (MediaPipe, fully offline) or mouse/touch.
// The camera image is processed in memory frame-by-frame and immediately discarded.
// Nothing is recorded, stored or transmitted. (GPL-3.0-or-later)

const PINCH_ON = 0.32;   // thumb–index distance / palm size to start a grab
const PINCH_OFF = 0.46;  // ...and to release it (hysteresis)

class Pointer {
  constructor() {
    this.x = innerWidth / 2; this.y = innerHeight / 2;
    this.down = false; this.visible = false;
    this.source = 'mouse';
    this.handSeen = false; this.lastHandAt = 0;
    this.landmarks = null;
    this.cameraOn = false;
    this.stream = null; this.video = null; this.landmarker = null;
    this.listeners = { down: new Set(), up: new Set() };
    this.sx = null; this.sy = null;
    this.bindMouse();
  }

  on(evt, fn) { this.listeners[evt].add(fn); return () => this.listeners[evt].delete(fn); }
  emit(evt) { this.listeners[evt].forEach((fn) => fn(this)); }

  setDown(d) {
    if (d === this.down) return;
    this.down = d;
    // A pinch over an on-screen button "presses" it, so the whole game can be
    // navigated by hand.
    if (this.source === 'hand') {
      if (d) {
        const hit = document.elementFromPoint(this.x, this.y);
        const el = hit && hit.closest('button, .chip, a');
        if (el) { this.consumed = true; el.click(); return; }
      } else if (this.consumed) { this.consumed = false; return; }
    }
    this.emit(d ? 'down' : 'up');
  }

  bindMouse() {
    const move = (e) => {
      this.x = e.clientX; this.y = e.clientY; this.visible = true; this.source = 'mouse'; this.lastMouseAt = performance.now();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', (e) => {
      if (e.target.closest && e.target.closest('button, input, select, a, .modal, .panel, .tray-btn')) return;
      if (e.target.id !== 'stage' && !e.target.closest('#stage-wrap')) return;
      move(e); this.setDown(true);
    });
    window.addEventListener('pointerup', (e) => { if (this.source === 'mouse') { move(e); this.setDown(false); } });
    window.addEventListener('blur', () => { if (this.source === 'mouse') this.setDown(false); });
  }

  /** Start camera + hand tracking. Resolves true on success. */
  async startCamera(onStatus = () => {}) {
    if (this.cameraOn) return true;
    try {
      onStatus('loading');
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false,
      });
      this.video = document.getElementById('cam-video');
      this.video.srcObject = this.stream;
      await this.video.play();
      if (!this.landmarker) {
        const vision = await import('../vendor/vision_bundle.mjs');
        const fileset = await vision.FilesetResolver.forVisionTasks(new URL('../vendor/wasm', import.meta.url).href);
        const make = (delegate) => vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: new URL('../vendor/hand_landmarker.task', import.meta.url).href, delegate },
          runningMode: 'VIDEO', numHands: 1,
          minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        });
        try { this.landmarker = await make('GPU'); } catch { this.landmarker = await make('CPU'); }
      }
      this.cameraOn = true;
      this.loop();
      onStatus('on');
      return true;
    } catch (err) {
      console.warn('camera unavailable', err);
      this.stopCamera();
      onStatus('fail');
      return false;
    }
  }

  /** Stop every camera track — the camera light turns off immediately. */
  stopCamera() {
    this.cameraOn = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.landmarks = null; this.handSeen = false;
    if (this.source === 'hand') { this.setDown(false); this.source = 'mouse'; }
  }

  loop() {
    if (!this.cameraOn) return;
    this.raf = requestAnimationFrame(() => this.loop());
    const v = this.video;
    if (!v || v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    let res;
    try { res = this.landmarker.detectForVideo(v, performance.now()); } catch { return; }
    const lm = res && res.landmarks && res.landmarks[0];
    const now = performance.now();
    if (!lm) {
      this.landmarks = null;
      if (this.handSeen && now - this.lastHandAt > 400) {
        this.handSeen = false;
        if (this.source === 'hand') { this.setDown(false); this.visible = false; }
      }
      return;
    }
    this.landmarks = lm;
    this.handSeen = true; this.lastHandAt = now;
    // Ignore the hand briefly if the mouse was just used.
    if (this.lastMouseAt && now - this.lastMouseAt < 600) return;

    const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
    const palm = Math.max(0.02, (d(0, 5) + d(0, 17) + d(5, 17)) / 3);
    const pinch = d(4, 8) / palm;
    // Cursor follows the point between thumb and index fingertip (stable while pinching).
    const px = (lm[4].x + lm[8].x) / 2, py = (lm[4].y + lm[8].y) / 2;
    // Mirror horizontally and map the middle 76% of the camera to the whole screen.
    const m = 0.12;
    let nx = 1 - (px - m) / (1 - 2 * m), ny = (py - m) / (1 - 2 * m);
    nx = Math.min(1, Math.max(0, nx)); ny = Math.min(1, Math.max(0, ny));
    const tx = nx * innerWidth, ty = ny * innerHeight;
    // Adaptive smoothing: steady when still, responsive when moving fast.
    if (this.sx === null) { this.sx = tx; this.sy = ty; }
    const speed = Math.hypot(tx - this.sx, ty - this.sy);
    const a = Math.min(0.85, 0.22 + speed / 160);
    this.sx += (tx - this.sx) * a; this.sy += (ty - this.sy) * a;
    this.x = this.sx; this.y = this.sy;
    this.visible = true; this.source = 'hand';
    this.pinch = pinch;
    if (!this.down && pinch < PINCH_ON) this.setDown(true);
    else if (this.down && pinch > PINCH_OFF) this.setDown(false);
  }

  /** Draw the small mirrored camera preview with the hand skeleton. */
  drawPreview(canvas) {
    const g = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    if (!this.cameraOn || !this.video) return;
    g.save();
    g.translate(w, 0); g.scale(-1, 1);
    g.globalAlpha = 0.9;
    g.drawImage(this.video, 0, 0, w, h);
    g.restore();
    const lm = this.landmarks;
    if (!lm) return;
    const P = (i) => [(1 - lm[i].x) * w, lm[i].y * h];
    const bones = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    for (const [a, b] of bones) { const [x1, y1] = P(a), [x2, y2] = P(b); g.moveTo(x1, y1); g.lineTo(x2, y2); }
    g.stroke();
    for (let i = 0; i < 21; i++) {
      const [x, y] = P(i);
      g.fillStyle = i === 4 || i === 8 ? (this.down ? '#ffd23f' : '#4be3c1') : '#ffffff';
      g.beginPath(); g.arc(x, y, i === 4 || i === 8 ? 4.5 : 2.5, 0, Math.PI * 2); g.fill();
    }
  }
}

export const pointer = new Pointer();
// Make sure the camera is released whenever the page goes away.
window.addEventListener('pagehide', () => pointer.stopCamera());
window.addEventListener('beforeunload', () => pointer.stopCamera());

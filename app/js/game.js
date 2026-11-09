// GeoGrasp — gameplay for Easy / Medium / Hard (continents) / Capital Cities (GPL-3.0-or-later)
import { t, getLang } from './i18n.js';
import { audio } from './audio.js';
import { pointer } from './input.js';
import { stats } from './storage.js';
import { drawOcean, drawPiece, colorFor } from './map.js';

const TURN_SECONDS = 120;
const HIT = document.createElement('canvas').getContext('2d'); // identity-transform hit testing
const ease = (x) => 1 - Math.pow(1 - x, 3);
const easeBack = (x) => { const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const nameOf = (it) => (getLang() === 'ja' ? it.ja : it.en);
const otherName = (it) => (getLang() === 'ja' ? it.en : it.ja);

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath();
}

export class Game {
  constructor(app) {
    this.app = app; // { map, hud, showResults, onExit, size() }
    this.map = app.map;
    this.cache = document.createElement('canvas');
    this.particles = [];
    this.floaters = [];
    this.anims = [];
    this.active = false;
    this.unsub = [];
  }

  // ------------------------------------------------------------------ lifecycle
  start({ mode, region }) {
    this.mode = mode; // easy | medium | hard | capitals
    this.region = mode === 'hard' ? 'world' : region;
    this.score = 0; this.right = 0; this.wrong = 0; this.log = [];
    this.wrongCount = new Map();
    this.placed = new Set();
    this.held = null; this.hover = null; this.dwell = 0;
    this.particles = []; this.floaters = []; this.anims = [];
    this.paused = false; this.done = false; this.locked = false;
    this.startedAt = performance.now(); this.activeMs = 0;
    this.active = true;
    this.layout();
    this.unsub.push(pointer.on('down', () => this.onDown()), pointer.on('up', () => this.onUp()));
    this.app.hud.show(mode);
    this.app.hud.setScore(0);
    if (mode === 'capitals') this.setupCapitals(); else this.setupPuzzle();
    this.nextTurn(true);
  }

  stop(save = true) {
    if (!this.active) return;
    this.active = false;
    this.unsub.forEach((u) => u()); this.unsub = [];
    audio.stopVoice();
    this.app.hud.hide();
    if (save && (this.right + this.wrong > 0)) this.saveSession();
  }

  saveSession() {
    stats.addTime(this.activeMs);
    stats.addSession({
      date: new Date().toISOString(), mode: this.mode, region: this.region, ms: Math.round(this.activeMs),
      score: this.score, right: this.right, wrong: this.wrong, done: this.done, log: this.log.slice(0, 400),
    });
  }

  setPaused(p) { this.paused = p; }

  // ------------------------------------------------------------------ layout
  layout() {
    const { W, H } = this.app.size();
    this.W = W; this.H = H;
    const top = 76;
    const hasTray = this.mode !== 'capitals';
    this.trayW = hasTray ? Math.round(Math.min(300, Math.max(210, W * 0.19))) : 0;
    this.mapRect = { x: 8, y: top, w: W - this.trayW - 16, h: H - top - 10 };
    this.map.layout(this.mapRect, this.region);
    this.trayRect = { x: W - this.trayW - 4, y: top, w: this.trayW - 8, h: H - top - 12 };
    const dpr = window.devicePixelRatio || 1;
    this.cache.width = Math.round(W * dpr); this.cache.height = Math.round(H * dpr);
    this.layoutTray();
    this.dirty = true;
  }

  layoutTray() {
    if (!this.trayRect || this.mode === 'capitals') return;
    const n = this.mode === 'hard' ? 7 : this.mode === 'medium' ? 4 : 5;
    const r = this.trayRect, head = 54, pad = 12;
    const sh = Math.min(150, (r.h - head - pad) / n - pad);
    this.slots = Array.from({ length: n }, (_, i) => ({ x: r.x + pad, y: r.y + head + i * (sh + pad), w: r.w - pad * 2, h: sh }));
    (this.tray || []).forEach((p, i) => { if (p) p.slot = this.slots[i]; });
  }

  pieceScale(it, slot) {
    const bw = it.bounds[1][0] - it.bounds[0][0], bh = it.bounds[1][1] - it.bounds[0][1];
    return Math.min((slot.w * 0.78) / bw, (slot.h * 0.74) / bh, 9);
  }
  dragScale(it) {
    // True map scale, but tiny countries are enlarged so little hands can see them.
    return Math.min(4, Math.max(1, 34 / Math.max(1, it.size)));
  }

  // ------------------------------------------------------------------ setup
  setupPuzzle() {
    const M = this.map;
    if (this.mode === 'hard') {
      this.items = M.continents.filter((c) => c.main2d);
      this.background = [];
      this.prefilled = new Set();
    } else {
      const inRegion = (c) => this.region === 'world' || c.cont === this.region;
      const minSize = this.region === 'world' ? 7 : 6;
      this.items = M.countries.filter((c) => c.play && inRegion(c) && c.onScreen && c.size >= minSize && c.main2d);
      const itemSet = new Set(this.items);
      this.prefilled = new Set(M.countries.filter((c) => inRegion(c) && !itemSet.has(c) && c.cont !== 'antarctica').map((c) => c.cca3));
      this.background = M.countries.filter((c) => !inRegion(c) || c.cont === 'antarctica');
    }
    // Big, recognisable pieces first, but shuffled in small groups.
    const sorted = [...this.items].sort((a, b) => b.parea - a.parea);
    this.queue = [];
    for (let i = 0; i < sorted.length; i += 8) this.queue.push(...shuffle(sorted.slice(i, i + 8)));
    if (this.mode !== 'easy') this.queue = shuffle(this.queue);
    this.tray = [];
    this.total = this.items.length;
  }

  setupCapitals() {
    const M = this.map;
    const inRegion = (c) => this.region === 'world' || c.cont === this.region;
    this.items = M.countries.filter((c) => c.play && inRegion(c) && c.onScreen && c.capEn && c.size >= 9);
    this.queue = shuffle([...this.items]).slice(0, 10);
    this.total = this.queue.length;
    this.asked = 0;
    this.background = M.countries.filter((c) => !inRegion(c));
    this.prefilled = new Set();
    this.answered = new Set();
  }

  // ------------------------------------------------------------------ turns
  nextTurn(first = false) {
    if (!this.active) return;
    this.turnStart = performance.now(); this.turnPausedMs = 0;
    this.lastTick = null;
    this.hintFor = null;
    if (this.mode === 'capitals') return this.nextCapital();

    const remaining = this.items.filter((c) => !this.placed.has(c.cca3));
    if (remaining.length === 0) return this.finish();
    const slotsN = this.slots.length;

    if (this.mode === 'easy') {
      // keep pieces already in the tray; fill empty slots from the queue
      this.tray = this.tray.filter((p) => p && !this.placed.has(p.item.cca3));
      this.tray.forEach((p, i) => { p.slot = this.slots[i]; });
      while (this.tray.length < slotsN && this.queue.length) this.addTray(this.queue.shift());
      this.target = null;
      this.app.hud.setTitle(t('pickPiece'), pointer.cameraOn ? t('pinchHint') : t('mouseHint'));
      if (first) audio.say('pick', t('pickPiece'));
    } else {
      // Medium & Hard: the voice names one target; the tray offers it among others.
      this.queue = this.queue.filter((c) => !this.placed.has(c.cca3));
      this.target = this.queue.shift();
      const others = remaining.filter((c) => c !== this.target);
      let picks;
      if (this.mode === 'hard') picks = others;
      else {
        const same = shuffle(others.filter((c) => c.cont === this.target.cont));
        const rest = shuffle(others.filter((c) => c.cont !== this.target.cont));
        picks = [...same, ...rest].slice(0, slotsN - 1);
      }
      this.tray = [];
      shuffle([this.target, ...picks]).slice(0, slotsN).forEach((it) => this.addTray(it));
      this.app.hud.setTitle(this.mode === 'hard' ? t('listenCont') : t('listen'), '', true);
      this.sayTarget();
    }
    this.updateProgress();
  }

  sayTarget() {
    if (!this.target) return;
    audio.say(`f_${this.target.cca3}`, this.mode === 'hard' ? nameOf(this.target) : nameOf(this.target));
  }
  replay() {
    if (this.mode === 'capitals' && this.current) audio.say(`c_${this.current.cca3}`, `${t('capitalIs')} ${this.capName(this.current)}. ${t('whichCountry')}`);
    else if (this.target) this.sayTarget();
    else audio.say('pinch', t('pinchHint'));
  }

  addTray(item) {
    const i = this.tray.length;
    const slot = this.slots[i];
    this.tray.push({ item, slot, appear: performance.now() + i * 70, hoverT: 0 });
  }

  updateProgress() {
    if (this.mode === 'capitals') this.app.hud.setProgress(`${t('question')} ${Math.min(this.asked, this.total)} / ${this.total}`);
    else this.app.hud.setProgress(`${t('placed')} ${this.placed.size} / ${this.total}`);
  }

  turnRemaining() {
    if (this.locked) return this.frozenRemaining ?? TURN_SECONDS;
    const el = (performance.now() - this.turnStart - this.turnPausedMs) / 1000;
    return Math.max(0, TURN_SECONDS - el);
  }

  // ------------------------------------------------------------------ input
  trayPieceAt(x, y) {
    if (!this.tray) return null;
    return this.tray.find((p) => p && !p.gone && x >= p.slot.x && x <= p.slot.x + p.slot.w && y >= p.slot.y && y <= p.slot.y + p.slot.h);
  }

  onDown() {
    if (!this.active || this.paused || this.locked || this.done) return;
    const { x, y } = pointer;
    if (this.mode === 'capitals') { if (this.hover) this.answerCapital(this.hover); return; }
    if (this.held) return;
    const p = this.trayPieceAt(x, y);
    if (!p) return;
    const it = p.item;
    p.gone = true;
    const s0 = this.pieceScale(it, p.slot);
    this.held = { piece: p, item: it, x, y, scale: s0, target: this.dragScale(it), since: performance.now() };
    if (this.mode === 'easy') this.lastPicked = it;
    audio.sfx('pickup');
  }

  onUp() {
    if (!this.held || !this.active) return;
    const h = this.held; this.held = null;
    const { x, y } = pointer;
    const it = h.item;
    const overTray = x > this.trayRect.x - 10;
    if (overTray) { this.returnPiece(h, false); return; }
    const d = Math.hypot(x - it.cen[0], y - it.cen[1]);
    const tol = this.mode === 'easy' ? Math.max(34, it.size * 0.42) : this.mode === 'hard' ? Math.max(44, it.size * 0.28) : Math.max(26, it.size * 0.36);
    HIT.setTransform(1, 0, 0, 1, 0, 0);
    const inside = it.main2d && HIT.isPointInPath(it.main2d, x, y);
    const isTarget = this.mode === 'easy' || it === this.target;
    if (isTarget && (d <= tol || inside)) this.correct(it, h);
    else {
      let why = 'placed', other = null;
      if (this.mode !== 'easy' && it !== this.target) { why = 'chose'; other = it.cca3; }
      else {
        const under = this.mode === 'hard' ? this.map.countryAt(HIT, x, y, this.map.continents) : this.map.countryAt(HIT, x, y);
        other = under ? under.cca3 : null;
      }
      this.miss(this.mode === 'easy' ? it : this.target, why, other);
      this.returnPiece(h, true);
    }
  }

  returnPiece(h, wrong) {
    const p = h.piece;
    const s1 = this.pieceScale(h.item, p.slot);
    const from = { x: pointer.x, y: pointer.y, s: h.scale };
    this.anims.push({ type: 'return', item: h.item, from, to: { x: p.slot.x + p.slot.w / 2, y: p.slot.y + p.slot.h / 2, s: s1 }, t0: performance.now(), dur: wrong ? 520 : 320, done: () => { p.gone = false; p.wobble = wrong ? performance.now() : 0; } });
    audio.sfx(wrong ? 'wrong' : 'drop');
  }

  // ------------------------------------------------------------------ outcomes
  itemKey(it) { return (this.mode === 'hard' ? 'continent:' : this.mode === 'capitals' ? 'capital:' : 'country:') + it.cca3; }

  correct(it, h) {
    const firstTry = !this.wrongCount.get(it.cca3);
    const remain = this.turnRemaining();
    const pts = 100 + Math.round(remain) + (firstTry ? 50 : 0);
    this.score += pts; this.right++;
    this.log.push({ k: it.cca3, ok: true });
    stats.mark(this.itemKey(it), true);
    this.locked = true; this.frozenRemaining = remain;
    this.flyHome(it, { x: pointer.x, y: pointer.y, s: h.scale }, () => {
      this.placed.add(it.cca3);
      this.tray = this.tray.filter((p) => p.item !== it);
      this.dirty = true;
      this.burst(it.cen[0], it.cen[1], colorFor(it.cont, it.idx), it.size);
      this.floaters.push({ x: it.cen[0], y: it.cen[1] - 10, text: `+${pts}`, t0: performance.now() });
      this.app.hud.setScore(this.score);
      this.app.hud.setTitle(nameOf(it), otherName(it), false, true);
      audio.sfx('correct');
      this.updateProgress();
      // Speak the name with a natural recorded voice, then continue.
      audio.say(`n_${it.cca3}`, nameOf(it)).then(() => new Promise((r) => setTimeout(r, 450))).then(() => {
        if (!this.active) return;
        this.locked = false;
        this.nextTurn();
      });
    });
  }

  flyHome(it, from, done) {
    this.anims.push({ type: 'home', item: it, from, to: { x: it.cen[0], y: it.cen[1], s: 1 }, t0: performance.now(), dur: 420, done });
  }

  miss(it, why, other) {
    this.wrong++;
    this.wrongCount.set(it.cca3, (this.wrongCount.get(it.cca3) || 0) + 1);
    this.log.push({ k: it.cca3, ok: false, why, other });
    stats.mark(this.itemKey(it), false);
    if (this.wrongCount.get(it.cca3) >= (this.mode === 'easy' ? 2 : 3)) this.hintFor = it;
    this.app.hud.flash(t('wrongTry'));
    audio.say('try', t('wrongTry'));
  }

  timeUp() {
    audio.sfx('timeup');
    if (this.mode === 'capitals') {
      const it = this.current;
      this.miss(it, 'timeout', null);
      return this.revealCapital(it);
    }
    const inTray = (x) => x && this.tray.some((p) => p.item === x);
    let it = this.held ? this.held.item : this.target || (inTray(this.lastPicked) ? this.lastPicked : this.tray[0] && this.tray[0].item);
    if (!it) return this.nextTurn();
    let from;
    if (this.held && this.held.item === it) { from = { x: pointer.x, y: pointer.y, s: this.held.scale }; this.held = null; }
    else {
      const p = this.tray.find((q) => q.item === it);
      if (this.held) { this.returnPiece(this.held, false); this.held = null; }
      from = p ? { x: p.slot.x + p.slot.w / 2, y: p.slot.y + p.slot.h / 2, s: this.pieceScale(it, p.slot) } : { x: it.cen[0], y: it.cen[1], s: 1 };
      if (p) p.gone = true;
    }
    this.wrong++;
    this.log.push({ k: it.cca3, ok: false, why: 'timeout' });
    stats.mark(this.itemKey(it), false);
    this.locked = true; this.frozenRemaining = 0;
    this.app.hud.flash(t('timeUp'));
    this.anims.push({ type: 'home', item: it, from, to: { x: it.cen[0], y: it.cen[1], s: 1 }, t0: performance.now(), dur: 1300, done: () => {
      this.placed.add(it.cca3);
      this.tray = this.tray.filter((p) => p.item !== it);
      this.dirty = true;
      this.app.hud.setTitle(nameOf(it), otherName(it), false, true);
      this.updateProgress();
      audio.say(`n_${it.cca3}`, nameOf(it)).then(() => setTimeout(() => { if (this.active) { this.locked = false; this.nextTurn(); } }, 700));
    } });
    audio.say('timeup', t('timeUp'));
  }

  finish() {
    this.done = true; this.locked = true;
    audio.sfx('complete');
    for (let i = 0; i < 6; i++) setTimeout(() => this.burst(this.mapRect.x + Math.random() * this.mapRect.w, this.mapRect.y + Math.random() * this.mapRect.h * 0.7, `hsl(${Math.random() * 360},90%,65%)`, 120), i * 250);
    this.app.hud.setTitle(t('complete'), '', false, true);
    audio.say('complete', t('complete')).then(() => setTimeout(() => {
      if (!this.active) return;
      this.saveSession();
      this.active = false;
      this.unsub.forEach((u) => u()); this.unsub = [];
      this.app.showResults({ score: this.score, right: this.right, wrong: this.wrong, ms: this.activeMs, mode: this.mode });
    }, 1200));
  }

  // ------------------------------------------------------------------ capitals
  capName(c) { return getLang() === 'ja' ? c.capJa : c.capEn; }

  nextCapital() {
    if (this.asked >= this.total || !this.queue.length) return this.finish();
    this.current = this.queue.shift();
    this.asked++;
    this.updateProgress();
    this.dwell = 0; this.hover = null; this.flashBad = null;
    this.app.hud.setTitle(`${t('capitalIs')} ${this.capName(this.current)}`, t('whichCountry'), false, false, '🏛️');
    audio.say(`c_${this.current.cca3}`, `${t('capitalIs')} ${this.capName(this.current)}. ${t('whichCountry')}`);
  }

  answerCapital(c) {
    if (this.locked) return;
    const it = this.current;
    if (c === it) {
      const firstTry = !this.wrongCount.get(it.cca3);
      const pts = 100 + Math.round(this.turnRemaining()) + (firstTry ? 50 : 0);
      this.score += pts; this.right++;
      this.log.push({ k: it.cca3, ok: true });
      stats.mark(this.itemKey(it), true);
      this.app.hud.setScore(this.score);
      this.floaters.push({ x: it.cen[0], y: it.cen[1] - 10, text: `+${pts}`, t0: performance.now() });
      audio.sfx('correct');
      this.burst(it.cen[0], it.cen[1], colorFor(it.cont, it.idx), it.size);
      this.revealCapital(it, true);
    } else {
      this.flashBad = { c, t0: performance.now() };
      this.wrong++;
      this.wrongCount.set(it.cca3, (this.wrongCount.get(it.cca3) || 0) + 1);
      this.log.push({ k: it.cca3, ok: false, why: 'answered', other: c.cca3 });
      stats.mark(this.itemKey(it), false);
      audio.sfx('wrong');
      this.app.hud.flash(`${nameOf(c)} ✗`);
      if (this.wrongCount.get(it.cca3) >= 3) this.revealCapital(it);
      else audio.say('try', t('wrongTry'));
      this.dwell = 0;
    }
  }

  revealCapital(it, ok = false) {
    this.locked = true; this.frozenRemaining = this.turnRemaining();
    this.answered.add(it.cca3); this.dirty = true;
    this.revealed = { c: it, t0: performance.now() };
    this.app.hud.setTitle(nameOf(it), `${t('capitalOf')}: ${this.capName(it)}`, false, true);
    this.app.showFlagCard(it, ok);
    audio.say(`t_${it.cca3}`, `${nameOf(it)}. ${t('capitalIs')} ${this.capName(it)}.`).then(() => setTimeout(() => {
      if (!this.active) return;
      this.app.hideFlagCard();
      this.revealed = null; this.locked = false;
      this.nextTurn();
    }, 1400));
  }

  // ------------------------------------------------------------------ effects
  burst(x, y, color, size = 40) {
    const n = Math.min(60, 22 + size / 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 5.5;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: 1, decay: 0.012 + Math.random() * 0.018, size: 3 + Math.random() * 6, color: Math.random() < 0.4 ? '#ffffff' : Math.random() < 0.5 ? '#ffe066' : color, star: Math.random() < 0.6, rot: Math.random() * 6 });
    }
  }

  // ------------------------------------------------------------------ rendering
  rebuildCache() {
    const g = this.cache.getContext('2d');
    const dpr = this.cache.width / this.W;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const M = this.map;
    drawOcean(g, this.W, this.H, M);
    g.lineJoin = 'round';
    // decor & background (not part of this puzzle)
    for (const d of M.decor) { g.fillStyle = 'rgba(240,230,200,0.25)'; g.fill(d); }
    for (const c of this.background) {
      if (!c.p2d) continue;
      g.fillStyle = c.cont === 'antarctica' ? 'rgba(235,245,255,0.55)' : 'rgba(225,215,190,0.28)';
      g.fill(c.p2d);
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 0.5; g.stroke(c.p2d);
    }
    if (this.mode === 'hard') {
      for (const ct of M.continents) {
        if (!ct.p2d) continue;
        if (this.placed.has(ct.cca3)) {
          drawPiece(g, ct.p2d, colorFor(ct.cont, ct.idx), { bounds: ct.bounds, lw: 1.4 });
          g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.4;
          for (const c of M.countries) if (c.cont === ct.cont && c.p2d) g.stroke(c.p2d);
        } else {
          g.fillStyle = 'rgba(255,255,255,0.06)'; g.fill(ct.p2d);
          g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 0.8; g.stroke(ct.p2d); g.setLineDash([]);
        }
      }
      return;
    }
    const capitals = this.mode === 'capitals';
    const itemSet = new Set(this.items.map((c) => c.cca3));
    for (const c of M.countries) {
      if (!c.p2d || this.background.includes(c)) continue;
      const placed = this.placed.has(c.cca3) || this.prefilled.has(c.cca3);
      if (capitals) {
        const ans = this.answered.has(c.cca3);
        g.fillStyle = colorFor(c.cont, c.idx, ans ? 0 : 6, ans ? 1 : 0.8);
        g.fill(c.p2d);
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 0.7; g.stroke(c.p2d);
      } else if (placed) {
        drawPiece(g, c.p2d, colorFor(c.cont, c.idx, this.prefilled.has(c.cca3) ? -6 : 0, this.prefilled.has(c.cca3) ? 0.75 : 1), { bounds: c.bounds, lw: 0.8 });
      } else if (itemSet.has(c.cca3)) {
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill(c.p2d);
        g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 0.8; g.stroke(c.p2d);
      }
    }
    if (capitals) {
      for (const c of M.countries) {
        if (!this.answered.has(c.cca3) || !c.capXY) continue;
        g.fillStyle = '#fff'; g.strokeStyle = '#d33'; g.lineWidth = 2;
        star(g, c.capXY[0], c.capXY[1], 6); g.fill(); g.stroke();
      }
    }
  }

  frame(g, dt) {
    if (!this.map.proj) return;
    const now = performance.now();
    if (!this.paused && this.active && !this.done) this.activeMs += dt;
    if (this.paused) { this.turnPausedMs += dt; }
    if (this.dirty) { this.rebuildCache(); this.dirty = false; }
    g.drawImage(this.cache, 0, 0, this.W, this.H);

    // timer
    if (this.active && !this.done) {
      const rem = this.turnRemaining();
      this.app.hud.setTimer(rem, TURN_SECONDS);
      if (!this.locked && !this.paused) {
        const s = Math.ceil(rem);
        if (s <= 10 && s !== this.lastTick && s > 0) { this.lastTick = s; audio.sfx('tick'); }
        if (rem <= 0) this.timeUp();
      }
    }

    if (this.mode === 'capitals') this.frameCapitals(g, now, dt);

    // hint pulse on the target position after repeated mistakes
    if (this.hintFor && !this.placed.has(this.hintFor.cca3)) {
      const it = this.hintFor, k = 0.5 + 0.5 * Math.sin(now / 220);
      g.save();
      g.shadowColor = '#ffe066'; g.shadowBlur = 18 * k;
      g.strokeStyle = `rgba(255,224,102,${0.5 + 0.5 * k})`; g.lineWidth = 2.5;
      g.stroke(it.main2d);
      g.beginPath(); g.arc(it.cen[0], it.cen[1], 16 + 16 * k + it.size * 0.2, 0, Math.PI * 2); g.stroke();
      g.restore();
    }

    if (this.mode !== 'capitals') this.drawTray(g, now);

    // flying pieces
    this.anims = this.anims.filter((a) => {
      const k = Math.min(1, (now - a.t0) / a.dur);
      const e = a.type === 'return' ? easeBack(k) : ease(k);
      const x = a.from.x + (a.to.x - a.from.x) * e, y = a.from.y + (a.to.y - a.from.y) * e - Math.sin(k * Math.PI) * (a.type === 'home' ? 30 : 0);
      const s = a.from.s + (a.to.s - a.from.s) * e;
      this.drawItem(g, a.item, x, y, s, a.type === 'home' ? 1 - k : 0.6);
      if (k >= 1) { a.done && a.done(); return false; }
      return true;
    });

    // held piece
    if (this.held) {
      const h = this.held;
      h.scale += (h.target - h.scale) * Math.min(1, dt / 90);
      const bob = 1 + Math.sin(now / 260) * 0.015;
      this.drawItem(g, h.item, pointer.x, pointer.y, h.scale * bob, 1);
    }

    this.drawParticles(g, dt);
    this.drawCursor(g, now);
  }

  drawItem(g, it, x, y, s, shadow = 1) {
    g.save();
    g.translate(x - it.cen[0] * s, y - it.cen[1] * s);
    g.scale(s, s);
    if (shadow > 0) {
      g.save();
      g.shadowColor = `rgba(0,10,30,${0.45 * shadow})`; g.shadowBlur = 18 * shadow; g.shadowOffsetY = 12 * shadow;
      g.fillStyle = colorFor(it.cont, it.idx); g.fill(it.main2d);
      g.restore();
    }
    drawPiece(g, it.main2d, colorFor(it.cont, it.idx), { bounds: it.bounds, scale: s, lw: 1.6 });
    g.restore();
  }

  drawTray(g, now) {
    const r = this.trayRect;
    g.save();
    roundRect(g, r.x, r.y, r.w, r.h, 22);
    const bg = g.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    bg.addColorStop(0, 'rgba(255,255,255,0.20)'); bg.addColorStop(1, 'rgba(255,255,255,0.08)');
    g.fillStyle = bg; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#ffffff'; g.font = '600 18px Fredoka, "M PLUS Rounded 1c", sans-serif'; g.textAlign = 'center';
    g.fillText(this.mode === 'hard' ? `🌍 ${t('continent')}` : '🧩', r.x + r.w / 2, r.y + 34);
    const hoverP = !this.held && !this.locked ? this.trayPieceAt(pointer.x, pointer.y) : null;
    for (const p of this.tray) {
      if (!p || !p.slot) continue;
      const s = p.slot;
      const appear = Math.min(1, Math.max(0, (now - p.appear) / 380));
      if (appear <= 0) continue;
      p.hoverT += ((p === hoverP ? 1 : 0) - p.hoverT) * 0.2;
      const lift = p.hoverT;
      g.save();
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const sc = easeBack(appear) * (1 + lift * 0.05);
      g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
      roundRect(g, s.x, s.y, s.w, s.h, 16);
      g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 10 + lift * 12; g.shadowOffsetY = 4 + lift * 4;
      g.fillStyle = p.gone ? 'rgba(255,255,255,0.18)' : `rgba(255,255,255,${0.88 + lift * 0.1})`;
      g.fill();
      g.shadowColor = 'transparent';
      if (lift > 0.05) { g.strokeStyle = `rgba(255,224,102,${lift})`; g.lineWidth = 3; g.stroke(); }
      if (!p.gone) {
        let wob = 0;
        if (p.wobble) { const k = (now - p.wobble) / 500; if (k < 1) wob = Math.sin(k * 20) * (1 - k) * 0.12; else p.wobble = 0; }
        const it = p.item, ps = this.pieceScale(it, s);
        g.translate(cx, cy); g.rotate(wob); g.translate(-cx, -cy);
        this.drawItem(g, it, cx, cy, ps, 0);
      }
      g.restore();
    }
    g.restore();
  }

  frameCapitals(g, now, dt) {
    const { x, y } = pointer;
    let hov = null;
    if (!this.locked && pointer.visible && x < this.W) {
      HIT.setTransform(1, 0, 0, 1, 0, 0);
      hov = this.map.countryAt(HIT, x, y, this.items) || this.map.nearest(x, y, this.items, 14);
    }
    if (hov !== this.hover) { this.hover = hov; this.dwell = 0; if (hov) audio.sfx('hover'); }
    if (hov) {
      g.save();
      g.shadowColor = '#fff'; g.shadowBlur = 14;
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill(hov.p2d);
      g.strokeStyle = '#ffffff'; g.lineWidth = 2.2; g.stroke(hov.p2d);
      g.restore();
      // Hands: hold still on a country to choose it.
      if (pointer.source === 'hand') {
        this.dwell += dt;
        if (this.dwell > 1700) { this.dwell = 0; this.answerCapital(hov); }
      }
    }
    if (this.flashBad) {
      const k = (now - this.flashBad.t0) / 900;
      if (k < 1) {
        g.save(); g.globalAlpha = 1 - k; g.fillStyle = '#ff4d6d'; g.fill(this.flashBad.c.p2d); g.restore();
        const c = this.flashBad.c;
        g.save(); g.globalAlpha = 1 - k; g.font = '600 18px Fredoka, "M PLUS Rounded 1c", sans-serif'; g.textAlign = 'center';
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.strokeText(nameOf(c), c.cen[0], c.cen[1] - 14);
        g.fillStyle = '#fff'; g.fillText(nameOf(c), c.cen[0], c.cen[1] - 14); g.restore();
      } else this.flashBad = null;
    }
    if (this.revealed) {
      const c = this.revealed.c, k = 0.5 + 0.5 * Math.sin((now - this.revealed.t0) / 200);
      g.save();
      g.shadowColor = '#ffe066'; g.shadowBlur = 24 * k;
      g.fillStyle = colorFor(c.cont, c.idx, 8); g.fill(c.p2d);
      g.strokeStyle = '#ffe066'; g.lineWidth = 3; g.stroke(c.p2d);
      g.restore();
      if (c.capXY) {
        g.save(); g.fillStyle = '#fff'; g.strokeStyle = '#e63946'; g.lineWidth = 2.5;
        star(g, c.capXY[0], c.capXY[1], 9 + 2 * k); g.fill(); g.stroke(); g.restore();
      }
    }
  }

  drawParticles(g, dt) {
    const f = dt / 16.7;
    g.save();
    this.particles = this.particles.filter((p) => {
      p.x += p.vx * f; p.y += p.vy * f; p.vy += 0.12 * f; p.vx *= 0.99; p.life -= p.decay * f; p.rot += 0.1 * f;
      if (p.life <= 0) return false;
      g.globalAlpha = Math.min(1, p.life * 1.5);
      g.fillStyle = p.color;
      if (p.star) { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); star(g, 0, 0, p.size); g.fill(); g.restore(); }
      else { g.beginPath(); g.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2); g.fill(); }
      return true;
    });
    const now = performance.now();
    this.floaters = this.floaters.filter((fl) => {
      const k = (now - fl.t0) / 1300;
      if (k >= 1) return false;
      g.globalAlpha = 1 - k * k;
      g.font = '700 28px Fredoka, sans-serif'; g.textAlign = 'center';
      g.lineWidth = 5; g.strokeStyle = 'rgba(10,40,80,0.6)';
      g.strokeText(fl.text, fl.x, fl.y - k * 60);
      g.fillStyle = '#ffe066'; g.fillText(fl.text, fl.x, fl.y - k * 60);
      return true;
    });
    g.restore();
  }

  drawCursor(g, now) {
    // The hand cursor itself is drawn on the top-most overlay by main.js.
    this.cursorDwell = this.mode === 'capitals' && this.hover ? this.dwell / 1700 : 0;
  }
}

export function drawHandCursor(g, p, dwell = 0, now = performance.now()) {
  const { x, y } = p;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 8;
  const r = p.down ? 13 : 20 + Math.sin(now / 300) * 1.5;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = p.down ? 'rgba(255,210,63,0.9)' : 'rgba(255,255,255,0.25)'; g.fill();
  g.lineWidth = 4; g.strokeStyle = p.down ? '#fff' : 'rgba(255,255,255,0.95)'; g.stroke();
  g.shadowBlur = 0;
  g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  if (dwell > 0) {
    g.beginPath(); g.arc(x, y, 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, dwell));
    g.lineWidth = 6; g.lineCap = 'round'; g.strokeStyle = '#4be3c1'; g.stroke();
  }
  g.restore();
}

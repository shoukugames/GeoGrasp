// GeoGrasp — Tutorial / World Explorer: countries, capitals and flags (GPL-3.0-or-later)
import { getLang } from './i18n.js';
import { audio } from './audio.js';
import { pointer } from './input.js';
import { drawOcean, drawPiece, colorFor } from './map.js';

const HIT = document.createElement('canvas').getContext('2d');

export class Tutorial {
  constructor(app) {
    this.app = app; this.map = app.map;
    this.cache = document.createElement('canvas');
    this.active = false;
  }

  start(region = 'world') {
    this.region = region;
    this.active = true; this.sel = null; this.hover = null; this.dwell = 0;
    this.layout();
    this.unsub = pointer.on('down', () => { if (this.hover) this.select(this.hover); });
    audio.say('explore', '');
  }

  stop() { this.active = false; if (this.unsub) this.unsub(); audio.stopVoice(); this.app.hideInfo(); }

  setRegion(r) { this.region = r; this.sel = null; this.app.hideInfo(); this.layout(); }

  layout() {
    const { W, H } = this.app.size();
    this.W = W; this.H = H;
    const rect = { x: 8, y: 132, w: W - 16, h: H - 140 };
    this.map.layout(rect, this.region);
    const dpr = window.devicePixelRatio || 1;
    this.cache.width = Math.round(W * dpr); this.cache.height = Math.round(H * dpr);
    const inRegion = (c) => this.region === 'world' || c.cont === this.region;
    this.items = this.map.countries.filter((c) => c.play && c.onScreen && inRegion(c));
    this.list = [...this.items].sort((a, b) => (getLang() === 'ja' ? a.ja.localeCompare(b.ja, 'ja') : a.en.localeCompare(b.en)));
    this.dirty = true;
  }

  rebuild() {
    const g = this.cache.getContext('2d');
    const dpr = this.cache.width / this.W;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOcean(g, this.W, this.H, this.map);
    const inRegion = (c) => this.region === 'world' || c.cont === this.region;
    for (const d of this.map.decor) { g.fillStyle = 'rgba(240,230,200,0.25)'; g.fill(d); }
    for (const c of this.map.countries) {
      if (!c.p2d) continue;
      if (inRegion(c)) drawPiece(g, c.p2d, colorFor(c.cont, c.idx), { bounds: c.bounds, lw: 0.7 });
      else { g.fillStyle = c.cont === 'antarctica' ? 'rgba(235,245,255,0.55)' : 'rgba(225,215,190,0.28)'; g.fill(c.p2d); }
    }
  }

  step(dir) {
    const i = this.sel ? this.list.indexOf(this.sel) : -1;
    const n = this.list.length;
    this.select(this.list[(i + dir + n) % n]);
  }

  select(c) {
    this.sel = c; this.dwell = 0;
    audio.sfx('click');
    this.app.showInfo(c);
    const lang = getLang();
    audio.say(`t_${c.cca3}`, lang === 'ja' ? `${c.ja}。首都は${c.capJa}です。` : `${c.en}. The capital city is ${c.capEn}.`);
  }

  frame(g, dt) {
    if (this.dirty) { this.rebuild(); this.dirty = false; }
    g.drawImage(this.cache, 0, 0, this.W, this.H);
    const now = performance.now();
    let hov = null;
    if (pointer.visible && pointer.y > 130 && !this.app.overInfo(pointer.x, pointer.y)) {
      HIT.setTransform(1, 0, 0, 1, 0, 0);
      hov = this.map.countryAt(HIT, pointer.x, pointer.y, this.items) || this.map.nearest(pointer.x, pointer.y, this.items, 12);
    }
    if (hov !== this.hover) { this.hover = hov; this.dwell = 0; if (hov) audio.sfx('hover'); }
    if (hov && hov !== this.sel) {
      g.save(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill(hov.p2d);
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(hov.p2d); g.restore();
      const label = getLang() === 'ja' ? hov.ja : hov.en;
      g.save(); g.font = '600 17px Fredoka, "M PLUS Rounded 1c", sans-serif'; g.textAlign = 'center';
      const ly = Math.max(150, pointer.y - 34);
      g.lineWidth = 5; g.strokeStyle = 'rgba(5,30,60,0.7)'; g.strokeText(label, pointer.x, ly);
      g.fillStyle = '#fff'; g.fillText(label, pointer.x, ly); g.restore();
      if (pointer.source === 'hand') { this.dwell += dt; if (this.dwell > 1300) this.select(hov); }
    }
    if (this.sel) {
      const c = this.sel, k = 0.5 + 0.5 * Math.sin(now / 250);
      g.save(); g.shadowColor = '#ffe066'; g.shadowBlur = 16 + 10 * k;
      g.strokeStyle = '#ffe066'; g.lineWidth = 3; g.stroke(c.p2d);
      g.fillStyle = 'rgba(255,240,170,0.35)'; g.fill(c.p2d); g.restore();
      if (c.capXY) {
        const [x, y] = c.capXY;
        g.save(); g.fillStyle = '#fff'; g.strokeStyle = '#e63946'; g.lineWidth = 2.5;
        g.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4.5 : 10 + k * 1.5; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
        g.closePath(); g.fill(); g.stroke();
        const cap = getLang() === 'ja' ? c.capJa : c.capEn;
        g.font = '600 15px Fredoka, "M PLUS Rounded 1c", sans-serif'; g.textAlign = 'left';
        g.lineWidth = 4; g.strokeStyle = 'rgba(5,30,60,0.75)'; g.strokeText(cap, x + 13, y + 5);
        g.fillStyle = '#fff'; g.fillText(cap, x + 13, y + 5);
        g.restore();
      }
    }
    this.cursorDwell = hov && hov !== this.sel ? this.dwell / 1300 : 0;
  }
}

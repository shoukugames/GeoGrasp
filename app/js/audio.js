// GeoGrasp — audio: generative ambient music, sound effects and voice (GPL-3.0-or-later)
// All music and sound effects are synthesised live with the Web Audio API.
import { settings } from './storage.js';
import { getLang } from './i18n.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.voiceCache = new Map();
    this.voiceSrc = null;
    this.voiceToken = 0;
  }

  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -14; this.master.ratio.value = 3;
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0;
    this.musicDuck = ctx.createGain(); this.musicDuck.gain.value = 1;
    this.musicBus.connect(this.musicDuck).connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = settings.sfx;
    this.sfxBus.connect(this.master);
    this.voiceBus = ctx.createGain(); this.voiceBus.gain.value = settings.voice * 1.25;
    this.voiceBus.connect(this.master);

    // Reverb (generated impulse response) shared by music and effects
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(5.5, 2.6);
    const revOut = ctx.createGain(); revOut.gain.value = 0.9;
    this.reverb.connect(revOut).connect(this.musicBus);
    this.sfxReverb = ctx.createConvolver();
    this.sfxReverb.buffer = this.impulse(2.2, 3);
    const sfxRev = ctx.createGain(); sfxRev.gain.value = 0.35;
    this.sfxReverb.connect(sfxRev).connect(this.sfxBus);

    // Ping-pong delay for the bells
    this.delayIn = ctx.createGain(); this.delayIn.gain.value = 0.35;
    const dl = ctx.createDelay(2), dr = ctx.createDelay(2), fb = ctx.createGain();
    dl.delayTime.value = 0.75; dr.delayTime.value = 1.125; fb.gain.value = 0.38;
    const pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner();
    pl.pan.value = -0.7; pr.pan.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    this.delayIn.connect(dl); dl.connect(pl).connect(this.reverb); dl.connect(dr); dr.connect(pr).connect(this.reverb);
    dr.connect(lp).connect(fb).connect(dl);
    pl.connect(this.musicBus); pr.connect(this.musicBus);

    this.noiseBuf = this.noise(4);
    const resume = () => { if (ctx.state !== 'running') ctx.resume(); };
    ['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, resume));
  }

  impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  noise(seconds) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0; // pinkish noise
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    }
    return buf;
  }

  // ---------------------------------------------------------------- music
  setMusicVolume(v) {
    settings.music = v;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.8);
    if (v > 0 && !this.musicTimer) this.startMusic();
  }
  setSfxVolume(v) { settings.sfx = v; if (this.ctx) this.sfxBus.gain.value = v; }
  setVoiceVolume(v) { settings.voice = v; if (this.ctx) this.voiceBus.gain.value = v * 1.25; }

  startMusic() {
    this.init();
    if (this.musicTimer) return;
    const ctx = this.ctx;
    // Dreamy Lydian-flavoured progression: Dmaj9 – Bm9 – Gmaj9#11 – A6/9 – Em9 – Gmaj7/A
    this.chords = [
      [50, 57, 62, 66, 69, 76], [47, 54, 61, 62, 66, 73], [43, 54, 57, 62, 66, 73],
      [45, 52, 57, 59, 64, 71], [40, 54, 59, 62, 66, 74], [45, 55, 59, 62, 66, 71],
    ];
    this.scale = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]; // D major pentatonic-ish
    this.chordIdx = 0;
    this.nextChordAt = ctx.currentTime + 0.2;
    this.nextBellAt = ctx.currentTime + 2;
    this.musicBus.gain.setTargetAtTime(settings.music * 0.5, ctx.currentTime, 2);
    this.startOcean();
    this.musicTimer = setInterval(() => this.scheduleMusic(), 200);
  }

  stopMusic() {
    if (!this.musicTimer) return;
    clearInterval(this.musicTimer); this.musicTimer = null;
  }

  scheduleMusic() {
    if (settings.music <= 0) return;
    const ctx = this.ctx, now = ctx.currentTime, CH = 9.6;
    while (this.nextChordAt < now + 1) {
      const chord = this.chords[this.chordIdx % this.chords.length];
      this.pad(chord, this.nextChordAt, CH + 3.5);
      this.bass(chord[0] - 12, this.nextChordAt, CH + 2);
      this.currentChord = chord;
      this.chordIdx++;
      this.nextChordAt += CH;
    }
    while (this.nextBellAt < now + 1) {
      const chord = this.currentChord || this.chords[0];
      const pool = this.scale.filter((n) => chord.some((c) => (n - c) % 12 === 0) || Math.random() < 0.3);
      const n = pool[Math.floor(Math.random() * pool.length)];
      this.bell(n, this.nextBellAt, 0.05 + Math.random() * 0.04);
      if (Math.random() < 0.35) this.bell(n + (Math.random() < 0.5 ? 7 : 12), this.nextBellAt + 0.38, 0.03);
      this.nextBellAt += [1.2, 1.6, 2.4, 3.2, 4.8][Math.floor(Math.random() * 5)];
    }
  }

  pad(notes, t, dur) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.055, t + 3.5);
    out.gain.setValueAtTime(0.055, t + dur - 4.5);
    out.gain.linearRampToValueAtTime(0, t + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 0.6;
    filt.frequency.setValueAtTime(500, t);
    filt.frequency.linearRampToValueAtTime(1300, t + dur * 0.5);
    filt.frequency.linearRampToValueAtTime(600, t + dur);
    filt.connect(out);
    out.connect(this.musicBus); out.connect(this.reverb);
    notes.slice(1).forEach((n, i) => {
      for (const [type, det, g] of [['sawtooth', -7, 0.18], ['triangle', 6, 0.5], ['sine', 0, 0.35]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(), pan = ctx.createStereoPanner();
        o.type = type; o.frequency.value = midi(n); o.detune.value = det + (Math.random() * 4 - 2);
        og.gain.value = g / notes.length;
        pan.pan.value = ((i % 3) - 1) * 0.5;
        o.connect(og).connect(pan).connect(filt);
        o.start(t); o.stop(t + dur + 0.1);
      }
    });
  }

  bass(n, t, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = midi(n);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 2.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.1);
  }

  bell(n, t, vel) {
    const ctx = this.ctx, f = midi(n);
    const g = ctx.createGain(), pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    g.connect(pan); pan.connect(this.musicBus); pan.connect(this.reverb); pan.connect(this.delayIn);
    [[1, 1], [2.01, 0.3], [3.98, 0.08]].forEach(([mul, amp]) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * mul; og.gain.value = amp;
      o.connect(og).connect(g); o.start(t); o.stop(t + 3.3);
    });
  }

  startOcean() {
    // Very soft, slow "ocean waves" bed made from filtered pink noise.
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.08; lfoG.gain.value = 0.045;
    lfo.connect(lfoG).connect(g.gain);
    const lfo2 = ctx.createOscillator(), lfo2G = ctx.createGain();
    lfo2.frequency.value = 0.05; lfo2G.gain.value = 350;
    lfo2.connect(lfo2G).connect(f.frequency);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(); lfo.start(); lfo2.start();
  }

  // ---------------------------------------------------------------- sfx
  tone({ f = 440, f2 = null, type = 'sine', t = 0, dur = 0.2, vol = 0.2, attack = 0.005, rev = true, pan = 0 }) {
    if (!this.ctx || settings.sfx <= 0) return;
    const ctx = this.ctx, st = ctx.currentTime + t;
    const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
    o.type = type; o.frequency.setValueAtTime(f, st);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, st + dur);
    g.gain.setValueAtTime(0, st);
    g.gain.linearRampToValueAtTime(vol, st + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.sfxBus);
    if (rev) p.connect(this.sfxReverb);
    o.start(st); o.stop(st + dur + 0.05);
  }

  sfx(name) {
    this.init();
    switch (name) {
      case 'hover': this.tone({ f: 1400, dur: 0.05, vol: 0.04, rev: false }); break;
      case 'click': this.tone({ f: 880, f2: 1320, dur: 0.08, vol: 0.09 }); break;
      case 'pickup':
        this.tone({ f: 420, f2: 840, dur: 0.16, vol: 0.16, type: 'triangle' });
        this.tone({ f: 1260, dur: 0.12, vol: 0.05, t: 0.05 });
        break;
      case 'drop': this.tone({ f: 500, f2: 260, dur: 0.18, vol: 0.12, type: 'triangle' }); break;
      case 'correct':
        [72, 76, 79, 84, 88].forEach((n, i) => {
          this.tone({ f: midi(n), dur: 0.9, vol: 0.12, t: i * 0.07, pan: -0.6 + i * 0.3 });
          this.tone({ f: midi(n) * 2.01, dur: 0.5, vol: 0.03, t: i * 0.07 });
        });
        this.sparkle(0.25);
        break;
      case 'wrong':
        this.tone({ f: 330, f2: 300, dur: 0.22, vol: 0.13, type: 'triangle' });
        this.tone({ f: 247, f2: 220, dur: 0.35, vol: 0.13, type: 'triangle', t: 0.17 });
        break;
      case 'tick': this.tone({ f: 1500, dur: 0.04, vol: 0.06, rev: false }); break;
      case 'timeup': [67, 64, 60].forEach((n, i) => this.tone({ f: midi(n), dur: 0.5, vol: 0.12, type: 'triangle', t: i * 0.16 })); break;
      case 'complete':
        [60, 64, 67, 72, 76, 79, 84, 88, 91, 96].forEach((n, i) => this.tone({ f: midi(n), dur: 1.6, vol: 0.1, t: i * 0.09, pan: Math.sin(i) * 0.6 }));
        [60, 64, 67, 71].forEach((n) => this.tone({ f: midi(n), dur: 3.5, vol: 0.06, t: 0.9, attack: 0.4, type: 'triangle' }));
        this.sparkle(1);
        break;
      case 'whoosh': {
        if (!this.ctx) return;
        const ctx = this.ctx, st = ctx.currentTime;
        const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
        f.frequency.setValueAtTime(400, st); f.frequency.exponentialRampToValueAtTime(2400, st + 0.35);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.5, st + 0.1); g.gain.exponentialRampToValueAtTime(0.001, st + 0.4);
        s.connect(f).connect(g).connect(this.sfxBus); s.start(st, Math.random() * 3); s.stop(st + 0.45);
        break;
      }
      default: break;
    }
  }

  sparkle(t0) {
    for (let i = 0; i < 8; i++) this.tone({ f: midi(96 + [0, 2, 4, 7, 9][i % 5]), dur: 0.3, vol: 0.025, t: t0 + i * 0.05 + Math.random() * 0.03, pan: Math.random() * 2 - 1 });
  }

  // ---------------------------------------------------------------- voice
  async loadVoice(key, lang) {
    const id = `${lang}/${key}`;
    if (this.voiceCache.has(id)) return this.voiceCache.get(id);
    const p = fetch(`voice/${id}.ogg`).then((r) => { if (!r.ok) throw new Error('missing'); return r.arrayBuffer(); })
      .then((b) => this.ctx.decodeAudioData(b)).catch(() => null);
    this.voiceCache.set(id, p);
    return p;
  }

  preloadVoice(keys) { this.init(); const l = getLang(); keys.forEach((k) => this.loadVoice(k, l)); }

  stopVoice() {
    this.voiceToken++;
    if (this.voiceSrc) { try { this.voiceSrc.stop(); } catch { /* already stopped */ } this.voiceSrc = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (this.ctx) this.musicDuck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4);
  }

  /** Speak a recorded line; `fallback` text is used with the system voice if the clip is missing. */
  async say(key, fallback = '') {
    this.init();
    this.stopVoice();
    const token = this.voiceToken;
    if (settings.voice <= 0) return;
    const lang = getLang();
    const buf = await this.loadVoice(key, lang);
    if (token !== this.voiceToken) return;
    const ctx = this.ctx;
    this.musicDuck.gain.setTargetAtTime(0.35, ctx.currentTime, 0.15);
    if (buf) {
      await new Promise((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(this.voiceBus);
        src.onended = resolve;
        this.voiceSrc = src; src.start();
      });
    } else if (fallback && window.speechSynthesis) {
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(fallback);
        u.lang = lang === 'ja' ? 'ja-JP' : 'en-US'; u.rate = 0.9; u.volume = settings.voice;
        const v = speechSynthesis.getVoices().filter((x) => x.lang.startsWith(lang))
          .sort((a, b) => /natural|neural|premium|enhanced/i.test(b.name) - /natural|neural|premium|enhanced/i.test(a.name))[0];
        if (v) u.voice = v;
        u.onend = u.onerror = resolve;
        speechSynthesis.speak(u);
        setTimeout(resolve, 8000);
      });
    }
    if (token === this.voiceToken) { this.voiceSrc = null; this.musicDuck.gain.setTargetAtTime(1, ctx.currentTime, 0.5); }
  }
}

export const audio = new AudioEngine();

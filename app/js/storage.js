// GeoGrasp — local, on-device storage for settings and parent progress (GPL-3.0-or-later)
// Everything stays on this computer (Electron's local storage). Nothing is uploaded.
const KEY = 'geograsp.v1';

const DEFAULTS = {
  settings: { lang: null, difficulty: 'easy', region: 'world', music: 0.55, sfx: 0.8, voice: 1, camera: null /* null = not asked, true / false */ },
  stats: { totalMs: 0, sessions: [], items: {} },
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw) return structuredClone(DEFAULTS);
    return {
      settings: { ...DEFAULTS.settings, ...(raw.settings || {}) },
      stats: { ...DEFAULTS.stats, ...(raw.stats || {}) },
    };
  } catch { return structuredClone(DEFAULTS); }
}

const state = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ } }

export const settings = new Proxy(state.settings, {
  set(target, k, v) { target[k] = v; save(); return true; },
});

export const stats = {
  get data() { return state.stats; },
  addTime(ms) { state.stats.totalMs += Math.max(0, ms | 0); save(); },
  /** item: key like "country:JPN" — record right / wrong answers per item */
  mark(item, right) {
    const it = state.stats.items[item] || (state.stats.items[item] = { r: 0, w: 0 });
    right ? it.r++ : it.w++;
    save();
  },
  addSession(s) {
    state.stats.sessions.unshift(s);
    state.stats.sessions = state.stats.sessions.slice(0, 200);
    save();
  },
  reset() { state.stats = structuredClone(DEFAULTS.stats); save(); },
};

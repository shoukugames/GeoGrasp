// GeoGrasp v0.1.1 — app controller
// Copyright (C) 2026 Shawn Rapaz — GNU GPL v3.0 or later. Made with Claude Code.
/* global d3 */
import { t, setLang, getLang, onLang, applyI18n } from './i18n.js';
import { settings, stats } from './storage.js';
import { audio } from './audio.js';
import { pointer } from './input.js';
import { WorldMap, colorFor } from './map.js';
import { Game, drawHandCursor } from './game.js';
import { Tutorial } from './tutorial.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const REGIONS = ['world', 'africa', 'asia', 'europe', 'north_america', 'south_america', 'oceania'];

const canvas = $('#stage');
const g = canvas.getContext('2d');
const cursorCanvas = $('#cursor-layer');
const cg = cursorCanvas.getContext('2d');
let W = innerWidth, H = innerHeight;
let scene = 'title';
let map, game, tutorial;
let lastMode = null;

function resize() {
  W = innerWidth; H = innerHeight;
  const dpr = window.devicePixelRatio || 1;
  for (const c of [canvas, cursorCanvas]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  cg.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (scene === 'game' && game.active) game.layout();
  if (scene === 'tutorial') tutorial.layout();
}

// ------------------------------------------------------------------ HUD
let flashTimer = null;
const hud = {
  show() { $('#hud').classList.remove('hidden'); },
  hide() { $('#hud').classList.add('hidden'); },
  setTitle(main, sub = '', voice = false, celebrate = false, icon = '') {
    $('#hud-title').textContent = (icon ? icon + ' ' : '') + main;
    $('#hud-sub').textContent = sub || '';
    const b = $('#hud-banner');
    b.classList.toggle('voice', !!voice);
    b.classList.remove('celebrate'); void b.offsetWidth;
    if (celebrate) b.classList.add('celebrate');
  },
  setScore(s) { $('#hud-score').textContent = s.toLocaleString(); },
  setProgress(txt) { $('#hud-progress').textContent = txt; },
  setTimer(rem, total) {
    const s = Math.ceil(rem);
    const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (this._last !== txt) {
      this._last = txt;
      $('#hud-timer-text').textContent = txt;
      $('#hud-timer-ring').style.strokeDashoffset = String(106.8 * (1 - rem / total));
      $('#hud-timer').classList.toggle('low', s <= 10);
    }
  },
  flash(msg) {
    const f = $('#hud-flash'); f.textContent = msg; f.classList.add('show');
    clearTimeout(flashTimer); flashTimer = setTimeout(() => f.classList.remove('show'), 1600);
  },
};

// ------------------------------------------------------------------ modals
let modalResolve = null;
function openModal(id) {
  $$('.modal').forEach((m) => m.classList.add('hidden'));
  $('#modal-back').classList.remove('hidden');
  $(id).classList.remove('hidden');
  audio.sfx('whoosh');
}
function closeModals() {
  $$('.modal').forEach((m) => m.classList.add('hidden'));
  $('#modal-back').classList.add('hidden');
}
const anyModalOpen = () => $$('.modal').some((m) => !m.classList.contains('hidden'));

/** Simple grown-up check so children don't change camera or parent settings by accident. */
function parentGate() {
  return new Promise((resolve) => {
    const a = 3 + Math.floor(Math.random() * 7), b = 3 + Math.floor(Math.random() * 7), c = 10 + Math.floor(Math.random() * 20);
    $('#gate-q').textContent = `${a} × ${b} + ${c} = ?`;
    $('#gate-a').value = ''; $('#gate-err').textContent = '';
    openModal('#modal-gate');
    setTimeout(() => $('#gate-a').focus(), 50);
    const done = (ok) => { $('#gate-ok').onclick = $('#gate-cancel').onclick = $('#gate-a').onkeydown = null; closeModals(); resolve(ok); };
    const check = () => {
      if (Number($('#gate-a').value) === a * b + c) done(true);
      else { $('#gate-err').textContent = t('gateWrong'); audio.sfx('wrong'); $('#gate-a').value = ''; }
    };
    $('#gate-ok').onclick = check;
    $('#gate-cancel').onclick = () => done(false);
    $('#gate-a').onkeydown = (e) => { if (e.key === 'Enter') check(); if (e.key === 'Escape') done(false); };
  });
}

function cameraConsent() {
  return new Promise((resolve) => {
    openModal('#modal-camera');
    $('#cam-allow').onclick = () => { closeModals(); resolve(true); };
    $('#cam-deny').onclick = () => { closeModals(); resolve(false); };
  });
}

/** Ask a grown-up for permission, then start (or skip) the camera. */
async function requestCamera() {
  if (!(await parentGate())) return false;
  const ok = await cameraConsent();
  settings.camera = ok;
  if (ok) return startCamera();
  setControl('mouse');
  return false;
}

async function startCamera() {
  $('#cam-box').classList.remove('hidden');
  const ok = await pointer.startCamera((st) => {
    $('#cam-msg').textContent = st === 'loading' ? t('loadingCam') : st === 'fail' ? t('camFail') : '';
  });
  if (!ok) { setTimeout(() => $('#cam-box').classList.add('hidden'), 2500); setControl('mouse', false); }
  else setControl('hands', false);
  return ok;
}

function stopCamera() { pointer.stopCamera(); $('#cam-box').classList.add('hidden'); }

function setControl(c, act = true) {
  $$('.ctl-seg button').forEach((b) => b.classList.toggle('on', b.dataset.ctl === c));
  settings.control = c;
  if (!act) return;
  if (c === 'mouse') stopCamera();
  else if (settings.camera === true) startCamera();
  else requestCamera().then((ok) => { if (!ok) setControl('mouse', false); });
}

// ------------------------------------------------------------------ title globe
let globeT = 0;
let globeLite = null;
const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, p: Math.random() * 6 }));
function simplify(geo, step) {
  const ring = (r) => (r.length < 12 ? r : r.filter((_, i) => i % step === 0 || i === r.length - 1));
  if (geo.type === 'Polygon') return { type: 'Polygon', coordinates: geo.coordinates.map(ring) };
  return { type: 'MultiPolygon', coordinates: geo.coordinates.map((p) => p.map(ring)).filter((p) => p[0].length >= 4) };
}
function drawTitle(dt) {
  globeT += dt;
  const bg = g.createRadialGradient(W * 0.7, H * 0.45, 40, W * 0.6, H * 0.5, Math.max(W, H));
  bg.addColorStop(0, '#1d5f9e'); bg.addColorStop(0.5, '#0f3a68'); bg.addColorStop(1, '#071d38');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (const s of stars) {
    g.globalAlpha = 0.35 + 0.35 * Math.sin(globeT / 900 + s.p);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  if (!map) return;
  if (!globeLite) globeLite = map.countries.map((c) => ({ c, geo: simplify(c.geo, 3) }));
  const R = Math.min(H * 0.4, W * 0.24);
  const cx = W * 0.72, cy = H * 0.5 + Math.sin(globeT / 1800) * 6;
  const proj = d3.geoOrthographic().scale(R).translate([cx, cy]).rotate([globeT * 0.006, -18, 0]).clipAngle(90).precision(0.8);
  const path = d3.geoPath(proj, g);
  // atmosphere glow
  const glow = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.35);
  glow.addColorStop(0, 'rgba(120,210,255,0.45)'); glow.addColorStop(1, 'rgba(120,210,255,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, R * 1.35, 0, Math.PI * 2); g.fill();
  const oc = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
  oc.addColorStop(0, '#5cc8ff'); oc.addColorStop(0.6, '#1f7fc4'); oc.addColorStop(1, '#0d4a85');
  g.fillStyle = oc; g.beginPath(); path({ type: 'Sphere' }); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 0.8; g.beginPath(); path(map.graticule); g.stroke();
  g.lineJoin = 'round';
  for (const { c, geo } of globeLite) {
    g.beginPath(); path(geo);
    g.fillStyle = colorFor(c.cont, c.idx); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 0.6; g.stroke();
  }
  // shading + highlight for a glossy 3D globe
  const sh = g.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.05, cx, cy, R * 1.02);
  sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,10,40,0.45)');
  g.fillStyle = sh; g.beginPath(); path({ type: 'Sphere' }); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2; g.beginPath(); path({ type: 'Sphere' }); g.stroke();
  // orbiting puzzle piece sparkle
  const a = globeT / 2600;
  const ox = cx + Math.cos(a) * R * 1.18, oy = cy + Math.sin(a) * R * 0.32;
  g.fillStyle = '#ffe066'; g.globalAlpha = 0.9; g.beginPath();
  for (let i = 0; i < 10; i++) { const an = -Math.PI / 2 + (i * Math.PI) / 5 + a * 2, r = i % 2 ? 5 : 12; g.lineTo(ox + Math.cos(an) * r, oy + Math.sin(an) * r); }
  g.closePath(); g.fill(); g.globalAlpha = 1;
}

// ------------------------------------------------------------------ title UI
function refreshTitle() {
  $$('.lang-seg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  $$('.diff-seg button').forEach((b) => b.classList.toggle('on', b.dataset.diff === settings.difficulty));
  $('#diff-desc').textContent = t(settings.difficulty + 'Desc');
  const hard = settings.difficulty === 'hard';
  $('#region-chips').classList.toggle('hidden', hard);
  $('.region-label').classList.toggle('hidden', hard);
  renderChips($('#region-chips'), settings.region, (r) => { settings.region = r; refreshTitle(); });
}

function renderChips(el, current, onPick) {
  el.innerHTML = '';
  for (const r of REGIONS) {
    const b = document.createElement('button');
    b.className = 'chip' + (r === current ? ' on' : '');
    b.textContent = t(r);
    b.onclick = () => { audio.sfx('click'); onPick(r); };
    el.appendChild(b);
  }
}

function showScreen(name) {
  scene = name;
  document.body.classList.toggle('in-title', name === 'title');
  $('#title').classList.toggle('hidden', name !== 'title');
  $('#tut-ui').classList.toggle('hidden', name !== 'tutorial');
  if (name !== 'game') hud.hide();
  canvas.style.cursor = name === 'game' || name === 'tutorial' ? 'grab' : 'default';
}

function goTitle() {
  if (game && game.active) game.stop(true);
  if (tutorial && tutorial.active) tutorial.stop();
  closeModals(); hideFlagCard();
  showScreen('title');
  refreshTitle();
}

function startGame(mode) {
  audio.sfx('click');
  lastMode = mode;
  closeModals();
  showScreen('game');
  game.start({ mode, region: settings.region });
}

// ------------------------------------------------------------------ parents
function fmtDuration(ms) {
  if (ms < 60000) { const sec = Math.round(ms / 1000); return getLang() === 'ja' ? `${sec}秒` : `${sec} s`; }
  const m = Math.round(ms / 60000);
  if (m < 60) return getLang() === 'ja' ? `${m}分` : `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  return getLang() === 'ja' ? `${h}時間${mm}分` : `${h} h ${mm} min`;
}
function itemName(kind, code) {
  if (kind === 'hard') { const c = map.continents.find((x) => x.cca3 === code); return c ? (getLang() === 'ja' ? c.ja : c.en) : code; }
  const c = map.byCode.get(code); return c ? (getLang() === 'ja' ? c.ja : c.en) : code;
}
function modeLabel(m) { return t('mode' + m[0].toUpperCase() + m.slice(1)); }
function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

function renderParents() {
  const d = stats.data;
  const S = d.sessions;
  const right = S.reduce((a, s) => a + s.right, 0), wrong = S.reduce((a, s) => a + s.wrong, 0);
  const best = S.reduce((a, s) => Math.max(a, s.score), 0);
  const total = S.reduce((a, s) => a + s.score, 0);
  const acc = right + wrong ? Math.round((right / (right + wrong)) * 100) + '%' : '—';
  const items = Object.entries(d.items).map(([k, v]) => {
    const [kind, code] = k.split(':');
    const label = itemName(kind === 'continent' ? 'hard' : 'c', code) + (kind === 'capital' ? ' 🏛️' : kind === 'continent' ? ' 🌍' : '');
    return { label, ...v };
  });
  const weak = items.filter((i) => i.w > 0).sort((a, b) => b.w - b.r * 0.5 - (a.w - a.r * 0.5)).slice(0, 24);
  const strong = items.filter((i) => i.r > 0).sort((a, b) => b.r - b.w - (a.r - a.w)).slice(0, 24);
  let html = `<div class="kpis">
    <div class="kpi"><small>${t('totalTime')}</small><b>${fmtDuration(d.totalMs)}</b></div>
    <div class="kpi"><small>${t('sessions')}</small><b>${S.length}</b></div>
    <div class="kpi"><small>${t('totalScore')}</small><b>${total.toLocaleString()}</b></div>
    <div class="kpi"><small>${t('bestScore')}</small><b>${best.toLocaleString()}</b></div>
    <div class="kpi"><small>${t('accuracy')}</small><b>${acc}</b></div>
  </div>
  <div class="two-col">
    <div><h3>❗ ${t('needsPractice')}</h3><div class="tag-list">${weak.map((i) => `<span class="tag">${esc(i.label)} ✗${i.w}</span>`).join('') || '—'}</div></div>
    <div><h3>✅ ${t('mastered')}</h3><div class="tag-list">${strong.map((i) => `<span class="tag good">${esc(i.label)} ✓${i.r}</span>`).join('') || '—'}</div></div>
  </div>
  <h3>🕒 ${t('recent')}</h3>`;
  if (!S.length) html += `<p>${t('noData')}</p>`;
  else {
    html += `<table class="sessions"><thead><tr><th>${t('colDate')}</th><th>${t('colMode')}</th><th>${t('colMap')}</th><th>${t('colTime')}</th><th>${t('colScore')}</th><th>${t('colRight')}</th><th>${t('colWrong')}</th><th>${t('details')}</th></tr></thead><tbody>`;
    for (const s of S.slice(0, 60)) {
      const dt = new Date(s.date);
      const log = s.log.map((e) => {
        const name = esc(itemName(s.mode, e.k));
        if (e.ok) return `<li class="ok">✓ ${name}</li>`;
        const other = e.other ? esc(itemName(s.mode, e.other)) : '';
        const why = e.why === 'timeout' ? t('timeout') : e.why === 'chose' ? `${t('chose')}: ${other}` : e.why === 'answered' ? `${t('answered')}: ${other}` : other ? `${t('wrongAs')}: ${other}` : '';
        return `<li class="bad">✗ ${name}${why ? ' — ' + why : ''}</li>`;
      }).join('');
      html += `<tr><td>${dt.toLocaleDateString(getLang() === 'ja' ? 'ja-JP' : undefined)} ${dt.toLocaleTimeString(getLang() === 'ja' ? 'ja-JP' : undefined, { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${modeLabel(s.mode)}</td><td>${t(s.region)}</td><td>${fmtDuration(s.ms)}</td><td>${s.score.toLocaleString()}</td>
        <td class="ok">${s.right}</td><td class="bad">${s.wrong}</td>
        <td><details><summary>${s.log.length}</summary><ul class="log-list">${log}</ul></details></td></tr>`;
    }
    html += '</tbody></table>';
  }
  html += `<div class="parent-actions">
    <div>📷 ${t('camState')}: <b>${settings.camera === true ? t('camAllowed') : t('camDenied')}</b>
      <button class="small-btn ghost" id="p-cam">${t('camChange')}</button></div>
    <button class="small-btn danger" id="p-reset">${t('resetProgress')}</button></div>`;
  $('#parents-body').innerHTML = html;
  $('#p-reset').onclick = () => { if (confirm(t('resetConfirm'))) { stats.reset(); renderParents(); } };
  $('#p-cam').onclick = async () => {
    const ok = await cameraConsent();
    settings.camera = ok;
    if (ok) startCamera(); else setControl('mouse');
    openModal('#panel-parents'); renderParents();
  };
}

// ------------------------------------------------------------------ cards
function showInfo(c) {
  $('#info-flag').src = `flags/${c.cca2}.svg`;
  $('#info-name').textContent = getLang() === 'ja' ? c.ja : c.en;
  $('#info-alt').textContent = getLang() === 'ja' ? c.en : c.ja;
  $('#info-cap').textContent = getLang() === 'ja' ? c.capJa : c.capEn;
  $('#info-cont').textContent = t(c.cont);
  const card = $('#info-card');
  card.classList.add('hidden'); void card.offsetWidth; card.classList.remove('hidden');
  card._c = c;
}
function hideInfo() { $('#info-card').classList.add('hidden'); }
function overInfo(x, y) {
  const el = $('#info-card');
  if (el.classList.contains('hidden')) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
function showFlagCard(c, ok) {
  $('#fc-flag').src = `flags/${c.cca2}.svg`;
  $('#fc-name').textContent = getLang() === 'ja' ? c.ja : c.en;
  $('#fc-cap').textContent = `🏛️ ${getLang() === 'ja' ? c.capJa : c.capEn}`;
  const f = $('#flag-card'); f.classList.toggle('ok', !!ok); f.classList.remove('hidden');
}
function hideFlagCard() { $('#flag-card').classList.add('hidden'); }

function showResults(r) {
  const n = r.right + r.wrong;
  const ratio = n ? r.right / n : 1;
  $('#res-stars').textContent = ratio > 0.85 ? '⭐⭐⭐' : ratio > 0.6 ? '⭐⭐' : '⭐';
  $('#res-score').textContent = r.score.toLocaleString();
  $('#res-right').textContent = r.right;
  $('#res-wrong').textContent = r.wrong;
  $('#res-time').textContent = fmtDuration(r.ms);
  openModal('#modal-results');
}

// ------------------------------------------------------------------ wiring
function wire() {
  $$('.lang-seg button').forEach((b) => (b.onclick = () => { audio.sfx('click'); settings.lang = b.dataset.lang; setLang(b.dataset.lang); }));
  $$('.diff-seg button').forEach((b) => (b.onclick = () => { audio.sfx('click'); settings.difficulty = b.dataset.diff; refreshTitle(); }));
  $$('.ctl-seg button').forEach((b) => (b.onclick = () => { audio.sfx('click'); setControl(b.dataset.ctl); }));
  $('#btn-play').onclick = () => startGame(settings.difficulty);
  $('#btn-capitals').onclick = () => startGame('capitals');
  $('#btn-tutorial').onclick = () => {
    audio.sfx('click'); showScreen('tutorial');
    const reg = settings.region || 'world';
    tutorial.start(reg);
    const pick = (r) => { tutorial.setRegion(r); renderChips($('#tut-chips'), r, pick); };
    renderChips($('#tut-chips'), reg, pick);
  };
  $('#btn-parents').onclick = async () => { audio.sfx('click'); if (await parentGate()) { renderParents(); openModal('#panel-parents'); } };
  $('#btn-credits').onclick = () => { audio.sfx('click'); openModal('#panel-credits'); };
  $('#btn-quit').onclick = () => quitApp();
  $('#btn-fullscreen').onclick = () => { if (window.geograsp) window.geograsp.toggleFullscreen(); else if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); };
  $$('[data-close]').forEach((b) => (b.onclick = () => { audio.sfx('click'); closeModals(); }));
  $('#modal-back').onclick = () => { if (!$('#panel-parents').classList.contains('hidden') || !$('#panel-credits').classList.contains('hidden')) closeModals(); };

  $('#hud-back').onclick = () => { audio.sfx('click'); goTitle(); };
  $('#hud-replay').onclick = () => game.replay();
  $('#res-home').onclick = () => goTitle();
  $('#res-again').onclick = () => startGame(lastMode);
  $('#pause-resume').onclick = () => togglePause(false);
  $('#pause-home').onclick = () => goTitle();
  $('#tut-back').onclick = () => { audio.sfx('click'); goTitle(); };
  $('#tut-prev').onclick = () => tutorial.step(-1);
  $('#tut-next').onclick = () => tutorial.step(1);
  $('#info-say').onclick = () => { const c = $('#info-card')._c; if (c) tutorial.select(c); };

  const vm = $('#vol-music'), vs = $('#vol-sfx'), vv = $('#vol-voice');
  vm.value = settings.music; vs.value = settings.sfx; vv.value = settings.voice;
  vm.oninput = () => audio.setMusicVolume(+vm.value);
  vs.oninput = () => audio.setSfxVolume(+vs.value);
  vs.onchange = () => audio.sfx('click');
  vv.oninput = () => audio.setVoiceVolume(+vv.value);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (scene === 'game' && game.active && !game.done) togglePause();
      else if (anyModalOpen() && $('#modal-gate').classList.contains('hidden') && $('#modal-camera').classList.contains('hidden')) closeModals();
      else if (scene === 'tutorial') goTitle();
    }
    if (scene === 'tutorial' && e.key === 'ArrowRight') tutorial.step(1);
    if (scene === 'tutorial' && e.key === 'ArrowLeft') tutorial.step(-1);
    if (scene === 'game' && (e.key === 'r' || e.key === 'R')) game.replay();
  });
  // Closing the window: keep the child's progress and release the camera.
  window.addEventListener('beforeunload', () => { if (game && game.active) game.stop(true); pointer.stopCamera(); });
  window.addEventListener('blur', () => { if (scene === 'game' && game.active && !game.done && !game.paused) togglePause(true); });
  onLang(() => {
    refreshTitle();
    if (scene === 'tutorial') { tutorial.layout(); if (tutorial.sel) showInfo(tutorial.sel); }
    audio.voiceCache.clear();
  });
}

function togglePause(force) {
  const p = force ?? !game.paused;
  game.setPaused(p);
  if (p) openModal('#modal-pause'); else closeModals();
}

function quitApp() {
  stopCamera();
  if (game && game.active) game.stop(true);
  audio.say('goodbye', '').finally(() => {
    if (window.geograsp) window.geograsp.quit(); else window.close();
  });
  setTimeout(() => { if (window.geograsp) window.geograsp.quit(); }, 1800);
}

// Hand hover feedback on DOM buttons
let hoverEl = null;
function handHover() {
  let el = null;
  if (pointer.source === 'hand' && pointer.visible) {
    const hit = document.elementFromPoint(pointer.x, pointer.y);
    el = hit && hit.closest('button, .chip, a');
  }
  if (el !== hoverEl) {
    if (hoverEl) hoverEl.classList.remove('hand-hover');
    if (el) { el.classList.add('hand-hover'); audio.sfx('hover'); }
    hoverEl = el;
  }
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function loop(now) {
  const dt = Math.min(50, now - last); last = now;
  if (scene === 'title') drawTitle(dt);
  else if (scene === 'game') game.frame(g, dt);
  else if (scene === 'tutorial') tutorial.frame(g, dt);
  cg.clearRect(0, 0, W, H);
  handHover();
  if (pointer.source === 'hand' && pointer.visible) {
    const dwell = anyModalOpen() ? 0 : scene === 'game' ? game.cursorDwell || 0 : scene === 'tutorial' ? tutorial.cursorDwell || 0 : 0;
    drawHandCursor(cg, pointer, dwell, now);
  }
  if (pointer.cameraOn) {
    pointer.drawPreview($('#cam-preview'));
    const noHand = !pointer.handSeen;
    const msg = $('#cam-msg');
    if (noHand && msg.textContent === '') msg.textContent = t('showHand');
    else if (!noHand && msg.textContent === t('showHand')) msg.textContent = '';
  }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ boot
async function boot() {
  setLang(settings.lang || ((navigator.language || '').startsWith('ja') ? 'ja' : 'en'));
  applyI18n();
  resize();
  window.addEventListener('resize', resize);
  wire();
  showScreen('title');
  refreshTitle();
  requestAnimationFrame(loop);

  const data = await fetch('data/world.json').then((r) => r.json());
  map = new WorldMap(data);
  const app = { map, hud, showResults, showFlagCard, hideFlagCard, showInfo, hideInfo, overInfo, size: () => ({ W, H }) };
  game = new Game(app);
  tutorial = new Tutorial(app);
  window.__geograsp = { game, tutorial, map, pointer }; // handy for debugging in DevTools
  try { await document.fonts.ready; } catch { /* ignore */ }

  audio.init();
  audio.setMusicVolume(settings.music);
  audio.startMusic();
  $('#loading').classList.add('fade');
  setTimeout(() => $('#loading').remove(), 600);

  setControl(settings.camera === true && settings.control !== 'mouse' ? 'hands' : 'mouse', false);
  if (settings.camera === true && settings.control !== 'mouse') startCamera();
  // The game always starts playable with the mouse. A grown-up is only asked
  // about the camera when the player chooses Control → Hands (camera).
  setTimeout(() => audio.say('welcome', ''), 700);
}

boot();

// GeoGrasp data builder.
// Combines world-atlas (Natural Earth 1:50m shapes), world-countries (names,
// capitals, regions) and Wikidata Japanese capital names into app/data/world.json,
// and copies the required flags / vendor libraries into app/.
//
//   node scripts/build-data.mjs
//
// Copyright (C) 2026 Shawn Rapaz — GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const topojson = require('topojson-client');
const topo = require('world-atlas/countries-50m.json');
const wc = require('world-countries');
const wiki = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/wikidata-capitals.json'), 'utf8')).results.bindings;
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/overrides.json'), 'utf8'));

const CONTINENTS = {
  africa:        { en: 'Africa',        ja: 'アフリカ' },
  asia:          { en: 'Asia',          ja: 'アジア' },
  europe:        { en: 'Europe',        ja: 'ヨーロッパ' },
  north_america: { en: 'North America', ja: '北アメリカ' },
  south_america: { en: 'South America', ja: '南アメリカ' },
  oceania:       { en: 'Oceania',       ja: 'オセアニア' },
  antarctica:    { en: 'Antarctica',    ja: '南極' },
};

function continentOf(c) {
  if (overrides.continent[c.cca3]) return overrides.continent[c.cca3];
  switch (c.region) {
    case 'Africa': return 'africa';
    case 'Asia': return 'asia';
    case 'Europe': return 'europe';
    case 'Oceania': return 'oceania';
    case 'Antarctic': return 'antarctica';
    case 'Americas': return c.subregion === 'South America' ? 'south_america' : 'north_america';
    default: return 'oceania';
  }
}

// Japanese capitals from Wikidata, keyed by ISO alpha-3.
const capJa = new Map();
for (const b of wiki) {
  const iso = b.iso.value;
  const list = capJa.get(iso) || [];
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value || '');
  list.push({ en: b.capEn.value, ja: b.capJa.value, ll: m ? [Math.round(+m[1] * 100) / 100, Math.round(+m[2] * 100) / 100] : null });
  capJa.set(iso, list);
}
function capitalEntry(cca3, en) {
  const list = capJa.get(cca3);
  if (!list) return null;
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const hit = list.find((x) => norm(x.en) === norm(en)) || list.find((x) => norm(x.en).includes(norm(en)) || norm(en).includes(norm(x.en)));
  return hit || list[0];
}
function japaneseCapital(cca3, en) {
  return overrides.capitalJa[cca3] || capitalEntry(cca3, en)?.ja || null;
}

const byNum = new Map(wc.map((c) => [c.ccn3, c]));
const byName = new Map(wc.map((c) => [c.name.common, c]));
const geoms = topo.objects.countries.geometries;

// Group topology geometries by owning country (merge disputed bits into a parent).
const groups = new Map(); // cca3 -> geometry objects
const decor = [];
for (const g of geoms) {
  let c = byNum.get(g.id) || byName.get(g.properties.name);
  const merge = overrides.mergeInto[g.properties.name];
  if (merge) c = wc.find((x) => x.cca3 === merge);
  if (!c) { decor.push(g); continue; }
  if (!groups.has(c.cca3)) groups.set(c.cca3, []);
  groups.get(c.cca3).push(g);
}

const round = (geom) => {
  const r = (a) => (typeof a[0] === 'number' ? [Math.round(a[0] * 100) / 100, Math.round(a[1] * 100) / 100] : a.map(r));
  return { type: geom.type, coordinates: r(geom.coordinates) };
};

const countries = [];
const contGroups = Object.fromEntries(Object.keys(CONTINENTS).map((k) => [k, []]));
for (const [cca3, gs] of groups) {
  const c = wc.find((x) => x.cca3 === cca3);
  const cont = continentOf(c);
  contGroups[cont].push(...gs);
  const geo = round(topojson.merge(topo, gs));
  const capEn = (overrides.capitalEn[cca3] || c.capital[0] || '').trim();
  const playable = cont !== 'antarctica' && (c.unMember || overrides.extraPlayable.includes(cca3));
  const jaName = overrides.nameJa[cca3] || c.translations.jpn?.common || c.name.common;
  countries.push({
    cca3,
    cca2: c.cca2.toLowerCase(),
    en: overrides.nameEn[cca3] || c.name.common,
    ja: jaName,
    capEn: capEn || null,
    capJa: capEn ? japaneseCapital(cca3, capEn) || capEn : null,
    capLL: capEn ? (overrides.capitalLL[cca3] || capitalEntry(cca3, capEn)?.ll || null) : null,
    cont,
    area: c.area,
    latlng: c.latlng,
    play: playable,
    geo,
  });
}
for (const g of decor) contGroups[overrides.decorContinent[g.properties.name] || 'asia'].push(g);
countries.sort((a, b) => a.en.localeCompare(b.en));

// Russia spans two continents: split the merged Europe shape at the Ural
// mountains (~60°E) and give the eastern part (Siberia) to Asia.
const URAL = 60;
function clipRing(ring, west) {
  const inside = (p) => (west ? p[0] <= URAL : p[0] >= URAL);
  const cross = (a, b) => { const t = (URAL - a[0]) / (b[0] - a[0]); return [URAL, a[1] + t * (b[1] - a[1])]; };
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    if (inside(a)) { out.push(a); if (!inside(b)) out.push(cross(a, b)); }
    else if (inside(b)) out.push(cross(a, b));
  }
  if (out.length < 3) return null;
  out.push(out[0]);
  return out;
}
function splitAtUral(geo) {
  const polys = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
  const west = [], east = [];
  for (let poly of polys) {
    // Unwrap longitudes past the antimeridian (eastern Chukotka) so planar clipping works.
    if (poly[0].some((p) => p[0] > 100)) poly = poly.map((r) => r.map((p) => (p[0] < -100 ? [p[0] + 360, p[1]] : p)));
    const lons = poly[0].map((p) => p[0]);
    if (Math.max(...lons) < -100) { east.push(poly); continue; } // Chukotka beyond 180°
    if (Math.min(...lons) >= URAL) { east.push(poly); continue; }
    if (Math.max(...lons) <= URAL) { west.push(poly); continue; }
    for (const [dst, isWest] of [[west, true], [east, false]]) {
      const rings = poly.map((r) => clipRing(r, isWest)).filter(Boolean);
      if (rings.length && rings[0]) dst.push(rings);
    }
  }
  return { west, east };
}
const merged = Object.fromEntries(Object.keys(CONTINENTS).map((id) => {
  const m = topojson.merge(topo, contGroups[id]);
  return [id, m.type === 'Polygon' ? [m.coordinates] : m.coordinates];
}));
const { west, east } = splitAtUral({ type: 'MultiPolygon', coordinates: merged.europe });
merged.europe = west;
merged.asia = merged.asia.concat(east);
const continents = Object.entries(CONTINENTS).map(([id, n]) => ({
  id, en: n.en, ja: n.ja, geo: round({ type: 'MultiPolygon', coordinates: merged[id] }),
}));
const decorGeo = decor.map((g) => round(topojson.feature(topo, g).geometry));

fs.mkdirSync(path.join(APP, 'data'), { recursive: true });
fs.writeFileSync(path.join(APP, 'data/world.json'), JSON.stringify({ countries, continents, decor: decorGeo }));

// Voice script manifest (consumed by scripts/gen-voice.py).
fs.writeFileSync(path.join(ROOT, 'data/voice-lines.json'), JSON.stringify({
  countries: countries.filter((c) => c.play).map((c) => ({ key: c.cca3, en: c.en, ja: c.ja, capEn: c.capEn, capJa: c.capJa })),
  continents: continents.map((c) => ({ key: c.id, en: c.en, ja: c.ja })),
}, null, 1));

// Flags
fs.mkdirSync(path.join(APP, 'flags'), { recursive: true });
let flags = 0;
for (const c of countries) {
  const src = path.join(ROOT, 'node_modules/flag-icons/flags/4x3', `${c.cca2}.svg`);
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(APP, 'flags', `${c.cca2}.svg`)); flags++; }
  else console.warn('no flag for', c.cca3);
}

// Vendor libs (so the packaged app has no runtime npm deps and works offline)
const V = path.join(APP, 'vendor');
fs.mkdirSync(path.join(V, 'wasm'), { recursive: true });
const copies = [
  ['node_modules/d3-array/dist/d3-array.min.js', 'd3-array.min.js'],
  ['node_modules/d3-geo/dist/d3-geo.min.js', 'd3-geo.min.js'],
  ['node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', 'vision_bundle.mjs'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.js'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_internal.wasm'],
  ['assets/models/hand_landmarker.task', 'hand_landmarker.task'],
];
for (const [s, d] of copies) fs.copyFileSync(path.join(ROOT, s), path.join(V, d));

const play = countries.filter((c) => c.play);
console.log(`countries: ${countries.length} (playable ${play.length}), flags: ${flags}, decor: ${decor.length}`);
console.log('missing JA capital:', play.filter((c) => c.capEn && c.capJa === c.capEn).map((c) => c.cca3).join(' ') || 'none');
console.log('size:', (fs.statSync(path.join(APP, 'data/world.json')).size / 1024).toFixed(0), 'KB');

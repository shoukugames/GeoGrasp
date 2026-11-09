// GeoGrasp — world map geometry and rendering helpers (GPL-3.0-or-later)
/* global d3 */

export const CONT_COLORS = {
  africa: [28, 88, 64],
  asia: [46, 90, 62],
  europe: [208, 85, 66],
  north_america: [352, 85, 70],
  south_america: [135, 55, 60],
  oceania: [265, 75, 72],
  antarctica: [205, 60, 92],
};

// lon/lat boxes used to frame each region, plus a projection rotation.
export const REGIONS = {
  world:         { box: [-180, -57, 180, 84], rotate: [-11, 0] },
  africa:        { box: [-19, -36, 53, 38], rotate: [-15, 0] },
  europe:        { box: [-25, 34, 45, 71.5], rotate: [-10, 0] },
  asia:          { box: [26, -11, 148, 56], rotate: [-90, 0] },
  north_america: { box: [-168, 6, -52, 74], rotate: [105, 0] },
  south_america: { box: [-82, -56, -34, 13], rotate: [60, 0] },
  oceania:       { box: [110, -48, 182, 2], rotate: [-150, 0] },
};

function hsl([h, s, l], dl = 0, a = 1) { return `hsla(${h},${s}%,${Math.max(0, Math.min(100, l + dl))}%,${a})`; }
// Neighbouring countries get clearly different shades of their continent colour.
export const colorFor = (cont, idx = 0, dl = 0, a = 1) => {
  const [h, s, l] = CONT_COLORS[cont];
  return hsl([h + (((idx * 47) % 7) - 3) * 6, s, l], dl + (((idx * 31) % 5) - 2) * 5, a);
};

function boxPoints([x0, y0, x1, y1]) {
  const pts = [];
  for (let x = x0; x <= x1; x += 4) { pts.push([x, y0], [x, y1]); }
  for (let y = y0; y <= y1; y += 4) { pts.push([x0, y], [x1, y]); }
  return { type: 'MultiPoint', coordinates: pts };
}

/** Pick the polygons that make up the recognisable "main body" of a country. */
function mainGeometry(geo, continent = false) {
  if (geo.type !== 'MultiPolygon') return geo;
  if (continent) {
    const polys = geo.coordinates.map((c) => ({ c, area: d3.geoArea({ type: 'Polygon', coordinates: c }) }));
    const max = Math.max(...polys.map((p) => p.area));
    return { type: 'MultiPolygon', coordinates: polys.filter((p) => p.area > max * 0.012).map((p) => p.c) };
  }
  const polys = geo.coordinates.map((c) => {
    const g = { type: 'Polygon', coordinates: c };
    return { c, area: d3.geoArea(g), cen: d3.geoCentroid(g) };
  });
  const big = polys.reduce((a, b) => (b.area > a.area ? b : a));
  const keep = polys.filter((p) => p === big || p.area > big.area * 0.3 || d3.geoDistance(p.cen, big.cen) < 0.3);
  return { type: 'MultiPolygon', coordinates: keep.map((p) => p.c) };
}

export class WorldMap {
  constructor(data) {
    this.data = data;
    this.countries = data.countries.map((c, i) => ({ ...c, idx: i, main: mainGeometry(c.geo) }));
    this.byCode = new Map(this.countries.map((c) => [c.cca3, c]));
    this.continents = data.continents.map((c, i) => ({ ...c, idx: i, cca3: c.id, cont: c.id, main: mainGeometry(c.geo, true) }));
    this.graticule = d3.geoGraticule10();
  }

  /** Fit the map into a pixel rectangle for a region and pre-compute all paths. */
  layout(rect, region = 'world') {
    const R = REGIONS[region] || REGIONS.world;
    const proj = d3.geoNaturalEarth1().rotate(R.rotate).precision(0.3)
      .fitExtent([[rect.x + 14, rect.y + 14], [rect.x + rect.w - 14, rect.y + rect.h - 14]], region === 'world' ? { type: 'Sphere' } : boxPoints(R.box));
    this.proj = proj; this.rect = rect; this.region = region;
    const path = d3.geoPath(proj);
    this.path = path;
    const prep = (c) => {
      const full = path(c.geo), main = path(c.main);
      c.p2d = full ? new Path2D(full) : null;
      c.main2d = main ? new Path2D(main) : null;
      c.bounds = path.bounds(c.main);
      c.cen = path.centroid(c.main);
      c.parea = path.area(c.main);
      c.size = Math.max(c.bounds[1][0] - c.bounds[0][0], c.bounds[1][1] - c.bounds[0][1]);
      c.onScreen = !!main && Number.isFinite(c.cen[0]) && c.cen[0] > rect.x && c.cen[0] < rect.x + rect.w && c.cen[1] > rect.y && c.cen[1] < rect.y + rect.h;
      if (c.capLL) { const p = proj(c.capLL); c.capXY = p; }
    };
    this.countries.forEach(prep);
    this.continents.forEach(prep);
    this.decor = this.data.decor.map((g) => new Path2D(path(g) || ''));
    this.grat2d = new Path2D(path(this.graticule));
    this.sphere2d = new Path2D(path({ type: 'Sphere' }));
    return proj;
  }

  countryAt(ctx, x, y, list = this.countries) {
    let best = null;
    for (const c of list) {
      if (!c.p2d) continue;
      if (ctx.isPointInPath(c.p2d, x, y)) { if (!best || c.parea < best.parea) best = c; }
    }
    return best;
  }

  /** Nearest (by centroid) — helps small countries with a forgiving radius. */
  nearest(x, y, list, maxDist) {
    let best = null, bd = maxDist;
    for (const c of list) {
      if (!c.onScreen) continue;
      const d = Math.hypot(c.cen[0] - x, c.cen[1] - y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
}

/** Draw ocean, graticule and a soft vignette. */
export function drawOcean(g, W, H, map, t = 0) {
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#0e4a7a'); grd.addColorStop(0.55, '#0b3d6b'); grd.addColorStop(1, '#082c52');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  if (!map) return;
  g.save();
  g.clip(map.sphere2d);
  const og = g.createRadialGradient(W * 0.45, H * 0.4, 50, W * 0.45, H * 0.45, Math.max(W, H) * 0.7);
  og.addColorStop(0, '#1f7fb8'); og.addColorStop(0.6, '#145f96'); og.addColorStop(1, '#0d4a7c');
  g.fillStyle = og; g.fill(map.sphere2d);
  g.strokeStyle = 'rgba(255,255,255,0.09)'; g.lineWidth = 1;
  g.stroke(map.grat2d);
  g.restore();
  g.strokeStyle = 'rgba(160,220,255,0.35)'; g.lineWidth = 2;
  g.stroke(map.sphere2d);
}

/** Fill a piece/country with a glossy puzzle look. */
export function drawPiece(g, p2d, base, { stroke = 'rgba(255,255,255,0.95)', lw = 1.2, scale = 1, gloss = true, bounds = null } = {}) {
  g.fillStyle = base;
  g.fill(p2d);
  if (gloss && bounds) {
    const [[x0, y0], [x1, y1]] = bounds;
    const gr = g.createLinearGradient(x0, y0, x1 * 0.4 + x0 * 0.6, y1);
    gr.addColorStop(0, 'rgba(255,255,255,0.38)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = gr; g.fill(p2d);
  }
  g.lineJoin = 'round';
  g.strokeStyle = stroke; g.lineWidth = lw / scale;
  g.stroke(p2d);
}

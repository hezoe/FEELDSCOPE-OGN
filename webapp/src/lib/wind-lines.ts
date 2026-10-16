/**
 * 風の流線(静止表示)。ogn.ezoe.net v0.22 と同じ描き方。
 * 風速で色分けした流線(白い縁・矢じり=風下の向き)を、地図を動かし終えたとき・データ更新時だけ描き直す。
 * v1.4.25〜1.4.29 の粒子アニメーション(leaflet-velocity)は画面全体を毎秒20回塗り直し、
 * ブラウザの処理能力をほぼ使い切っていた(ogn.ezoe.net の計測で使用率 99%・描画 15〜19回/秒 → 流線で 4〜5%)。
 */
import L from "leaflet";

/** grib2json 形式(/api/wind/<level> の応答): [U(東向き m/s), V(北向き m/s)]、北の行から南へ・西から東へ */
export type WindGridData = { header: { nx: number; ny: number; la1: number; lo1: number; dx: number; dy: number }; data: (number | null)[] }[];

const STEP = 2;            // 流線をたどる刻み(px)
const MAX_STEPS = 400;     // 片側の最大の長さ(刻み数)
const SEED = 30;           // 出発点の間隔(px)。地図(世界座標)に固定するので、少し動かしても線の形が変わらない
const CELL = 10, SEP = 3;  // 線どうしの間隔: 10px のます目で、半径3ます以内に別の線があれば止める
const MIN_LEN = 12;        // これより短い線(刻み数)は描かない
const ARROW_EVERY = 30;    // 矢じりの間隔(刻み数=約60px)
const REDRAW_PX = 64;      // 同じ縮尺・大きさでこれ未満しか動いていなければ描き直さない
const NCOL = 24;           // 色の段数(同じ色の区間をまとめて描く)

/** 格子の風(u, v)。値の無います目に掛かれば null */
function windUV(g: WindGridData, lat: number, lon: number): [number, number] | null {
  const h = g[0].header, U = g[0].data, V = g[1].data;
  const fx = (lon - h.lo1) / h.dx, fy = (h.la1 - lat) / h.dy;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= h.nx || y0 + 1 >= h.ny) return null;
  const k = y0 * h.nx + x0, ks = [k, k + 1, k + h.nx, k + h.nx + 1];
  for (const i of ks) if (U[i] == null || V[i] == null) return null;
  const tx = fx - x0, ty = fy - y0, w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  let u = 0, v = 0;
  for (let i = 0; i < 4; i++) { u += (U[ks[i]] as number) * w[i]; v += (V[ks[i]] as number) * w[i]; }
  return [u, v];
}
const hash = (i: number, j: number) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function makePalette(colors: string[]): string[] {
  const rgb = colors.map((c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)));
  return Array.from({ length: NCOL }, (_, i) => {
    const t = (i / (NCOL - 1)) * (rgb.length - 1), k = Math.min(Math.floor(t), rgb.length - 2), f = t - k;
    return `rgb(${rgb[k].map((v, n) => Math.round(v + (rgb[k + 1][n] - v) * f)).join(",")})`;
  });
}

function draw(cv: HTMLCanvasElement, m: L.Map, g: WindGridData | null, palette: string[], maxMs: number): void {
  const size = m.getSize(), W = size.x, H = size.y, dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + "px"; cv.style.height = H + "px";
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  if (!g) return;
  const colorIdx = (ms: number) => Math.round(Math.min(Math.max(ms / maxMs, 0), 1) * (NCOL - 1));
  // 東・北の画面上の単位ベクトル(メルカトルは等角なので中心で求めれば画面全体に使える)
  const c = m.containerPointToLatLng([W / 2, H / 2]), p0 = m.latLngToContainerPoint(c);
  const pe = m.latLngToContainerPoint([c.lat, c.lng + 0.01]), pn = m.latLngToContainerPoint([c.lat + 0.01, c.lng]);
  const le = Math.hypot(pe.x - p0.x, pe.y - p0.y) || 1, ln = Math.hypot(pn.x - p0.x, pn.y - p0.y) || 1;
  const ex = [(pe.x - p0.x) / le, (pe.y - p0.y) / le], ny = [(pn.x - p0.x) / ln, (pn.y - p0.y) / ln];
  const at = (x: number, y: number) => { const ll = m.containerPointToLatLng([x, y]); return windUV(g, ll.lat, ll.lng); };
  const gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL), occ = new Uint8Array(gw * gh);
  const cellOf = (x: number, y: number) => { const i = Math.floor(x / CELL), j = Math.floor(y / CELL); return i < 0 || j < 0 || i >= gw || j >= gh ? -1 : j * gw + i; };
  const free = (x: number, y: number) => {
    const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
    if (i < 0 || j < 0 || i >= gw || j >= gh) return false;
    for (let b = -SEP + 1; b < SEP; b++) for (let a = -SEP + 1; a < SEP; a++) {
      const ii = i + a, jj = j + b;
      if (ii >= 0 && jj >= 0 && ii < gw && jj < gh && occ[jj * gw + ii]) return false;
    }
    return true;
  };
  const trace = (x: number, y: number, dir: number) => {
    const pts: [number, number, number][] = [];
    for (let n = 0; n < MAX_STEPS; n++) {
      const w = at(x, y); if (!w) break;
      const sp = Math.hypot(w[0], w[1]); if (sp < 0.3) break;
      const dx = (w[0] * ex[0] + w[1] * ny[0]) / sp, dy = (w[0] * ex[1] + w[1] * ny[1]) / sp;
      const nx = x + dir * STEP * dx, nyy = y + dir * STEP * dy;
      if (!free(nx, nyy)) break;
      pts.push([nx, nyy, sp]); x = nx; y = nyy;
    }
    return pts;
  };
  // 出発点: 世界座標の格子(SEED px)に固定し、ずらし量と順番は格子番号のハッシュで決める
  const z = m.getZoom(), corners = [[0, 0], [W, 0], [0, H], [W, H]].map((q) => m.project(m.containerPointToLatLng(q as [number, number]), z));
  const xs = corners.map((q) => q.x), ys = corners.map((q) => q.y);
  const i0 = Math.floor(Math.min(...xs) / SEED), i1 = Math.ceil(Math.max(...xs) / SEED);
  const j0 = Math.floor(Math.min(...ys) / SEED), j1 = Math.ceil(Math.max(...ys) / SEED);
  const seeds: [number, number, number][] = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const r = hash(i, j), wx = (i + 0.5 + (r - 0.5) * 0.66) * SEED, wy = (j + 0.5 + (hash(j, i) - 0.5) * 0.66) * SEED;
    const cp = m.latLngToContainerPoint(m.unproject([wx, wy], z));
    if (cp.x >= 0 && cp.y >= 0 && cp.x < W && cp.y < H) seeds.push([r, cp.x, cp.y]);
  }
  seeds.sort((a, b) => a[0] - b[0]);
  const lines: [number, number, number][][] = [];
  for (const [, sx, sy] of seeds) {
    if (!free(sx, sy)) continue;                     // 既にほかの線が近くを通っている
    const line = trace(sx, sy, -1).reverse().concat([[sx, sy, 0]], trace(sx, sy, 1));
    if (line.length < MIN_LEN) continue;
    for (const q of line) { const k = cellOf(q[0], q[1]); if (k >= 0) occ[k] = 1; }
    lines.push(line);
  }
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // 下地の白い縁(地図の上でも線が見えるように)
  ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 3.2; ctx.beginPath();
  for (const l of lines) { ctx.moveTo(l[0][0], l[0][1]); for (const q of l) ctx.lineTo(q[0], q[1]); }
  ctx.stroke();
  // 風速の色で、同じ色の区間をまとめて描く
  const paths: [number, number, number][][][] = Array.from({ length: NCOL }, () => []);
  for (const l of lines) {
    let ci = -1, seg: [number, number, number][] = [];
    for (let k = 1; k < l.length; k++) {
      const c2 = colorIdx(l[k][2] || l[k - 1][2]);
      if (c2 !== ci) { seg = [l[k - 1]]; paths[c2].push(seg); ci = c2; }
      seg.push(l[k]);
    }
  }
  ctx.lineWidth = 1.6;
  paths.forEach((segs, ci) => {
    if (!segs.length) return;
    ctx.strokeStyle = palette[ci]; ctx.beginPath();
    for (const sgm of segs) { ctx.moveTo(sgm[0][0], sgm[0][1]); for (const q of sgm) ctx.lineTo(q[0], q[1]); }
    ctx.stroke();
  });
  // 矢じり(風下の向き)
  ctx.lineWidth = 1.8;
  for (const l of lines) for (let k = 25; k < l.length - 2; k += ARROW_EVERY) {
    const [ax, ay, sp] = l[k], [bx, by] = l[k + 2], ang = Math.atan2(by - ay, bx - ax), hl = 6;
    ctx.strokeStyle = palette[colorIdx(sp)]; ctx.beginPath();
    for (const s of [-0.5, 0.5]) { ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(ang + s) * hl, by - Math.sin(ang + s) * hl); }
    ctx.stroke();
  }
}

/** 風の流線のレイヤ。pane に描画面(canvas)を1枚置き、画面の左上に合わせて描く */
export class WindLinesLayer extends L.Layer {
  private cv: HTMLCanvasElement | null = null;
  private grid: WindGridData | null;
  private last: { zoom: number; size: L.Point; pane: L.Point } | null = null;
  private readonly palette: string[];
  private readonly paneName: string;
  private readonly maxMs: number;

  constructor(opts: { pane: string; colors: string[]; maxMs: number; grid?: WindGridData | null }) {
    super();
    this.paneName = opts.pane;
    this.palette = makePalette(opts.colors);
    this.maxMs = opts.maxMs;
    this.grid = opts.grid || null;
  }
  onAdd(m: L.Map): this {
    this.cv = L.DomUtil.create("canvas", "wind-lines", m.getPane(this.paneName)) as HTMLCanvasElement;
    this.cv.style.pointerEvents = "none";
    m.on("moveend resize", this.onMoveEnd, this);
    m.on("zoomstart", this.hide, this);
    this.redraw();
    return this;
  }
  onRemove(m: L.Map): this {
    m.off("moveend resize", this.onMoveEnd, this);
    m.off("zoomstart", this.hide, this);
    if (this.cv) L.DomUtil.remove(this.cv);
    this.cv = null;
    return this;
  }
  setGrid(g: WindGridData): void { this.grid = g; this.redraw(); }
  private hide(): void { if (this.cv) this.cv.style.visibility = "hidden"; }
  private panePos(m: L.Map): L.Point {
    return (m as unknown as { _getMapPanePos(): L.Point })._getMapPanePos();
  }
  private onMoveEnd(e: L.LeafletEvent): void {
    const m = this._map, l = this.last;
    if (!m || !this.cv) return;
    // 同じ縮尺・大きさで少しだけ動いた(自動追従など)なら描き直さない(描画面は地図と一緒に動いている)
    if (e.type === "moveend" && l && this.cv.style.visibility !== "hidden" && m.getZoom() === l.zoom && m.getSize().equals(l.size)) {
      const p = this.panePos(m);
      if (Math.abs(p.x - l.pane.x) < REDRAW_PX && Math.abs(p.y - l.pane.y) < REDRAW_PX) return;
    }
    this.redraw();
  }
  redraw(): void {
    const m = this._map;
    if (!m || !this.cv) return;
    const pane = this.panePos(m);
    L.DomUtil.setPosition(this.cv, pane.multiplyBy(-1));   // 画面の左上に合わせる
    draw(this.cv, m, this.grid, this.palette, this.maxMs);
    this.cv.style.visibility = "";
    this.last = { zoom: m.getZoom(), size: m.getSize(), pane };
  }
}

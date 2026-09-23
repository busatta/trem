import * as THREE from 'three';
import { mat, matD, mesh, box, cylY, cylX, sphere, rng, smoothstep, textTexture } from './util.js';

// ---------------------------------------------------------------------------
// Trilho: um oval com retas longas (para as estações) e curvas suaves.
// ---------------------------------------------------------------------------
export class Track {
  constructor() {
    const pts = [];
    const N = 96;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const e = 2 / 3.2;
      pts.push(new THREE.Vector3(
        115 * Math.sign(c) * Math.abs(c) ** e,
        0,
        75 * Math.sign(s) * Math.abs(s) ** e + 12 * Math.sin(2 * th),
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = 3000;
    this.length = curve.getLength();

    // Amostras pré-calculadas a cada 0,5 unidade (rápido de consultar).
    this.step = 0.5;
    this.n = Math.ceil(this.length / this.step);
    this.px = new Float32Array(this.n);
    this.pz = new Float32Array(this.n);
    this.tx = new Float32Array(this.n);
    this.tz = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const u = i / this.n;
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u);
      const l = Math.hypot(t.x, t.z);
      this.px[i] = p.x; this.pz[i] = p.z;
      this.tx[i] = t.x / l; this.tz[i] = t.z / l;
    }
  }

  wrap(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  // Posição, tangente (frente) e lado direito numa distância s.
  sample(s, out = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3() }) {
    const f = (this.wrap(s) / this.length) * this.n;
    const i0 = Math.floor(f) % this.n, i1 = (i0 + 1) % this.n, a = f - Math.floor(f);
    out.p.set(this.px[i0] + (this.px[i1] - this.px[i0]) * a, 0, this.pz[i0] + (this.pz[i1] - this.pz[i0]) * a);
    out.t.set(this.tx[i0] + (this.tx[i1] - this.tx[i0]) * a, 0, this.tz[i0] + (this.tz[i1] - this.tz[i0]) * a).normalize();
    out.r.set(-out.t.z, 0, out.t.x);
    return out;
  }

  // Lado de fora do oval (+1 = direita, -1 = esquerda).
  outward(s) {
    const f = this.sample(s);
    return Math.sign(f.r.x * f.p.x + f.r.z * f.p.z) || 1;
  }

  // Distância "para frente" de a até b ao longo do trilho.
  ahead(a, b) {
    return this.wrap(b - a);
  }
}

// Varre um perfil 2D (lateral, altura) ao longo do trilho entre s0 e s1.
export function sweep(track, profile, s0, s1, step, colorFn) {
  const segs = Math.max(1, Math.ceil((s1 - s0) / step));
  const pos = [], col = [], idx = [];
  const n = profile.length;
  const f = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3() };
  const color = new THREE.Color();
  for (let i = 0; i <= segs; i++) {
    const s = s0 + ((s1 - s0) * i) / segs;
    track.sample(s, f);
    for (let j = 0; j < n; j++) {
      const [lx, ly] = profile[j];
      pos.push(f.p.x + f.r.x * lx, ly, f.p.z + f.r.z * lx);
      if (colorFn) {
        colorFn(j, lx, ly, color);
        col.push(color.r, color.g, color.b);
      }
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rect(x0, x1, y0, y1) {
  return [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]];
}

// ---------------------------------------------------------------------------
// Mundo
// ---------------------------------------------------------------------------
export class World {
  constructor(scene) {
    this.scene = scene;
    this.track = new Track();
    const L = this.track.length;
    this.tunnel = { s0: -24, s1: 24 };
    this.bridge = { s0: L * 0.5 - 10, s1: L * 0.5 + 10 };
    this.lake = { x: -35, z: 0, r: 24 };
    this.river = { x0: -35, x1: -320, z: 0, w: 6 };
    this.stations = [
      { id: 'fazenda', name: 'Fazenda', emoji: '🚜', s: L * 0.25, kind: 'load' },
      { id: 'cidade', name: 'Cidade', emoji: '🏠', s: L * 0.75, kind: 'unload' },
    ];
    for (const st of this.stations) {
      st.o = this.track.outward(st.s);
      st.frame = this.track.sample(st.s);
      st.frame = { p: st.frame.p.clone(), t: st.frame.t.clone(), r: st.frame.r.clone() };
    }
    this.cows = [];
    this.windows = mat(0x333333, { emissive: 0xffd54f, emissiveIntensity: 0 });
    this.clickables = [];

    this._buildDistanceGrid();
    this._lights();
    this._sky();
    this._terrain();
    this._water();
    this._trackMeshes();
    this._tunnel();
    this._bridge();
    this._catenary();
    for (const st of this.stations) this._station(st);
    this._farm(this.stations[0]);
    this._town(this.stations[1]);
    this._windmill(35, 18);
    this._trees();
    this._clouds();
  }

  // ----- distância até o trilho (para achatar o terreno perto dele) -----
  _buildDistanceGrid() {
    const tr = this.track;
    this.cell = 16;
    this.grid = new Map();
    for (let i = 0; i < tr.n; i += 3) {
      const k = `${Math.floor(tr.px[i] / this.cell)},${Math.floor(tr.pz[i] / this.cell)}`;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(tr.px[i], tr.pz[i]);
    }
  }

  distToTrack(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = 1e9;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const arr = this.grid.get(`${cx + i},${cz + j}`);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 2) {
          const dx = arr[k] - x, dz = arr[k + 1] - z;
          const d = dx * dx + dz * dz;
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best);
  }

  waterMask(x, z) {
    const { lake, river } = this;
    const dl = Math.hypot(x - lake.x, z - lake.z);
    let m = 1 - smoothstep(lake.r - 4, lake.r, dl);
    if (x < river.x0 && x > river.x1) {
      const wig = Math.sin(x * 0.05) * 3 * smoothstep(-130, -160, x);
      const dr = Math.abs(z - wig);
      m = Math.max(m, 1 - smoothstep(river.w - 2.5, river.w, dr));
    }
    return m;
  }

  heightAt(x, z) {
    const d = this.distToTrack(x, z);
    let hills = 0;
    hills += Math.max(0, Math.sin(x * 0.031) * Math.cos(z * 0.027) * 7 + Math.sin((x + z) * 0.017) * 4);
    const fromCenter = Math.hypot(x, z * 1.3);
    hills += smoothstep(150, 250, fromCenter) * (18 + Math.sin(x * 0.05 + z * 0.03) * 8);
    // Montanha do túnel
    const dm = Math.hypot(x - 150, z);
    hills += Math.max(0, 1 - dm / 60) ** 1.5 * 26;
    // Terreno plano perto das estações
    for (const st of this.stations) {
      const ds = Math.hypot(x - st.frame.p.x, z - st.frame.p.z);
      hills *= smoothstep(45, 75, ds);
    }
    let h = hills * smoothstep(7, 30, d);
    const w = this.waterMask(x, z);
    h = h * (1 - w) + -2.6 * w;
    return h;
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5c7a3a, 1.3);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -35; sc.right = 35; sc.top = 35; sc.bottom = -35; sc.near = 1; sc.far = 200;
    this.sun.shadow.bias = -0.0015;
    this.sunOffset = new THREE.Vector3(40, 70, 25);
    this.scene.add(this.sun, this.sun.target);
  }

  _sky() {
    this.dayColor = new THREE.Color(0x8fd3ff);
    this.nightColor = new THREE.Color(0x0b1333);
    this.scene.background = this.dayColor.clone();
    this.scene.fog = new THREE.Fog(this.dayColor.clone(), 150, 420);

    // Estrelas
    const r = rng(7);
    const pos = [];
    for (let i = 0; i < 500; i++) {
      const th = r() * Math.PI * 2, ph = r() * 1.3;
      pos.push(Math.cos(th) * Math.cos(ph) * 380, Math.sin(ph) * 380 + 20, Math.sin(th) * Math.cos(ph) * 380);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    this.scene.add(this.stars);

    this.moon = sphere(14, new THREE.MeshBasicMaterial({ color: 0xfff9d6, fog: false }), -200, 170, -250, 24);
    this.moon.castShadow = false;
    this.moon.visible = false;
    this.scene.add(this.moon);
  }

  _terrain() {
    const size = 600, segs = 170;
    const g = new THREE.PlaneGeometry(size, size, segs, segs);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = [];
    const c = new THREE.Color();
    const grass = new THREE.Color(0x7ccf5b), grass2 = new THREE.Color(0x5daa45);
    const sand = new THREE.Color(0xe3cf92), rock = new THREE.Color(0x9c8f7c), snow = new THREE.Color(0xffffff);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      const n = (Math.sin(x * 0.13) + Math.cos(z * 0.11) + Math.sin((x - z) * 0.07)) / 6 + 0.5;
      c.copy(grass).lerp(grass2, n);
      if (h < -0.3) c.copy(sand);
      else if (h < 0.2 && this.waterMask(x, z) > 0.05) c.lerp(sand, 0.6);
      if (h > 16) c.lerp(rock, smoothstep(16, 22, h));
      if (h > 26) c.lerp(snow, smoothstep(26, 30, h));
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  _water() {
    const g = new THREE.PlaneGeometry(600, 600);
    g.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.MeshLambertMaterial({ color: 0x3ba7e8, transparent: true, opacity: 0.85 });
    const w = new THREE.Mesh(g, this.waterMat);
    w.position.y = -0.9;
    this.scene.add(w);
  }

  _trackMeshes() {
    const tr = this.track, L = tr.length;
    // Brita
    const ballast = new THREE.Mesh(
      sweep(tr, [[-2.4, 0.02], [-1.9, 0.32], [1.9, 0.32], [2.4, 0.02]], 0, L, 1.5),
      matD(0xa39486),
    );
    ballast.receiveShadow = true;
    this.scene.add(ballast);

    // Dormentes
    const count = Math.floor(L / 1.3);
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.18, 0.5), mat(0x7a5230), count);
    const f = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3() };
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      tr.sample(i * 1.3, f);
      o.position.set(f.p.x, 0.4, f.p.z);
      o.rotation.set(0, Math.atan2(f.t.x, f.t.z), 0);
      o.updateMatrix();
      sleepers.setMatrixAt(i, o.matrix);
    }
    sleepers.receiveShadow = true;
    this.scene.add(sleepers);

    // Trilhos
    const railMat = new THREE.MeshLambertMaterial({ color: 0xc8ccd2, emissive: 0x222222, side: THREE.DoubleSide });
    for (const side of [-0.75, 0.75]) {
      const rail = new THREE.Mesh(
        sweep(tr, [[side - 0.09, 0.49], [side - 0.09, 0.7], [side + 0.09, 0.7], [side + 0.09, 0.49]], 0, L, 1.0),
        railMat,
      );
      this.scene.add(rail);
    }
  }

  _tunnel() {
    const tr = this.track;
    const { s0, s1 } = this.tunnel;
    // Perfil externo (monte) e interno (arco), em (lateral, altura)
    const outer = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI;
      outer.push([Math.cos(a) * 14, Math.pow(Math.sin(a), 0.8) * 13]);
    }
    const inner = [[3.6, 0], [3.6, 5.2]];
    for (let i = 1; i < 12; i++) {
      const a = (i / 12) * Math.PI;
      inner.push([Math.cos(a) * 3.6, 5.2 + Math.sin(a) * 3.6]);
    }
    inner.push([-3.6, 5.2], [-3.6, 0]);

    const grass = new THREE.Color(0x6cbf4f), dirt = new THREE.Color(0x8d7a5a);
    const outerGeo = sweep(tr, outer, s0, s1, 2, (j, lx, ly, c) => c.copy(dirt).lerp(grass, smoothstep(2, 7, ly)));
    const innerGeo = sweep(tr, inner, s0, s1, 2, (j, lx, ly, c) => c.setRGB(0.22, 0.2, 0.2));
    const m1 = new THREE.Mesh(outerGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const m2 = new THREE.Mesh(innerGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m1.receiveShadow = true;
    this.scene.add(m1, m2);

    // Portais de pedra nas duas pontas
    const contour = [...outer.map(([x, y]) => new THREE.Vector2(x, y)), ...inner.slice().reverse().map(([x, y]) => new THREE.Vector2(x, y))];
    // outer vai de +14 até -14; inner invertido vai de -3.6 até +3.6: forma simples
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const s of [s0, s1]) {
      const f = tr.sample(s);
      const pos = [];
      for (const v of contour) pos.push(f.p.x + f.r.x * v.x, v.y, f.p.z + f.r.z * v.x);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(tris.flat());
      g.computeVertexNormals();
      this.scene.add(new THREE.Mesh(g, mat(0xa89a8a, { side: THREE.DoubleSide })));
      // Arco de pedra em volta da entrada
      const archPts = inner.map(([x, y]) => [x * 1.12, y * 1.06]);
      const ring = [];
      for (let i = 0; i < inner.length; i++) {
        ring.push(new THREE.Vector3(f.p.x + f.r.x * archPts[i][0], archPts[i][1], f.p.z + f.r.z * archPts[i][0]));
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring), 40, 0.45, 6, false);
      this.scene.add(mesh(tube, 0x7d6e62));
    }
    // Pedras e pinheiros em cima do túnel
    const r = rng(11);
    for (let i = 0; i < 10; i++) {
      const s = s0 + 4 + r() * (s1 - s0 - 8);
      const f = tr.sample(s);
      const lat = (r() - 0.5) * 16;
      const y = Math.pow(Math.max(0, 1 - (lat / 14) ** 2), 0.4) * 13 - 0.5;
      const rock = mesh(new THREE.DodecahedronGeometry(1 + r() * 1.5), 0x9e9e9e, f.p.x + f.r.x * lat, y, f.p.z + f.r.z * lat);
      this.scene.add(rock);
    }
  }

  _bridge() {
    const tr = this.track;
    const { s0, s1 } = this.bridge;
    const wood = matD(0x8d5a2b), red = matD(0xd84343);
    this.scene.add(new THREE.Mesh(sweep(tr, rect(-2.7, 2.7, -0.7, 0.05), s0 - 2, s1 + 2, 1), wood));
    for (const side of [-2.8, 2.8]) {
      this.scene.add(new THREE.Mesh(sweep(tr, rect(side - 0.15, side + 0.15, 1.0, 1.3), s0 - 2, s1 + 2, 1), red));
    }
    // Colunas e pilares
    const f = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3() };
    for (let s = s0 - 2; s <= s1 + 2.01; s += 2.4) {
      tr.sample(s, f);
      for (const side of [-2.8, 2.8]) {
        this.scene.add(box(0.25, 1.1, 0.25, red, f.p.x + f.r.x * side, 0.6, f.p.z + f.r.z * side));
      }
    }
    for (const s of [s0 + 3, (s0 + s1) / 2, s1 - 3]) {
      tr.sample(s, f);
      const pier = box(4.5, 4, 1.2, 0x9e9e9e, f.p.x, -2.6, f.p.z);
      pier.rotation.y = Math.atan2(f.t.x, f.t.z);
      this.scene.add(pier);
    }
  }

  _catenary() {
    const tr = this.track, L = tr.length;
    // Fio por cima do trilho (para o trem elétrico)
    this.scene.add(new THREE.Mesh(sweep(tr, rect(-0.04, 0.04, 6.3, 6.38), 0, L, 2), matD(0x444444)));
    const spots = [];
    for (let s = 5; s < L; s += 24) {
      if (s > L + this.tunnel.s0 - 4 || s < this.tunnel.s1 + 4) continue;
      if (s > this.bridge.s0 - 4 && s < this.bridge.s1 + 4) continue;
      spots.push(s);
    }
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 7.2, 8), mat(0x6d7b85), spots.length);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.15, 4.2), mat(0x6d7b85), spots.length);
    const o = new THREE.Object3D();
    spots.forEach((s, i) => {
      const f = tr.sample(s);
      const side = -tr.outward(s) * 3.7;
      o.position.set(f.p.x + f.r.x * side, 3.6, f.p.z + f.r.z * side);
      o.rotation.set(0, 0, 0);
      o.updateMatrix();
      poles.setMatrixAt(i, o.matrix);
      const mid = side / 2;
      o.position.set(f.p.x + f.r.x * mid, 6.9, f.p.z + f.r.z * mid);
      o.rotation.set(0, Math.atan2(f.r.x, f.r.z), 0);
      o.updateMatrix();
      arms.setMatrixAt(i, o.matrix);
    });
    poles.castShadow = true;
    this.scene.add(poles, arms);
  }

  // Posição no mundo relativa a uma estação: ao longo do trilho e para fora.
  stationPoint(st, along, out, y = 0) {
    const f = st.frame;
    return new THREE.Vector3(
      f.p.x + f.t.x * along + f.r.x * out * st.o,
      y,
      f.p.z + f.t.z * along + f.r.z * out * st.o,
    );
  }

  _station(st) {
    const tr = this.track, o = st.o;
    const half = 22;
    const p = (a, b) => (o > 0 ? [a, b] : [-a, b]);
    const plat = [p(2.2, 0), p(2.2, 1.1), p(7.5, 1.1), p(7.5, 0), p(2.2, 0)];
    const platMesh = new THREE.Mesh(sweep(tr, plat, st.s - half, st.s + half, 1), matD(0xd7ccc8));
    platMesh.receiveShadow = true;
    this.scene.add(platMesh);
    this.scene.add(new THREE.Mesh(sweep(tr, [p(2.25, 1.12), p(2.7, 1.12)], st.s - half, st.s + half, 1), matD(0xffd600)));

    // Telhado com colunas
    const roofCol = st.kind === 'load' ? 0xc62828 : 0x1565c0;
    this.scene.add(new THREE.Mesh(sweep(tr, rect(...(o > 0 ? [3.4, 8.2] : [-8.2, -3.4]), 5.6, 5.9), st.s - 14, st.s + 14, 1), matD(roofCol)));
    const f = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3() };
    for (let a = -12; a <= 12; a += 8) {
      tr.sample(st.s + a, f);
      const lat = 6.8 * o;
      this.scene.add(cylY(0.15, 4.6, 0xeeeeee, f.p.x + f.r.x * lat, 3.35, f.p.z + f.r.z * lat, 8));
    }

    // Prédio da estação
    const yaw = Math.atan2(st.frame.t.x, st.frame.t.z);
    const bp = this.stationPoint(st, 0, 12);
    const b = new THREE.Group();
    b.position.copy(bp);
    b.rotation.y = yaw;
    b.add(box(4.5, 4.5, 12, 0xfff3d6, 0, 2.25, 0));
    const roof = mesh(new THREE.CylinderGeometry(0.01, 3.8, 2.4, 4, 1), roofCol, 0, 5.7, 0);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1, 1, 2.3);
    b.add(roof);
    const door = box(0.1, 2.4, 1.6, 0x6d4c41, 2.26 * o, 1.2, 0);
    b.add(door);
    for (const z of [-3.5, 3.5]) b.add(box(0.1, 1.2, 1.6, this.windows, 2.26 * o, 2.6, z));
    const clock = cylX(0.5, 0.15, 0xffffff, 2.3 * o, 3.9, 0, 16);
    b.add(clock);
    this.scene.add(b);

    // Placa com o nome
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: textTexture(`${st.emoji} ${st.name}`), side: THREE.DoubleSide }));
    const sp = this.stationPoint(st, 0, 5.6, 7.0);
    sign.position.copy(sp);
    sign.rotation.y = yaw + (o * Math.PI) / 2;
    this.scene.add(sign);
    for (const a of [-2.8, 2.8]) {
      const pp = this.stationPoint(st, a, 5.6, 6.4);
      this.scene.add(cylY(0.08, 1.2, 0xeeeeee, pp.x, pp.y, pp.z, 6));
    }

    // Postes com lâmpadas
    for (const a of [-18, 18]) {
      const lp = this.stationPoint(st, a, 6.2);
      this.scene.add(cylY(0.1, 4, 0x37474f, lp.x, 3.1, lp.z, 6));
      const bulb = sphere(0.35, this.windows, lp.x, 5.2, lp.z, 10);
      this.scene.add(bulb);
    }

    // Pilha de carga (preenchida pelo jogo)
    st.pile = new THREE.Group();
    this.scene.add(st.pile);
  }

  _farm(st) {
    const yaw = Math.atan2(st.frame.t.x, st.frame.t.z);
    const barn = new THREE.Group();
    barn.position.copy(this.stationPoint(st, 34, 26));
    barn.rotation.y = yaw;
    barn.add(box(10, 6, 8, 0xc62828, 0, 3, 0));
    const shape = new THREE.Shape([new THREE.Vector2(-5.6, 0), new THREE.Vector2(5.6, 0), new THREE.Vector2(0, 4)]);
    const rg = new THREE.ExtrudeGeometry(shape, { depth: 8.6, bevelEnabled: false });
    rg.translate(0, 0, -4.3);
    barn.add(mesh(rg, 0x5d4037, 0, 6, 0));
    barn.add(box(3.6, 4, 0.1, 0x8e2020, 0, 2, 4.02));
    barn.add(box(3.8, 0.25, 0.12, 0xffffff, 0, 2, 4.06).rotateZ(0.8));
    barn.add(box(3.8, 0.25, 0.12, 0xffffff, 0, 2, 4.06).rotateZ(-0.8));
    this.scene.add(barn);

    const sp = this.stationPoint(st, 44, 20);
    this.scene.add(cylY(2.5, 12, 0xb0bec5, sp.x, 6, sp.z, 20));
    this.scene.add(sphere(2.5, 0x78909c, sp.x, 12, sp.z, 20));

    // Fardos de feno
    const r = rng(3);
    for (let i = 0; i < 6; i++) {
      const hp = this.stationPoint(st, 50 + r() * 20, 14 + r() * 20, 0);
      const bale = cylX(1, 1.6, 0xf2c14e, hp.x, 1, hp.z, 14);
      bale.rotation.y = r() * 3;
      this.scene.add(bale);
    }

    // Cerca e vaquinhas
    const center = this.stationPoint(st, -30, 32);
    this.cowField = { x: center.x, z: center.z, r: 14 };
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const fx = center.x + Math.cos(a) * 17, fz = center.z + Math.sin(a) * 17;
      this.scene.add(box(0.25, 1.4, 0.25, 0xffffff, fx, 0.7, fz));
      const a2 = ((i + 0.5) / 28) * Math.PI * 2;
      const rail = box(0.12, 0.15, 3.9, 0xffffff, center.x + Math.cos(a2) * 17, 1.1, center.z + Math.sin(a2) * 17);
      rail.rotation.y = -a2;
      this.scene.add(rail);
    }
    for (let i = 0; i < 6; i++) {
      const cow = this._cow(r);
      const a = r() * Math.PI * 2, d = r() * 11;
      cow.position.set(center.x + Math.cos(a) * d, 0, center.z + Math.sin(a) * d);
      cow.rotation.y = r() * Math.PI * 2;
      Object.assign(cow.userData, { kind: 'cow', dir: cow.rotation.y, walk: 0, bounce: 0 });
      this.scene.add(cow);
      this.cows.push(cow);
      this.clickables.push(cow);
    }
  }

  _cow(r) {
    const g = new THREE.Group();
    const white = mat(0xffffff), black = mat(0x222222), pink = mat(0xffb6c1);
    g.add(box(1.4, 1.2, 2.4, white, 0, 1.6, 0));
    g.add(box(1.42, 0.7, 0.8, black, 0, 1.8, 0.3));
    g.add(box(1.42, 0.5, 0.6, black, 0, 1.5, -0.7));
    const head = new THREE.Group();
    head.position.set(0, 2.1, 1.4);
    head.add(box(0.9, 0.9, 0.9, white, 0, 0, 0.2));
    head.add(box(0.95, 0.45, 0.4, pink, 0, -0.2, 0.62));
    head.add(box(0.2, 0.2, 0.1, black, -0.25, 0.2, 0.66));
    head.add(box(0.2, 0.2, 0.1, black, 0.25, 0.2, 0.66));
    head.add(box(0.15, 0.35, 0.15, 0xfff3c4, -0.35, 0.55, 0.1));
    head.add(box(0.15, 0.35, 0.15, 0xfff3c4, 0.35, 0.55, 0.1));
    head.add(box(0.4, 0.2, 0.2, black, -0.6, 0.25, 0.1));
    head.add(box(0.4, 0.2, 0.2, black, 0.6, 0.25, 0.1));
    g.add(head);
    g.userData.head = head;
    for (const [x, z] of [[-0.5, 0.9], [0.5, 0.9], [-0.5, -0.9], [0.5, -0.9]]) g.add(box(0.3, 1.0, 0.3, white, x, 0.5, z));
    g.add(box(0.6, 0.3, 0.5, pink, 0, 0.95, -0.4));
    g.add(box(0.1, 0.9, 0.1, black, 0, 1.6, -1.25));
    return g;
  }

  _town(st) {
    const r = rng(5);
    const colors = [0xff8a65, 0xffd54f, 0x4fc3f7, 0xaed581, 0xba68c8, 0xf06292, 0x4db6ac];
    const yaw = Math.atan2(st.frame.t.x, st.frame.t.z);
    const spots = [[-40, 18], [-28, 24], [-16, 26], [22, 22], [34, 18], [46, 24], [-34, 40], [-6, 42], [16, 40], [40, 42], [-50, 30], [2, 60], [28, 60], [-26, 58]];
    spots.forEach(([along, out], i) => {
      const hp = this.stationPoint(st, along, out);
      hp.y = this.heightAt(hp.x, hp.z);
      const hgrp = new THREE.Group();
      hgrp.position.copy(hp);
      hgrp.rotation.y = yaw;
      const tall = i === 11 || i === 12;
      const w = 6 + r() * 3, d = 6 + r() * 3, h = tall ? 14 : 4 + r() * 3;
      hgrp.add(box(w, h, d, colors[i % colors.length], 0, h / 2, 0));
      if (!tall) {
        const roof = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.75, 3, 4), 0x8d3b2a, 0, h + 1.5, 0);
        roof.rotation.y = Math.PI / 4;
        hgrp.add(roof);
      } else {
        hgrp.add(box(w + 0.4, 0.5, d + 0.4, 0x607d8b, 0, h + 0.25, 0));
      }
      // Janelas (acendem à noite)
      // O lado +X local aponta para o trilho quando multiplicado por st.o
      const face = st.o * (w / 2 + 0.06);
      const rows = tall ? 4 : 1;
      for (let row = 0; row < rows; row++) {
        for (const z of [-d / 4, d / 4]) {
          const win = box(0.1, 1.1, 1.1, this.windows, face, tall ? 2.5 + row * 3 : h * 0.6, z);
          win.castShadow = false;
          hgrp.add(win);
        }
      }
      if (!tall) hgrp.add(box(0.1, 2.2, 1.3, 0x6d4c41, face, 1.1, 0));
      this.scene.add(hgrp);
    });
    // Árvores de praça e um chafariz
    const fp = this.stationPoint(st, 4, 26);
    this.scene.add(cylY(3, 0.8, 0xb0bec5, fp.x, 0.4, fp.z, 20));
    this.scene.add(cylY(2.6, 0.2, 0x4fc3f7, fp.x, 0.82, fp.z, 20));
    this.scene.add(cylY(0.3, 2, 0xb0bec5, fp.x, 1.4, fp.z, 8));
  }

  _windmill(x, z) {
    const g = new THREE.Group();
    g.position.set(x, this.heightAt(x, z), z);
    g.add(cylY(2.2, 12, 0xfff8e1, 0, 6, 0, 12, 1.4));
    g.add(mesh(new THREE.ConeGeometry(2, 2.5, 12), 0xc62828, 0, 13.2, 0));
    const blades = new THREE.Group();
    blades.position.set(0, 11.5, 1.8);
    for (let i = 0; i < 4; i++) {
      const b = box(1.4, 6, 0.1, 0xffffff, 0, 3.4, 0);
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      arm.add(b);
      blades.add(arm);
    }
    blades.add(sphere(0.5, 0x5d4037, 0, 0, 0.1));
    g.add(blades);
    g.rotation.y = 0.6;
    this.blades = blades;
    this.scene.add(g);
  }

  _trees() {
    const r = rng(42);
    const pts = [];
    for (let tries = 0; tries < 1400 && pts.length < 320; tries++) {
      const x = (r() - 0.5) * 520, z = (r() - 0.5) * 520;
      if (this.distToTrack(x, z) < 10) continue;
      if (this.waterMask(x, z) > 0.01) continue;
      if (Math.hypot(x - 115, z) < 30) continue;
      let near = false;
      for (const st of this.stations) {
        const d = Math.hypot(x - st.frame.p.x, z - st.frame.p.z);
        if (d < 75) near = true;
      }
      if (near && r() > 0.12) continue;
      if (this.cowField && Math.hypot(x - this.cowField.x, z - this.cowField.z) < 22) continue;
      if (Math.hypot(x - 35, z - 18) < 8) continue;
      const h = this.heightAt(x, z);
      if (h > 24) continue;
      pts.push([x, h, z, r()]);
    }
    const pines = pts.filter(p => p[3] < 0.45), rounds = pts.filter(p => p[3] >= 0.45);
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), mat(0x795548), pts.length);
    pts.forEach(([x, y, z, k], i) => {
      const s = 0.8 + k * 0.8;
      o.position.set(x, y + 1.5 * s, z);
      o.scale.set(s, s, s);
      o.updateMatrix();
      trunk.setMatrixAt(i, o.matrix);
    });
    trunk.castShadow = true;
    this.scene.add(trunk);

    const mk = (list, geo, yOff, palette) => {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), list.length);
      list.forEach(([x, y, z, k], i) => {
        const s = 0.8 + k * 0.8;
        o.position.set(x, y + yOff * s, z);
        o.scale.set(s, s, s);
        o.rotation.y = k * 20;
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
        im.setColorAt(i, col.set(palette[i % palette.length]));
      });
      im.castShadow = true;
      this.scene.add(im);
    };
    mk(pines, new THREE.ConeGeometry(2.4, 6, 8), 5.5, [0x2e7d32, 0x388e3c, 0x1b5e20]);
    mk(rounds, new THREE.IcosahedronGeometry(2.6, 0), 4.8, [0x66bb6a, 0x7cb342, 0x9ccc65, 0x43a047]);
  }

  _clouds() {
    const r = rng(9);
    this.clouds = [];
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x555555 });
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(r() * 3);
      for (let j = 0; j < n; j++) {
        const s = sphere(4 + r() * 4, white, j * 5 - n * 2.5, r() * 2, r() * 4, 10);
        s.castShadow = false;
        g.add(s);
      }
      g.position.set((r() - 0.5) * 500, 55 + r() * 30, (r() - 0.5) * 500);
      this.scene.add(g);
      this.clouds.push(g);
    }
  }

  // d = 1 dia, 0 noite
  setDay(d) {
    this.scene.background.copy(this.nightColor).lerp(this.dayColor, d);
    this.scene.fog.color.copy(this.scene.background);
    this.sun.intensity = 0.25 + 2.15 * d;
    this.sun.color.setRGB(0.6 + 0.4 * d, 0.7 + 0.3 * d, 1);
    this.hemi.intensity = 0.45 + 0.85 * d;
    this.windows.emissiveIntensity = (1 - d) * 1.2;
    this.stars.material.opacity = Math.max(0, 1 - d * 1.6);
    this.moon.visible = d < 0.6;
  }

  update(dt, time, focus) {
    this.blades.rotation.z += dt * 0.8;
    for (const c of this.clouds) {
      c.position.x += dt * 1.5;
      if (c.position.x > 260) c.position.x = -260;
    }
    // Vaquinhas passeando
    for (const cow of this.cows) {
      const u = cow.userData;
      u.walk -= dt;
      if (u.walk < 0) {
        u.walk = 2 + Math.random() * 5;
        u.dir = cow.rotation.y + (Math.random() - 0.5) * 2;
        u.moving = Math.random() < 0.5;
      }
      cow.rotation.y += (u.dir - cow.rotation.y) * dt;
      if (u.moving) {
        const nx = cow.position.x + Math.sin(cow.rotation.y) * dt * 1.2;
        const nz = cow.position.z + Math.cos(cow.rotation.y) * dt * 1.2;
        if (Math.hypot(nx - this.cowField.x, nz - this.cowField.z) < this.cowField.r) {
          cow.position.x = nx;
          cow.position.z = nz;
        } else {
          u.dir += Math.PI;
        }
      }
      u.bounce = Math.max(0, u.bounce - dt * 2);
      cow.position.y = Math.sin(u.bounce * Math.PI * 3) * u.bounce * 1.5;
      u.head.rotation.x = Math.sin(time * 1.3 + cow.id) * 0.15 + (u.moving ? 0 : 0.3);
    }
    // Sombra acompanha o trem
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset);
  }
}

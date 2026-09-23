import * as THREE from 'three';
import { mat, mesh, box, cylZ, cylX, cylY, sphere } from './util.js';

// Tudo é modelado com a frente em +Z e o topo do trilho em y = 0.

const RAIL_TOP = 0.7;

export const TRAIN_TYPES = {
  steam: { name: 'Maria Fumaça', energyName: 'carvão', wagons: [0xffc107, 0x42a5f5, 0x66bb6a] },
  electric: { name: 'Trem Elétrico', energyName: 'energia', wagons: [0xff7043, 0xab47bc, 0xffca28] },
  diesel: { name: 'Trem a Diesel', energyName: 'diesel', wagons: [0x26c6da, 0xef5350, 0x9ccc65] },
};

class Vehicle {
  constructor(length) {
    this.root = new THREE.Group();
    this.model = new THREE.Group();
    this.root.add(this.model);
    this.length = length;
    this.wheels = [];
    this.rods = [];
    this.hideInCab = [];
    this.cargoSlots = [];
  }

  wheel(r, x, z, color, spokes = true) {
    const g = new THREE.Group();
    g.position.set(x, r, z);
    const w = Math.abs(x) > 0.9 ? 0.26 : 0.2;
    g.add(cylX(r, w, color, 0, 0, 0, 20));
    g.add(cylX(r * 1.08, w * 0.5, 0x333333, -Math.sign(x) * w * 0.2, 0, 0, 20));
    g.add(cylX(r * 0.25, w + 0.06, 0xdddddd, 0, 0, 0, 10));
    if (spokes) {
      for (let i = 0; i < 3; i++) {
        const s = box(w + 0.02, r * 1.7, 0.1, 0xdddddd, 0, 0, 0);
        s.rotation.x = (i * Math.PI) / 3;
        g.add(s);
      }
    }
    this.model.add(g);
    this.wheels.push({ g, r });
    return g;
  }

  bogie(z, r, spread = 1.5) {
    for (const dz of [-spread / 2, spread / 2]) {
      for (const x of [-0.8, 0.8]) this.wheel(r, x, z + dz, 0x37474f, false);
    }
    this.model.add(box(1.8, 0.4, spread + 1.2, 0x263238, 0, r, z));
  }

  // Centraliza o modelo em z = 0 para ele seguir o trilho direitinho.
  center() {
    const bb = new THREE.Box3().setFromObject(this.model);
    this.model.position.z = -(bb.min.z + bb.max.z) / 2;
    this.model.position.y = RAIL_TOP;
  }

  spin(ds) {
    for (const w of this.wheels) w.g.rotation.x += ds / w.r;
  }
}

// Rostinho simpático (olhos piscam).
function addFace(v, x, y, z, r) {
  const face = new THREE.Group();
  face.position.set(x, y, z);
  const disc = cylZ(r, 0.1, 0xeceff1, 0, 0, 0, 28);
  face.add(disc);
  const eyes = [];
  for (const ex of [-0.33 * r, 0.33 * r]) {
    const eye = new THREE.Group();
    eye.position.set(ex, 0.2 * r, 0.05);
    const white = sphere(0.24 * r, 0xffffff, 0, 0, 0, 14);
    white.scale.z = 0.5;
    eye.add(white);
    const pupil = sphere(0.12 * r, 0x1a1a1a, 0, -0.02 * r, 0.1 * r, 10);
    eye.add(pupil);
    face.add(eye);
    eyes.push(eye);
  }
  const smile = mesh(new THREE.TorusGeometry(0.38 * r, 0.05 * r, 8, 20, Math.PI), 0xc62828, 0, -0.12 * r, 0.06);
  smile.rotation.z = Math.PI;
  face.add(smile);
  for (const cx of [-0.55 * r, 0.55 * r]) {
    const cheek = cylZ(0.13 * r, 0.02, 0xffab91, cx, -0.2 * r, 0.06, 12);
    face.add(cheek);
  }
  v.model.add(face);
  v.eyes = eyes;
}

function headlamp(v, x, y, z) {
  v.model.add(cylZ(0.3, 0.3, 0x333333, x, y, z, 12));
  const lens = cylZ(0.24, 0.05, new THREE.MeshBasicMaterial({ color: 0xfff59d }), x, y, z + 0.16, 12);
  v.model.add(lens);
  v.lampPos = new THREE.Vector3(x, y, z + 0.3);
}

// Painel da cabine (só aparece na visão de dentro).
function cabInterior(v, z, y, extras, frame) {
  const g = new THREE.Group();
  g.visible = false;
  if (frame) {
    // Colunas da janela e teto, para parecer que estamos dentro da cabine
    const { z: fz, y: fy, h, color } = frame;
    for (const x of [-1.15, 1.15]) g.add(box(0.18, h, 0.12, color, x, fy, fz));
    g.add(box(2.5, 0.18, 0.2, color, 0, fy + h / 2, fz));
    g.add(box(2.5, 0.08, 2.2, 0xeceff1, 0, fy + h / 2 + 0.1, fz - 1.1));
  }
  const dash = box(2.2, 0.55, 0.5, 0x37474f, 0, y, z);
  g.add(dash);
  const gaugeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xe53935 });
  v.needles = [];
  for (const gx of [-0.6, 0, 0.6]) {
    const gauge = cylY(0.14, 0.04, gaugeMat, gx, y + 0.29, z - 0.05, 20);
    g.add(gauge);
    const needle = box(0.03, 0.02, 0.12, needleMat, 0, 0, 0.05);
    const piv = new THREE.Group();
    piv.position.set(gx, y + 0.32, z - 0.05);
    piv.add(needle);
    g.add(piv);
    v.needles.push(piv);
  }
  const btnCols = [0x43a047, 0xfdd835, 0xe53935];
  btnCols.forEach((c, i) => g.add(cylY(0.07, 0.06, new THREE.MeshBasicMaterial({ color: c }), -0.95 + i * 0.18, y + 0.3, z + 0.12, 10)));
  if (extras) extras(g);
  v.model.add(g);
  v.cab = g;
}

// ---------------------------------------------------------------------------
// Maria Fumaça
// ---------------------------------------------------------------------------
function buildSteam() {
  const v = new Vehicle(9.4);
  const m = v.model;
  const red = 0xd32f2f, black = 0x212121, gold = 0xffc107;
  m.add(box(1.5, 0.5, 8.4, black, 0, 0.95, 0.4));
  // Caldeira
  m.add(cylZ(1.05, 4.6, red, 0, 2.2, 1.4, 24));
  for (const z of [0, 1.5, 3.0]) m.add(cylZ(1.09, 0.14, gold, 0, 2.2, z, 24));
  m.add(cylZ(1.12, 0.9, 0x424242, 0, 2.2, 4.1, 24));
  addFace(v, 0, 2.2, 4.6, 0.98);
  // Chaminé, domo, apito
  m.add(cylY(0.34, 1.2, black, 0, 3.7, 3.9, 14, 0.5));
  m.add(cylY(0.55, 0.25, black, 0, 4.35, 3.9, 14));
  const dome = sphere(0.5, gold, 0, 3.15, 1.6, 16);
  m.add(dome);
  m.add(cylY(0.12, 0.6, gold, 0.8, 4.6, -1.3, 8));
  headlamp(v, 0, 3.5, 4.45);
  v.smoke = new THREE.Vector3(0, 4.6, 3.9);
  // Cabine
  const cabZ = -2.35;
  m.add(box(2.6, 0.2, 3.0, black, 0, 1.25, cabZ));
  for (const x of [-1.22, 1.22]) {
    m.add(box(0.15, 1.3, 3.0, red, x, 1.95, cabZ));
    m.add(box(0.15, 1.6, 0.3, red, x, 3.4, -0.98));
    m.add(box(0.15, 1.6, 0.3, red, x, 3.4, -3.7));
  }
  for (const x of [-0.98, 0.98]) m.add(box(0.5, 1.2, 0.15, red, x, 1.9, -0.9));
  m.add(box(2.6, 0.2, 0.15, red, 0, 4.1, -0.9));
  m.add(box(2.9, 0.2, 3.5, black, 0, 4.3, cabZ));
  m.add(box(2.6, 0.9, 0.15, red, 0, 1.8, -3.78));
  // Rodas grandes com bielas
  const driveZ = [-0.4, 1.05, 2.5];
  for (const x of [-1.0, 1.0]) {
    for (const z of driveZ) {
      const w = v.wheel(0.68, x, z, red);
      w.add(cylX(0.08, 0.35, 0xdddddd, Math.sign(x) * 0.1, 0.34, 0, 8));
    }
    const rod = box(0.08, 0.14, 3.3, 0xb0bec5, x * 1.2, 0.68, 1.05);
    m.add(rod);
    v.rods.push({ mesh: rod, cy: 0.68, cz: 1.05, r: 0.34, wheel: v.wheels[v.wheels.length - 1] });
    v.wheel(0.42, x, 3.9, red);
    v.wheel(0.42, x, -2.9, red);
  }
  // Limpa-trilhos
  const cc = box(2.0, 0.7, 0.6, 0x9e9e9e, 0, 0.5, 5.0);
  cc.rotation.x = -0.6;
  m.add(cc);
  m.add(box(2.4, 0.3, 0.3, red, 0, 1.0, 4.75));
  // Painel interno com a fornalha
  cabInterior(v, -1.25, 1.9, g => {
    const fire = box(0.9, 0.7, 0.1, new THREE.MeshBasicMaterial({ color: 0xff6d00 }), 0, 1.75, -1.08);
    g.add(fire);
    v.fire = fire;
  });
  v.cabPos = new THREE.Vector3(-0.8, 3.75, -3.2);
  v.center();
  return v;
}

function buildTender() {
  const v = new Vehicle(5.2);
  const m = v.model;
  m.add(box(1.8, 0.4, 5, 0x212121, 0, 1.0, 0));
  m.add(box(2.4, 1.6, 4.8, 0xb71c1c, 0, 2.0, 0));
  m.add(box(2.45, 0.18, 4.85, 0xffc107, 0, 2.6, 0));
  // Monte de carvão
  const coal = new THREE.Group();
  const coalMat = mat(0x263238);
  for (let i = 0; i < 18; i++) {
    const c = mesh(new THREE.DodecahedronGeometry(0.35 + Math.random() * 0.25), coalMat, (Math.random() - 0.5) * 1.8, 2.9 + Math.random() * 0.3, (Math.random() - 0.5) * 3.8);
    coal.add(c);
  }
  m.add(coal);
  v.bogie(-1.5, 0.42, 1.2);
  v.bogie(1.5, 0.42, 1.2);
  v.center();
  return v;
}

// ---------------------------------------------------------------------------
// Trem Elétrico
// ---------------------------------------------------------------------------
function buildElectric() {
  const v = new Vehicle(10.6);
  const m = v.model;
  const green = 0x2e9e4f, yellow = 0xffd600, dark = 0x263238;
  m.add(box(2.2, 0.5, 9.6, dark, 0, 1.25, 0));
  const body = box(2.5, 2.4, 8.6, green, 0, 2.7, 0);
  m.add(body);
  m.add(box(2.54, 0.35, 8.64, yellow, 0, 1.75, 0));
  // Bicos arredondados
  for (const s of [-1, 1]) {
    const nose = mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.4, 20, 1, false, -Math.PI / 2, Math.PI), green, 0, 2.7, s * 4.3);
    nose.scale.z = 0.55;
    nose.rotation.y = s > 0 ? 0 : Math.PI;
    m.add(nose);
    const glass = box(1.6, 0.8, 0.1, 0x1a2a3a, 0, 3.35, s * 4.92);
    m.add(glass);
    v.hideInCab.push(glass);
  }
  addFace(v, 0, 2.45, 5.0, 0.62);
  for (const z of [-2.5, -0.8, 0.8, 2.5]) {
    for (const x of [-1.26, 1.26]) m.add(box(0.05, 0.8, 1.2, 0x1a2a3a, x, 3.2, z));
  }
  m.add(box(2.2, 0.2, 8, 0x90a4ae, 0, 4.0, 0));
  headlamp(v, 0, 1.75, 5.15);
  v.bogie(-3, 0.5);
  v.bogie(3, 0.5);
  // Pantógrafo
  const pant = { base: new THREE.Vector3(0, 4.15, -2.6), arms: [], up: 0 };
  m.add(box(1.2, 0.2, 1.2, 0x455a64, 0, 4.15, -2.2));
  const armGeo = new THREE.BoxGeometry(0.08, 0.08, 1);
  for (let i = 0; i < 2; i++) {
    const a = mesh(armGeo, 0x455a64);
    m.add(a);
    pant.arms.push(a);
  }
  pant.head = box(1.8, 0.1, 0.16, 0x455a64, 0, 4.35, -0.2);
  m.add(pant.head);
  v.pant = pant;
  v.smoke = new THREE.Vector3(0, 5.6, -1.6);
  cabInterior(v, 4.35, 2.75, null, { z: 4.75, y: 3.35, h: 1.1, color: green });
  v.cabPos = new THREE.Vector3(-0.45, 3.5, 3.0);
  v.center();
  setPantograph(v, 0);
  return v;
}

function setBetween(meshObj, a, b) {
  meshObj.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  const dy = b.y - a.y, dz = b.z - a.z;
  meshObj.rotation.set(-Math.atan2(dy, dz), 0, 0);
  meshObj.scale.set(1, 1, Math.hypot(dy, dz));
}

// p = 0 abaixado, 1 encostado no fio
export function setPantograph(v, p) {
  const pant = v.pant;
  pant.up = p;
  const B = pant.base;
  // O fio fica em y = 6,3 no mundo (5,6 no modelo, que está 0,7 acima)
  const H = new THREE.Vector3(0, 4.35 + p * 1.25, -0.2 - p * 1.4);
  const a = 1.25;
  const M = B.clone().add(H).multiplyScalar(0.5);
  const d = B.distanceTo(H);
  const h = Math.sqrt(Math.max(0, a * a - (d / 2) ** 2));
  const vy = H.y - B.y, vz = H.z - B.z;
  const E = new THREE.Vector3(0, M.y - (vz / d) * h, M.z + (vy / d) * h);
  if (E.y < M.y) E.set(0, M.y + (vz / d) * h, M.z - (vy / d) * h);
  setBetween(pant.arms[0], B, E);
  setBetween(pant.arms[1], E, H);
  pant.head.position.set(0, H.y, H.z);
}

// ---------------------------------------------------------------------------
// Trem a Diesel
// ---------------------------------------------------------------------------
function buildDiesel() {
  const v = new Vehicle(10.4);
  const m = v.model;
  const orange = 0xf57c00, black = 0x212121, yellow = 0xffeb3b;
  m.add(box(2.2, 0.5, 10, 0x37474f, 0, 1.25, 0));
  m.add(box(2.7, 0.12, 10.2, 0x546e7a, 0, 1.56, 0));
  // Capô comprido
  m.add(box(1.8, 2.0, 5.6, orange, 0, 2.6, -2.0));
  for (let i = 0; i < 5; i++) {
    for (const x of [-0.91, 0.91]) m.add(box(0.03, 1.1, 0.5, 0x5d4037, x, 2.7, -4.2 + i * 0.7));
  }
  // Escapamento
  m.add(cylY(0.2, 0.6, black, 0, 3.9, -1.2, 10));
  v.smoke = new THREE.Vector3(0, 4.3, -1.2);
  // Cabine
  m.add(box(2.6, 2.7, 2.3, orange, 0, 2.95, 1.9));
  m.add(box(2.8, 0.2, 2.5, black, 0, 4.4, 1.9));
  for (const x of [-1.31, 1.31]) {
    const side = box(0.05, 0.8, 1.4, 0x1a2a3a, x, 3.55, 1.9);
    m.add(side);
    v.hideInCab.push(side);
  }
  for (const x of [-0.62, 0.62]) {
    const glass = box(1.0, 0.8, 0.08, 0x1a2a3a, x, 3.65, 3.06);
    m.add(glass);
    v.hideInCab.push(glass);
  }
  // Nariz curto com listras
  m.add(box(1.8, 1.5, 1.4, orange, 0, 2.35, 3.75));
  for (let i = 0; i < 4; i++) {
    const s = box(0.3, 1.8, 0.06, i % 2 ? black : yellow, -0.7 + i * 0.45, 1.55, 4.47);
    s.rotation.z = 0.6;
    s.scale.y = 0.5;
    m.add(s);
  }
  addFace(v, 0, 2.4, 4.5, 0.62);
  headlamp(v, 0, 3.25, 4.2);
  // Guarda-corpos
  for (const x of [-1.3, 1.3]) m.add(box(0.06, 0.06, 9.4, yellow, x, 2.4, 0));
  v.bogie(-3.3, 0.5);
  v.bogie(3.3, 0.5);
  cabInterior(v, 2.75, 2.8);
  v.cabPos = new THREE.Vector3(-0.5, 3.85, 1.3);
  v.center();
  return v;
}

// ---------------------------------------------------------------------------
// Vagões
// ---------------------------------------------------------------------------
function buildWagon(color) {
  const v = new Vehicle(6.6);
  const m = v.model;
  m.add(box(2.0, 0.4, 6.2, 0x37474f, 0, 1.1, 0));
  m.add(box(2.5, 0.15, 6.2, color, 0, 1.4, 0));
  for (const x of [-1.2, 1.2]) m.add(box(0.12, 0.9, 6.2, color, x, 1.9, 0));
  for (const z of [-3.05, 3.05]) m.add(box(2.5, 0.9, 0.12, color, 0, 1.9, z));
  for (const x of [-1.27, 1.27]) m.add(box(0.04, 0.12, 6.24, 0xffffff, x, 2.1, 0));
  v.bogie(-2.1, 0.45, 1.2);
  v.bogie(2.1, 0.45, 1.2);
  v.cargo = new THREE.Group();
  m.add(v.cargo);
  for (const z of [-1.8, 0, 1.8]) v.cargoSlots.push(new THREE.Vector3(0, 1.5, z));
  v.center();
  return v;
}

export function buildTrain(type) {
  const info = TRAIN_TYPES[type];
  const vehicles = [];
  if (type === 'steam') vehicles.push(buildSteam(), buildTender());
  else if (type === 'electric') vehicles.push(buildElectric());
  else vehicles.push(buildDiesel());
  const wagons = info.wagons.map(buildWagon);
  vehicles.push(...wagons);

  // Distância de cada carro até o centro da locomotiva (para trás é negativo)
  const gap = 0.7;
  const offsets = [0];
  for (let i = 1; i < vehicles.length; i++) {
    offsets.push(offsets[i - 1] - vehicles[i - 1].length / 2 - gap - vehicles[i].length / 2);
  }
  for (const v of vehicles) {
    v.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  // Engates entre os carros
  for (let i = 0; i < vehicles.length - 1; i++) {
    const vi = vehicles[i];
    vi.model.add(box(0.3, 0.3, gap + 0.8, 0x212121, 0, 0.9, -vi.length / 2 - gap / 2 - vi.model.position.z));
  }
  return { type, info, vehicles, offsets, loco: vehicles[0], wagons, wagonIdx: vehicles.map((v, i) => i).filter(i => wagons.includes(vehicles[i])) };
}

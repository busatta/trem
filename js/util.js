import * as THREE from 'three';

const matCache = new Map();

// Material Lambert (barato para tablet), reaproveitado por cor.
export function mat(color, opts) {
  if (opts) return new THREE.MeshLambertMaterial({ color, ...opts });
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(color, m);
  }
  return m;
}

// Material visível dos dois lados (para as peças geradas ao longo do trilho).
export function matD(color) {
  const key = 'D' + color;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    matCache.set(key, m);
  }
  return m;
}

export function mesh(geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, typeof material === 'number' ? mat(material) : material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}

export function box(w, h, d, material, x, y, z) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

// Cilindro deitado ao longo do eixo Z (para caldeira, etc).
export function cylZ(r, len, material, x, y, z, seg = 20, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  g.rotateX(Math.PI / 2);
  return mesh(g, material, x, y, z);
}

// Cilindro deitado ao longo do eixo X (para rodas).
export function cylX(r, len, material, x, y, z, seg = 20) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return mesh(g, material, x, y, z);
}

export function cylY(r, h, material, x, y, z, seg = 16, rTop = r) {
  return mesh(new THREE.CylinderGeometry(rTop, r, h, seg), material, x, y, z);
}

export function sphere(r, material, x, y, z, seg = 16) {
  return mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2)), material, x, y, z);
}

// Gerador pseudoaleatório com semente (o mundo é sempre igual).
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Textura com texto (placas das estações).
export function textTexture(text, bg = '#fff8e1', fg = '#5d4037', w = 512, h = 128) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 10;
  g.strokeRect(5, 5, w - 10, h - 10);
  g.fillStyle = fg;
  g.font = `bold ${Math.floor(h * 0.55)}px "Trebuchet MS", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Textura redonda e macia para fumaça / faíscas.
export function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

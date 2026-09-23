import * as THREE from 'three';
import { World } from './world.js';
import { buildTrain, setPantograph, TRAIN_TYPES } from './trains.js';
import { Sound, say, voice } from './audio.js';
import { box, cylX, cylY, sphere, puffTexture } from './util.js';

// ---------------------------------------------------------------------------
// Preparação
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
const world = new World(scene);
const track = world.track;
const sound = new Sound();
const V3 = THREE.Vector3;

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('trem.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('trem.' + k, JSON.stringify(v)); } catch (e) { /* ok */ }
  },
};

const SLOW = 9, FAST = 18;
const CAMS = ['front', 'chase', 'cab', 'side', 'sky'];
const CAM_ICONS = { front: '😊', chase: '🚂', cab: '👀', side: '🌳', sky: '☁️' };

const state = {
  type: null,
  train: null,
  s: world.stations[0].s - 90,
  speed: 0,
  running: false,
  fast: false,
  energy: 0,
  pantTarget: 0,
  pant: 0,
  cam: 'front',
  yaw: 0,
  pitch: 0,
  lastDrag: 0,
  atStation: null,
  ignore: null,
  busy: false,
  cargoLoaded: false,
  cargoType: store.get('cargoType', 0),
  stars: store.get('stars', 0),
  day: 1,
  dayTarget: 1,
  menu: true,
  lastHint: 0,
  saidGo: false,
  time: 0,
};

// ---------------------------------------------------------------------------
// Cargas
// ---------------------------------------------------------------------------
const BRIGHT = [0xe53935, 0x1e88e5, 0x8e24aa, 0x43a047, 0xfdd835, 0xff7043];
const CARGO = [
  {
    say: 'os presentes',
    make(i) {
      const g = new THREE.Group();
      g.add(box(1.1, 1.0, 1.1, BRIGHT[i % BRIGHT.length], 0, 0.5, 0));
      g.add(box(1.14, 1.02, 0.22, 0xfff176, 0, 0.5, 0));
      g.add(box(0.22, 1.02, 1.14, 0xfff176, 0, 0.5, 0));
      g.add(sphere(0.22, 0xfff176, 0, 1.08, 0, 8));
      return g;
    },
  },
  {
    say: 'a madeira',
    make() {
      const g = new THREE.Group();
      for (const [x, y] of [[-0.3, 0.28], [0.3, 0.28], [0, 0.76]]) {
        const log = cylX(0.28, 1.5, 0x8d6e63, 0, y, 0, 10);
        log.rotation.y = Math.PI / 2;
        log.position.x = x;
        g.add(log);
      }
      return g;
    },
  },
  {
    say: 'as maçãs',
    make() {
      const g = new THREE.Group();
      g.add(box(1.3, 0.5, 1.3, 0xbc8f5f, 0, 0.25, 0));
      for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0, 0]]) {
        g.add(sphere(0.26, x === 0 ? 0x7cb342 : 0xe53935, x, x === 0 ? 0.85 : 0.65, z, 10));
      }
      return g;
    },
  },
  {
    say: 'as bolas',
    make(i) {
      const g = new THREE.Group();
      g.add(sphere(0.6, BRIGHT[(i + 2) % BRIGHT.length], 0, 0.6, 0, 16));
      g.add(cylY(0.62, 0.22, 0xffffff, 0, 0.6, 0, 16));
      return g;
    },
  },
  {
    say: 'o leite',
    make() {
      const g = new THREE.Group();
      g.add(cylY(0.45, 1.0, 0xeceff1, 0, 0.5, 0, 14));
      g.add(cylY(0.45, 0.14, 0x1e88e5, 0, 0.7, 0, 14));
      g.add(cylY(0.3, 0.3, 0xeceff1, 0, 1.15, 0, 12, 0.22));
      g.add(cylY(0.26, 0.1, 0x90a4ae, 0, 1.34, 0, 12));
      return g;
    },
  },
];

// ---------------------------------------------------------------------------
// Partículas (fumaça, vapor, faíscas)
// ---------------------------------------------------------------------------
const puffTex = puffTexture();
const particles = [];
for (let i = 0; i < 110; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false;
  scene.add(s);
  particles.push({ s, life: 0, max: 1, v: new V3(), s0: 1, s1: 2, op: 0.8, grav: 0 });
}
let pIdx = 0;
function emit(pos, vel, color, s0, s1, life, op = 0.8, grav = 0) {
  const p = particles[pIdx];
  pIdx = (pIdx + 1) % particles.length;
  p.s.position.copy(pos);
  p.v.copy(vel);
  p.s.material.color.set(color);
  Object.assign(p, { s0, s1, max: life, life, op, grav });
  p.s.visible = true;
}
function updateParticles(dt) {
  for (const p of particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.s.visible = false; continue; }
    const k = 1 - p.life / p.max;
    p.v.y -= p.grav * dt;
    p.s.position.addScaledVector(p.v, dt);
    p.v.multiplyScalar(1 - dt * 0.8);
    const sc = p.s0 + (p.s1 - p.s0) * k;
    p.s.scale.set(sc, sc, sc);
    p.s.material.opacity = p.op * (1 - k) * Math.min(1, k * 10 + 0.3);
  }
}
const rnd = (a) => (Math.random() - 0.5) * a;

// ---------------------------------------------------------------------------
// Animações simples
// ---------------------------------------------------------------------------
const tweens = [];
function tween(dur, delay, fn, onDone) {
  tweens.push({ dur, t: -delay, fn, onDone });
}
function fly(obj, to, dur, arc, delay, onDone) {
  let from = null;
  tween(dur, delay, k => {
    if (!from) from = obj.position.clone();
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    obj.position.lerpVectors(from, to, e);
    obj.position.y += arc * Math.sin(Math.PI * k);
    obj.rotation.y += 0.15;
  }, onDone);
}
function updateTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    if (tw.t < 0) continue;
    const k = Math.min(1, tw.t / tw.dur);
    tw.fn(k);
    if (k >= 1) {
      tweens.splice(i, 1);
      if (tw.onDone) tw.onDone();
    }
  }
}

// ---------------------------------------------------------------------------
// Trem
// ---------------------------------------------------------------------------
let headlight = null;

function selectTrain(type) {
  if (state.train) for (const v of state.train.vehicles) scene.remove(v.root);
  tweens.length = 0;
  state.type = type;
  state.train = buildTrain(type);
  for (const v of state.train.vehicles) scene.add(v.root);
  state.energy = 0;
  state.pant = state.pantTarget = 0;
  state.speed = 0;
  state.running = false;
  state.atStation = null;
  state.ignore = null;
  state.busy = false;
  state.cargoLoaded = false;
  state.saidGo = false;
  for (const st of world.stations) st.pile.clear();
  buildPile();

  const loco = state.train.loco;
  headlight = new THREE.SpotLight(0xfff2c0, 0, 90, 0.5, 0.6, 0);
  headlight.position.copy(loco.lampPos);
  headlight.target.position.copy(loco.lampPos).add(new V3(0, -1.5, 20));
  loco.model.add(headlight, headlight.target);
  placeTrain();
  updateHud(true);
}

const tmpF = { p: new V3(), t: new V3(), r: new V3() };
const pA = new V3(), pB = new V3();
function placeTrain() {
  const { vehicles, offsets } = state.train;
  vehicles.forEach((v, i) => {
    const c = state.s + offsets[i];
    track.sample(c + v.length * 0.35, tmpF);
    pA.copy(tmpF.p);
    track.sample(c - v.length * 0.35, tmpF);
    pB.copy(tmpF.p);
    v.root.position.copy(pA).add(pB).multiplyScalar(0.5);
    v.root.lookAt(v.root.position.x + (pA.x - pB.x), 0, v.root.position.z + (pA.z - pB.z));
  });
}

function canMove() {
  if (state.type === 'electric') return state.pant > 0.98;
  return state.energy > 0;
}

function stopPoint(st) {
  const { offsets, wagonIdx } = state.train;
  const mean = wagonIdx.reduce((a, i) => a + offsets[i], 0) / wagonIdx.length;
  return track.wrap(st.s - mean);
}

// Lugar na plataforma ao lado de um espaço de carga de um vagão.
function platformSpot(st, wi, slot) {
  const v = state.train.vehicles[wi];
  const s = stopPoint(st) + state.train.offsets[wi] + slot.z + v.model.position.z;
  track.sample(s, tmpF);
  const lat = 4.8 * st.o;
  return new V3(tmpF.p.x + tmpF.r.x * lat, 1.1, tmpF.p.z + tmpF.r.z * lat);
}

function buildPile() {
  const st = world.stations[0];
  st.pile.clear();
  if (state.cargoLoaded) return;
  const cargo = CARGO[state.cargoType % CARGO.length];
  let n = 0;
  for (const wi of state.train.wagonIdx) {
    const v = state.train.vehicles[wi];
    for (const slot of v.cargoSlots) {
      const it = cargo.make(n++);
      it.position.copy(platformSpot(st, wi, slot));
      it.rotation.y = Math.random() * 3;
      it.traverse(o => { if (o.isMesh) o.castShadow = true; });
      it.userData = { wagon: v, slot };
      st.pile.add(it);
    }
  }
}

// ---------------------------------------------------------------------------
// Ações da criança
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const ui = {
  go: $('goBtn'), horn: $('hornBtn'), energy: $('energyBtn'), speed: $('speedBtn'), cam: $('camBtn'),
  action: $('actionBtn'), home: $('homeBtn'), day: $('dayBtn'), snd: $('soundBtn'), fs: $('fsBtn'),
  stars: $('starCount'), fill: document.querySelector('#energyBtn .fill'), menu: $('menu'),
  energyIcon: $('energyIcon'), confetti: $('confetti'),
};

function onTap(el, fn) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    sound.unlock();
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 150);
    fn(e);
  });
}

function hint(text) {
  const now = performance.now();
  if (now - state.lastHint < 7000) return;
  state.lastHint = now;
  say(text);
}

function pressGo() {
  if (state.busy) return;
  if (state.running && canMove()) {
    state.running = false;
    if (state.speed > 3) sound.brake();
    return;
  }
  state.running = true;
  if (state.atStation) {
    state.ignore = state.atStation.id;
    state.atStation = null;
  }
  if (!canMove()) {
    state.lastHint = 0;
    hint(state.type === 'steam' ? 'Precisa de carvão! Aperte o carvão!'
      : state.type === 'diesel' ? 'Precisa de diesel! Aperte a bomba de combustível!'
        : 'Aperte o raio para ligar a energia!');
  } else if (Math.random() < 0.4) {
    say(['Vamos lá!', 'Partiu!', 'Lá vamos nós!'][Math.floor(Math.random() * 3)]);
  }
}

function pressHorn() {
  sound.horn(state.type);
  const loco = state.train.loco;
  if (state.type === 'steam') {
    const p = loco.model.localToWorld(new V3(0.8, 5.0, -1.3));
    for (let i = 0; i < 6; i++) emit(p, new V3(rnd(1), 3 + Math.random() * 2, rnd(1)), 0xffffff, 0.5, 2.2, 1.1, 0.9);
  }
  loco.hornBounce = 1;
}

function pressEnergy() {
  const loco = state.train.loco;
  if (state.type === 'steam') {
    sound.shovel();
    const was = state.energy;
    state.energy = Math.min(1, state.energy + 0.34);
    const p = loco.model.localToWorld(loco.smoke.clone());
    setTimeout(() => {
      for (let i = 0; i < 8; i++) emit(p, new V3(rnd(2), 5 + Math.random() * 3, rnd(2)), 0x555555, 1, 4, 2.2, 0.85);
    }, 400);
    if (was === 0) encourageGo();
  } else if (state.type === 'diesel') {
    const was = state.energy;
    sound.fuel();
    state.energy = Math.min(1, state.energy + 0.5);
    if (was === 0) {
      setTimeout(() => {
        sound.engineStart();
        const p = loco.model.localToWorld(loco.smoke.clone());
        for (let i = 0; i < 10; i++) emit(p, new V3(rnd(1.5), 4 + Math.random() * 3, rnd(1.5)), 0x333333, 0.8, 3, 1.8, 0.9);
      }, 700);
      encourageGo();
    }
  } else {
    state.pantTarget = state.pantTarget > 0.5 ? 0 : 1;
    sound.zap(state.pantTarget > 0.5);
    if (state.pantTarget > 0.5) {
      setTimeout(() => {
        const p = loco.model.localToWorld(loco.smoke.clone());
        for (let i = 0; i < 14; i++) emit(p, new V3(rnd(8), Math.random() * 4, rnd(8)), 0xfff59d, 0.4, 0.1, 0.5, 1, 12);
      }, 550);
      encourageGo();
    }
  }
}

function encourageGo() {
  if (state.running) return;
  setTimeout(() => {
    if (!state.running && !state.atStation) say('Oba! Agora aperte o botão verde!');
  }, 900);
}

function pressSpeed() {
  state.fast = !state.fast;
  say(state.fast ? 'Rápido!' : 'Devagar!');
}

function pressCam() {
  const i = (CAMS.indexOf(state.cam) + 1) % CAMS.length;
  state.cam = CAMS[i];
  state.yaw = 0;
  state.pitch = 0;
  state.side = null;
  camSnap = true;
}

function arrive(st) {
  state.atStation = st;
  state.running = false;
  state.speed = 0;
  state.s = stopPoint(st);
  sound.ding();
  if (st.kind === 'load') say(`Chegamos na fazenda! Vamos carregar ${CARGO[state.cargoType % CARGO.length].say}!`);
  else say('Chegamos na cidade! Vamos descarregar!');
}

function pressAction() {
  const st = state.atStation;
  if (!st || state.busy) return;
  state.busy = true;
  if (st.kind === 'load') doLoad(st);
  else doUnload(st);
}

function doLoad(st) {
  const items = [...st.pile.children];
  items.forEach((it, i) => {
    const v = it.userData.wagon;
    const target = v.model.localToWorld(it.userData.slot.clone());
    fly(it, target, 0.7, 3, i * 0.35, () => {
      v.cargo.attach(it);
      it.position.copy(it.userData.slot);
      it.rotation.set(0, 0, 0);
      sound.pop();
      if (i === items.length - 1) {
        state.cargoLoaded = true;
        state.busy = false;
        sound.chime();
        say('Pronto! Agora vamos levar para a cidade! Aperte o botão verde!');
      }
    });
  });
}

function doUnload(st) {
  const items = [];
  for (const wi of state.train.wagonIdx) {
    const v = state.train.vehicles[wi];
    for (const it of [...v.cargo.children]) items.push([it, wi]);
  }
  if (!items.length) { state.busy = false; return; }
  items.forEach(([it, wi], i) => {
    const target = platformSpot(st, wi, it.userData.slot);
    st.pile.attach(it);
    fly(it, target, 0.7, 3, i * 0.3, () => {
      sound.pop();
      if (i === items.length - 1) setTimeout(() => finishDelivery(st), 600);
    });
  });
}

function finishDelivery(st) {
  for (const it of [...st.pile.children]) {
    tween(0.5, Math.random() * 0.3, k => it.scale.setScalar(1 - k), () => st.pile.remove(it));
  }
  state.stars += 1;
  store.set('stars', state.stars);
  state.cargoLoaded = false;
  state.cargoType = (state.cargoType + 1) % CARGO.length;
  store.set('cargoType', state.cargoType);
  state.busy = false;
  sound.chime();
  confetti();
  say('Muito bem! Você ganhou uma estrela!');
  setTimeout(buildPile, 900);
  updateHud(true);
}

function confetti() {
  const box = ui.confetti;
  const items = ['⭐', '🎉', '✨', '🌟', '🎈'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.textContent = items[i % items.length];
    s.style.left = `${Math.random() * 100}%`;
    s.style.animationDelay = `${Math.random() * 0.6}s`;
    s.style.fontSize = `${6 + Math.random() * 6}vmin`;
    box.appendChild(s);
    setTimeout(() => s.remove(), 3500);
  }
  const star = $('stars');
  star.classList.remove('bump');
  void star.offsetWidth;
  star.classList.add('bump');
}

// ---------------------------------------------------------------------------
// Toques na tela: arrastar gira a câmera, tocar numa vaca faz "muuu"
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
let drag = null;
canvas.addEventListener('pointerdown', e => {
  sound.unlock();
  drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX;
  drag.y = e.clientY;
  state.yaw -= dx * 0.006;
  if (state.cam === 'cab') {
    state.yaw = Math.max(-1.9, Math.min(1.9, state.yaw));
    state.pitch = Math.max(-0.6, Math.min(0.5, state.pitch - dy * 0.005));
  }
  state.lastDrag = performance.now();
});
canvas.addEventListener('pointerup', e => {
  if (!drag) return;
  const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
  if (moved < 12 && performance.now() - drag.t < 400) tapWorld(e);
  drag = null;
});
canvas.addEventListener('pointercancel', () => { drag = null; });

function tapWorld(e) {
  if (state.menu) return;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const targets = [...world.clickables, ...state.train.vehicles.map(v => v.root)];
  const hit = raycaster.intersectObjects(targets, true)[0];
  if (!hit) return;
  let o = hit.object;
  while (o && !(o.userData && o.userData.kind === 'cow') && !state.train.vehicles.some(v => v.root === o)) o = o.parent;
  if (!o) return;
  if (o.userData.kind === 'cow') {
    sound.moo();
    o.userData.bounce = 1;
  } else {
    pressHorn();
  }
}

// ---------------------------------------------------------------------------
// Câmeras
// ---------------------------------------------------------------------------
// 1 dentro do túnel, 0 longe dele (para a câmera não entrar na montanha)
function tunnelFactor(s) {
  const L = track.length, t = world.tunnel;
  const w = track.wrap(s);
  const x = w > L / 2 ? w - L : w;
  const out = Math.max(0, t.s0 - x, x - t.s1);
  return 1 - Math.min(1, out / 14);
}

let camSnap = true;
let stationBlend = 0;
let lastStation = null;
const camTarget = new V3();
const locoPos = new V3();
const fwd = new V3();

function updateCamera(dt) {
  const loco = state.train.loco;
  loco.root.getWorldPosition(locoPos);
  track.sample(state.s, tmpF);
  fwd.copy(tmpF.t);
  const k = camSnap ? 1 : 1 - Math.exp(-dt * 3.5);
  const inCab = state.cam === 'cab' && !state.menu;
  loco.cab.visible = inCab;
  for (const m of loco.hideInCab) m.visible = !inCab;
  camera.fov = inCab ? 72 : 60;

  // Volta a olhar para a frente depois de um tempo sem mexer
  if (performance.now() - state.lastDrag > 4000 && state.cam === 'cab') {
    state.yaw *= 1 - dt * 1.5;
    state.pitch *= 1 - dt * 1.5;
  }

  if (state.menu) {
    const a = state.time * 0.15;
    const desired = new V3(locoPos.x + Math.cos(a) * 24, 8, locoPos.z + Math.sin(a) * 24);
    camera.position.lerp(desired, k);
    camTarget.lerp(locoPos.clone().add(new V3(0, 2, 0)), k);
    camera.lookAt(camTarget);
  } else if (inCab) {
    const cp = loco.cabPos.clone();
    const bob = Math.sin(state.time * 14) * 0.015 * (state.speed / FAST);
    cp.y += bob;
    camera.position.copy(loco.model.localToWorld(cp));
    const dir = new V3(Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch) - 0.1, Math.cos(state.yaw) * Math.cos(state.pitch));
    camera.lookAt(loco.model.localToWorld(loco.cabPos.clone().add(dir.multiplyScalar(10))));
    camTarget.copy(locoPos);
  } else if (state.cam === 'front') {
    // Na frente e de lado, vendo o rostinho do trem
    const sc = state.s + 15;
    const inT = tunnelFactor(sc);
    track.sample(sc, tmpF);
    const lat = -track.outward(sc) * 10 * (1 - inT);
    const target = locoPos.clone().add(new V3(0, 2.2, 0));
    const off = new V3(tmpF.p.x + tmpF.r.x * lat, 4.5 + 1.5 * (1 - inT), tmpF.p.z + tmpF.r.z * lat).sub(target);
    off.applyAxisAngle(new V3(0, 1, 0), state.yaw);
    camera.position.lerp(target.clone().add(off), k);
    camTarget.lerp(target, k);
    camera.lookAt(camTarget);
  } else if (state.cam === 'chase') {
    const sc = state.s - 24;
    const inT = tunnelFactor(sc);
    track.sample(sc, tmpF);
    const target = locoPos.clone().add(new V3(0, 2.5, 0)).addScaledVector(fwd, 6);
    const off = tmpF.p.clone().add(new V3(0, 11 - 5.5 * inT, 0)).sub(target);
    off.applyAxisAngle(new V3(0, 1, 0), state.yaw);
    camera.position.lerp(target.clone().add(off), k);
    camTarget.lerp(target, k);
    camera.lookAt(camTarget);
  } else if (state.cam === 'side') {
    const L = track.length;
    if (!state.side || track.ahead(state.side.s, state.s) > 35 && track.ahead(state.side.s, state.s) < L / 2) {
      let s = state.s + 50 + state.speed * 1.5;
      const sideSign = state.side ? -state.side.sign : 1;
      const t0 = world.tunnel;
      const sw = track.wrap(s);
      if (sw > L + t0.s0 - 10 || sw < t0.s1 + 10) s = t0.s1 + 15;
      track.sample(s, tmpF);
      const lat = 11 * sideSign;
      const p = new V3(tmpF.p.x + tmpF.r.x * lat, 0, tmpF.p.z + tmpF.r.z * lat);
      p.y = Math.max(0, world.heightAt(p.x, p.z)) + 2.2;
      state.side = { s, sign: sideSign, p };
      camSnap = true;
    }
    camera.position.copy(state.side.p);
    camTarget.lerp(locoPos.clone().add(new V3(0, 2.5, 0)), camSnap ? 1 : k);
    camera.lookAt(camTarget);
  } else {
    const a = state.yaw + 0.8;
    const desired = locoPos.clone().add(new V3(Math.cos(a) * 38, 48, Math.sin(a) * 38));
    camera.position.lerp(desired, k);
    camTarget.lerp(locoPos, k);
    camera.lookAt(camTarget);
  }

  // Na estação a câmera mostra a plataforma com a carga
  const wantStation = !!state.atStation && !inCab && !state.menu;
  if (state.atStation) lastStation = state.atStation;
  stationBlend += Math.sign((wantStation ? 1 : 0) - stationBlend) * Math.min(Math.abs((wantStation ? 1 : 0) - stationBlend), dt * 1.2);
  if (stationBlend > 0.001 && lastStation && !inCab) {
    const e = stationBlend * stationBlend * (3 - 2 * stationBlend);
    const sp = world.stationPoint(lastStation, 4, -13, 10);
    const tp = world.stationPoint(lastStation, 0, 3, 1.5);
    camera.position.lerp(sp, e);
    camera.lookAt(camTarget.clone().lerp(tp, e));
  }
  camera.updateProjectionMatrix();
  camSnap = false;
}

// ---------------------------------------------------------------------------
// Simulação
// ---------------------------------------------------------------------------
function update(dt) {
  state.time += dt;
  const tr = state.train;
  const loco = tr.loco;
  const L = track.length;

  // Pantógrafo sobe/desce devagar
  if (state.type === 'electric') {
    const before = state.pant;
    state.pant += Math.sign(state.pantTarget - state.pant) * Math.min(Math.abs(state.pantTarget - state.pant), dt * 1.2);
    if (state.pant !== before) setPantograph(loco, state.pant);
  }

  // Velocidade alvo
  let target = state.running && canMove() ? (state.fast ? FAST : SLOW) : 0;
  let arriving = null;
  if (!state.menu && !state.atStation) {
    for (const st of world.stations) {
      if (state.ignore === st.id) continue;
      const hasTask = st.kind === 'load' ? !state.cargoLoaded : state.cargoLoaded;
      if (!hasTask) continue;
      const d = track.ahead(state.s, stopPoint(st));
      if (d < 80) {
        target = Math.min(target, Math.sqrt(2 * 2.5 * Math.max(0, d - 0.15)) + 0.4);
        if (state.running && (!arriving || d < arriving.d)) arriving = { st, d };
        if (d < 25 && state.speed > 4 && !st.braked) { st.braked = true; sound.brake(); }
      }
    }
  }
  if (state.ignore) {
    const st = world.stations.find(s => s.id === state.ignore);
    const past = track.ahead(stopPoint(st), state.s);
    if (past > 20 && past < L / 2) state.ignore = null;
  }
  if (state.speed < target) state.speed = Math.min(target, state.speed + dt * 3);
  else state.speed = Math.max(target, state.speed - dt * 6);
  // Chegou (ou ia passar do ponto neste quadro)
  if (arriving && arriving.d <= state.speed * dt + 0.4) {
    for (const st of world.stations) st.braked = false;
    arrive(arriving.st);
  }

  const ds = state.speed * dt;
  state.s = track.wrap(state.s + ds);
  if (state.type !== 'electric' && ds > 0) {
    state.energy = Math.max(0, state.energy - ds * (state.type === 'steam' ? 0.0017 : 0.001));
    if (state.energy === 0 && state.running) {
      hint(state.type === 'steam' ? 'Acabou o carvão! Coloque mais carvão!' : 'Acabou o diesel! Vamos abastecer!');
    }
  }
  if (state.type === 'electric' && state.running && !canMove() && state.pantTarget < 0.5) {
    hint('Aperte o raio para ligar a energia!');
  }

  placeTrain();
  for (const v of tr.vehicles) v.spin(ds);
  for (const r of loco.rods) {
    const a = r.wheel.g.rotation.x;
    r.mesh.position.y = r.cy + r.r * Math.cos(a);
    r.mesh.position.z = r.cz + r.r * Math.sin(a);
  }

  // Olhos piscando e pulinho da buzina
  const blink = (state.time % 4) < 0.12;
  for (const e of loco.eyes) e.scale.y = blink ? 0.1 : 1;
  loco.hornBounce = Math.max(0, (loco.hornBounce || 0) - dt * 2);
  loco.model.position.y = 0.7 + Math.sin(loco.hornBounce * Math.PI * 4) * 0.08 * loco.hornBounce;

  // Painel da cabine
  const sp01 = state.speed / FAST;
  if (loco.needles) {
    loco.needles[0].rotation.y = 1.2 - sp01 * 2.4;
    loco.needles[1].rotation.y = 1.2 - (state.type === 'electric' ? state.pant : state.energy) * 2.4;
    loco.needles[2].rotation.y = Math.sin(state.time * 3) * 0.2;
  }
  if (loco.fire) loco.fire.material.color.setRGB(0.4 + state.energy * 0.6, 0.1 + state.energy * (0.35 + Math.random() * 0.1), 0);

  // Fumaça
  const smokeP = loco.model.localToWorld(loco.smoke.clone());
  if (state.type === 'steam' && state.energy > 0) {
    if (Math.random() < dt * (1.5 + state.speed * 0.7)) {
      emit(smokeP, new V3(rnd(0.6), 3.5 + Math.random() * 2, rnd(0.6)), 0xf5f5f5, 0.8, 3.6 + sp01 * 2, 2.4, 0.85);
    }
    if (state.running && state.speed < 5 && Math.random() < dt * 8) {
      for (const x of [-1.3, 1.3]) {
        const p = loco.model.localToWorld(new V3(x, 0.5, 3.4));
        emit(p, new V3(x * 1.5, 0.8, rnd(1)), 0xffffff, 0.4, 1.8, 0.8, 0.8);
      }
    }
  } else if (state.type === 'diesel' && state.energy > 0) {
    if (Math.random() < dt * (1.5 + state.speed * 0.4)) {
      emit(smokeP, new V3(rnd(0.4), 3 + Math.random(), rnd(0.4)), 0x6d6d6d, 0.4, 1.8, 1.3, 0.6);
    }
  } else if (state.type === 'electric' && state.pant > 0.98 && state.speed > 1) {
    if (Math.random() < dt * state.speed * 0.25) {
      for (let i = 0; i < 4; i++) emit(smokeP, new V3(rnd(5), Math.random() * 3, rnd(5)), 0xfffde7, 0.35, 0.05, 0.35, 1, 10);
    }
  }

  // Dia e noite
  if (state.day !== state.dayTarget) {
    state.day += Math.sign(state.dayTarget - state.day) * Math.min(Math.abs(state.dayTarget - state.day), dt * 0.6);
    world.setDay(state.day);
  }
  if (headlight) headlight.intensity = (1 - state.day) * 5;

  // Som
  const engineOn = state.type === 'electric' ? state.pant > 0.98 : state.energy > 0;
  sound.update(dt, state.type, sp01, ds, engineOn);

  world.update(dt, state.time, locoPos);
  updateTweens(dt);
  updateParticles(dt);
  updateCamera(dt);
  updateHud(false);
}

// ---------------------------------------------------------------------------
// Botões na tela
// ---------------------------------------------------------------------------
const ENERGY_ICONS = {
  steam: '<svg viewBox="0 0 64 64"><path d="M8 50 L20 30 L34 36 L44 22 L58 50 Z" fill="#263238"/><circle cx="22" cy="44" r="9" fill="#37474f"/><circle cx="40" cy="42" r="10" fill="#212121"/><circle cx="31" cy="30" r="7" fill="#455a64"/><path d="M30 20 C26 12 34 8 32 2 C40 8 42 14 38 20 Z" fill="#ff7043"/></svg>',
  diesel: '<span>⛽</span>',
  electric: '<span>⚡</span>',
};

let lastHud = {};
function updateHud(force) {
  if (!state.train) return;
  const moving = state.running && canMove();
  const at = state.atStation;
  const showAction = !!at && !state.busy && (at.kind === 'load' ? !state.cargoLoaded : state.cargoLoaded);
  const hud = {
    moving,
    type: state.type,
    fast: state.fast,
    cam: state.cam,
    action: showAction ? at.kind : '',
    stars: state.stars,
    needEnergy: !canMove() && (state.running || !at),
    goPulse: canMove() && !moving && !showAction && !state.busy,
    day: state.dayTarget,
    snd: sound.enabled,
  };
  const energyVal = state.type === 'electric' ? state.pant : state.energy;
  ui.fill.style.transform = `scaleX(${energyVal})`;
  ui.fill.style.background = energyVal < 0.2 ? '#ef5350' : state.type === 'electric' ? '#ffd600' : '#66bb6a';
  if (!force && JSON.stringify(hud) === JSON.stringify(lastHud)) return;
  lastHud = hud;
  ui.go.classList.toggle('stop', moving);
  ui.go.classList.toggle('pulse', hud.goPulse);
  ui.energyIcon.innerHTML = ENERGY_ICONS[state.type];
  ui.energy.classList.toggle('pulse', hud.needEnergy);
  ui.speed.textContent = state.fast ? '🐇' : '🐢';
  ui.cam.querySelector('.mode').textContent = CAM_ICONS[state.cam];
  ui.action.classList.toggle('hidden', !showAction);
  ui.action.querySelector('.lbl').textContent = hud.action === 'load' ? 'Carregar' : 'Descarregar';
  ui.action.querySelector('.arrow').textContent = hud.action === 'load' ? '⬆️' : '⬇️';
  ui.stars.textContent = state.stars;
  ui.day.textContent = state.dayTarget > 0.5 ? '🌙' : '☀️';
  ui.snd.textContent = sound.enabled ? '🔊' : '🔇';
}

onTap(ui.go, pressGo);
onTap(ui.horn, pressHorn);
onTap(ui.energy, pressEnergy);
onTap(ui.speed, pressSpeed);
onTap(ui.cam, pressCam);
onTap(ui.action, pressAction);
onTap(ui.day, () => {
  state.dayTarget = state.dayTarget > 0.5 ? 0 : 1;
  say(state.dayTarget ? 'Bom dia!' : 'Boa noite! Acenda o farol!');
});
onTap(ui.snd, () => {
  sound.setEnabled(!sound.enabled);
  voice.enabled = sound.enabled;
  if (!voice.enabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  store.set('sound', sound.enabled);
  updateHud(true);
});
onTap(ui.fs, toggleFullscreen);
onTap(ui.home, () => {
  state.running = false;
  state.menu = true;
  ui.menu.classList.remove('hidden');
  document.body.classList.add('in-menu');
});

function toggleFullscreen() {
  const d = document, el = d.documentElement;
  const isFs = d.fullscreenElement || d.webkitFullscreenElement;
  try {
    if (isFs) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  } catch (e) { /* sem tela cheia neste aparelho */ }
}

// Menu de escolha do trem
const INTRO = {
  steam: 'Maria Fumaça! Coloque carvão para ela andar!',
  electric: 'Trem elétrico! Aperte o raio para ligar a energia!',
  diesel: 'Trem a diesel! Coloque diesel para ele andar!',
};
document.querySelectorAll('.card').forEach(card => {
  onTap(card, () => {
    const type = card.dataset.type;
    selectTrain(type);
    state.menu = false;
    state.cam = 'front';
    state.yaw = 0;
    camSnap = true;
    ui.menu.classList.add('hidden');
    document.body.classList.remove('in-menu');
    const d = document;
    if (!(d.fullscreenElement || d.webkitFullscreenElement) && store.get('autoFs', true)) toggleFullscreen();
    sound.horn(type);
    setTimeout(() => say(INTRO[type]), 1300);
  });
});

sound.enabled = store.get('sound', true);
voice.enabled = sound.enabled;

// ---------------------------------------------------------------------------
// Laço principal
// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

document.addEventListener('visibilitychange', () => {
  if (!sound.ctx) return;
  if (document.hidden) sound.ctx.suspend();
  else sound.ctx.resume();
});

selectTrain('steam');
world.setDay(1);
const clock = new THREE.Clock();
// Em testes (?debug) o computador pode ser lento: deixa o tempo andar mais por quadro.
const MAX_DT = location.search.includes('debug') ? 0.3 : 0.05;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), MAX_DT);
  update(dt);
  renderer.render(scene, camera);
});
document.body.classList.add('ready');

// Ajuda para testes automáticos: abra com ?debug
if (location.search.includes('debug')) window.trem = { state, world, stopPoint };

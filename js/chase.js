import * as THREE from 'three';
import { mat, mesh, box, sphere } from './util.js';
import { say } from './audio.js';

// Regras da perseguição (fácil de ajustar)
export const CHASE = {
  HORNS: 30, // buzinadas até o touro aparecer
  WIN_STARS: 3, // estrelas ganhas ao escapar
  LOSE_STARS: 3, // estrelas perdidas se o touro pegar
  DURATION: 12, // segundos que precisa aguentar fugindo
  START_GAP: 20, // distância inicial entre o touro e o último vagão
  CATCH_GAP: 3.2, // o focinho do touro encosta no vagão
  MAX_GAP: 28, // o touro nunca fica mais longe que isso (para aparecer na tela)
  BULL_SPEED: 11,
  BASE_SPEED: 6, // velocidade do trem sem apertar nada
  TAP_BOOST: 2.5, // quanto cada toque acelera
  MAX_BOOST: 14,
  BOOST_DECAY: 1.0, // por segundo
};

// Touro bravo (mas fofinho). Frente em +Z.
function buildBull() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const brown = mat(0x5d3a1a), dark = mat(0x3e2512), horn = mat(0xfff3d6);
  body.add(box(1.9, 1.7, 3.2, brown, 0, 2.1, 0));
  body.add(box(2.0, 1.2, 1.2, dark, 0, 2.6, 1.0)); // cangote
  const head = new THREE.Group();
  head.position.set(0, 2.4, 1.9);
  head.add(box(1.3, 1.2, 1.2, brown, 0, 0, 0.3));
  head.add(box(1.35, 0.6, 0.5, 0xd7a08a, 0, -0.35, 0.9)); // focinho
  head.add(mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 16), 0xffc107, 0, -0.62, 1.16)); // argola
  for (const x of [-1, 1]) {
    head.add(box(0.14, 0.14, 0.06, 0x3e2723, x * 0.25, -0.3, 1.16)); // narinas
    const eye = sphere(0.17, 0xffffff, x * 0.36, 0.25, 0.9, 10);
    head.add(eye);
    head.add(sphere(0.09, 0x111111, x * 0.33, 0.24, 1.03, 8));
    const brow = box(0.4, 0.09, 0.08, 0x111111, x * 0.36, 0.48, 0.95);
    brow.rotation.z = x * -0.45; // sobrancelha brava
    head.add(brow);
    const h = mesh(new THREE.ConeGeometry(0.16, 0.9, 8), horn, x * 0.85, 0.55, 0.2);
    h.rotation.z = x * -1.1;
    head.add(h);
    head.add(box(0.45, 0.25, 0.1, dark, x * 0.75, 0.2, 0.2)); // orelhas
  }
  body.add(head);
  g.userData.head = head;
  // Pernas que balançam
  const legs = [];
  for (const [x, z] of [[-0.6, 1.1], [0.6, 1.1], [-0.6, -1.1], [0.6, -1.1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.4, z);
    pivot.add(box(0.42, 1.3, 0.42, brown, 0, -0.65, 0));
    pivot.add(box(0.46, 0.25, 0.46, 0x222222, 0, -1.3, 0));
    body.add(pivot);
    legs.push(pivot);
  }
  const tail = box(0.12, 1.1, 0.12, dark, 0, 2.2, -1.7);
  tail.rotation.x = 0.6;
  body.add(tail);
  g.userData.legs = legs;
  g.userData.tail = tail;
  g.userData.body = body;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(1.25);
  return g;
}

export class Chase {
  // ctx: { scene, track, sound, emit, state, tailS(), canStart(), addStars(n), confetti(items), onStart(), onEnd() }
  constructor(ctx) {
    this.ctx = ctx;
    this.bull = buildBull();
    this.bull.visible = false;
    ctx.scene.add(this.bull);
    this.hornCount = 0;
    this.active = null;
    this.ui = {
      root: document.getElementById('chaseUI'),
      run: document.getElementById('runBtn'),
      bull: document.querySelector('#chaseMeter .bull'),
      time: document.querySelector('#chaseMeter .time'),
    };
    this.f = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3() };
  }

  // Chamado a cada buzinada fora da perseguição
  countHorn() {
    if (this.active) return;
    this.hornCount++;
  }

  get running() {
    return !!this.active && (this.active.phase === 'warn' || this.active.phase === 'run');
  }

  start() {
    const { sound } = this.ctx;
    this.hornCount = 0;
    this.active = { phase: 'warn', t: 0, gap: 45, boost: 0, legT: 0, puffT: 0 };
    this.bull.visible = true;
    this.bull.scale.setScalar(1.25);
    this.ui.root.classList.remove('hidden');
    document.body.classList.add('chasing');
    sound.moo(0.6);
    setTimeout(() => sound.startTension(), 600);
    say('Opa! Um touro bravo vem vindo! Aperte o botão bem rápido para fugir!');
    this.ctx.onStart();
  }

  tap() {
    const a = this.active;
    if (!a || !this.running) return;
    a.boost = Math.min(CHASE.MAX_BOOST, a.boost + CHASE.TAP_BOOST);
    this.ctx.sound.whoosh();
  }

  // Devolve a velocidade que o trem deve ter (ou null para o jogo normal decidir)
  update(dt, time) {
    if (!this.active && this.hornCount >= CHASE.HORNS && this.ctx.canStart()) this.start();
    const a = this.active;
    if (!a) return null;
    const { sound, track } = this.ctx;
    a.t += dt;
    a.boost = Math.max(0, a.boost - CHASE.BOOST_DECAY * dt);
    const trainSpeed = CHASE.BASE_SPEED + a.boost;
    let override = null;
    let bullSpeed = CHASE.BULL_SPEED;

    if (a.phase === 'warn') {
      // O touro aparece lá atrás e chega correndo
      const k = Math.min(1, a.t / 2);
      a.gap = 45 + (CHASE.START_GAP - 45) * k;
      bullSpeed = trainSpeed + 12;
      override = trainSpeed;
      if (k >= 1) { a.phase = 'run'; a.t = 0; }
    } else if (a.phase === 'run') {
      a.gap += (trainSpeed - CHASE.BULL_SPEED) * dt;
      a.gap = Math.min(a.gap, CHASE.MAX_GAP);
      override = trainSpeed;
      sound.setTension(1 - (a.gap - CHASE.CATCH_GAP) / (CHASE.START_GAP - CHASE.CATCH_GAP));
      if (a.gap <= CHASE.CATCH_GAP) this._caught();
      else if (a.t >= CHASE.DURATION) this._escaped();
    } else if (a.phase === 'escaped') {
      bullSpeed = Math.max(0, CHASE.BULL_SPEED * (1 - a.t / 1.5));
      a.gap += (this.ctx.state.speed - bullSpeed) * dt;
      if (a.t > 1.5) this.bull.userData.body.position.y = -0.5 * Math.min(1, (a.t - 1.5) * 2); // senta cansado
      if (a.t > 4) this._finish();
    } else if (a.phase === 'caught') {
      override = 0;
      bullSpeed = 0;
      if (a.t > 3) this.bull.scale.setScalar(1.25 * Math.max(0.01, 1 - (a.t - 3) * 2));
      if (a.t > 3.5) this._finish();
    }
    if (!this.active) return null;

    // Posiciona o touro no trilho atrás do trem
    const bullS = this.ctx.tailS() - a.gap;
    track.sample(bullS, this.f);
    this.bull.position.set(this.f.p.x, 0.7, this.f.p.z);
    this.bull.lookAt(this.f.p.x + this.f.t.x, 0.7, this.f.p.z + this.f.t.z);
    const legs = this.bull.userData.legs;
    a.legT += dt * (bullSpeed * 0.9 + 1);
    const swing = bullSpeed > 0.5 ? 0.7 : 0;
    legs.forEach((l, i) => { l.rotation.x = Math.sin(a.legT + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * swing; });
    this.bull.userData.body.rotation.x = bullSpeed > 0.5 ? Math.sin(a.legT * 2) * 0.05 : 0;
    this.bull.userData.tail.rotation.z = Math.sin(time * 8) * 0.4;
    if (bullSpeed > 0.5) this.bull.position.y += Math.abs(Math.sin(a.legT)) * 0.35;

    // Poeira e bufadas
    a.puffT -= dt;
    if (a.puffT < 0 && bullSpeed > 0.5) {
      a.puffT = 0.12;
      const back = this.bull.localToWorld(new THREE.Vector3(0, 0.2, -2));
      this.ctx.emit(back, new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2), 0xc8a97e, 0.8, 2.5, 0.9, 0.7);
      if (Math.random() < 0.3) {
        const nose = this.bull.localToWorld(new THREE.Vector3(0, 2.0, 3.3));
        this.ctx.emit(nose, new THREE.Vector3(0, 0.8, 0), 0xffffff, 0.3, 1.4, 0.6, 0.9);
      }
    }
    this._updateUi();
    return override;
  }

  _caught() {
    const { sound } = this.ctx;
    this.active.phase = 'caught';
    this.active.t = 0;
    this.active.shake = 0.6;
    sound.stopTension();
    sound.bonk();
    sound.moo(0.7);
    sound.sadTrombone();
    const lost = this.ctx.addStars(-CHASE.LOSE_STARS);
    this.ctx.confetti(['💫', '💥', '⭐']);
    say(lost > 0
      ? `Ah não! O touro pegou o trem! Perdeu ${lost === 1 ? 'uma estrela' : `${lost} estrelas`}. Na próxima, aperte mais rápido!`
      : 'Ah não! O touro pegou o trem! Na próxima, aperte mais rápido!');
    this.ui.root.classList.add('hidden');
  }

  _escaped() {
    const { sound } = this.ctx;
    this.active.phase = 'escaped';
    this.active.t = 0;
    sound.stopTension();
    sound.fanfare();
    this.ctx.addStars(CHASE.WIN_STARS);
    this.ctx.confetti();
    say(`Ufa! Você escapou do touro! Ganhou ${CHASE.WIN_STARS} estrelas!`);
    this.ui.root.classList.add('hidden');
  }

  _finish() {
    this.bull.visible = false;
    this.bull.userData.body.position.y = 0;
    const caught = this.active.phase === 'caught';
    this.active = null;
    this.ctx.sound.stopTension();
    this.ui.root.classList.add('hidden');
    document.body.classList.remove('chasing');
    this.ctx.onEnd(caught);
  }

  // Tremidinha na câmera quando o touro pega
  shake(dt) {
    const a = this.active;
    if (!a || !a.shake) return 0;
    a.shake = Math.max(0, a.shake - dt);
    return a.shake;
  }

  // Câmera de lado mostrando o touro e o trem
  cameraPose(pos, target) {
    const a = this.active;
    if (!a) return false;
    const { track } = this.ctx;
    const tail = this.ctx.tailS();
    const mid = tail - a.gap / 2;
    track.sample(mid, this.f);
    const lat = -track.outward(tail) * (14 + a.gap * 0.3);
    pos.set(this.f.p.x + this.f.r.x * lat, 8, this.f.p.z + this.f.r.z * lat);
    target.set(this.f.p.x, 2, this.f.p.z);
    // Dentro do túnel: câmera atrás do touro, no meio do trilho (senão entra na montanha)
    const inT = this.ctx.tunnelFactor(mid);
    if (inT > 0) {
      track.sample(tail - a.gap - 9, this.f);
      const behind = new THREE.Vector3(this.f.p.x, 4.5, this.f.p.z);
      pos.lerp(behind, inT);
      track.sample(tail, this.f);
      target.lerp(new THREE.Vector3(this.f.p.x, 2, this.f.p.z), inT);
    }
    return true;
  }

  _updateUi() {
    const a = this.active;
    if (!a) return;
    // 0 = touro colado no trem, 1 = bem longe
    const far = Math.max(0, Math.min(1, (a.gap - CHASE.CATCH_GAP) / (CHASE.MAX_GAP - CHASE.CATCH_GAP)));
    this.ui.bull.style.left = `${(1 - far) * 78}%`;
    const left = a.phase === 'run' ? 1 - a.t / CHASE.DURATION : 1;
    this.ui.time.style.transform = `scaleX(${Math.max(0, left)})`;
    this.ui.root.classList.toggle('danger', far < 0.3);
  }
}

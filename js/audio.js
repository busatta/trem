// Todos os sons são sintetizados com WebAudio: não precisa de arquivos de áudio.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.chuffTimer = 0;
    this.clackDist = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.9 : 0;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this._makeNoise();
      this._setupEngines();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  get t() { return this.ctx.currentTime; }

  _makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noise(dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const offset = Math.random() * 1.5;
    src.start(this.t, offset);
    src.stop(this.t + dur + 0.05);
    return src;
  }

  _env(gainNode, t0, attack, hold, release, peak) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack);
    g.setValueAtTime(peak, t0 + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  }

  _osc(type, freq, t0, dur) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  // Motores contínuos (diesel e elétrico) que só mudam de volume/tom.
  _setupEngines() {
    const c = this.ctx;
    // Diesel: ronco grave
    this.dieselGain = c.createGain();
    this.dieselGain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    this.dieselOsc1 = c.createOscillator();
    this.dieselOsc1.type = 'sawtooth';
    this.dieselOsc1.frequency.value = 42;
    this.dieselOsc2 = c.createOscillator();
    this.dieselOsc2.type = 'square';
    this.dieselOsc2.frequency.value = 21;
    const g2 = c.createGain();
    g2.gain.value = 0.4;
    this.dieselOsc1.connect(lp);
    this.dieselOsc2.connect(g2).connect(lp);
    lp.connect(this.dieselGain).connect(this.master);
    this.dieselOsc1.start();
    this.dieselOsc2.start();

    // Elétrico: zumbido que sobe com a velocidade
    this.elecGain = c.createGain();
    this.elecGain.gain.value = 0;
    this.elecOsc = c.createOscillator();
    this.elecOsc.type = 'triangle';
    this.elecOsc.frequency.value = 120;
    this.elecOsc2 = c.createOscillator();
    this.elecOsc2.type = 'sine';
    this.elecOsc2.frequency.value = 240;
    const eg2 = c.createGain();
    eg2.gain.value = 0.5;
    this.elecOsc.connect(this.elecGain);
    this.elecOsc2.connect(eg2).connect(this.elecGain);
    this.elecGain.connect(this.master);
    this.elecOsc.start();
    this.elecOsc2.start();
  }

  // Chamado a cada quadro. speed01 = velocidade 0..1, ds = distância andada.
  update(dt, type, speed01, ds, engineOn) {
    if (!this.ctx) return;
    const now = this.t;
    const dieselTarget = type === 'diesel' && engineOn ? 0.1 + speed01 * 0.18 : 0;
    this.dieselGain.gain.setTargetAtTime(dieselTarget, now, 0.2);
    this.dieselOsc1.frequency.setTargetAtTime(38 + speed01 * 40, now, 0.3);
    this.dieselOsc2.frequency.setTargetAtTime(19 + speed01 * 20, now, 0.3);

    const elecTarget = type === 'electric' && engineOn ? 0.015 + speed01 * 0.07 : 0;
    this.elecGain.gain.setTargetAtTime(elecTarget, now, 0.2);
    this.elecOsc.frequency.setTargetAtTime(110 + speed01 * 380, now, 0.3);
    this.elecOsc2.frequency.setTargetAtTime(220 + speed01 * 760, now, 0.3);

    if (type === 'steam' && speed01 > 0.02) {
      // "tchu-tchu": 4 baforadas por volta da roda
      const rate = 1.2 + speed01 * 9;
      this.chuffTimer += dt * rate;
      if (this.chuffTimer >= 1) {
        this.chuffTimer = 0;
        this.chuff(0.12 + speed01 * 0.12);
      }
    }

    // Tec-tec dos trilhos
    this.clackDist += ds;
    if (this.clackDist > 12) {
      this.clackDist = 0;
      this.clack(0.05 + speed01 * 0.12);
      setTimeout(() => this.clack(0.05 + speed01 * 0.12), 90);
    }
  }

  chuff(vol) {
    const t0 = this.t;
    const src = this._noise(0.3);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t0);
    bp.frequency.exponentialRampToValueAtTime(300, t0 + 0.25);
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.01, 0.03, 0.2, vol);
    src.connect(bp).connect(g).connect(this.master);
  }

  clack(vol) {
    if (!this.ctx) return;
    const t0 = this.t;
    const src = this._noise(0.08);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 3;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.002, 0.005, 0.05, vol);
    src.connect(bp).connect(g).connect(this.master);
  }

  horn(type) {
    if (!this.ctx) return;
    const t0 = this.t;
    if (type === 'steam') {
      // Piuí! (curto e depois longo)
      this._whistle(t0, 0.28, 1);
      this._whistle(t0 + 0.38, 0.9, 1.06);
    } else if (type === 'diesel') {
      this._chordHorn(t0, 1.1, [196, 247, 294, 370], 'sawtooth', 1400, 0.1);
    } else {
      this._chordHorn(t0, 0.35, [659, 830], 'square', 2500, 0.06);
      this._chordHorn(t0 + 0.42, 0.55, [554, 698], 'square', 2500, 0.06);
    }
  }

  _whistle(t0, dur, mult) {
    const out = this.ctx.createGain();
    this._env(out, t0, 0.04, dur, 0.15, 0.22);
    out.connect(this.master);
    for (const f of [587, 740, 880]) {
      const o = this._osc('sine', f * mult * 0.97, t0, dur + 0.25);
      o.frequency.exponentialRampToValueAtTime(f * mult, t0 + 0.08);
      const g = this.ctx.createGain();
      g.gain.value = 0.33;
      o.connect(g).connect(out);
    }
    const n = this._noise(dur + 0.25);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000;
    const ng = this.ctx.createGain();
    ng.gain.value = 0.15;
    n.connect(bp).connect(ng).connect(out);
  }

  _chordHorn(t0, dur, freqs, type, cutoff, vol) {
    const out = this.ctx.createGain();
    this._env(out, t0, 0.03, dur, 0.12, vol);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.connect(out).connect(this.master);
    for (const f of freqs) this._osc(type, f, t0, dur + 0.2).connect(lp);
  }

  // Pá de carvão + fogo crepitando
  shovel() {
    if (!this.ctx) return;
    const t0 = this.t;
    const src = this._noise(0.4);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, t0);
    bp.frequency.linearRampToValueAtTime(1800, t0 + 0.3);
    const g = this.ctx.createGain();
    this._env(g, t0, 0.02, 0.15, 0.15, 0.35);
    src.connect(bp).connect(g).connect(this.master);
    for (let i = 0; i < 8; i++) {
      setTimeout(() => this.clack(0.08 + Math.random() * 0.1), 350 + Math.random() * 500);
    }
    // Uuush do fogo
    const f = this._noise(1.0);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const fg = this.ctx.createGain();
    this._env(fg, t0 + 0.35, 0.2, 0.2, 0.5, 0.3);
    f.connect(lp).connect(fg).connect(this.master);
  }

  // Bolhas de combustível: glub glub
  fuel() {
    if (!this.ctx) return;
    for (let i = 0; i < 6; i++) {
      const t0 = this.t + i * 0.12;
      const o = this._osc('sine', 300, t0, 0.12);
      o.frequency.exponentialRampToValueAtTime(700 + Math.random() * 200, t0 + 0.1);
      const g = this.ctx.createGain();
      this._env(g, t0, 0.01, 0.03, 0.07, 0.25);
      o.connect(g).connect(this.master);
    }
  }

  // Pantógrafo subindo + faísca
  zap(up) {
    if (!this.ctx) return;
    const t0 = this.t;
    const o = this._osc('sawtooth', up ? 200 : 600, t0, 0.6);
    o.frequency.exponentialRampToValueAtTime(up ? 600 : 150, t0 + 0.5);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.02, 0.35, 0.15, 0.08);
    o.connect(lp).connect(g).connect(this.master);
    if (up) {
      const n = this._noise(0.25);
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      const ng = this.ctx.createGain();
      this._env(ng, t0 + 0.5, 0.005, 0.05, 0.15, 0.3);
      n.connect(hp).connect(ng).connect(this.master);
    }
  }

  // Motor diesel ligando
  engineStart() {
    if (!this.ctx) return;
    const t0 = this.t;
    const o = this._osc('sawtooth', 20, t0, 1.2);
    o.frequency.linearRampToValueAtTime(60, t0 + 0.8);
    o.frequency.linearRampToValueAtTime(40, t0 + 1.1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.1, 0.7, 0.3, 0.3);
    o.connect(lp).connect(g).connect(this.master);
  }

  ding() {
    if (!this.ctx) return;
    const t0 = this.t;
    for (const [f, v] of [[1318, 0.2], [2636, 0.06], [3950, 0.03]]) {
      const o = this._osc('sine', f, t0, 1.5);
      const g = this.ctx.createGain();
      this._env(g, t0, 0.005, 0.02, 1.3, v);
      o.connect(g).connect(this.master);
    }
  }

  chime() {
    if (!this.ctx) return;
    [523, 659, 784, 1046, 1318].forEach((f, i) => {
      const t0 = this.t + i * 0.12;
      const o = this._osc('triangle', f, t0, 0.6);
      const g = this.ctx.createGain();
      this._env(g, t0, 0.01, 0.05, 0.45, 0.2);
      o.connect(g).connect(this.master);
    });
  }

  pop() {
    if (!this.ctx) return;
    const t0 = this.t;
    const o = this._osc('sine', 900, t0, 0.15);
    o.frequency.exponentialRampToValueAtTime(250, t0 + 0.12);
    const g = this.ctx.createGain();
    this._env(g, t0, 0.005, 0.02, 0.1, 0.25);
    o.connect(g).connect(this.master);
  }

  click() {
    if (!this.ctx) return;
    const t0 = this.t;
    const o = this._osc('sine', 600, t0, 0.08);
    const g = this.ctx.createGain();
    this._env(g, t0, 0.003, 0.01, 0.05, 0.12);
    o.connect(g).connect(this.master);
  }

  brake() {
    if (!this.ctx) return;
    const t0 = this.t;
    const o = this._osc('sine', 2900, t0, 1.0);
    o.frequency.linearRampToValueAtTime(2500, t0 + 0.9);
    const g = this.ctx.createGain();
    this._env(g, t0, 0.1, 0.4, 0.4, 0.025);
    o.connect(g).connect(this.master);
    const n = this._noise(1.0);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    const ng = this.ctx.createGain();
    this._env(ng, t0 + 0.6, 0.05, 0.1, 0.4, 0.12);
    n.connect(hp).connect(ng).connect(this.master);
  }

  moo() {
    if (!this.ctx) return;
    const t0 = this.t;
    const o = this._osc('sawtooth', 150, t0, 1.3);
    o.frequency.linearRampToValueAtTime(175, t0 + 0.3);
    o.frequency.linearRampToValueAtTime(115, t0 + 1.2);
    const lfo = this._osc('sine', 5, t0, 1.3);
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 4;
    lfo.connect(lfoG).connect(o.frequency);
    const f1 = this.ctx.createBiquadFilter();
    f1.type = 'lowpass';
    f1.frequency.setValueAtTime(400, t0);
    f1.frequency.linearRampToValueAtTime(900, t0 + 0.4);
    f1.frequency.linearRampToValueAtTime(350, t0 + 1.2);
    f1.Q.value = 4;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.15, 0.7, 0.35, 0.4);
    o.connect(f1).connect(g).connect(this.master);
  }
}

// Voz em português (usa a voz do próprio tablet)
let voices = [];
function loadVoices() {
  try { voices = window.speechSynthesis.getVoices(); } catch (e) { voices = []; }
}
if ('speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

export const voice = { enabled: true };

export function say(text) {
  if (!voice.enabled || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    u.rate = 1.0;
    u.pitch = 1.15;
    const v = voices.find(v => v.lang === 'pt-BR') || voices.find(v => v.lang && v.lang.startsWith('pt'));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  } catch (e) { /* sem voz, tudo bem */ }
}

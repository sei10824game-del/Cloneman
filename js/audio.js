// CLONEMAN — retro SFX via Web Audio API (no assets needed)
export class AudioMan {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._chompAlt = false;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setMuted(m) { this.muted = m; }

  _env(gainPeak, attack, decay, when = 0) {
    const ctx = this.ensure();
    if (!ctx) return null;
    const g = ctx.createGain();
    const t0 = ctx.currentTime + when;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gainPeak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(ctx.destination);
    return { g, t0 };
  }

  _tone(freq, type, peak, attack, decay, when = 0, freqEnd = null) {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const env = this._env(peak, attack, decay, when);
    if (!env) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, env.t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, env.t0 + attack + decay);
    o.connect(env.g);
    o.start(env.t0);
    o.stop(env.t0 + attack + decay + 0.02);
  }

  _noise(peak, attack, decay, when = 0) {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const env = this._env(peak, attack, decay, when);
    if (!env) return;
    const len = Math.floor(ctx.sampleRate * (attack + decay));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(env.g);
    src.start(env.t0);
  }

  chomp() {
    this._chompAlt = !this._chompAlt;
    this._tone(this._chompAlt ? 620 : 480, 'square', 0.06, 0.008, 0.06);
  }

  shoot() {
    this._tone(880, 'square', 0.08, 0.005, 0.10, 0, 320);
    this._tone(1560, 'sawtooth', 0.035, 0.005, 0.07, 0, 640);
  }

  enemyHit() {
    this._tone(300, 'square', 0.09, 0.005, 0.07);
  }

  enemyDie() {
    this._tone(520, 'sawtooth', 0.10, 0.01, 0.28, 0, 70);
    this._noise(0.12, 0.01, 0.22);
  }

  blockBreak() {
    this._noise(0.10, 0.005, 0.12);
    this._tone(180, 'triangle', 0.08, 0.005, 0.09, 0, 90);
  }

  power() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 'square', 0.07, 0.01, 0.12, i * 0.07));
  }

  playerHit() {
    this._tone(220, 'sawtooth', 0.14, 0.01, 0.4, 0, 55);
    this._noise(0.14, 0.01, 0.3);
  }

  roundClear() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone(f, 'square', 0.09, 0.01, 0.16, i * 0.09));
  }

  cloneSpawn() {
    this._tone(1046, 'sine', 0.07, 0.01, 0.18, 0, 1568);
  }

  cloneDown() {
    this._tone(760, 'sine', 0.09, 0.01, 0.22, 0, 170);
    this._tone(360, 'triangle', 0.07, 0.01, 0.2, 0.07, 110);
  }

  gameOver() {
    [392, 330, 262, 196].forEach((f, i) => this._tone(f, 'triangle', 0.12, 0.01, 0.32, i * 0.17));
  }

  uiStart() {
    this._tone(660, 'square', 0.07, 0.01, 0.09);
    this._tone(990, 'square', 0.07, 0.01, 0.14, 0.09);
  }
}

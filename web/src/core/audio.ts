import { events } from './events';

/**
 * AudioManager — every sound is synthesized with WebAudio (no asset files needed).
 * Listens to game events; nothing calls it directly except for ambience/music state.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noiseBuf!: AudioBuffer;
  private last = new Map<string, number>();
  private nextNote = 0;
  private step = 0;
  private intense = false;
  private fireLevel = 0;
  private fireTimer = 0;
  sfxOn = true;
  musicOn = true;

  constructor() {
    const unlock = () => {
      this.init();
      if (this.ctx?.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.bind();
  }

  private init() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 0.9 : 0;
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.32 : 0;
    this.music.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextNote = this.ctx.currentTime + 0.1;
    window.setInterval(() => this.scheduleMusic(), 100);
  }

  setSfx(on: boolean) { this.sfxOn = on; if (this.ctx) this.sfx.gain.value = on ? 0.9 : 0; }
  setMusic(on: boolean) { this.musicOn = on; if (this.ctx) this.music.gain.value = on ? 0.32 : 0; }
  setIntense(on: boolean) { this.intense = on; }
  /** 0..1 — how close the player is to the furnace fire. */
  setFireLevel(v: number) { this.fireLevel = v; }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  private throttle(name: string, ms: number) {
    const now = performance.now();
    if ((this.last.get(name) ?? 0) + ms > now) return false;
    this.last.set(name, now);
    return true;
  }

  // ---- primitives ----
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, freqEnd?: number, delay = 0, out?: AudioNode) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 1, delay = 0, out?: AudioNode) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out ?? this.sfx);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // ---- sound effects ----
  play(name: string) {
    if (!this.ctx || !this.sfxOn) return;
    switch (name) {
      case 'chop':
        if (!this.throttle(name, 60)) return;
        this.noise(0.09, 0.5, 'bandpass', 1500 + Math.random() * 400, 2);
        this.tone(140, 0.12, 'sine', 0.5, 70);
        break;
      case 'fall':
        this.tone(220, 0.5, 'sawtooth', 0.06, 70);
        this.noise(0.45, 0.6, 'lowpass', 400, 1, 0.35);
        this.tone(70, 0.35, 'sine', 0.6, 40, 0.35);
        break;
      case 'coin':
        if (!this.throttle(name, 45)) return;
        this.tone(1320 + Math.random() * 60, 0.08, 'sine', 0.16);
        this.tone(1980, 0.12, 'sine', 0.12, undefined, 0.05);
        break;
      case 'pay':
        if (!this.throttle(name, 50)) return;
        this.tone(900 + Math.random() * 200, 0.05, 'triangle', 0.1);
        break;
      case 'pop':
        if (!this.throttle(name, 40)) return;
        this.tone(520 + Math.random() * 120, 0.07, 'sine', 0.18, 900);
        break;
      case 'build':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.2, undefined, i * 0.07));
        this.noise(0.3, 0.3, 'lowpass', 700, 1);
        break;
      case 'roar':
        if (!this.throttle(name, 700)) return;
        this.tone(110, 0.9, 'sawtooth', 0.14, 55);
        this.tone(83, 0.9, 'square', 0.06, 50);
        this.noise(0.8, 0.25, 'bandpass', 500, 0.7);
        break;
      case 'ballista':
        if (!this.throttle(name, 60)) return;
        this.tone(330, 0.18, 'triangle', 0.22, 110);
        this.noise(0.05, 0.3, 'highpass', 3000);
        break;
      case 'boom':
        this.noise(0.6, 0.8, 'lowpass', 300);
        this.tone(90, 0.4, 'sine', 0.6, 35);
        break;
      case 'hit':
        if (!this.throttle(name, 50)) return;
        this.noise(0.08, 0.5, 'lowpass', 900);
        this.tone(180, 0.1, 'square', 0.08, 90);
        break;
      case 'hurt':
        if (!this.throttle(name, 150)) return;
        this.tone(300, 0.2, 'sawtooth', 0.12, 120);
        break;
      case 'ko':
        this.tone(400, 0.7, 'triangle', 0.25, 80);
        break;
      case 'horn':
        this.tone(196, 0.9, 'sawtooth', 0.09);
        this.tone(147, 0.9, 'sawtooth', 0.09, undefined, 0.45);
        break;
      case 'win':
        [659, 784, 988, 1318].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.18, undefined, i * 0.09));
        break;
      case 'rock':
        if (!this.throttle(name, 60)) return;
        this.tone(900, 0.06, 'square', 0.08, 500);
        this.noise(0.08, 0.4, 'highpass', 2000);
        break;
      case 'drop':
        if (!this.throttle(name, 45)) return;
        this.tone(260 + Math.random() * 80, 0.06, 'sine', 0.2, 180);
        break;
      case 'ding':
        this.tone(1568, 0.3, 'sine', 0.15);
        break;
      case 'click':
        this.tone(700, 0.04, 'triangle', 0.15);
        break;
    }
  }

  /** Called every frame: fire crackle near the furnace. */
  update(dt: number) {
    if (!this.ctx || !this.sfxOn || this.fireLevel <= 0.02) return;
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = 0.04 + Math.random() * 0.16;
      this.noise(0.03 + Math.random() * 0.05, 0.25 * this.fireLevel, 'bandpass', 1800 + Math.random() * 2500, 3);
      if (Math.random() < 0.15) this.noise(0.25, 0.08 * this.fireLevel, 'lowpass', 500);
    }
  }

  // ---- generative winter music (A minor), tenser during waves ----
  private scheduleMusic() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx;
    const bpm = this.intense ? 132 : 84;
    const stepDur = 60 / bpm / 2; // 8th notes
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    const scale = [57, 60, 62, 64, 67, 69, 72, 74, 76];
    while (this.nextNote < c.currentTime + 0.3) {
      const t = this.nextNote - c.currentTime;
      const bar = Math.floor(this.step / 8) % chords.length;
      const chord = chords[bar];
      const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
      if (this.step % 8 === 0) {
        for (const n of chord) this.pad(midi(n - 12), stepDur * 8, t);
        if (this.intense) this.tone(midi(chord[0] - 24), stepDur * 7, 'sawtooth', 0.05, undefined, t, this.music);
      }
      // arpeggio pluck
      const playArp = this.intense ? true : this.step % 2 === 0 || Math.random() < 0.3;
      if (playArp) {
        const n = this.intense ? chord[this.step % 3] + 12 : scale[(this.step * 3 + bar * 2) % scale.length];
        this.tone(midi(n), this.intense ? 0.18 : 0.6, 'triangle', this.intense ? 0.05 : 0.04, undefined, t, this.music);
      }
      if (this.intense) {
        if (this.step % 2 === 0) { // kick
          this.tone(110, 0.18, 'sine', 0.35, 40, t, this.music);
        }
        if (this.step % 4 === 2) this.noise(0.08, 0.12, 'highpass', 5000, 1, t, this.music);
      } else if (this.step % 16 === 12 && Math.random() < 0.5) {
        this.tone(midi(84 + [0, 3, 7][Math.floor(Math.random() * 3)]), 1.2, 'sine', 0.025, undefined, t, this.music); // chime
      }
      this.nextNote += stepDur;
      this.step++;
    }
  }

  private pad(freq: number, dur: number, delay: number) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    o.detune.value = (Math.random() - 0.5) * 12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private bind() {
    events.on('tree:hit', () => this.play('chop'));
    events.on('rock:hit', () => this.play('rock'));
    events.on('tree:fell', () => this.play('fall'));
    events.on('currency:collected', () => this.play('coin'));
    events.on('zone:pay', () => this.play('pay'));
    events.on('zone:built', () => this.play('build'));
    events.on('region:opened', () => this.play('win'));
    events.on('enemy:spawn', () => this.play('roar'));
    events.on('enemy:hit', () => this.play('hit'));
    events.on('enemy:telegraph', () => this.play('roar'));
    events.on('tower:fire', () => this.play('ballista'));
    events.on('cannon:explode', () => this.play('boom'));
    events.on('player:hit', () => this.play('hurt'));
    events.on('player:ko', () => this.play('ko'));
    events.on('wave:warning', () => this.play('horn'));
    events.on('wave:start', () => this.setIntense(true));
    events.on('wave:end', () => { this.setIntense(false); this.play('win'); });
    events.on('item:deposit', () => this.play('drop'));
    events.on('item:pickup', () => this.play('pop'));
    events.on('upgrade:bought', () => this.play('build'));
    events.on('palisade:broken', () => this.play('boom'));
    events.on('cook:done', () => this.play('ding'));
    events.on('tutorial:step', () => this.play('ding'));
  }
}

/* Procedural lofi generator built on the Web Audio API.
   Jazzy 7th-chord progressions, swung boom-bap drums, a lazy pentatonic
   melody, tape wobble, vinyl crackle and optional rain. No audio files. */
(function () {
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // [voicing (midi notes), bass root]
  const PROGRESSIONS = [
    [[[53, 57, 60, 64], 41], [[52, 55, 59, 62], 40], [[50, 53, 57, 60], 38], [[48, 52, 55, 59], 36]],
    [[[50, 53, 57, 60], 38], [[53, 57, 59, 64], 43], [[52, 55, 59, 62], 36], [[55, 61, 64, 67], 45]],
    [[[57, 60, 64, 67], 45], [[53, 57, 60, 64], 38], [[53, 59, 62, 67], 43], [[55, 59, 64, 67], 36]],
    [[[52, 55, 59, 62], 40], [[57, 60, 64, 67], 45], [[50, 53, 57, 60], 38], [[53, 59, 62, 67], 43]],
  ];
  const MELODY = [72, 74, 76, 79, 81, 84, 86];

  class Lofi {
    constructor() {
      this.ctx = null;
      this.playing = false;
      this.volume = 0.6;
      this.rain = false;
      this.crackle = true;
      this.bpm = 74;
      this.timer = null;
    }

    getCtx() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      return this.ctx;
    }

    _build() {
      if (this.master) return;
      const ctx = this.getCtx();
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass'; tone.frequency.value = 2600; tone.Q.value = 0.4;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3;
      this.master.connect(tone); tone.connect(comp); comp.connect(ctx.destination);

      // tape wow & flutter: a slowly modulated delay line on the music bus
      this.music = ctx.createGain(); this.music.gain.value = 1;
      const tape = ctx.createDelay(0.1); tape.delayTime.value = 0.012;
      const wow = ctx.createOscillator(); wow.frequency.value = 0.35;
      const wowDepth = ctx.createGain(); wowDepth.gain.value = 0.0018;
      wow.connect(wowDepth); wowDepth.connect(tape.delayTime); wow.start();
      this.music.connect(tape); tape.connect(this.master);

      // reverb
      this.verb = ctx.createConvolver();
      this.verb.buffer = this._impulse(2.6);
      const verbOut = ctx.createGain(); verbOut.gain.value = 0.32;
      this.verb.connect(verbOut); verbOut.connect(this.music);

      this.noise = this._noiseBuffer(2);

      // drum bus
      this.drums = ctx.createGain(); this.drums.gain.value = 0.75;
      const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 3800;
      this.drums.connect(dl); dl.connect(this.music);

      // vinyl crackle loop
      const cr = ctx.createBufferSource(); cr.buffer = this._crackleBuffer(5); cr.loop = true;
      const crf = ctx.createBiquadFilter(); crf.type = 'bandpass'; crf.frequency.value = 3000; crf.Q.value = 0.6;
      this.crackleGain = ctx.createGain(); this.crackleGain.gain.value = this.crackle ? 0.5 : 0;
      cr.connect(crf); crf.connect(this.crackleGain); this.crackleGain.connect(this.master); cr.start();

      // rain loop
      const rn = ctx.createBufferSource(); rn.buffer = this._rainBuffer(6); rn.loop = true;
      const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 1700;
      const rh = ctx.createBiquadFilter(); rh.type = 'highpass'; rh.frequency.value = 250;
      this.rainGain = ctx.createGain(); this.rainGain.gain.value = this.rain ? 0.55 : 0;
      rn.connect(rl); rl.connect(rh); rh.connect(this.rainGain); this.rainGain.connect(this.master); rn.start();
    }

    _noiseBuffer(sec) {
      const ctx = this.ctx, n = ctx.sampleRate * sec;
      const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    _crackleBuffer(sec) {
      const ctx = this.ctx, n = ctx.sampleRate * sec;
      const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * 0.012;
        if (Math.random() < 0.00035) {
          const amp = rand(0.15, 0.6) * (Math.random() < 0.5 ? -1 : 1);
          for (let k = 0; k < 40 && i + k < n; k++) d[i + k] += amp * Math.exp(-k / 6);
        }
      }
      return b;
    }
    _rainBuffer(sec) {
      const ctx = this.ctx, n = ctx.sampleRate * sec;
      const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.03 * w) / 1.03;
        d[i] = last * 3 + w * 0.04;
        if (Math.random() < 0.0006) for (let k = 0; k < 200 && i + k < n; k++) d[i + k] += (Math.random() - 0.5) * 0.25 * Math.exp(-k / 40);
      }
      // crossfade the loop seam
      const f = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < f; i++) { const t = i / f; d[i] = d[i] * t + d[n - f + i] * (1 - t); }
      return b;
    }
    _impulse(sec) {
      const ctx = this.ctx, n = ctx.sampleRate * sec;
      const b = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      }
      return b;
    }

    /* ---------- instruments ---------- */
    _keys(midi, t, dur, vel, send = 0.35) {
      const ctx = this.ctx, f = mtof(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.025);
      g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.9);
      g.gain.setTargetAtTime(0.0001, t + dur, 0.25);
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.18, t); g2.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
      o1.detune.value = rand(-6, 6);
      o1.connect(g); o2.connect(g2); g2.connect(g);
      g.connect(this.music);
      const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(this.verb);
      const end = t + dur + 1.6;
      o1.start(t); o2.start(t); o1.stop(end); o2.stop(end);
    }
    _bass(midi, t, dur) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(midi + 12);
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mtof(midi + 12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.32, t + 0.02);
      g.gain.setTargetAtTime(0.0001, t + dur * 0.85, 0.08);
      const g2 = ctx.createGain(); g2.gain.value = 0.12;
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.music);
      o.start(t); o2.start(t); o.stop(t + dur + 0.5); o2.stop(t + dur + 0.5);
    }
    _kick(t, vel = 1) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.95 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o.connect(g); g.connect(this.drums); o.start(t); o.stop(t + 0.4);
    }
    _snare(t, vel = 1) {
      const ctx = this.ctx;
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.32 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      n.connect(bp); bp.connect(g); g.connect(this.drums);
      const s = ctx.createGain(); s.gain.value = 0.25; g.connect(s); s.connect(this.verb);
      const o = ctx.createOscillator(); o.frequency.value = 185;
      const og = ctx.createGain(); og.gain.setValueAtTime(0.18 * vel, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(og); og.connect(this.drums);
      n.start(t, Math.random()); n.stop(t + 0.25); o.start(t); o.stop(t + 0.1);
    }
    _hat(t, vel = 1) {
      const ctx = this.ctx;
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.07 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      n.connect(hp); hp.connect(g); g.connect(this.drums);
      n.start(t, Math.random()); n.stop(t + 0.06);
    }

    /* ---------- sequencer ---------- */
    _scheduleStep(step, t) {
      const stepDur = 60 / this.bpm / 4;
      const swing = step % 4 === 2 ? stepDur * 0.38 : 0;
      const ts = t + swing;
      if (step === 0) {
        if (this.bar % 16 === 0 && this.bar > 0) this.prog = pick(PROGRESSIONS);
        this.dropDrums = this.bar % 8 === 0 && Math.random() < 0.6;
      }
      const [voicing, root] = this.prog[this.bar % 4];

      if (step === 0) voicing.forEach((m, i) => this._keys(m, t + i * 0.018 + rand(0, 0.01), stepDur * 14, rand(0.07, 0.09)));
      if (step === 10 && Math.random() < 0.45) voicing.forEach((m, i) => this._keys(m, ts + i * 0.015, stepDur * 5, 0.045));

      if (step === 0) this._bass(root, t, stepDur * 6);
      if (step === 6 && Math.random() < 0.4) this._bass(root + 7, ts, stepDur * 2);
      if (step === 10) this._bass(root, ts, stepDur * 4);

      if (!this.dropDrums) {
        if (step === 0 || step === 10 || (step === 7 && Math.random() < 0.35)) this._kick(ts, step === 0 ? 1 : 0.8);
        if (step === 4 || step === 12) this._snare(ts, rand(0.85, 1));
        if (step % 2 === 0) this._hat(ts, step % 4 === 0 ? rand(0.8, 1) : rand(0.45, 0.7));
        if (step === 15 && Math.random() < 0.2) this._hat(ts, 0.5);
      }

      if (step % 2 === 0 && Math.random() < (this.dropDrums ? 0.12 : 0.24)) {
        this.melIdx = Math.max(0, Math.min(MELODY.length - 1, this.melIdx + pick([-2, -1, -1, 1, 1, 2])));
        this._keys(MELODY[this.melIdx], ts, stepDur * pick([2, 3, 4]), rand(0.035, 0.055), 0.6);
      }
    }

    _tick() {
      const ctx = this.ctx, stepDur = 60 / this.bpm / 4;
      // big lookahead so background-tab timer throttling doesn't cause gaps
      while (this.nextTime < ctx.currentTime + 1.5) {
        this._scheduleStep(this.step, this.nextTime);
        this.nextTime += stepDur;
        this.step = (this.step + 1) % 16;
        if (this.step === 0) this.bar++;
      }
    }

    async start() {
      if (this.playing) return;
      const ctx = this.getCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') await ctx.resume();
      this._build();
      this.playing = true;
      this.prog = pick(PROGRESSIONS);
      this.step = 0; this.bar = 0; this.melIdx = 3;
      this.nextTime = ctx.currentTime + 0.15;
      this.master.gain.cancelScheduledValues(ctx.currentTime);
      this.master.gain.setTargetAtTime(this.volume * 0.85, ctx.currentTime, 0.4);
      this.music.gain.cancelScheduledValues(ctx.currentTime);
      this.music.gain.setValueAtTime(1, ctx.currentTime);
      this._tick();
      this.timer = setInterval(() => this._tick(), 200);
    }

    stop() {
      if (!this.playing) return;
      this.playing = false;
      clearInterval(this.timer);
      const ctx = this.ctx, now = ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0, now, 0.35);
    }

    setVolume(v) {
      this.volume = v;
      if (this.master && this.playing) this.master.gain.setTargetAtTime(v * 0.85, this.ctx.currentTime, 0.1);
    }
    setRain(on) {
      this.rain = on;
      if (this.rainGain) this.rainGain.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.5);
    }
    setCrackle(on) {
      this.crackle = on;
      if (this.crackleGain) this.crackleGain.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.3);
    }

    /* little coin "clink" — goes straight to the speakers, independent of music volume */
    clink(intensity = 1) {
      const ctx = this.getCtx();
      if (!ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      const base = rand(2400, 3200);
      [1, 1.47, 2.09].forEach((r, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base * r;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.05 * intensity / (i + 1), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 + i * 0.05);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.35);
      });
    }
    chime() {
      const ctx = this.getCtx();
      if (!ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      [72, 76, 79, 84].forEach((m, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + i * 0.09);
        g.gain.linearRampToValueAtTime(0.08, t + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.8);
        o.connect(g); g.connect(ctx.destination); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.9);
      });
    }
  }

  window.Lofi = Lofi;
})();

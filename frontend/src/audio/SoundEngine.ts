/**
 * SoundEngine — Procedural audio for SKYSHIELD using Web Audio API.
 * All sounds are synthesized with oscillators and noise. No external files.
 */

type SoundName =
  | "detection_ping"
  | "track_confirmed"
  | "identification_complete"
  | "engagement_kinetic"
  | "engagement_electronic"
  | "engagement_directed_energy"
  | "target_defeated"
  | "mission_fail"
  | "threat_yellow"
  | "threat_orange"
  | "threat_red"
  | "camera_slew"
  | "clock_tick"
  | "debrief_reveal";

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _volume = 0.5;
  private _muted = false;
  private initialized = false;

  constructor() {
    // Restore preferences from localStorage
    const saved = localStorage.getItem("skyshield_audio");
    if (saved) {
      try {
        const prefs = JSON.parse(saved);
        if (typeof prefs.volume === "number") this._volume = prefs.volume;
        if (typeof prefs.muted === "boolean") this._muted = prefs.muted;
      } catch {
        // ignore
      }
    }
  }

  /** Must be called from a user gesture (click/key) to satisfy autoplay policy. */
  init(): void {
    if (this.initialized) return;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._muted ? 0 : this._volume;
    this.masterGain.connect(this.ctx.destination);
    this.initialized = true;
  }

  private ensureCtx(): { ctx: AudioContext; master: GainNode } | null {
    if (!this.initialized) this.init();
    if (!this.ctx || !this.masterGain) return null;
    if (this.ctx.state === "suspended") this.ctx.resume();
    return { ctx: this.ctx, master: this.masterGain };
  }

  private savePrefs(): void {
    localStorage.setItem(
      "skyshield_audio",
      JSON.stringify({ volume: this._volume, muted: this._muted }),
    );
  }

  get volume(): number {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && !this._muted) {
      this.masterGain.gain.value = this._volume;
    }
    this.savePrefs();
  }

  get muted(): boolean {
    return this._muted;
  }
  set muted(m: boolean) {
    this._muted = m;
    if (this.masterGain) {
      this.masterGain.gain.value = m ? 0 : this._volume;
    }
    this.savePrefs();
  }

  // ─── Sound Generators ──────────────────────────────────────────

  play(name: SoundName): void {
    const audio = this.ensureCtx();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;

    switch (name) {
      case "detection_ping":
        this.detectionPing(ctx, master, t);
        break;
      case "track_confirmed":
        this.trackConfirmed(ctx, master, t);
        break;
      case "identification_complete":
        this.identificationComplete(ctx, master, t);
        break;
      case "engagement_kinetic":
        this.engagementKinetic(ctx, master, t);
        break;
      case "engagement_electronic":
        this.engagementElectronic(ctx, master, t);
        break;
      case "engagement_directed_energy":
        this.engagementDirectedEnergy(ctx, master, t);
        break;
      case "target_defeated":
        this.targetDefeated(ctx, master, t);
        break;
      case "mission_fail":
        this.missionFail(ctx, master, t);
        break;
      case "threat_yellow":
        this.threatChange(ctx, master, t, 0);
        break;
      case "threat_orange":
        this.threatChange(ctx, master, t, 1);
        break;
      case "threat_red":
        this.threatChange(ctx, master, t, 2);
        break;
      case "camera_slew":
        this.cameraSlew(ctx, master, t);
        break;
      case "clock_tick":
        this.clockTick(ctx, master, t);
        break;
      case "debrief_reveal":
        this.debriefReveal(ctx, master, t);
        break;
    }
  }

  /** Short sonar-style radar blip. Sine 1200Hz, quick exponential decay. */
  private detectionPing(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.15);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Two-tone ascending beep. */
  private trackConfirmed(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    const freqs = [660, 880];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.3, t + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.12);
      osc.connect(gain).connect(master);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.15);
    });
  }

  /** Three quick ascending tones — satisfying 'classified' chirp. */
  private identificationComplete(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    const freqs = [523, 659, 784]; // C5, E5, G5
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.25, t + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.1);
      osc.connect(gain).connect(master);
      osc.start(t + i * 0.09);
      osc.stop(t + i * 0.09 + 0.12);
    });
  }

  /** Punchy low thump + mid crackle for kinetic weapons. */
  private engagementKinetic(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    // Low thump
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.2);
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + 0.25);

    // Mid crackle via noise burst
    this.noiseBurst(ctx, master, t + 0.02, 0.12, 0.35, 800, 3000);
  }

  /** Electronic buzz/sweep for jammers & EW. */
  private engagementElectronic(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(2000, t + 0.3);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.5);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.setValueAtTime(0.2, t + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  /** Directed energy: rising hum + sharp release. */
  private engagementDirectedEnergy(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    // Charge-up hum
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.linearRampToValueAtTime(0.4, t + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + 0.45);

    // Sharp click at release
    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.type = "square";
    click.frequency.value = 3000;
    cg.gain.setValueAtTime(0.3, t + 0.3);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    click.connect(cg).connect(master);
    click.start(t + 0.3);
    click.stop(t + 0.35);
  }

  /** Clean success chime: major triad. */
  private targetDefeated(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    const freqs = [523, 659, 784, 1047]; // C5, E5, G5, C6
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      const start = t + i * 0.06;
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  }

  /** Alarm buzz: low ominous pulse. */
  private missionFail(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 180;
      const start = t + i * 0.25;
      gain.gain.setValueAtTime(0.3, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.2);
    }
  }

  /** Threat level escalation: brief warning tone, increasingly urgent. */
  private threatChange(
    ctx: AudioContext,
    master: GainNode,
    t: number,
    severity: number, // 0=yellow, 1=orange, 2=red
  ): void {
    const baseFreq = 400 + severity * 200;
    const pulses = severity + 1;
    for (let i = 0; i < pulses; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = baseFreq;
      const start = t + i * 0.12;
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.12);
    }
  }

  /** Servo motor whir: filtered noise sweep. */
  private cameraSlew(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    // White noise through bandpass filter sweeping up
    const bufferSize = ctx.sampleRate * 0.4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(2000, t + 0.2);
    filter.frequency.exponentialRampToValueAtTime(800, t + 0.35);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    noise.connect(filter).connect(gain).connect(master);
    noise.start(t);
    noise.stop(t + 0.35);
  }

  /** Barely audible tick: very short high-freq click. */
  private clockTick(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  /** Score reveal: rapid ascending tones like a slot machine tally. */
  private debriefReveal(
    ctx: AudioContext,
    master: GainNode,
    t: number,
  ): void {
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 400 + i * 80;
      const start = t + i * 0.06;
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.08);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.1);
    }
    // Final chime
    const final = ctx.createOscillator();
    const fg = ctx.createGain();
    final.type = "sine";
    final.frequency.value = 1047; // C6
    const ft = t + steps * 0.06 + 0.05;
    fg.gain.setValueAtTime(0.25, ft);
    fg.gain.exponentialRampToValueAtTime(0.001, ft + 0.4);
    final.connect(fg).connect(master);
    final.start(ft);
    final.stop(ft + 0.45);
  }

  // ─── Helpers ───────────────────────────────────────────────────

  /** Short noise burst through a bandpass filter. */
  private noiseBurst(
    ctx: AudioContext,
    master: GainNode,
    t: number,
    duration: number,
    volume: number,
    lowFreq: number,
    highFreq: number,
  ): void {
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = (lowFreq + highFreq) / 2;
    filter.Q.value = 1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter).connect(gain).connect(master);
    noise.start(t);
    noise.stop(t + duration);
  }
}

/** Singleton instance. */
export const soundEngine = new SoundEngine();

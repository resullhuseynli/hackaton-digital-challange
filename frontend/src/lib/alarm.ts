/** Two-tone siren built with the Web Audio API (no audio assets needed). */
class Alarm {
  private ctx: AudioContext | null = null;
  private timer: number | null = null;
  private stopAt = 0;

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  /** Call from a user gesture once so browsers allow audio later. */
  unlock() {
    const ctx = this.ensureCtx();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  /** Distinct rising three-note chime (♿ SOS), clearly different from the RED ALERT siren. */
  chime() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    [660, 880, 1175].forEach((freq, i) => {
      const at = ctx.currentTime + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.32);
    });
  }

  private beep(freq: number, duration: number) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  /** Plays the siren for `seconds` (repeats high/low tones). */
  play(seconds = 6) {
    this.stopAt = Date.now() + seconds * 1000;
    if (this.timer != null) return;
    let high = true;
    const step = () => {
      if (Date.now() > this.stopAt) {
        this.stop();
        return;
      }
      this.beep(high ? 960 : 720, 0.32);
      high = !high;
    };
    step();
    this.timer = window.setInterval(step, 380);
  }

  stop() {
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
  }
}

export const alarm = new Alarm();

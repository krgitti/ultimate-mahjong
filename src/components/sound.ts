/**
 * Tiny WebAudio synth for UI feedback — no external assets.
 * All sounds are short oscillator blips with envelopes.
 */

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function blip(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08, slide = 0) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur + 0.02);
}

export const sfx = {
  click: () => blip(660, 0.06, 'triangle', 0.05),
  select: () => blip(880, 0.07, 'triangle', 0.06),
  match: () => {
    blip(740, 0.09, 'sine', 0.07);
    setTimeout(() => blip(988, 0.12, 'sine', 0.07), 70);
  },
  error: () => blip(160, 0.16, 'sawtooth', 0.05, -60),
  call: () => blip(523, 0.12, 'square', 0.045),
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.18, 'sine', 0.07), i * 110));
  },
  lose: () => {
    [392, 330, 262].forEach((f, i) => setTimeout(() => blip(f, 0.2, 'sine', 0.06), i * 140));
  },
};

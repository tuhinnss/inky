/**
 * Sound and vibration: the pencil heard on paper as you write, the eraser as you rub, and
 * a soft note when the notebook writes in an answer.
 *
 * Every sound is made on the spot with the Web Audio API from filtered noise and two
 * oscillators. There are no sound files to download or cache, so it works offline from
 * the first visit and adds nothing to the app's size.
 *
 * Vibration uses `navigator.vibrate`. Android browsers have it; iPhones and iPads do not,
 * and many tablets have no vibration motor. Where it is missing, nothing happens.
 *
 * Both are switched off together by the speaker button in the margin, and the choice is
 * remembered on this device.
 */

import type { Motion } from '../canvas/InkCanvas';
import { VIBRATION, scratchLevel, type Cue } from './cues';

const SETTING = 'calcink.feedback';

/** How loud the pencil is at full speed. Quiet: it is a texture, not a signal. */
const PENCIL_GAIN = 0.11;
/** The eraser's rubber is softer and lower, and a little louder for it. */
const ERASER_GAIN = 0.14;
/** The pencil's hiss sits high, where graphite catching on paper does. */
const PENCIL_PITCH = 3200;
const ERASER_PITCH = 700;
/** How quickly the sound follows the pen, and how soon it dies once the pen stops. */
const FOLLOW = 0.015;
const STOPPED_AFTER = 0.06;
const FADE = 0.03;
/** An idle audio context is suspended after this long, so the device can sleep its audio. */
const SUSPEND_AFTER_MS = 4000;
/** How long the notebook takes to pencil an answer in (see AnswerOverlay). */
const WRITE_S = 0.26;

/** Whether sound and vibration are on: on unless switched off on this device before. */
export function loadFeedbackSetting(): boolean {
  try {
    return localStorage.getItem(SETTING) !== 'off';
  } catch {
    return true; // storage blocked, as in some private windows
  }
}

function saveFeedbackSetting(on: boolean): void {
  try {
    localStorage.setItem(SETTING, on ? 'on' : 'off');
  } catch {
    // Not remembered, but it still applies for this visit.
  }
}

/** A running pencil or eraser sound: noise through a band-pass filter, at some volume. */
interface Scratch {
  tool: Motion['tool'];
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class Feedback {
  private on: boolean;
  private context: AudioContext | null = null;
  /** Two seconds of paper: white noise with a slow grain, played in a loop. */
  private paper: AudioBuffer | null = null;
  private scratch: Scratch | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(on = loadFeedbackSetting()) {
    this.on = on;
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    saveFeedbackSetting(on);
    if (!on) this.stopScratch();
  }

  /**
   * Browsers keep a page silent until the person has touched it. Called on every press on
   * the page, which counts as a touch, so the audio is ready by the time the pen moves.
   */
  wake(): void {
    if (!this.on) return;
    clearTimeout(this.suspendTimer);
    if (!this.context) {
      const Context =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      try {
        this.context = new Context({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.paper = makePaper(this.context);
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  /** The pen or eraser moved at this speed, or lifted (null). */
  move(motion: Motion | null): void {
    const context = this.context;
    if (!motion) {
      this.stopScratch();
      return;
    }
    if (!this.on || !context || !this.paper) return;
    if (this.scratch?.tool !== motion.tool) {
      this.stopScratch();
      this.scratch = this.startScratch(context, this.paper, motion.tool);
    }
    const full = motion.tool === 'pen' ? PENCIL_GAIN : ERASER_GAIN;
    const level = full * scratchLevel(motion.speed);
    const gain = this.scratch.gain.gain;
    const now = context.currentTime;
    // Follow the pen, then fall silent unless another movement comes to say it is still
    // moving: a pen held still on the paper makes no sound.
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(level, now, FOLLOW);
    gain.setTargetAtTime(0, now + STOPPED_AFTER, FADE);
  }

  /** An answer was written in, or a sum turned out not to work. */
  cue(cue: Cue): void {
    if (!this.on) return;
    vibrate(VIBRATION[cue]);
    const { context, paper } = this;
    if (!context || !paper || context.state === 'closed') return;
    clearTimeout(this.suspendTimer);
    const play = (): void => {
      const now = context.currentTime;
      if (cue === 'answer') {
        // A soft wooden note, and the pencil writing the answer in as it appears.
        note(context, 784, now, 0.05);
        this.pencilStroke(context, paper, now + 0.02, WRITE_S, 0.05);
      } else {
        // Two low notes, falling: something to look at, without a buzzer.
        note(context, 330, now, 0.05);
        note(context, 262, now + 0.13, 0.05);
      }
      this.suspendLater();
    };
    // Asleep after a quiet spell: wake it first, or the notes would wait for the next stroke.
    if (context.state === 'running') play();
    else context.resume().then(play, () => {});
  }

  /** A scribble rubbed writing out. Its sound was the scribble itself; this adds the feel. */
  scratchedOut(): void {
    if (this.on) vibrate(VIBRATION['scratch-out']);
  }

  destroy(): void {
    clearTimeout(this.suspendTimer);
    this.stopScratch();
    void this.context?.close().catch(() => {});
    this.context = null;
  }

  private startScratch(context: AudioContext, paper: AudioBuffer, tool: Motion['tool']): Scratch {
    const source = context.createBufferSource();
    source.buffer = paper;
    source.loop = true;
    // Start somewhere different each time, so no two strokes sound exactly alike.
    const offset = Math.random() * paper.duration;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = tool === 'pen' ? PENCIL_PITCH : ERASER_PITCH;
    filter.Q.value = tool === 'pen' ? 0.9 : 0.6;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(context.currentTime, offset);
    clearTimeout(this.suspendTimer);
    return { tool, source, gain };
  }

  private stopScratch(): void {
    const scratch = this.scratch;
    if (!scratch || !this.context) return;
    this.scratch = null;
    const now = this.context.currentTime;
    scratch.gain.gain.cancelScheduledValues(now);
    scratch.gain.gain.setTargetAtTime(0, now, FADE);
    scratch.source.stop(now + 6 * FADE);
    this.suspendLater();
  }

  /** The sound of a short line pencilled in: three quick strokes of graphite. */
  private pencilStroke(
    context: AudioContext,
    paper: AudioBuffer,
    at: number,
    length: number,
    loudness: number,
  ): void {
    const source = context.createBufferSource();
    source.buffer = paper;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = PENCIL_PITCH;
    filter.Q.value = 0.9;
    const gain = context.createGain();
    gain.gain.value = 0;
    const strokes = 3;
    for (let i = 0; i < strokes; i++) {
      const start = at + (i * length) / strokes;
      gain.gain.setTargetAtTime(loudness, start, 0.01);
      gain.gain.setTargetAtTime(0, start + length / strokes / 2, 0.02);
    }
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(at, Math.random() * paper.duration * 0.5);
    source.stop(at + length + 0.2);
  }

  /** Once everything has gone quiet, lets the audio hardware sleep. */
  private suspendLater(): void {
    clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      if (!this.scratch) void this.context?.suspend().catch(() => {});
    }, SUSPEND_AFTER_MS);
  }
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Refused, as before the page has been touched. It is only a nicety.
  }
}

/** A short, soft note like a tap on a wooden block: a pure tone with a quick decay. */
function note(context: AudioContext, frequency: number, at: number, loudness: number): void {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(loudness, at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
  gain.connect(context.destination);
  // The fundamental, and a quieter overtone that gives it the knock of wood.
  for (const [multiple, share] of [
    [1, 1],
    [2.76, 0.25],
  ]) {
    const oscillator = context.createOscillator();
    oscillator.frequency.value = frequency * multiple;
    const level = context.createGain();
    level.gain.value = share;
    oscillator.connect(level).connect(gain);
    oscillator.start(at);
    oscillator.stop(at + 0.4);
  }
}

/**
 * White noise whose loudness wanders a little, many times a second, the way a pencil's
 * sound catches on the tooth of the paper.
 */
function makePaper(context: AudioContext): AudioBuffer {
  const length = 2 * context.sampleRate;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const grainEvery = Math.round(context.sampleRate / 90);
  let grain = 1;
  let target = 1;
  for (let i = 0; i < length; i++) {
    if (i % grainEvery === 0) target = 0.55 + 0.45 * Math.random();
    grain += (target - grain) * 0.002;
    data[i] = (Math.random() * 2 - 1) * grain;
  }
  return buffer;
}

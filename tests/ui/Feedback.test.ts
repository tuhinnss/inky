import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Feedback, loadFeedbackSettings } from '../../src/ui/Feedback';
import { VIBRATION, VOLUME, volumeGain } from '../../src/ui/cues';

/** An audio parameter that records what it was told to do. */
class FakeParam {
  value = 0;
  readonly targets: Array<[number, number]> = [];
  setTargetAtTime(value: number, at: number): void {
    this.targets.push([value, at]);
  }
  cancelScheduledValues(): void {}
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
}

class FakeNode {
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  started = 0;
  stopped = 0;
  connect<T>(next: T): T {
    return next;
  }
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
}

class FakeAudioContext {
  static made: FakeAudioContext[] = [];
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 1;
  readonly sampleRate = 8000;
  readonly destination = {};
  readonly gains: FakeNode[] = [];
  readonly oscillators: FakeNode[] = [];
  constructor() {
    FakeAudioContext.made.push(this);
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { duration: length / this.sampleRate, getChannelData: () => data };
  }
  createBufferSource = () => new FakeNode();
  createBiquadFilter = () => new FakeNode();
  createGain = () => {
    const node = new FakeNode();
    this.gains.push(node);
    return node;
  };
  createOscillator = () => {
    const node = new FakeNode();
    this.oscillators.push(node);
    return node;
  };
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  suspend = vi.fn(() => {
    this.state = 'suspended';
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
}

let stored: Map<string, string>;
let vibrate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeAudioContext.made = [];
  stored = new Map();
  vibrate = vi.fn(() => true);
  vi.stubGlobal('window', { AudioContext: FakeAudioContext });
  vi.stubGlobal('navigator', { vibrate });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Sound at the initial volume, and vibration. */
const ON = { volume: VOLUME.initial, vibration: true };

/** The gain node every sound goes through, made first, and the ones made after it. */
const master = (context: FakeAudioContext): FakeNode => context.gains[0];
const sounds = (context: FakeAudioContext): FakeNode[] => context.gains.slice(1);

describe('the settings', () => {
  it('start with some sound and vibration, and are remembered', () => {
    expect(loadFeedbackSettings()).toEqual(ON);
    const feedback = new Feedback();
    feedback.setVolume(35);
    feedback.setVibration(false);
    expect(loadFeedbackSettings()).toEqual({ volume: 35, vibration: false });
    const again = new Feedback();
    expect([again.volume, again.vibration]).toEqual([35, false]);
  });

  it('snap the volume to the slider and ignore nonsense', () => {
    const feedback = new Feedback();
    feedback.setVolume(250);
    expect(feedback.volume).toBe(100);
    stored.set('calcink.volume', 'loud');
    expect(loadFeedbackSettings().volume).toBe(VOLUME.initial);
  });

  it('work when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadFeedbackSettings()).toEqual(ON);
    const feedback = new Feedback();
    expect(() => feedback.setVolume(0)).not.toThrow();
    expect(feedback.volume).toBe(0);
  });
});

describe('Feedback', () => {
  it('makes no sound until the page has been touched', () => {
    const feedback = new Feedback(ON);
    feedback.move({ tool: 'pen', speed: 1 });
    feedback.cue('answer');
    expect(FakeAudioContext.made).toHaveLength(0);
  });

  it('vibrates for an answer, a problem and a scratch-out', () => {
    const feedback = new Feedback(ON);
    feedback.cue('answer');
    feedback.cue('problem');
    feedback.scratchedOut();
    expect(vibrate.mock.calls).toEqual([
      [VIBRATION.answer],
      [VIBRATION.problem],
      [VIBRATION['scratch-out']],
    ]);
  });

  it('is silent at volume 0, and still vibrates', () => {
    const feedback = new Feedback({ volume: 0, vibration: true });
    feedback.wake();
    feedback.move({ tool: 'pen', speed: 1 });
    feedback.cue('answer');
    expect(FakeAudioContext.made).toHaveLength(0);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('is heard but not felt with vibration off', () => {
    const feedback = new Feedback({ ...ON, vibration: false });
    feedback.wake();
    feedback.cue('answer');
    feedback.scratchedOut();
    expect(vibrate).not.toHaveBeenCalled();
    expect(FakeAudioContext.made[0].oscillators).toHaveLength(2);
  });

  it('taps once when vibration is switched on, to show what it does', () => {
    const feedback = new Feedback({ ...ON, vibration: false });
    feedback.setVibration(true);
    expect(vibrate.mock.calls).toEqual([[VIBRATION.answer]]);
  });

  it('knows whether the device can vibrate', () => {
    expect(new Feedback(ON).canVibrate).toBe(true);
    vi.stubGlobal('navigator', {});
    expect(new Feedback(ON).canVibrate).toBe(false);
  });

  it('survives a browser without vibration or audio', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});
    const feedback = new Feedback(ON);
    feedback.wake();
    expect(() => {
      feedback.move({ tool: 'pen', speed: 1 });
      feedback.cue('problem');
      feedback.scratchedOut();
      feedback.preview();
    }).not.toThrow();
  });

  it('plays everything through one volume, and follows the slider', () => {
    const feedback = new Feedback(ON);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    expect(master(context).gain.value).toBe(volumeGain(VOLUME.initial));
    feedback.setVolume(30);
    expect(master(context).gain.targets.at(-1)?.[0]).toBe(volumeGain(30));
  });

  it('plays the pencil louder the faster it moves, and stops when it lifts', () => {
    const feedback = new Feedback(ON);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    feedback.move({ tool: 'pen', speed: 0.1 });
    feedback.move({ tool: 'pen', speed: 1 });
    const [scratch] = sounds(context);
    const levels = scratch.gain.targets.map(([value]) => value).filter((value) => value > 0);
    expect(levels).toHaveLength(2);
    expect(levels[1]).toBeGreaterThan(levels[0]);
    // Each movement is followed by a fall to silence, unless another comes first.
    expect(scratch.gain.targets.filter(([value]) => value === 0)).toHaveLength(2);

    feedback.move(null);
    expect(scratch.gain.targets.at(-1)?.[0]).toBe(0);
  });

  it('plays the eraser through a sound of its own', () => {
    const feedback = new Feedback(ON);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    feedback.move({ tool: 'pen', speed: 1 });
    feedback.move({ tool: 'eraser', speed: 1 });
    expect(sounds(context)).toHaveLength(2);
  });

  it('plays one note for an answer and two for a problem', () => {
    const feedback = new Feedback(ON);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    feedback.cue('answer');
    // Each note is a tone and its overtone.
    expect(context.oscillators).toHaveLength(2);
    feedback.cue('problem');
    expect(context.oscillators).toHaveLength(6);
  });

  it('plays a sample note for the slider, starting the audio if need be', () => {
    const feedback = new Feedback(ON);
    feedback.preview();
    expect(FakeAudioContext.made[0].oscillators).toHaveLength(2);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('wakes a sleeping audio context before a cue', async () => {
    const feedback = new Feedback(ON);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    context.state = 'suspended';
    feedback.cue('answer');
    expect(context.resume).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(context.oscillators).toHaveLength(2);
  });

  it('stops the pencil when the volume goes to 0 mid-stroke', () => {
    const feedback = new Feedback(ON);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    feedback.move({ tool: 'pen', speed: 1 });
    feedback.setVolume(0);
    expect(sounds(context)[0].gain.targets.at(-1)?.[0]).toBe(0);
  });
});

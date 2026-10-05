import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Feedback, loadFeedbackSetting } from '../../src/ui/Feedback';
import { VIBRATION } from '../../src/ui/cues';

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

describe('the setting', () => {
  it('is on until switched off, and remembered', () => {
    expect(loadFeedbackSetting()).toBe(true);
    new Feedback().setEnabled(false);
    expect(loadFeedbackSetting()).toBe(false);
    expect(new Feedback().enabled).toBe(false);
  });

  it('is on when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadFeedbackSetting()).toBe(true);
    const feedback = new Feedback();
    expect(() => feedback.setEnabled(false)).not.toThrow();
    expect(feedback.enabled).toBe(false);
  });
});

describe('Feedback', () => {
  it('makes no sound until the page has been touched', () => {
    const feedback = new Feedback(true);
    feedback.move({ tool: 'pen', speed: 1 });
    feedback.cue('answer');
    expect(FakeAudioContext.made).toHaveLength(0);
  });

  it('vibrates for an answer, a problem and a scratch-out', () => {
    const feedback = new Feedback(true);
    feedback.cue('answer');
    feedback.cue('problem');
    feedback.scratchedOut();
    expect(vibrate.mock.calls).toEqual([
      [VIBRATION.answer],
      [VIBRATION.problem],
      [VIBRATION['scratch-out']],
    ]);
  });

  it('is silent and still when switched off', () => {
    const feedback = new Feedback(false);
    feedback.wake();
    feedback.move({ tool: 'pen', speed: 1 });
    feedback.cue('answer');
    feedback.scratchedOut();
    expect(FakeAudioContext.made).toHaveLength(0);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('survives a browser without vibration or audio', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});
    const feedback = new Feedback(true);
    feedback.wake();
    expect(() => {
      feedback.move({ tool: 'pen', speed: 1 });
      feedback.cue('problem');
      feedback.scratchedOut();
    }).not.toThrow();
  });

  it('plays the pencil louder the faster it moves, and stops when it lifts', () => {
    const feedback = new Feedback(true);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    feedback.move({ tool: 'pen', speed: 0.1 });
    feedback.move({ tool: 'pen', speed: 1 });
    const scratch = context.gains[0];
    const levels = scratch.gain.targets.map(([value]) => value).filter((value) => value > 0);
    expect(levels).toHaveLength(2);
    expect(levels[1]).toBeGreaterThan(levels[0]);
    // Each movement is followed by a fall to silence, unless another comes first.
    expect(scratch.gain.targets.filter(([value]) => value === 0)).toHaveLength(2);

    feedback.move(null);
    expect(scratch.gain.targets.at(-1)?.[0]).toBe(0);
  });

  it('plays the eraser through a sound of its own', () => {
    const feedback = new Feedback(true);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    feedback.move({ tool: 'pen', speed: 1 });
    feedback.move({ tool: 'eraser', speed: 1 });
    expect(context.gains).toHaveLength(2);
  });

  it('plays one note for an answer and two for a problem', () => {
    const feedback = new Feedback(true);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    feedback.cue('answer');
    // Each note is a tone and its overtone.
    expect(context.oscillators).toHaveLength(2);
    feedback.cue('problem');
    expect(context.oscillators).toHaveLength(6);
  });

  it('wakes a sleeping audio context before a cue', async () => {
    const feedback = new Feedback(true);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    context.state = 'suspended';
    feedback.cue('answer');
    expect(context.resume).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(context.oscillators).toHaveLength(2);
  });

  it('stops the pencil when switched off mid-stroke', () => {
    const feedback = new Feedback(true);
    feedback.wake();
    const [context] = FakeAudioContext.made;
    feedback.move({ tool: 'pen', speed: 1 });
    feedback.setEnabled(false);
    expect(context.gains[0].gain.targets.at(-1)?.[0]).toBe(0);
  });
});

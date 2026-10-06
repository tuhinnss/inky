/**
 * When the notebook should make itself heard or felt. Kept apart from the sound and the
 * vibration themselves (Feedback.ts) so that it can be tested without a browser.
 *
 * A cue marks news, not state: an answer that appears or changes, or a sum that turns out
 * not to work. An answer that stays as it was says nothing again, and one update says at
 * most one thing, however many lines changed in it: undoing "clear" brings back a whole
 * page of answers at once, and a page that chimed for each would be a nuisance.
 */

import type { Equation } from '../app/equations';
import { snapSize, type SizeRange } from './sizes';

/** An answer appeared, or a sum turned out not to work. */
export type Cue = 'answer' | 'problem';

/** What the line says now, as far as a cue is concerned, or null when it says nothing yet. */
export function outcomeOf(equation: Equation): { cue: Cue; text: string } | null {
  const { evaluation, definition, graph, solution } = equation;
  // "x = 10" taken in, or a graph drawn, is an answer of sorts: the notebook understood.
  if (definition) return { cue: 'answer', text: `${definition.name}=${definition.value}` };
  if (graph) return { cue: 'answer', text: `graph:${graph.body}` };
  if (solution) {
    // Solved, or shown to have no solution, is an answer; beyond what is solved is not.
    const text = `solution:${JSON.stringify(solution)}`;
    return { cue: solution.kind === 'beyond' ? 'problem' : 'answer', text };
  }
  if (!evaluation) return null;
  switch (evaluation.status) {
    case 'ok':
      return { cue: 'answer', text: evaluation.text };
    case 'error':
      return { cue: 'problem', text: `error:${evaluation.error.code}` };
    default:
      // Division by zero and overflow are written in, but they are still not answers.
      return { cue: 'problem', text: evaluation.text };
  }
}

/** Remembers what each line last said, and reports what is new. */
export class CueTracker {
  /** By equation id. */
  private readonly heard = new Map<number, string>();

  /**
   * The cue for this update of the page, or null when nothing new appeared. A problem
   * outranks an answer: it is the one that needs the writer's attention.
   */
  next(equations: readonly Equation[]): Cue | null {
    let cue: Cue | null = null;
    const present = new Set<number>();
    for (const equation of equations) {
      const outcome = outcomeOf(equation);
      if (!outcome) continue;
      present.add(equation.id);
      if (this.heard.get(equation.id) === outcome.text) continue;
      this.heard.set(equation.id, outcome.text);
      if (cue !== 'problem') cue = outcome.cue;
    }
    // A line that stops saying anything, rubbed out or unfinished again, is forgotten, so
    // that the same answer written again is news again.
    for (const id of this.heard.keys()) if (!present.has(id)) this.heard.delete(id);
    return cue;
  }
}

/** Below this speed, in CSS pixels per millisecond, the pencil makes no sound. */
const SILENT_BELOW = 0.03;
/** At this speed and above it is as loud as it gets. */
const LOUDEST_AT = 1.2;

/**
 * How loud the pencil sounds, from 0 to 1, at a given speed across the paper. A pencil
 * held still is silent and grows louder as it moves faster, as graphite on paper does.
 * The square root makes slow, careful writing still audible.
 */
export function scratchLevel(speed: number): number {
  if (!(speed > SILENT_BELOW)) return 0;
  return Math.min(1, Math.sqrt((speed - SILENT_BELOW) / (LOUDEST_AT - SILENT_BELOW)));
}

/** Vibration patterns, in milliseconds on and off, as `navigator.vibrate` takes them. */
export const VIBRATION: Readonly<Record<Cue | 'scratch-out', number | number[]>> = {
  /** One short tap, like a pencil set down. */
  answer: 12,
  /** Two taps: something to look at. */
  problem: [10, 70, 10],
  /** A longer buzz as the scribble rubs the writing out. */
  'scratch-out': 25,
};

/** The volume, in percent, as the slider in the speaker's menu sets it. 0 is silent. */
export const VOLUME: SizeRange = { min: 0, max: 100, step: 5, initial: 70 };

export function volumeLabel(volume: number): string {
  return volume === 0 ? 'Off' : `${volume}%`;
}

/**
 * The gain for a volume. Ears hear loudness on a roughly logarithmic scale, so a gain in
 * step with the slider would do nearly all its changing in the first quarter of it.
 * Squaring spreads the change along the whole slider. At the initial 70% it is about 1:
 * the sounds as they were tuned.
 */
export function volumeGain(volume: number): number {
  const share = snapSize(VOLUME, volume) / 100;
  return 2 * share * share;
}

import { describe, expect, it } from 'vitest';
import type { Equation } from '../../src/app/equations';
import { evaluate } from '../../src/math';
import {
  CueTracker,
  outcomeOf,
  scratchLevel,
  VOLUME,
  volumeGain,
  volumeLabel,
} from '../../src/ui/cues';

/** Just enough of an equation for the cues: its id and what it worked out to. */
function line(id: number, expression: string): Equation {
  const evaluation = expression.endsWith('=') ? evaluate(expression) : null;
  return { id, expression, evaluation } as Equation;
}

function definition(id: number, value: number): Equation {
  return {
    id,
    expression: `x=${value}`,
    evaluation: null,
    definition: { name: 'x', value },
  } as Equation;
}

describe('outcomeOf', () => {
  it('says nothing for a line that is not finished', () => {
    expect(outcomeOf(line(1, '18+4'))).toBeNull();
  });

  it('calls a worked sum an answer', () => {
    expect(outcomeOf(line(1, '18+4='))).toEqual({ cue: 'answer', text: '22' });
  });

  it('calls a taken-in definition an answer', () => {
    expect(outcomeOf(definition(1, 10))).toEqual({ cue: 'answer', text: 'x=10' });
  });

  it('calls a graph drawn an answer, and a changed graph news', () => {
    const graph = (body: string) =>
      ({ id: 1, expression: `y=${body}`, evaluation: null, graph: { body } }) as Equation;
    expect(outcomeOf(graph('2x+1'))).toEqual({ cue: 'answer', text: 'graph:2x+1' });
    const cues = new CueTracker();
    expect(cues.next([graph('2x+1')])).toBe('answer');
    expect(cues.next([graph('2x+1')])).toBeNull();
    expect(cues.next([graph('2x+3')])).toBe('answer');
  });

  it('calls a malformed sum, division by zero and overflow problems', () => {
    expect(outcomeOf(line(1, '18+='))?.cue).toBe('problem');
    expect(outcomeOf(line(1, '1÷0='))?.cue).toBe('problem');
    const huge = '9'.repeat(200);
    expect(outcomeOf(line(1, `${huge}×${huge}=`))?.cue).toBe('problem');
  });
});

describe('CueTracker', () => {
  it('cues a new answer once, not on every update after', () => {
    const cues = new CueTracker();
    expect(cues.next([line(1, '18+4')])).toBeNull();
    expect(cues.next([line(1, '18+4=')])).toBe('answer');
    expect(cues.next([line(1, '18+4=')])).toBeNull();
  });

  it('cues an answer that changes', () => {
    const cues = new CueTracker();
    cues.next([line(1, '18+4=')]);
    expect(cues.next([line(1, '18+5=')])).toBe('answer');
  });

  it('says one thing for many lines that change together', () => {
    const cues = new CueTracker();
    expect(cues.next([line(1, '1+1='), line(2, '2+2='), line(3, '3+3=')])).toBe('answer');
  });

  it('lets a problem outrank an answer in the same update', () => {
    const cues = new CueTracker();
    expect(cues.next([line(1, '1+1='), line(2, '2+=')])).toBe('problem');
    expect(cues.next([line(1, '1+1='), line(2, '2+='), line(3, '4÷2=')])).toBe('answer');
  });

  it('does not repeat a problem that is still there', () => {
    const cues = new CueTracker();
    expect(cues.next([line(1, '2+=')])).toBe('problem');
    expect(cues.next([line(1, '2+='), line(2, '1')])).toBeNull();
  });

  it('cues the same answer again once the line was rubbed out and written again', () => {
    const cues = new CueTracker();
    cues.next([line(1, '18+4=')]);
    expect(cues.next([])).toBeNull();
    expect(cues.next([line(1, '18+4=')])).toBe('answer');
  });

  it('forgets an answer when its line is unfinished again', () => {
    const cues = new CueTracker();
    cues.next([line(1, '18+4=')]);
    cues.next([line(1, '18+4')]);
    expect(cues.next([line(1, '18+4=')])).toBe('answer');
  });
});

describe('scratchLevel', () => {
  it('is silent when the pencil is still or barely moving', () => {
    expect(scratchLevel(0)).toBe(0);
    expect(scratchLevel(0.01)).toBe(0);
    expect(scratchLevel(Number.NaN)).toBe(0);
  });

  it('grows with speed and stops at full', () => {
    expect(scratchLevel(0.2)).toBeGreaterThan(scratchLevel(0.1));
    expect(scratchLevel(0.6)).toBeGreaterThan(scratchLevel(0.2));
    expect(scratchLevel(1.2)).toBe(1);
    expect(scratchLevel(50)).toBe(1);
  });

  it('keeps slow, careful writing audible', () => {
    expect(scratchLevel(0.1)).toBeGreaterThan(0.2);
  });
});

describe('the volume', () => {
  it('is silent at 0 and labelled Off', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeLabel(0)).toBe('Off');
    expect(volumeLabel(35)).toBe('35%');
  });

  it('plays the sounds as tuned at the initial volume', () => {
    expect(volumeGain(VOLUME.initial)).toBeCloseTo(1, 1);
  });

  it('changes along the whole slider, not just its start', () => {
    // A quarter of the way along gives far less than a quarter of full gain.
    expect(volumeGain(25) / volumeGain(100)).toBeLessThan(0.1);
    expect(volumeGain(50)).toBeLessThan(volumeGain(75));
  });
});

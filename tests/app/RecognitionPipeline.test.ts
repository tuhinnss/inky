import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Equation } from '../../src/app/equations';
import { RecognitionPipeline, type Classifier } from '../../src/app/RecognitionPipeline';
import { StrokeStore, type Stroke } from '../../src/ink';
import { MODEL, MODEL_SYMBOLS } from '../../src/recognition/model';
import { after, ink, leftEdge, strokesOf, type InkSymbol } from '../fixtures/ink';
import { classify as classifyWithModel } from '../recognition/helpers';

/** The bundled model, behind the pipeline's interface. */
const realModel: Classifier = {
  async classify(symbols) {
    const predictions = await classifyWithModel(symbols);
    const probabilities = new Float32Array(symbols.length * MODEL.classes);
    predictions.forEach((p, i) => probabilities.set(p.probabilities, i * MODEL.classes));
    return { probabilities, elapsedMs: 1 };
  },
};

/**
 * A classifier that answers only when told to, from a table of what each stroke is.
 * Lets a test hold a reply back while the page changes underneath it.
 */
function manualClassifier() {
  const truth = new Map<number, string>();
  const requests: Array<{ symbols: ReadonlyArray<readonly Stroke[]>; reply(): void }> = [];

  const classifier: Classifier = {
    classify(symbols) {
      return new Promise((resolve) => {
        requests.push({
          symbols,
          reply() {
            const probabilities = new Float32Array(symbols.length * MODEL.classes);
            symbols.forEach((strokes, i) => {
              const char = truth.get(strokes[0].id);
              probabilities[i * MODEL.classes + MODEL_SYMBOLS.indexOf(char as never)] = 1;
            });
            resolve({ probabilities, elapsedMs: 1 });
          },
        });
      });
    },
  };

  return {
    classifier,
    requests,
    /** Registers what each symbol is, so the classifier can answer correctly. */
    learn: (written: readonly InkSymbol[]) => {
      for (const symbol of written)
        for (const stroke of symbol.strokes) truth.set(stroke.id, symbol.char);
      return written;
    },
  };
}

function harness(classifier: Classifier, idleMs = 0) {
  const store = new StrokeStore();
  const updates: Equation[][] = [];
  const stats = vi.fn();
  const pipeline = new RecognitionPipeline(store, classifier, {
    idleMs,
    onUpdate: (equations) => updates.push([...equations]),
    onStats: stats,
  });
  const latest = (): Equation[] => updates[updates.length - 1] ?? [];
  const write = (symbols: readonly InkSymbol[]) =>
    store.apply({ added: strokesOf(symbols), removed: [] });
  const erase = (symbols: readonly InkSymbol[]) =>
    store.apply({ added: [], removed: strokesOf(symbols) });
  return { store, pipeline, updates, stats, latest, write, erase };
}

/** Lets the idle timer fire and pending promise callbacks run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

afterEach(() => vi.useRealTimers());

describe('RecognitionPipeline with the bundled model', () => {
  it('turns handwriting into an answer', async () => {
    const { write, latest } = harness(realModel);
    write(ink('18+4×3=', { x: 40, y: 60, size: 80 }));

    await vi.waitFor(() => expect(latest()[0]?.evaluation).toMatchObject({ status: 'ok' }));
    expect(latest()[0]).toMatchObject({
      expression: '18+4×3=',
      evaluation: { status: 'ok', value: 30, text: '30' },
    });
  });

  it('handles several equations on one page independently', async () => {
    const { write, latest } = harness(realModel);
    write(ink('18+4×3=', { x: 40, y: 40, size: 70 }));
    write(ink('7.5÷2-60=', { x: 40, y: 200, size: 70, seed: 2 }));
    write(ink('9÷0=', { x: 40, y: 360, size: 70, seed: 3 }));

    await vi.waitFor(() => expect(latest().filter((e) => e.evaluation)).toHaveLength(3));
    expect(latest().map((e) => e.evaluation?.status)).toEqual(['ok', 'ok', 'undefined']);
    expect(
      latest().map((e) => (e.evaluation?.status === 'ok' ? e.evaluation.value : null)),
    ).toEqual([30, -56.25, null]);
  });

  it('re-evaluates when a number is erased and rewritten', async () => {
    const { write, erase, latest } = harness(realModel);
    const written = ink('18+4×3=', { x: 40, y: 60, size: 80 });
    write(written);
    await vi.waitFor(() => expect(latest()[0]?.evaluation).toMatchObject({ value: 30 }));

    // Replace the 3 with a 5, in the same place.
    const three = written[5];
    erase([three]);
    write(ink('5', { x: leftEdge([three]), y: 60, size: 80 }));

    await vi.waitFor(() => expect(latest()[0]?.evaluation).toMatchObject({ value: 38 }));
    expect(latest()[0]).toMatchObject({ id: 1, expression: '18+4×5=' });
    expect(latest()[0].version).toBeGreaterThan(1);
  });
});

describe('RecognitionPipeline with x', () => {
  it('answers a sum using the x given above it, and again when x changes', async () => {
    const { classifier, requests, learn } = manualClassifier();
    const { write, erase, latest } = harness(classifier);
    const ten = learn(ink('×=10', { x: 40, y: 40, size: 70 }));
    write(ten);
    write(learn(ink('××3=', { x: 40, y: 220, size: 70, seed: 2 })));
    await settle();
    requests.shift()!.reply();
    await vi.waitFor(() => expect(latest()[1]?.evaluation).toMatchObject({ value: 30 }));

    // Write x = 12 instead: the sum below is answered again, though its ink is unchanged.
    erase(ten);
    write(learn(ink('×=12', { x: 40, y: 40, size: 70, seed: 4 })));
    await settle();
    requests.shift()!.reply();
    await vi.waitFor(() => expect(latest()[1]?.evaluation).toMatchObject({ value: 36 }));
  });
});

describe('RecognitionPipeline', () => {
  it('waits for a quiet period before reading the page', () => {
    vi.useFakeTimers();
    const { classifier, requests, learn } = manualClassifier();
    const { write } = harness(classifier, 350);

    write(learn(ink('1', { size: 80 })));
    vi.advanceTimersByTime(349);
    expect(requests).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(requests).toHaveLength(1);
  });

  it('does not read the page while the pen is down', () => {
    vi.useFakeTimers();
    const { classifier, requests, learn } = manualClassifier();
    const { pipeline, write } = harness(classifier, 350);

    pipeline.setPenDown(true);
    write(learn(ink('1', { size: 80 })));
    vi.advanceTimersByTime(5000);
    expect(requests).toHaveLength(0);

    pipeline.setPenDown(false);
    vi.advanceTimersByTime(350);
    expect(requests).toHaveLength(1);
  });

  it('sends only symbols it has not seen before', async () => {
    const { classifier, requests, learn } = manualClassifier();
    const { write } = harness(classifier);

    const start = learn(ink('12+3', { size: 80 }));
    write(start);
    await settle();
    expect(requests[0].symbols).toHaveLength(4);
    requests[0].reply();
    await settle();

    // Adding "=" sends one symbol, not five.
    write(learn(ink('=', { x: after(start), size: 80 })));
    await settle();
    expect(requests).toHaveLength(2);
    expect(requests[1].symbols).toHaveLength(1);
  });

  it('never sends decimal points to the model', async () => {
    const { classifier, requests, learn } = manualClassifier();
    const { write } = harness(classifier);

    write(learn(ink('7.5', { size: 80 })));
    await settle();
    expect(requests[0].symbols).toHaveLength(2);
  });

  it('answers from the cache, with no request, when an erased symbol is restored', async () => {
    const { classifier, requests, learn } = manualClassifier();
    const { write, erase, latest } = harness(classifier);
    const written = learn(ink('2+3=', { size: 80 }));

    write(written);
    await settle();
    requests[0].reply();
    await settle();
    expect(latest()[0].evaluation).toMatchObject({ value: 5 });

    erase([written[2]]);
    await settle();
    write([written[2]]); // as undo would
    await settle();

    expect(requests).toHaveLength(1);
    expect(latest()[0].evaluation).toMatchObject({ value: 5 });
  });

  it('discards a result for an equation that changed while it was being computed', async () => {
    const { classifier, requests, learn } = manualClassifier();
    const { write, latest, stats } = harness(classifier);

    // Version 1: "2+3=". Its request goes out and is held.
    const start = learn(ink('2+3=', { size: 80 }));
    write(start);
    await settle();
    expect(requests).toHaveLength(1);

    // Before the reply, the user appends to the line: it is now version 2, and "2+3="
    // is no longer what is on the page. A second request goes out for the new version.
    write(learn(ink('4', { x: after(start), size: 80 })));
    await settle();
    expect(requests).toHaveLength(2);

    // The first reply now arrives, for a version that no longer exists.
    requests[0].reply();
    await settle();
    expect(latest().every((equation) => equation.evaluation === null)).toBe(true);
    expect(stats).toHaveBeenLastCalledWith(expect.objectContaining({ staleResults: 1 }));

    // The second reply is current and is published.
    requests[1].reply();
    await settle();
    expect(latest()[0]).toMatchObject({ id: 1, version: 2, expression: '2+3=4' });
  });

  it('discards a result for an equation that was erased meanwhile', async () => {
    const { classifier, requests, learn } = manualClassifier();
    const { write, erase, latest } = harness(classifier);
    const written = learn(ink('2+3=', { size: 80 }));

    write(written);
    await settle();
    erase(written);
    await settle();
    requests[0].reply();
    await settle();

    expect(latest()).toEqual([]);
  });

  it('keeps a stale reply in the cache, since the strokes it describes did not change', async () => {
    const { classifier, requests, learn } = manualClassifier();
    const { write, latest } = harness(classifier);

    const start = learn(ink('2+3', { size: 80 }));
    write(start);
    await settle();
    write(learn(ink('=', { x: after(start), size: 80 })));
    await settle();
    expect(requests).toHaveLength(2); // second request: "=" plus the three still uncached

    requests[0].reply(); // stale for the equation, but fills the cache for 2, +, 3
    requests[1].reply();
    await settle();
    expect(latest()[0].evaluation).toMatchObject({ value: 5 });
  });

  it('removes an equation from the output when its ink is erased', async () => {
    const { classifier, requests, learn } = manualClassifier();
    const { write, erase, latest } = harness(classifier);
    const written = learn(ink('2+3=', { size: 80 }));

    write(written);
    await settle();
    requests[0].reply();
    await settle();
    expect(latest()).toHaveLength(1);

    erase(written);
    await settle();
    expect(latest()).toEqual([]);
  });

  it('reports a failed request without throwing', async () => {
    const onError = vi.fn();
    const store = new StrokeStore();
    new RecognitionPipeline(
      store,
      { classify: () => Promise.reject(new Error('worker gone')) },
      { idleMs: 0, onUpdate: () => {}, onError },
    );

    store.apply({ added: strokesOf(ink('1', { size: 80 })), removed: [] });
    await settle();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'worker gone' }));
  });

  it('stops listening and ignores late replies after dispose', async () => {
    const { classifier, requests, learn } = manualClassifier();
    const { pipeline, write, updates } = harness(classifier);

    write(learn(ink('1', { size: 80 })));
    await settle();
    const before = updates.length;

    pipeline.dispose();
    requests[0].reply();
    write(learn(ink('2', { x: 200, size: 80 })));
    await settle();

    expect(updates).toHaveLength(before);
    expect(requests).toHaveLength(1);
  });
});

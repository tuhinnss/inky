import type { Stroke } from '../ink';
import { groupIntoLines } from './lines';
import { segmentLine, type Line } from './symbols';

/** Everything on the page, as lines of symbols: top to bottom, each left to right. */
export function layoutPage(strokes: readonly Stroke[]): Line[] {
  return groupIntoLines(strokes).map(segmentLine);
}

export { groupIntoLines } from './lines';
export { isFlat, lineHeight, measure, type StrokeMetrics } from './metrics';
export { segmentLine, type Line, type SymbolGroup } from './symbols';

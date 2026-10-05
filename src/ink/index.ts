export { eraseFromStroke, strokeIsHit } from './eraser';
export { EditBuilder, History, StrokeEdit, type Command } from './history';
export { crossingPoint, distance, distanceToSegment, pathLength } from './geometry';
export { isScribble, scratchedOut } from './scratch';
export { inBox, moveStrokes, pointInPolygon, selectWithLasso, selectionBounds } from './selection';
export { StrokeStore, type StrokeChange, type StrokeListener } from './StrokeStore';
export {
  boundsIntersect,
  createStroke,
  inkBounds,
  strokeBounds,
  unionBounds,
  type Bounds,
  type Point,
  type Stroke,
} from './types';

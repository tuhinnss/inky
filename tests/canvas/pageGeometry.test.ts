import { describe, expect, it } from 'vitest';
import {
  MIN_PAGE_HEIGHT,
  PAGE_GAP,
  PULL_TO_ADD,
  pageAt,
  pageHeightFor,
  pageTop,
  pagesFor,
  pagesHeight,
  pullProgress,
  wheelPixels,
  type Pages,
} from '../../src/canvas/pageGeometry';

const GRID = 28;
const three: Pages = { height: 700, count: 3 };

describe('the height of a page', () => {
  it('is the height of the window, rounded up to whole squares of the grid', () => {
    expect(pageHeightFor(680, GRID)).toBe(700);
    expect(pageHeightFor(700, GRID)).toBe(700);
    expect(pageHeightFor(701, GRID)).toBe(728);
  });

  it('is never so short that a page holds only a line or two', () => {
    expect(pageHeightFor(300, GRID)).toBe(MIN_PAGE_HEIGHT);
  });

  it('keeps every page starting on a ruling line', () => {
    expect(PAGE_GAP % GRID).toBe(0);
    for (let i = 0; i < 4; i++) expect(pageTop(three, i) % GRID).toBe(0);
  });
});

describe('where the pages are', () => {
  it('puts each page one gap below the last', () => {
    expect(pageTop(three, 0)).toBe(0);
    expect(pageTop(three, 1)).toBe(700 + PAGE_GAP);
    expect(pageTop(three, 2)).toBe(2 * (700 + PAGE_GAP));
  });

  it('measures from the top of the first page to the bottom of the last', () => {
    expect(pagesHeight({ height: 700, count: 1 })).toBe(700);
    expect(pagesHeight(three)).toBe(3 * 700 + 2 * PAGE_GAP);
  });

  it('finds the page under a point', () => {
    expect(pageAt(three, 0)).toBe(0);
    expect(pageAt(three, 699)).toBe(0);
    expect(pageAt(three, 700 + PAGE_GAP)).toBe(1);
    expect(pageAt(three, pageTop(three, 2) + 350)).toBe(2);
  });

  it('finds no page in the gap between two', () => {
    expect(pageAt(three, 700 + 1)).toBeNull();
    expect(pageAt(three, 700 + PAGE_GAP - 1)).toBeNull();
  });

  it('finds no page above the first or below the last', () => {
    expect(pageAt(three, -1)).toBeNull();
    expect(pageAt(three, pagesHeight(three) + 1)).toBeNull();
    expect(pageAt(three, Number.NaN)).toBeNull();
  });
});

describe('how many pages the writing needs', () => {
  it('is one for an empty notebook or writing on the first page', () => {
    expect(pagesFor(three, 0)).toBe(1);
    expect(pagesFor(three, 650)).toBe(1);
    expect(pagesFor(three, -40)).toBe(1);
  });

  it('counts the page a stroke begins on', () => {
    expect(pagesFor(three, 700 + PAGE_GAP + 10)).toBe(2);
    expect(pagesFor(three, pageTop(three, 2) + 10)).toBe(3);
  });

  it('counts a stroke that begins in a gap with the page above it', () => {
    expect(pagesFor(three, 700 + 5)).toBe(1);
  });

  it('can need more pages than there are, after an undo brings writing back', () => {
    expect(pagesFor({ height: 700, count: 1 }, pageTop(three, 2) + 10)).toBe(3);
  });
});

describe('pulling for a new page', () => {
  it('fills the ring in proportion to the pull', () => {
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(PULL_TO_ADD / 2)).toBe(0.5);
    expect(pullProgress(PULL_TO_ADD)).toBe(1);
  });

  it('never fills it past full or below empty', () => {
    expect(pullProgress(PULL_TO_ADD * 3)).toBe(1);
    expect(pullProgress(-50)).toBe(0);
  });

  it('counts a turn of the wheel in pixels whatever unit the device reports', () => {
    expect(wheelPixels(100, 0, 700)).toBe(100);
    expect(wheelPixels(3, 1, 700)).toBe(48);
    expect(wheelPixels(1, 2, 700)).toBe(700);
  });
});

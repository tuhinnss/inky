import { describe, expect, it } from 'vitest';
import { isPalm, PALM_CONTACT, PEN_PRESENCE_MS, type PenState } from '../../src/canvas/palm';

const finger = (timeStamp: number) => ({ timeStamp, width: 26, height: 30 });
const hand = (timeStamp: number) => ({ timeStamp, width: 70, height: 110 });
const noPen: PenState = { seen: false, lastActivity: -Infinity };
const penAt = (lastActivity: number): PenState => ({ seen: true, lastActivity });

describe('telling a resting hand from a finger', () => {
  describe('on a device where no stylus has been used', () => {
    it('lets every touch write', () => {
      expect(isPalm(finger(1000), noPen)).toBe(false);
    });

    it('lets even a broad touch write: it may be a thumb, and there is no pen to prefer', () => {
      expect(isPalm(hand(1000), noPen)).toBe(false);
    });
  });

  describe('once a stylus is in use', () => {
    it('ignores a touch that lands just after the pen lifted', () => {
      expect(isPalm(finger(1000 + PEN_PRESENCE_MS - 1), penAt(1000))).toBe(true);
    });

    it('ignores a touch while the pen hovers nearby', () => {
      // Hovering counts as activity, so the pen was "last seen" a few milliseconds ago.
      expect(isPalm(finger(5000), penAt(4990))).toBe(true);
    });

    it('lets a finger write once the pen has been away for a moment', () => {
      expect(isPalm(finger(1000 + PEN_PRESENCE_MS), penAt(1000))).toBe(false);
      expect(isPalm(finger(60_000), penAt(1000))).toBe(false);
    });

    it('ignores a contact too large for a fingertip, however long the pen has been away', () => {
      expect(isPalm(hand(60_000), penAt(1000))).toBe(true);
    });

    it('judges the contact by its larger side', () => {
      expect(isPalm({ timeStamp: 60_000, width: 20, height: PALM_CONTACT + 1 }, penAt(0))).toBe(
        true,
      );
      expect(isPalm({ timeStamp: 60_000, width: PALM_CONTACT, height: 20 }, penAt(0))).toBe(false);
    });

    it('treats a touch of unknown size as a finger', () => {
      expect(isPalm({ timeStamp: 60_000, width: 0, height: 0 }, penAt(0))).toBe(false);
    });
  });
});

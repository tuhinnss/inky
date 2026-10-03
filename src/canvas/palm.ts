/**
 * Telling a hand resting on the screen from a finger that means to write.
 *
 * Someone writing with a stylus rests the side of their hand on the glass, usually a
 * moment before the pen tip arrives. The screen reports that hand as a touch like any
 * other. Three things give it away, and none of them needs anything but the pointer
 * events themselves.
 *
 * Pure logic, no DOM.
 */

/** A touch this soon after the pen was last seen, touching or hovering, is the writing hand. */
export const PEN_PRESENCE_MS = 400;
/**
 * A touch whose contact patch is larger than this in either direction, in CSS pixels, is
 * the side of a hand. A fingertip reports roughly 20 to 35.
 */
export const PALM_CONTACT = 48;

export interface PenState {
  /** Whether a stylus has been used at all since the page was opened. */
  seen: boolean;
  /** `timeStamp` of the last event of any kind from the stylus, hovering included. */
  lastActivity: number;
}

export interface TouchContact {
  timeStamp: number;
  /** Size of the contact patch as the browser reports it. Zero when it does not know. */
  width: number;
  height: number;
}

/**
 * Should this touch be ignored as a resting hand?
 *
 * Never, until a stylus has been used: on a device without one, every touch is a finger
 * that means to write, however broad. Once a stylus is in play, a touch is the hand if
 * the pen was near a moment ago, or if the contact is too large for a fingertip. A finger
 * can still write: a small touch with the pen away is let through.
 */
export function isPalm(touch: TouchContact, pen: PenState): boolean {
  if (!pen.seen) return false;
  if (touch.timeStamp - pen.lastActivity < PEN_PRESENCE_MS) return true;
  return Math.max(touch.width, touch.height) > PALM_CONTACT;
}

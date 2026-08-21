import { useRef, useCallback } from 'react';

/**
 * useStabilizer — Rolling-window debounce for noisy frame-by-frame letter guesses.
 *
 * Strategy:
 *   - Maintains a circular buffer of the last WINDOW_SIZE classifyLetter outputs.
 *   - A letter is confirmed only when the same non-null letter appears in at least
 *     CONFIRM_THRESHOLD of the last WINDOW_SIZE frames (majority vote).
 *   - After confirming, requires a "reset" (the rolling window must go through a
 *     period without that letter) before the same letter can fire again.
 *     This prevents "AAAA" from holding a single pose.
 *
 * Uses frame-count based rolling window (not wall-clock), which is consistent
 * since the detection loop runs at requestAnimationFrame rate.
 *
 * @param {object} opts
 * @param {number} opts.windowSize     — Number of frames in the rolling buffer (default 20)
 * @param {number} opts.confirmThreshold — Minimum count of same letter to confirm (default 15)
 * @param {function} opts.onConfirm    — Called with the confirmed letter string
 */
export default function useStabilizer({
  windowSize = 20,
  confirmThreshold = 15,
  onConfirm,
} = {}) {
  const bufferRef = useRef([]);            // rolling window of recent letters
  const lastConfirmedRef = useRef(null);   // last confirmed letter (to prevent repeats)
  const resetSeenRef = useRef(false);      // true once the window has seen non-matching frames

  /**
   * Feed a new frame's letter classification into the stabilizer.
   * Returns { confirmed: boolean, letter: string|null, bufferFill: number }
   */
  const feed = useCallback((letter) => {
    // Push new letter onto the rolling buffer
    bufferRef.current.push(letter);
    if (bufferRef.current.length > windowSize) {
      bufferRef.current.shift();
    }

    const buffer = bufferRef.current;

    // Count occurrences of each non-null letter in the window
    const counts = {};
    for (const l of buffer) {
      if (l !== null) {
        counts[l] = (counts[l] || 0) + 1;
      }
    }

    // Find the majority letter (highest count above threshold)
    let bestLetter = null;
    let bestCount = 0;
    for (const [l, c] of Object.entries(counts)) {
      if (c > bestCount) {
        bestCount = c;
        bestLetter = l;
      }
    }

    // Check if the dominant letter meets the confirmation threshold
    if (bestLetter && bestCount >= confirmThreshold) {
      // If this is the same letter as last time, require a reset
      if (bestLetter === lastConfirmedRef.current) {
        if (!resetSeenRef.current) {
          // Still holding the same letter — no confirmation
          return {
            confirmed: false,
            letter: bestLetter,
            bufferFill: bestCount,
          };
        }
        // Reset was seen, but the letter came back strongly — confirm again
        lastConfirmedRef.current = bestLetter;
        resetSeenRef.current = false;
        bufferRef.current = []; // clear window after confirm
        if (onConfirm) onConfirm(bestLetter);
        return {
          confirmed: true,
          letter: bestLetter,
          bufferFill: bestCount,
        };
      }

      // New letter — confirm it
      lastConfirmedRef.current = bestLetter;
      resetSeenRef.current = false;
      bufferRef.current = []; // clear window after confirm
      if (onConfirm) onConfirm(bestLetter);
      return {
        confirmed: true,
        letter: bestLetter,
        bufferFill: bestCount,
      };
    }

    // No letter met the threshold — check if we need to mark a reset
    // A "reset" is when the window contains mostly nulls or a different letter
    // than the last confirmed one
    const dominantIsLastConfirmed = bestLetter === lastConfirmedRef.current;
    if (!dominantIsLastConfirmed && lastConfirmedRef.current !== null) {
      // The window has shifted away from the last confirmed letter
      resetSeenRef.current = true;
    }

    return {
      confirmed: false,
      letter: bestLetter,
      bufferFill: bestCount,
    };
  }, [windowSize, confirmThreshold, onConfirm]);

  /** Reset the stabilizer state (e.g. on Clear) */
  const reset = useCallback(() => {
    bufferRef.current = [];
    lastConfirmedRef.current = null;
    resetSeenRef.current = false;
  }, []);

  return { feed, reset };
}

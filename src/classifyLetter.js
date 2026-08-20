/**
 * classifyLetter — Geometric rule-based ASL fingerspelling classifier
 *
 * Recognizes 7 static letters: A, B, C, L, O, Y, I
 * Uses normalized landmark coordinates from MediaPipe HandLandmarker.
 * Works for both left and right hands (no handedness assumption).
 *
 * Landmark indices:
 *   0: WRIST
 *   1-4: THUMB (CMC, MCP, IP, TIP)
 *   5-8: INDEX  (MCP, PIP, DIP, TIP)
 *   9-12: MIDDLE (MCP, PIP, DIP, TIP)
 *   13-16: RING   (MCP, PIP, DIP, TIP)
 *   17-20: PINKY  (MCP, PIP, DIP, TIP)
 */

// ── Landmark indices ──
const WRIST = 0;
const THUMB_CMC = 1;
const THUMB_MCP = 2;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_DIP = 7;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_DIP = 11;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_DIP = 15;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_DIP = 19;
const PINKY_TIP = 20;

// ── Geometry helpers ──

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute a palm reference length (wrist to middle MCP).
 * Used to normalize all other distances so results are scale-invariant.
 */
function palmLength(lm) {
  return dist(lm[WRIST], lm[MIDDLE_MCP]) || 0.001;
}

/**
 * Compute palm width (index MCP to pinky MCP).
 */
function palmWidth(lm) {
  return dist(lm[INDEX_MCP], lm[PINKY_MCP]) || 0.001;
}

/**
 * Check if a finger is extended.
 * Returns a ratio: dist(tip, MCP) / dist(PIP, MCP).
 * When the finger is straight, the tip is past the PIP so ratio > 1.
 * When curled, the tip folds back so ratio < 1.
 *
 * A finger is considered extended if ratio > extendedThreshold.
 * A finger is considered curled if ratio < curledThreshold.
 */
function fingerExtendRatio(lm, mcpIdx, pipIdx, tipIdx) {
  const mcpToPip = dist(lm[mcpIdx], lm[pipIdx]);
  const mcpToTip = dist(lm[mcpIdx], lm[tipIdx]);
  return mcpToPip > 0.0001 ? mcpToTip / mcpToPip : 0;
}

/**
 * Check if thumb is extended outward (away from palm center).
 * Measures distance from thumb tip to index MCP normalized by palm width.
 */
function thumbOutwardRatio(lm) {
  const pw = palmWidth(lm);
  return dist(lm[THUMB_TIP], lm[INDEX_MCP]) / pw;
}

/**
 * Check if thumb is curled across the palm.
 * Measures distance from thumb tip to middle MCP normalized by palm width.
 * Low ratio = thumb tip is close to the palm center = curled.
 */
function thumbAcrossPalmRatio(lm) {
  const pw = palmWidth(lm);
  return dist(lm[THUMB_TIP], lm[MIDDLE_MCP]) / pw;
}

/**
 * Compute how close all fingertips are to thumb tip.
 * Returns avg distance from each fingertip to thumb tip, normalized by palm width.
 * Low ratio = O-shape.
 */
function fingertipToThumbRatio(lm) {
  const pw = palmWidth(lm);
  const tips = [INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP];
  let total = 0;
  for (const t of tips) {
    total += dist2D(lm[t], lm[THUMB_TIP]);
  }
  return (total / tips.length) / pw;
}

// ── Classification helpers ──

function countExtended(lm) {
  const ext = (mcp, pip, tip) => fingerExtendRatio(lm, mcp, pip, tip);
  let count = 0;
  if (ext(INDEX_MCP, INDEX_PIP, INDEX_TIP) > 1.1) count++;
  if (ext(MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP) > 1.1) count++;
  if (ext(RING_MCP, RING_PIP, RING_TIP) > 1.1) count++;
  if (ext(PINKY_MCP, PINKY_PIP, PINKY_TIP) > 1.1) count++;
  return count;
}

// ── Letter classifiers ──
// Each returns a confidence score 0-1, or 0 if it doesn't match.

function scoreA(lm) {
  // A: All fingers curled, thumb extended alongside the hand (not across the palm).
  const e = (mcp, pip, tip) => fingerExtendRatio(lm, mcp, pip, tip);

  // All 4 fingers must be curled
  const indexCurled = e(INDEX_MCP, INDEX_PIP, INDEX_TIP) < 0.85;
  const middleCurled = e(MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP) < 0.85;
  const ringCurled = e(RING_MCP, RING_PIP, RING_TIP) < 0.85;
  const pinkyCurled = e(PINKY_MCP, PINKY_PIP, PINKY_TIP) < 0.85;

  if (!(indexCurled && middleCurled && ringCurled && pinkyCurled)) return 0;

  // Thumb should NOT be across the palm (that would be a different letter).
  // Thumb tip should be away from index MCP but not as far as for L/Y.
  const thumbOut = thumbOutwardRatio(lm);
  const thumbAcross = thumbAcrossPalmRatio(lm);

  // For A, thumb is alongside — not tucked in, not fully extended out
  if (thumbAcross < 0.6) return 0; // too tucked = maybe fist with no A
  if (thumbOut > 1.5) return 0;     // too far out = L or Y territory

  return 0.7;
}

function scoreB(lm) {
  // B: Index, middle, ring, pinky all extended. Thumb curled across the palm.
  const e = (mcp, pip, tip) => fingerExtendRatio(lm, mcp, pip, tip);

  const indexExt = e(INDEX_MCP, INDEX_PIP, INDEX_TIP) > 1.15;
  const middleExt = e(MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP) > 1.15;
  const ringExt = e(RING_MCP, RING_PIP, RING_TIP) > 1.15;
  const pinkyExt = e(PINKY_MCP, PINKY_PIP, PINKY_TIP) > 1.15;

  if (!(indexExt && middleExt && ringExt && pinkyExt)) return 0;

  // Thumb must be curled (tip close to palm)
  const thumbAcross = thumbAcrossPalmRatio(lm);
  if (thumbAcross > 0.9) return 0; // thumb is out = not B

  // Fingers should be roughly together (not splayed)
  // Check that fingertips are relatively close to each other horizontally
  const tips = [lm[INDEX_TIP], lm[MIDDLE_TIP], lm[RING_TIP], lm[PINKY_TIP]];
  const spread = Math.max(...tips.map(t => t.x)) - Math.min(...tips.map(t => t.x));
  const pw = palmWidth(lm);

  if (spread / pw > 1.2) return 0; // too splayed

  return 0.8;
}

function scoreC(lm) {
  // C: All fingers slightly curved (not fully extended, not fully closed).
  // Fingertips form a gentle arc, thumb also curved.
  const e = (mcp, pip, tip) => fingerExtendRatio(lm, mcp, pip, tip);

  const indexRatio = e(INDEX_MCP, INDEX_PIP, INDEX_TIP);
  const middleRatio = e(MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP);
  const ringRatio = e(RING_MCP, RING_PIP, RING_TIP);
  const pinkyRatio = e(PINKY_MCP, PINKY_PIP, PINKY_TIP);

  // All fingers should be partially curled — between 0.7 and 1.1
  const allPartiallyCurled =
    indexRatio > 0.65 && indexRatio < 1.15 &&
    middleRatio > 0.65 && middleRatio < 1.15 &&
    ringRatio > 0.65 && ringRatio < 1.15 &&
    pinkyRatio > 0.65 && pinkyRatio < 1.15;

  if (!allPartiallyCurled) return 0;

  // Tips should be somewhat close to thumb (forming C opening)
  const tipToThumb = fingertipToThumbRatio(lm);
  // C has a moderate gap — not too close (O), not too far (open hand)
  if (tipToThumb < 0.4 || tipToThumb > 1.2) return 0;

  // Fingertips should form a gentle curve — check index and pinky tips
  // are at similar height (not all extended straight up)
  const tipYSpread = Math.max(
    lm[INDEX_TIP].y, lm[MIDDLE_TIP].y, lm[RING_TIP].y, lm[PINKY_TIP].y
  ) - Math.min(
    lm[INDEX_TIP].y, lm[MIDDLE_TIP].y, lm[RING_TIP].y, lm[PINKY_TIP].y
  );
  const pl = palmLength(lm);
  if (tipYSpread / pl > 0.5) return 0; // too much vertical spread

  return 0.6;
}

function scoreL(lm) {
  // L: Index extended up, thumb extended outward to the side.
  // Middle, ring, pinky curled.
  const e = (mcp, pip, tip) => fingerExtendRatio(lm, mcp, pip, tip);

  const indexExt = e(INDEX_MCP, INDEX_PIP, INDEX_TIP) > 1.15;
  const middleCurled = e(MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP) < 0.85;
  const ringCurled = e(RING_MCP, RING_PIP, RING_TIP) < 0.85;
  const pinkyCurled = e(PINKY_MCP, PINKY_PIP, PINKY_TIP) < 0.85;

  if (!(indexExt && middleCurled && ringCurled && pinkyCurled)) return 0;

  // Thumb must be extended outward (not across the palm)
  const thumbOut = thumbOutwardRatio(lm);
  if (thumbOut < 1.1) return 0;

  // Thumb should be roughly perpendicular to index finger
  // Index tip is above (lower y), thumb tip is to the side (similar y to MCPs)
  const indexToThumbAngle = Math.abs(lm[THUMB_TIP].y - lm[INDEX_MCP].y);
  const pw = palmWidth(lm);
  if (indexToThumbAngle / pw > 0.6) return 0; // thumb is too vertical = not L

  return 0.85;
}

function scoreO(lm) {
  // O: All fingertips close to thumb tip, forming a circle.
  // Fingers curve down toward thumb.
  const e = (mcp, pip, tip) => fingerExtendRatio(lm, mcp, pip, tip);

  // Fingers should be partially curled (not fully extended)
  const indexRatio = e(INDEX_MCP, INDEX_PIP, INDEX_TIP);
  const middleRatio = e(MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP);

  if (indexRatio > 1.05 || middleRatio > 1.05) return 0; // too extended

  // All fingertips must be close to thumb tip
  const tipToThumb = fingertipToThumbRatio(lm);
  if (tipToThumb > 0.6) return 0; // too far apart

  // Also check that individual fingertips are close (not just average)
  const tips = [INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP];
  const pw = palmWidth(lm);
  const maxDist = Math.max(...tips.map(t => dist2D(lm[t], lm[THUMB_TIP]))) / pw;
  if (maxDist > 0.8) return 0; // at least one tip is too far

  return 0.85;
}

function scoreY(lm) {
  // Y: Thumb extended outward, pinky extended.
  // Index, middle, ring curled.
  const e = (mcp, pip, tip) => fingerExtendRatio(lm, mcp, pip, tip);

  const indexCurled = e(INDEX_MCP, INDEX_PIP, INDEX_TIP) < 0.85;
  const middleCurled = e(MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP) < 0.85;
  const ringCurled = e(RING_MCP, RING_PIP, RING_TIP) < 0.85;
  const pinkyExt = e(PINKY_MCP, PINKY_PIP, PINKY_TIP) > 1.1;

  if (!(indexCurled && middleCurled && ringCurled && pinkyExt)) return 0;

  // Thumb must be extended outward
  const thumbOut = thumbOutwardRatio(lm);
  if (thumbOut < 1.0) return 0;

  // Pinky should be spread from ring finger
  const pinkyRingSpread = dist2D(lm[PINKY_TIP], lm[RING_TIP]) / palmWidth(lm);
  if (pinkyRingSpread < 0.2) return 0; // too close = not spread

  return 0.85;
}

function scoreI(lm) {
  // I: Only pinky extended upward. All others curled.
  // Thumb curled (usually across the palm).
  const e = (mcp, pip, tip) => fingerExtendRatio(lm, mcp, pip, tip);

  const indexCurled = e(INDEX_MCP, INDEX_PIP, INDEX_TIP) < 0.85;
  const middleCurled = e(MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP) < 0.85;
  const ringCurled = e(RING_MCP, RING_PIP, RING_TIP) < 0.85;
  const pinkyExt = e(PINKY_MCP, PINKY_PIP, PINKY_TIP) > 1.1;

  if (!(indexCurled && middleCurled && ringCurled && pinkyExt)) return 0;

  // Thumb should be curled (not extended out like Y)
  const thumbOut = thumbOutwardRatio(lm);
  if (thumbOut > 1.2) return 0; // thumb is out = more like Y

  return 0.8;
}

// ── Main classifier ──

/**
 * classifyLetter — Given 21 hand landmarks, returns the best-guess ASL letter.
 *
 * @param {Array<{x: number, y: number, z: number}>} landmarks
 *   Array of 21 normalized landmarks from MediaPipe HandLandmarker.
 * @returns {'A'|'B'|'C'|'L'|'O'|'Y'|'I'|null}
 *   The recognized letter, or null if no confident match.
 */
export default function classifyLetter(landmarks) {
  // Guard: must have at least 21 landmarks
  if (!landmarks || !Array.isArray(landmarks) || landmarks.length < 21) {
    return null;
  }

  // Score each letter
  const scores = [
    { letter: 'A', score: scoreA(landmarks) },
    { letter: 'B', score: scoreB(landmarks) },
    { letter: 'C', score: scoreC(landmarks) },
    { letter: 'L', score: scoreL(landmarks) },
    { letter: 'O', score: scoreO(landmarks) },
    { letter: 'Y', score: scoreY(landmarks) },
    { letter: 'I', score: scoreI(landmarks) },
  ];

  // Find the highest-scoring letter
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  // Require minimum confidence to avoid flickering guesses
  if (best.score < 0.6) {
    return null;
  }

  return best.letter;
}

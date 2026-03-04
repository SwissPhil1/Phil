/**
 * SM-2 Spaced Repetition Algorithm (Anki-style)
 *
 * Based on Anki's modified SM-2 with per-button interval factors:
 * - Again (q=0): lapse → reset to 1 day, ease −0.20
 * - Hard  (q=3): interval × 1.2, ease −0.15
 * - Good  (q=4): interval × ease, ease unchanged
 * - Easy  (q=5): interval × ease × 1.3 (easy bonus), ease +0.15
 *
 * Learning phase (reps 0-1): fixed graduating steps, no ease changes.
 * Review phase  (reps 2+):  multiplicative intervals with ease tracking.
 *
 * References:
 *   https://faqs.ankiweb.net/what-spaced-repetition-algorithm
 *   https://docs.ankiweb.net/deck-options.html
 */

export interface SM2Result {
  easeFactor: number;
  interval: number; // days
  repetitions: number;
  nextReview: Date;
}

// Anki-style constants
const HARD_FACTOR = 1.2;       // Hard interval multiplier
const EASY_BONUS = 1.3;        // Easy interval bonus multiplier
const EASY_GRADUATE = 4;       // Days when pressing Easy on a new card
const GRADUATING_INTERVAL = 6; // Days when graduating from learning (Good)
const MIN_EASE = 1.3;          // Minimum ease factor (Anki: 130%)

export function calculateSM2(
  quality: number,
  previousEaseFactor: number = 2.5,
  previousInterval: number = 0,
  previousRepetitions: number = 0
): SM2Result {
  const q = Math.max(0, Math.min(5, quality));

  let easeFactor = previousEaseFactor;
  let interval: number;
  let repetitions: number;

  if (q < 3) {
    // ── Lapse: reset ──
    repetitions = 0;
    interval = 1;
    // Only penalise ease for graduated cards (Anki: new cards keep starting ease)
    if (previousRepetitions >= 2) {
      easeFactor = Math.max(MIN_EASE, easeFactor - 0.2);
    }
  } else if (previousRepetitions === 0) {
    // ── New card: first successful review ──
    // No ease changes during learning (Anki behaviour)
    repetitions = 1;
    if (q === 5) {
      interval = EASY_GRADUATE; // Easy: skip learning → 4 days
    } else {
      interval = 1;            // Hard & Good: 1 day
    }
  } else if (previousRepetitions === 1) {
    // ── Learning card: graduating review ──
    // No ease changes during learning
    repetitions = 2;
    if (q === 3) {
      // Hard: modest increase from previous interval
      interval = Math.max(previousInterval + 1, Math.round(previousInterval * HARD_FACTOR));
    } else if (q === 5) {
      // Easy: graduating interval × easy bonus
      interval = Math.round(GRADUATING_INTERVAL * EASY_BONUS); // ≈ 8 days
    } else {
      // Good: standard graduating interval
      interval = GRADUATING_INTERVAL; // 6 days
    }
  } else {
    // ── Review phase: graduated card ──
    repetitions = previousRepetitions + 1;
    if (q === 3) {
      // Hard: interval × 1.2, ease −0.15
      interval = Math.max(previousInterval + 1, Math.round(previousInterval * HARD_FACTOR));
      easeFactor = Math.max(MIN_EASE, easeFactor - 0.15);
    } else if (q === 5) {
      // Easy: interval × ease × easy bonus, ease +0.15
      interval = Math.round(previousInterval * easeFactor * EASY_BONUS);
      easeFactor = easeFactor + 0.15;
    } else {
      // Good: interval × ease, ease unchanged
      interval = Math.round(previousInterval * easeFactor);
    }
  }

  // Anki rule: successful reviews must always advance the interval by ≥ 1 day
  if (q >= 3 && interval <= previousInterval) {
    interval = previousInterval + 1;
  }

  // Floor at 1 day
  interval = Math.max(1, interval);

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);

  return { easeFactor, interval, repetitions, nextReview };
}

/** Label for quality rating */
export function qualityLabel(quality: number): string {
  switch (quality) {
    case 0:
      return "Blackout";
    case 1:
      return "Wrong";
    case 2:
      return "Almost";
    case 3:
      return "Hard";
    case 4:
      return "Good";
    case 5:
      return "Easy";
    default:
      return "Unknown";
  }
}

// ── Flashcard helpers ───────────────────────────────────────────────────────

/**
 * Preview what interval each rating would produce for a card's current state.
 * Used to show "< 1j", "4j", "10j", "25j" under the rating buttons.
 */
export function previewIntervals(
  easeFactor: number = 2.5,
  interval: number = 0,
  repetitions: number = 0
): { again: number; hard: number; good: number; easy: number } {
  return {
    again: calculateSM2(0, easeFactor, interval, repetitions).interval,
    hard: calculateSM2(3, easeFactor, interval, repetitions).interval,
    good: calculateSM2(4, easeFactor, interval, repetitions).interval,
    easy: calculateSM2(5, easeFactor, interval, repetitions).interval,
  };
}

/** Format an interval in days as a short French string */
export function formatInterval(days: number): string {
  if (days < 1) return "< 1j";
  if (days === 1) return "1j";
  if (days < 30) return `${days}j`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}a`;
}

/**
 * Card maturity based on latest review state.
 * - "new": never reviewed (reps === 0 and no reviews exist)
 * - "learning": interval < 21 days
 * - "young": interval 21-89 days
 * - "mature": interval ≥ 90 days
 */
export function cardMaturity(
  interval: number,
  repetitions: number
): "new" | "learning" | "young" | "mature" {
  if (repetitions === 0) return "new";
  if (interval < 21) return "learning";
  if (interval < 90) return "young";
  return "mature";
}

/** XP earned for a given quality rating */
export function xpForQuality(quality: number): number {
  switch (quality) {
    case 0: return 1;
    case 1: return 1;
    case 2: return 2;
    case 3: return 3;
    case 4: return 5;
    case 5: return 8;
    default: return 0;
  }
}

/** Level system: level = floor(sqrt(totalXP / 50)) */
export function levelFromXp(totalXp: number): {
  level: number;
  currentXp: number;
  nextLevelXp: number;
  progress: number;
} {
  const level = Math.floor(Math.sqrt(totalXp / 50));
  const currentLevelMinXp = level * level * 50;
  const nextLevelMinXp = (level + 1) * (level + 1) * 50;
  const xpInLevel = totalXp - currentLevelMinXp;
  const xpNeeded = nextLevelMinXp - currentLevelMinXp;
  return {
    level,
    currentXp: xpInLevel,
    nextLevelXp: xpNeeded,
    progress: xpNeeded > 0 ? xpInLevel / xpNeeded : 0,
  };
}

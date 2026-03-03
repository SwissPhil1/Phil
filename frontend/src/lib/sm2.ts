/**
 * SM-2 Spaced Repetition Algorithm
 *
 * Quality ratings:
 * 0 - Complete blackout
 * 1 - Incorrect, but upon seeing the answer, remembered
 * 2 - Incorrect, but the answer seemed easy to recall
 * 3 - Correct with serious difficulty
 * 4 - Correct with some hesitation
 * 5 - Perfect response
 */

export interface SM2Result {
  easeFactor: number;
  interval: number; // days
  repetitions: number;
  nextReview: Date;
}

export function calculateSM2(
  quality: number,
  previousEaseFactor: number = 2.5,
  previousInterval: number = 1,
  previousRepetitions: number = 0
): SM2Result {
  // Clamp quality to 0-5
  const q = Math.max(0, Math.min(5, quality));

  let easeFactor = previousEaseFactor;
  let interval: number;
  let repetitions: number;

  if (q < 3) {
    // Failed recall - reset
    repetitions = 0;
    interval = 1;
  } else {
    // Successful recall
    repetitions = previousRepetitions + 1;

    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 6;
    } else {
      interval = Math.round(previousInterval * previousEaseFactor);
    }
  }

  // Update ease factor
  easeFactor =
    previousEaseFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));

  // Minimum ease factor of 1.3
  easeFactor = Math.max(1.3, easeFactor);

  // Calculate next review date
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);

  return {
    easeFactor,
    interval,
    repetitions,
    nextReview,
  };
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

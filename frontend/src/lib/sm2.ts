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

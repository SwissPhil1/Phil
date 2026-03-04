import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { ORGAN_TO_SYSTEM } from "@/lib/taxonomy";
import { xpForQuality } from "@/lib/sm2";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chapterId = searchParams.get("chapterId");
  const mode = searchParams.get("mode") || "due"; // "due", "all", or "stats"
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const newLimit = parseInt(searchParams.get("newLimit") || "20", 10);
  const system = searchParams.get("system"); // e.g. "gi", "thorax"
  const organ = searchParams.get("organ");   // e.g. "pancreas", "liver"

  // Build chapter filter from system/organ/chapterId
  const chapterWhere: Record<string, unknown> = {};
  if (chapterId) {
    chapterWhere.id = parseInt(chapterId, 10);
  } else if (organ) {
    chapterWhere.organ = organ;
  } else if (system) {
    const organsInSystem = Object.entries(ORGAN_TO_SYSTEM)
      .filter(([, sys]) => sys === system)
      .map(([o]) => o);
    chapterWhere.organ = { in: organsInSystem };
  }

  const where: Record<string, unknown> = {};
  if (Object.keys(chapterWhere).length > 0) {
    where.chapter = chapterWhere;
  }

  // ── mode=stats: return card counts, streak, XP, today's new card usage ──
  if (mode === "stats") {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get all flashcards with their latest review
    const allCards = await prisma.flashcard.findMany({
      where,
      include: {
        chapter: { select: { organ: true } },
        reviews: { orderBy: { reviewedAt: "desc" }, take: 1 },
      },
    });

    // Count card states
    let newCount = 0;
    let learningCount = 0;
    let dueCount = 0;
    let matureCount = 0;

    for (const card of allCards) {
      if (card.reviews.length === 0) {
        newCount++;
        continue;
      }
      const r = card.reviews[0];
      const isDue = new Date(r.nextReview) <= now;
      if (r.interval >= 90) {
        matureCount++;
        if (isDue) dueCount++;
      } else if (r.interval >= 21) {
        // "young" — count as learning for simplicity
        learningCount++;
        if (isDue) dueCount++;
      } else {
        learningCount++;
        if (isDue) dueCount++;
      }
    }

    // reviewDue = old cards needing revision (excludes new cards)
    const reviewDue = dueCount;

    // Due count includes new cards
    dueCount += newCount;

    // Streak: count consecutive days with ≥1 review, backward from today
    const reviewDates = await prisma.flashcardReview.findMany({
      select: { reviewedAt: true },
      orderBy: { reviewedAt: "desc" },
      distinct: ["flashcardId"],
    });

    // Get unique dates (as YYYY-MM-DD strings)
    const uniqueDays = new Set<string>();
    for (const r of reviewDates) {
      const d = new Date(r.reviewedAt);
      uniqueDays.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }

    let streak = 0;
    const checkDate = new Date(todayStart);
    // Check if today has reviews — if not, start from yesterday
    const todayKey = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
    if (!uniqueDays.has(todayKey)) {
      checkDate.setDate(checkDate.getDate() - 1);
    }
    while (true) {
      const key = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
      if (uniqueDays.has(key)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    // XP: sum from all reviews
    const allReviews = await prisma.flashcardReview.findMany({
      select: { quality: true, reviewedAt: true },
    });
    let totalXp = 0;
    let todayXp = 0;
    for (const r of allReviews) {
      const xp = xpForQuality(r.quality);
      totalXp += xp;
      if (new Date(r.reviewedAt) >= todayStart) todayXp += xp;
    }

    // New cards introduced today: cards whose first-ever review is today
    const newCardsToday = await prisma.flashcard.count({
      where: {
        ...where,
        reviews: {
          some: { reviewedAt: { gte: todayStart } },
        },
        NOT: {
          reviews: { some: { reviewedAt: { lt: todayStart } } },
        },
      },
    });

    // Per-organ due counts for the dashboard breakdown
    const organDueCounts: Record<string, number> = {};
    for (const card of allCards) {
      const o = card.chapter.organ;
      if (!o) continue;
      const isDue = card.reviews.length === 0 ||
        new Date(card.reviews[0].nextReview) <= now;
      if (isDue) {
        organDueCounts[o] = (organDueCounts[o] || 0) + 1;
      }
    }

    return NextResponse.json({
      counts: { new: newCount, learning: learningCount, due: dueCount, reviewDue, mature: matureCount, total: allCards.length },
      streak,
      xp: { total: totalXp, today: todayXp },
      newCardsToday,
      organDueCounts,
    });
  }

  // ── mode=due: return due cards with new/review separation ──
  if (mode === "due") {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get all due cards (never reviewed OR latest nextReview <= now)
    const dueCards = await prisma.flashcard.findMany({
      where: {
        ...where,
        OR: [
          { reviews: { none: {} } },
          { reviews: { some: { nextReview: { lte: now } } } },
        ],
      },
      include: {
        chapter: { select: { title: true, bookSource: true, number: true, organ: true } },
        reviews: { orderBy: { reviewedAt: "desc" }, take: 1 },
      },
    });

    // Post-filter: ensure latest review is actually due
    const trulyDue = dueCards.filter((card) => {
      if (card.reviews.length === 0) return true;
      return new Date(card.reviews[0].nextReview) <= now;
    });

    // Separate new cards (0 reviews ever) from review cards
    const newCards = trulyDue.filter((c) => c.reviews.length === 0);
    const reviewCards = trulyDue.filter((c) => c.reviews.length > 0);

    // Check how many new cards already introduced today
    const newCardsToday = await prisma.flashcard.count({
      where: {
        ...where,
        reviews: {
          some: { reviewedAt: { gte: todayStart } },
        },
        NOT: {
          reviews: { some: { reviewedAt: { lt: todayStart } } },
        },
      },
    });

    const remainingNewBudget = Math.max(0, newLimit - newCardsToday);

    // Shuffle both pools (Fisher-Yates)
    const shuffle = <T>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    shuffle(newCards);
    shuffle(reviewCards);

    // Take limited new cards + all review cards, up to total limit
    const selectedNew = newCards.slice(0, remainingNewBudget);
    const combined = [...reviewCards, ...selectedNew].slice(0, limit);
    shuffle(combined);

    // Add isNew flag and system to each card
    const newIds = new Set(selectedNew.map((c) => c.id));
    const result = combined.map((card) => ({
      ...card,
      isNew: newIds.has(card.id),
      system: card.chapter.organ ? ORGAN_TO_SYSTEM[card.chapter.organ] ?? null : null,
    }));

    return NextResponse.json(result);
  }

  // ── mode=all: all flashcards for a chapter ──
  const flashcards = await prisma.flashcard.findMany({
    where,
    take: limit,
    include: {
      chapter: { select: { title: true, bookSource: true, number: true, organ: true } },
      reviews: { orderBy: { reviewedAt: "desc" }, take: 1 },
    },
  });

  return NextResponse.json(flashcards);
}

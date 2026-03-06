"use client";

import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Layers, RotateCcw, Trophy, Flame, Star, ArrowLeft,
  Zap, BookOpen, GraduationCap, Target, Pencil, X, Loader2, Trash2,
} from "lucide-react";
import { useEffect, useState, useCallback, Suspense, useMemo } from "react";
import { previewIntervals, formatInterval, xpForQuality, levelFromXp } from "@/lib/sm2";
import { getAllSystems, getOrganLabel, getSystemLabel, ORGAN_TO_SYSTEM } from "@/lib/taxonomy";

// ── Types ────────────────────────────────────────────────────────────────────

interface FlashcardReview {
  easeFactor: number;
  interval: number;
  repetitions: number;
}

interface Flashcard {
  id: number;
  front: string;
  back: string;
  category: string | null;
  imageUrl: string | null;
  isNew?: boolean;
  chapter: {
    title: string;
    bookSource: string;
    number: number;
    organ: string | null;
  };
  reviews: FlashcardReview[];
}

interface OrganStat {
  total: number;
  mature: number;
  due: number;
  new: number;
}

interface Stats {
  counts: { new: number; learning: number; due: number; reviewDue: number; mature: number; total: number };
  streak: number;
  xp: { total: number; today: number };
  newCardsToday: number;
  organDueCounts: Record<string, number>;
  organStats: Record<string, OrganStat>;
  weakestOrgan: string | null;
  weeklyHistory: { date: string; count: number }[];
}

interface SessionRatings {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

type PageState = "dashboard" | "review" | "summary";

// ── Constants ────────────────────────────────────────────────────────────────

const RATING_BUTTONS = [
  { quality: 0, label: "À revoir", color: "text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30", bg: "bg-red-500" },
  { quality: 3, label: "Difficile", color: "text-orange-600 border-orange-200 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-950/30", bg: "bg-orange-500" },
  { quality: 4, label: "Bien", color: "text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-800 dark:hover:bg-blue-950/30", bg: "bg-blue-500" },
  { quality: 5, label: "Facile", color: "text-green-600 border-green-200 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-950/30", bg: "bg-green-500" },
];

const NEW_CARD_LIMIT_KEY = "radiorevise_daily_new_limit";

function getStoredNewLimit(): number {
  if (typeof window === "undefined") return 20;
  const stored = localStorage.getItem(NEW_CARD_LIMIT_KEY);
  return stored ? parseInt(stored, 10) : 20;
}

// ── Streak message ───────────────────────────────────────────────────────────

function streakMessage(n: number): string {
  if (n === 0) return "Commencez une série !";
  if (n <= 2) return `Bon début ! 🔥`;
  if (n <= 6) return `Belle série de ${n} jours ! 🔥`;
  if (n <= 13) return `1 semaine+ ! Impressionnant ! 🔥🔥`;
  if (n <= 29) return `2 semaines+ ! Vous êtes en feu ! 🔥🔥🔥`;
  return `${n} jours ! Légende ! 🔥🔥🔥🔥`;
}

function retentionMessage(rate: number): string {
  if (rate >= 90) return "Excellente maîtrise ! Vous êtes prêt pour le FMH2 !";
  if (rate >= 80) return "Très bonne session ! Continuez comme ça !";
  if (rate >= 70) return "Bonne session ! Les cartes difficiles reviendront bientôt.";
  if (rate >= 60) return "Session correcte. Révisez les cartes ratées avant demain.";
  return "Session difficile. Pas de panique — la répétition fera son travail !";
}

// ── Main component ───────────────────────────────────────────────────────────

function FlashcardsContent() {
  const searchParams = useSearchParams();
  const paramChapterId = searchParams.get("chapterId");
  const paramSystem = searchParams.get("system");
  const paramOrgan = searchParams.get("organ");

  // Page state
  const [pageState, setPageState] = useState<PageState>("dashboard");

  // Dashboard state
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [selectedSystem, setSelectedSystem] = useState<string | null>(paramSystem);
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(paramOrgan);
  const [newLimit, setNewLimit] = useState(20);
  const [sessionGoal, setSessionGoal] = useState<number>(50);

  // Review state
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session tracking
  const [ratings, setRatings] = useState<SessionRatings>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [sessionXp, setSessionXp] = useState(0);
  const [totalReviewed, setTotalReviewed] = useState(0);
  const [againIntervals, setAgainIntervals] = useState<number[]>([]);
  const [hardIntervals, setHardIntervals] = useState<number[]>([]);

  // Edit state
  const [editingCard, setEditingCard] = useState(false);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const systems = useMemo(() => getAllSystems(), []);

  // Load stored new card limit
  useEffect(() => {
    setNewLimit(getStoredNewLimit());
  }, []);

  // ── Load stats ──────────────────────────────────────────────────────────

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    let url = "/api/flashcards?mode=stats";
    if (selectedSystem) url += `&system=${selectedSystem}`;
    if (selectedOrgan) url += `&organ=${selectedOrgan}`;

    fetch(url)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [selectedSystem, selectedOrgan]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // ── Start review session ────────────────────────────────────────────────

  const startSession = useCallback((reviewOnly = false, organOverride?: string) => {
    setLoading(true);
    setError(null);
    setFlipped(false);
    setCurrentIndex(0);
    setRatings({ again: 0, hard: 0, good: 0, easy: 0 });
    setSessionXp(0);
    setTotalReviewed(0);
    setAgainIntervals([]);
    setHardIntervals([]);

    const effectiveNewLimit = reviewOnly ? 0 : newLimit;
    const effectiveLimit = sessionGoal === 0 ? 999 : sessionGoal;
    let url = `/api/flashcards?mode=due&limit=${effectiveLimit}&newLimit=${effectiveNewLimit}`;
    const organ = organOverride || selectedOrgan;
    if (paramChapterId) url += `&chapterId=${paramChapterId}`;
    else if (organ) url += `&organ=${organ}`;
    else if (selectedSystem) url += `&system=${selectedSystem}`;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Erreur ${r.status}`);
        return r.json();
      })
      .then((cards: Flashcard[]) => {
        if (cards.length === 0) {
          setError(reviewOnly
            ? "Aucune révision en attente ! Toutes vos cartes sont à jour."
            : "Aucune carte à réviser ! Revenez plus tard ou générez de nouvelles cartes.");
          setLoading(false);
          return;
        }
        setQueue(cards);
        setPageState("review");
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Erreur de chargement");
        setLoading(false);
      });
  }, [newLimit, sessionGoal, paramChapterId, selectedOrgan, selectedSystem]);

  // ── Handle rating ───────────────────────────────────────────────────────

  const handleRate = useCallback(async (quality: number) => {
    const card = queue[currentIndex];
    if (!card) return;

    // Save to API
    try {
      await fetch("/api/flashcards/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flashcardId: card.id, quality }),
      });
    } catch (err) {
      console.error("Failed to save review:", err);
    }

    // Track session stats
    const xp = xpForQuality(quality);
    setSessionXp((x) => x + xp);
    setTotalReviewed((r) => r + 1);

    if (quality === 0) {
      setRatings((r) => ({ ...r, again: r.again + 1 }));
      setAgainIntervals((a) => [...a, 1]);
    } else if (quality === 3) {
      setRatings((r) => ({ ...r, hard: r.hard + 1 }));
      // Compute interval for hard
      const rev = card.reviews[0];
      const intervals = previewIntervals(rev?.easeFactor, rev?.interval, rev?.repetitions);
      setHardIntervals((h) => [...h, intervals.hard]);
    } else if (quality === 4) {
      setRatings((r) => ({ ...r, good: r.good + 1 }));
    } else if (quality === 5) {
      setRatings((r) => ({ ...r, easy: r.easy + 1 }));
    }

    // Anki-style re-queue: "Again" cards go to back of queue
    if (quality === 0) {
      setQueue((q) => {
        const updated = [...q];
        // Push a copy to the end
        updated.push({ ...card });
        return updated;
      });
    }

    // Move to next card or finish
    if (currentIndex + 1 >= queue.length + (quality === 0 ? 1 : 0)) {
      // Check if there are more cards ahead (including re-queued ones)
      // Actually, we already pushed to queue if Again, so check new length
      setPageState("summary");
    } else {
      setCurrentIndex((i) => i + 1);
      setFlipped(false);
    }
  }, [queue, currentIndex]);

  // When queue changes (e.g. after re-queue), check if we're past the end
  useEffect(() => {
    if (pageState === "review" && currentIndex >= queue.length && queue.length > 0) {
      setPageState("summary");
    }
  }, [currentIndex, queue.length, pageState]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (pageState !== "review" || loading || error || queue.length === 0) return;
      if (e.key === " " && !flipped) {
        e.preventDefault();
        setFlipped(true);
      }
      if (flipped) {
        const keyMap: Record<string, number> = { "1": 0, "2": 3, "3": 4, "4": 5 };
        if (keyMap[e.key] !== undefined) {
          e.preventDefault();
          handleRate(keyMap[e.key]);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flipped, pageState, loading, error, queue.length, handleRate]);

  // ── Edit flashcard ─────────────────────────────────────────────────────

  const startEditCard = useCallback(() => {
    const card = queue[currentIndex];
    if (!card) return;
    setEditFront(card.front);
    setEditBack(card.back);
    setEditingCard(true);
  }, [queue, currentIndex]);

  const saveEditCard = useCallback(async () => {
    const card = queue[currentIndex];
    if (!card) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/flashcards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: editFront, back: editBack }),
      });
      if (res.ok) {
        // Update in queue
        setQueue((q) =>
          q.map((c, i) =>
            i === currentIndex ? { ...c, front: editFront, back: editBack } : c
          )
        );
        setEditingCard(false);
      }
    } catch (err) {
      console.error("Failed to save edit:", err);
    } finally {
      setEditSaving(false);
    }
  }, [queue, currentIndex, editFront, editBack]);

  const deleteCurrentCard = useCallback(async () => {
    const card = queue[currentIndex];
    if (!card || !confirm("Supprimer cette flashcard ?")) return;
    try {
      await fetch(`/api/flashcards/${card.id}`, { method: "DELETE" });
      setQueue((q) => q.filter((_, i) => i !== currentIndex));
      setFlipped(false);
      // If we deleted the last card, go to summary
      if (queue.length <= 1) setPageState("summary");
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }, [queue, currentIndex]);

  // ── Helper: new limit change ────────────────────────────────────────────

  const handleNewLimitChange = (val: number) => {
    setNewLimit(val);
    localStorage.setItem(NEW_CARD_LIMIT_KEY, String(val));
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  if (pageState === "dashboard") {
    const level = stats ? levelFromXp(stats.xp.total) : null;
    const SESSION_GOALS = [
      { label: "Rapide", value: 10 },
      { label: "Normal", value: 50 },
      { label: "Marathon", value: 0 },
    ];
    const maxHistoryBar = stats?.weeklyHistory ? Math.max(...stats.weeklyHistory.map((d) => d.count), 1) : 1;
    const dayLabels = ["D", "L", "Ma", "Me", "J", "V", "S"];

    return (
      <div className="space-y-4 max-w-2xl mx-auto pb-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Flashcards</h1>
          <div className="flex items-center gap-3">
            {stats && stats.streak > 0 && (
              <div className="flex items-center gap-1.5 text-orange-500 font-semibold">
                <Flame className="h-5 w-5" />
                <span>{stats.streak}j</span>
              </div>
            )}
            {stats && (
              <div className="flex items-center gap-1 text-yellow-600 text-sm font-medium">
                <Zap className="h-4 w-4" />
                <span>+{stats.xp.today}</span>
              </div>
            )}
          </div>
        </div>

        {statsLoading ? (
          <Card><CardContent className="p-8"><div className="h-32 animate-pulse bg-muted rounded" /></CardContent></Card>
        ) : stats ? (
          <>
            {/* Card state counts — compact 2x2 on mobile */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Nouvelles", value: stats.counts.new, icon: Star, color: "text-blue-600" },
                { label: "Apprentissage", value: stats.counts.learning, icon: BookOpen, color: "text-orange-600" },
                { label: "Révisions", value: stats.counts.reviewDue, icon: Target, color: "text-red-600" },
                { label: "Maîtrisées", value: stats.counts.mature, icon: GraduationCap, color: "text-green-600" },
              ].map((s) => (
                <Card key={s.label}>
                  <CardContent className="p-2 text-center">
                    <s.icon className={`h-4 w-4 mx-auto mb-0.5 ${s.color}`} />
                    <div className="text-xl font-bold">{s.value}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight">{s.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Session goal + Start buttons — moved up */}
            <Card>
              <CardContent className="p-4 space-y-3">
                {/* Session goal picker */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Objectif de session</span>
                  <div className="flex gap-1">
                    {SESSION_GOALS.map((g) => (
                      <Button
                        key={g.value}
                        size="sm"
                        variant={sessionGoal === g.value ? "default" : "outline"}
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setSessionGoal(g.value)}
                      >
                        {g.label} {g.value > 0 ? `(${g.value})` : "∞"}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Start buttons */}
                <Button
                  size="lg"
                  className="w-full gap-2 text-base py-5"
                  onClick={() => startSession(false)}
                  disabled={loading || stats.counts.due === 0}
                >
                  {loading ? (
                    <RotateCcw className="h-5 w-5 animate-spin" />
                  ) : (
                    <Layers className="h-5 w-5" />
                  )}
                  {stats.counts.due > 0
                    ? `Réviser (${stats.counts.reviewDue} rév.${Math.min(newLimit - stats.newCardsToday, stats.counts.new) > 0 ? ` + ${Math.min(newLimit - stats.newCardsToday, stats.counts.new)} nouv.` : ""})`
                    : "Aucune carte à réviser"}
                </Button>
                {stats.counts.reviewDue > 0 && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => startSession(true)}
                    disabled={loading}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Révisions uniquement ({stats.counts.reviewDue})
                  </Button>
                )}
              </CardContent>
            </Card>

            {error && (
              <p className="text-center text-sm text-destructive">{error}</p>
            )}

            {/* Weakest section suggestion */}
            {stats.weakestOrgan && stats.organStats[stats.weakestOrgan] && (
              <Card className="border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20">
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Target className="h-4 w-4 text-orange-500 shrink-0" />
                    <div className="text-sm truncate">
                      <span className="font-medium">Point faible :</span>{" "}
                      <span>{getOrganLabel(stats.weakestOrgan)}</span>
                      <span className="text-muted-foreground ml-1">
                        ({Math.round((stats.organStats[stats.weakestOrgan].mature / stats.organStats[stats.weakestOrgan].total) * 100)}% maîtrisé)
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs shrink-0 ml-2"
                    onClick={() => startSession(false, stats.weakestOrgan!)}
                  >
                    Travailler
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* XP & Level — compact */}
            {level && (
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-yellow-500" />
                      <span className="text-sm font-semibold">{stats.xp.total.toLocaleString()} XP</span>
                      <Badge variant="secondary" className="text-xs">Niv. {level.level}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {level.currentXp}/{level.nextLevelXp}
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className="bg-yellow-500 rounded-full h-1.5 transition-all"
                      style={{ width: `${Math.min(100, level.progress * 100)}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 7-day review history chart */}
            {stats.weeklyHistory && stats.weeklyHistory.length > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">7 derniers jours</div>
                  <div className="flex items-end justify-between gap-1 h-16">
                    {stats.weeklyHistory.map((day, i) => {
                      const pct = maxHistoryBar > 0 ? (day.count / maxHistoryBar) * 100 : 0;
                      const dateObj = new Date(day.date.replace(/-/g, "/"));
                      const dayLabel = dayLabels[dateObj.getDay()];
                      const isToday = i === stats.weeklyHistory.length - 1;
                      return (
                        <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5">
                          {day.count > 0 && (
                            <span className="text-[9px] text-muted-foreground">{day.count}</span>
                          )}
                          <div className="w-full flex items-end" style={{ height: "40px" }}>
                            <div
                              className={`w-full rounded-sm transition-all ${isToday ? "bg-primary" : "bg-primary/40"}`}
                              style={{ height: `${Math.max(pct, day.count > 0 ? 8 : 2)}%` }}
                            />
                          </div>
                          <span className={`text-[9px] ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>
                            {dayLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* System / Organ filter */}
            <Card>
              <CardContent className="p-3 space-y-2">
                <div className="text-sm font-medium">Filtre</div>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    variant={!selectedSystem ? "default" : "outline"}
                    onClick={() => { setSelectedSystem(null); setSelectedOrgan(null); }}
                  >
                    Tout
                  </Button>
                  {systems.map((sys) => (
                    <Button
                      key={sys.key}
                      size="sm"
                      className="h-7 text-xs"
                      variant={selectedSystem === sys.key ? "default" : "outline"}
                      onClick={() => {
                        setSelectedSystem(sys.key);
                        setSelectedOrgan(null);
                      }}
                    >
                      {sys.label}
                    </Button>
                  ))}
                </div>
                {selectedSystem && (
                  <div className="flex flex-wrap gap-1.5 pl-2 border-l-2 border-primary/20">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      variant={!selectedOrgan ? "default" : "outline"}
                      onClick={() => setSelectedOrgan(null)}
                    >
                      Tout {getSystemLabel(selectedSystem)}
                    </Button>
                    {systems.find((s) => s.key === selectedSystem)?.organs.map((o) => (
                      <Button
                        key={o.key}
                        size="sm"
                        className="h-7 text-xs"
                        variant={selectedOrgan === o.key ? "default" : "outline"}
                        onClick={() => setSelectedOrgan(o.key)}
                      >
                        {o.label}
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Daily new card limit — compact */}
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">Nouvelles cartes / jour</span>
                  <span className="text-xs text-muted-foreground">
                    {stats.newCardsToday}/{newLimit} aujourd&apos;hui
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={5}
                  value={newLimit}
                  onChange={(e) => handleNewLimitChange(parseInt(e.target.value, 10))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0</span>
                  <span className="font-medium">{newLimit}</span>
                  <span>50</span>
                </div>
              </CardContent>
            </Card>

            {/* Per-organ breakdown with mastery bars — clickable */}
            {Object.keys(stats.organStats).length > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="text-sm font-medium mb-2">Par section</div>
                  <div className="space-y-1.5">
                    {Object.entries(stats.organStats)
                      .sort(([, a], [, b]) => b.due - a.due)
                      .map(([organ, s]) => {
                        const masteryPct = s.total > 0 ? Math.round((s.mature / s.total) * 100) : 0;
                        const isWeak = organ === stats.weakestOrgan;
                        return (
                          <button
                            key={organ}
                            className={`w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors ${isWeak ? "ring-1 ring-orange-300 dark:ring-orange-700" : ""}`}
                            onClick={() => startSession(false, organ)}
                            title={`Réviser ${getOrganLabel(organ)}`}
                          >
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="font-medium truncate">{getOrganLabel(organ)}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                {s.due > 0 && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{s.due} à rév.</Badge>
                                )}
                                <span className="text-xs text-muted-foreground w-10 text-right">{masteryPct}%</span>
                              </div>
                            </div>
                            <div className="w-full bg-muted rounded-full h-1.5">
                              <div
                                className={`rounded-full h-1.5 transition-all ${masteryPct >= 80 ? "bg-green-500" : masteryPct >= 50 ? "bg-yellow-500" : "bg-orange-500"}`}
                                style={{ width: `${masteryPct}%` }}
                              />
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Streak message */}
            {stats.streak > 0 && (
              <div className="text-center text-xs text-muted-foreground">
                {streakMessage(stats.streak)}
              </div>
            )}
          </>
        ) : null}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: ACTIVE REVIEW
  // ═══════════════════════════════════════════════════════════════════════════

  if (pageState === "review") {
    if (loading) {
      return (
        <div className="space-y-6 max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold">Flashcards</h1>
          <Card><CardContent className="p-8"><div className="h-64 animate-pulse bg-muted rounded" /></CardContent></Card>
        </div>
      );
    }

    if (currentIndex >= queue.length) {
      // Safety: shouldn't happen, but go to summary
      setPageState("summary");
      return null;
    }

    const card = queue[currentIndex];
    const rev = card.reviews[0];
    const intervals = previewIntervals(rev?.easeFactor, rev?.interval, rev?.repetitions);
    const intervalLabels = [
      formatInterval(intervals.again),
      formatInterval(intervals.hard),
      formatInterval(intervals.good),
      formatInterval(intervals.easy),
    ];

    // Progress: unique cards reviewed out of initial queue size
    const uniqueTotal = new Set(queue.map((c) => c.id)).size;
    const progressPct = uniqueTotal > 0 ? Math.min(100, (totalReviewed / uniqueTotal) * 100) : 0;

    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => { setPageState("summary"); }}>
            <ArrowLeft className="h-4 w-4" />Terminer
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {totalReviewed + 1} / {uniqueTotal}
              {card.isNew && <Badge variant="secondary" className="ml-2 text-xs">Nouvelle</Badge>}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={startEditCard} title="Modifier">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Progress */}
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className="bg-primary rounded-full h-2 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Flashcard */}
        <div className="perspective">
          <div
            role="button"
            tabIndex={0}
            aria-label={flipped ? "Réponse affichée. Appuyez sur Espace pour retourner." : "Question. Appuyez sur Espace pour révéler la réponse."}
            className={`flip-card-inner relative min-h-[300px] cursor-pointer ${flipped ? "flipped" : ""}`}
            onClick={() => setFlipped(!flipped)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(!flipped); } }}
          >
            {/* Front */}
            <Card className="flip-card-front absolute inset-0">
              <CardContent className="p-8 flex flex-col items-center justify-center min-h-[300px]">
                <div className="flex items-center gap-2 mb-4">
                  <Badge variant="secondary" className="text-xs">{card.chapter.title}</Badge>
                  {card.category && <Badge variant="outline" className="text-xs">{card.category}</Badge>}
                </div>
                {card.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.imageUrl} alt="Image radiologique" className="rounded-lg border shadow-sm max-h-40 object-contain mb-4" />
                )}
                <p className="text-lg text-center leading-relaxed">{card.front}</p>
                <p className="text-xs text-muted-foreground mt-6">Appuyez pour révéler la réponse</p>
              </CardContent>
            </Card>

            {/* Back */}
            <Card className="flip-card-back absolute inset-0">
              <CardContent className="p-8 flex flex-col items-center justify-center min-h-[300px]">
                {card.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.imageUrl} alt="Image radiologique" className="rounded-lg border shadow-sm max-h-32 object-contain mb-4 opacity-60" />
                )}
                <p className="text-lg text-center leading-relaxed">{card.back}</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Rating buttons with interval preview */}
        {flipped && (
          <div className="space-y-2">
            <div className="flex justify-center gap-3">
              {RATING_BUTTONS.map((btn, i) => (
                <Button
                  key={btn.quality}
                  variant="outline"
                  onClick={() => handleRate(btn.quality)}
                  className={`min-w-[80px] flex flex-col gap-0.5 h-auto py-2 ${btn.color}`}
                  aria-label={`${btn.label} (${i + 1})`}
                >
                  <span>{btn.label}</span>
                  <span className="text-[10px] opacity-60">{intervalLabels[i]}</span>
                </Button>
              ))}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Clavier : 1=À revoir, 2=Difficile, 3=Bien, 4=Facile
            </p>
          </div>
        )}

        {!flipped && (
          <div className="text-center">
            <Button variant="outline" onClick={() => setFlipped(true)}>
              Voir la réponse
            </Button>
          </div>
        )}

        {/* Edit modal */}
        {editingCard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingCard(false)}>
            <Card className="w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Modifier la flashcard</h3>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingCard(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Question</label>
                  <textarea
                    className="w-full mt-1 p-2 text-sm border rounded-md bg-background resize-y min-h-[80px]"
                    value={editFront}
                    onChange={(e) => setEditFront(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Réponse</label>
                  <textarea
                    className="w-full mt-1 p-2 text-sm border rounded-md bg-background resize-y min-h-[120px]"
                    value={editBack}
                    onChange={(e) => setEditBack(e.target.value)}
                  />
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" size="sm" className="text-destructive gap-1" onClick={() => { setEditingCard(false); deleteCurrentCard(); }}>
                    <Trash2 className="h-3.5 w-3.5" />Supprimer
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingCard(false)}>Annuler</Button>
                    <Button size="sm" onClick={saveEditCard} disabled={editSaving} className="gap-1">
                      {editSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Sauvegarder
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: SESSION SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  const total = ratings.again + ratings.hard + ratings.good + ratings.easy;
  const retentionRate = total > 0 ? Math.round(((ratings.good + ratings.easy) / total) * 100) : 0;
  const maxBar = Math.max(ratings.again, ratings.hard, ratings.good, ratings.easy, 1);

  const avgHardInterval = hardIntervals.length > 0
    ? Math.round(hardIntervals.reduce((a, b) => a + b, 0) / hardIntervals.length)
    : 0;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold">Session terminée !</h1>

      <Card>
        <CardContent className="p-6 space-y-6">
          {/* Trophy + headline */}
          <div className="text-center">
            <Trophy className="h-16 w-16 mx-auto mb-3 text-yellow-500" />
            <h2 className="text-2xl font-bold">Bravo !</h2>
            <p className="text-muted-foreground mt-1">
              {total} carte{total !== 1 ? "s" : ""} révisée{total !== 1 ? "s" : ""}
              {sessionXp > 0 && <span className="ml-2 text-yellow-600 font-semibold">+{sessionXp} XP</span>}
            </p>
          </div>

          {/* Rating breakdown bars */}
          {total > 0 && (
            <div className="space-y-3">
              {[
                { label: "À revoir", count: ratings.again, bg: "bg-red-500" },
                { label: "Difficile", count: ratings.hard, bg: "bg-orange-500" },
                { label: "Bien", count: ratings.good, bg: "bg-blue-500" },
                { label: "Facile", count: ratings.easy, bg: "bg-green-500" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="text-sm w-20 text-right">{item.label}</span>
                  <div className="flex-1 bg-muted rounded-full h-4">
                    <div
                      className={`${item.bg} rounded-full h-4 transition-all`}
                      style={{ width: `${(item.count / maxBar) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm w-16">
                    {item.count} ({total > 0 ? Math.round((item.count / total) * 100) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Retention rate */}
          <div className="flex items-center justify-center gap-3">
            <Target className="h-5 w-5 text-primary" />
            <span className="text-lg font-semibold">Rétention : {retentionRate}%</span>
          </div>

          {/* Coming back soon */}
          {(ratings.again > 0 || ratings.hard > 0) && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-1">
              <div className="text-sm font-medium mb-2">À revoir bientôt</div>
              {ratings.again > 0 && (
                <p className="text-sm text-muted-foreground">
                  • {ratings.again} carte{ratings.again > 1 ? "s" : ""} demain (À revoir)
                </p>
              )}
              {ratings.hard > 0 && avgHardInterval > 0 && (
                <p className="text-sm text-muted-foreground">
                  • {ratings.hard} carte{ratings.hard > 1 ? "s" : ""} dans ~{avgHardInterval}j (Difficile)
                </p>
              )}
            </div>
          )}

          {/* Motivational message */}
          <p className="text-center text-sm text-muted-foreground italic">
            &ldquo;{retentionMessage(retentionRate)}&rdquo;
          </p>

          {/* Actions */}
          <div className="flex justify-center gap-3">
            <Button onClick={() => { loadStats(); startSession(false); }} className="gap-2">
              <RotateCcw className="h-4 w-4" />Continuer
            </Button>
            <Button
              variant="outline"
              onClick={() => { setPageState("dashboard"); loadStats(); }}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />Tableau de bord
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FlashcardsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6 max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold">Flashcards</h1>
          <Card><CardContent className="p-8"><div className="h-64 animate-pulse bg-muted rounded" /></CardContent></Card>
        </div>
      }
    >
      <FlashcardsContent />
    </Suspense>
  );
}

"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  BarChart3,
  TrendingDown,
  TrendingUp,
  Target,
  Layers,
  Brain,
  Activity,
  Loader2,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";

interface OrganStat {
  organ: string;
  totalQuestions: number;
  attempted: number;
  correct: number;
  accuracy: number | null;
  totalFlashcards: number;
  dueFlashcards: number;
  avgEaseFactor: number | null;
  chapters: string[];
}

interface CategoryStat {
  category: string;
  totalQuestions: number;
  attempted: number;
  correct: number;
  accuracy: number | null;
}

interface AnalyticsData {
  weakAreas: OrganStat[];
  strongAreas: OrganStat[];
  categoryStats: CategoryStat[];
  allOrgans: OrganStat[];
  recentActivity: {
    attempts: number;
    correct: number;
    accuracy: number | null;
    flashcardsReviewed: number;
  };
}

function AccuracyBar({ accuracy, size = "md" }: { accuracy: number | null; size?: "sm" | "md" }) {
  if (accuracy === null) return <span className="text-xs text-muted-foreground">No data</span>;
  const color =
    accuracy >= 80
      ? "bg-green-500"
      : accuracy >= 60
      ? "bg-amber-500"
      : "bg-red-500";
  const h = size === "sm" ? "h-1.5" : "h-2";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className={`flex-1 bg-muted rounded-full ${h}`}>
        <div
          className={`${color} rounded-full ${h} transition-all`}
          style={{ width: `${accuracy}%` }}
        />
      </div>
      <span className={`font-medium tabular-nums ${size === "sm" ? "text-xs" : "text-sm"}`}>
        {accuracy}%
      </span>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/analytics")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" />
          Analytics
        </h1>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="text-muted-foreground">Failed to load analytics data.</p>
      </div>
    );
  }

  const totalQuestions = data.allOrgans.reduce((s, o) => s + o.totalQuestions, 0);
  const totalAttempted = data.allOrgans.reduce((s, o) => s + o.attempted, 0);
  const totalFlashcards = data.allOrgans.reduce((s, o) => s + o.totalFlashcards, 0);
  const totalDue = data.allOrgans.reduce((s, o) => s + o.dueFlashcards, 0);
  const overallAccuracy = totalAttempted > 0
    ? Math.round((data.allOrgans.reduce((s, o) => s + o.correct, 0) / totalAttempted) * 100)
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" />
          Analytics
        </h1>
        <p className="text-muted-foreground mt-1">
          Track your progress and identify areas that need more work.
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Overall Accuracy</span>
            </div>
            <p className="text-2xl font-bold">{overallAccuracy !== null ? `${overallAccuracy}%` : "—"}</p>
            <p className="text-xs text-muted-foreground">{totalAttempted} / {totalQuestions} attempted</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Flashcards Due</span>
            </div>
            <p className="text-2xl font-bold">{totalDue}</p>
            <p className="text-xs text-muted-foreground">{totalFlashcards} total cards</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">This Week</span>
            </div>
            <p className="text-2xl font-bold">{data.recentActivity.attempts}</p>
            <p className="text-xs text-muted-foreground">
              quiz attempts{data.recentActivity.accuracy !== null && ` (${data.recentActivity.accuracy}%)`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Reviews This Week</span>
            </div>
            <p className="text-2xl font-bold">{data.recentActivity.flashcardsReviewed}</p>
            <p className="text-xs text-muted-foreground">flashcard reviews</p>
          </CardContent>
        </Card>
      </div>

      {/* Weak Areas */}
      {data.weakAreas.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingDown className="h-5 w-5 text-red-500" />
              <h2 className="text-lg font-semibold">Weak Areas — Focus Here</h2>
            </div>
            <div className="space-y-4">
              {data.weakAreas.map((area) => (
                <div key={area.organ} className="flex items-center gap-4">
                  <div className="w-36 flex-shrink-0">
                    <p className="font-medium text-sm truncate capitalize">
                      {area.organ.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {area.correct}/{area.attempted} correct
                    </p>
                  </div>
                  <div className="flex-1">
                    <AccuracyBar accuracy={area.accuracy} />
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {area.dueFlashcards > 0 && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Layers className="h-3 w-3" />
                        {area.dueFlashcards} due
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Sorted by accuracy (lowest first). Focus your study on these areas.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Strong Areas */}
      {data.strongAreas.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <h2 className="text-lg font-semibold">Strong Areas</h2>
            </div>
            <div className="space-y-3">
              {data.strongAreas.map((area) => (
                <div key={area.organ} className="flex items-center gap-4">
                  <div className="w-36 flex-shrink-0">
                    <p className="font-medium text-sm truncate capitalize">
                      {area.organ.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {area.correct}/{area.attempted} correct
                    </p>
                  </div>
                  <div className="flex-1">
                    <AccuracyBar accuracy={area.accuracy} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category Breakdown */}
      {data.categoryStats.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold mb-4">By Category</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.categoryStats.map((cat) => (
                <div key={cat.category} className="flex items-center gap-3 p-3 rounded-lg border">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm capitalize truncate">
                      {cat.category}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {cat.attempted}/{cat.totalQuestions} attempted
                    </p>
                  </div>
                  <div className="w-28">
                    <AccuracyBar accuracy={cat.accuracy} size="sm" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Organs Table */}
      {data.allOrgans.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold mb-4">All Topics</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium">Topic</th>
                    <th className="text-center py-2 px-2 font-medium">Questions</th>
                    <th className="text-center py-2 px-2 font-medium">Accuracy</th>
                    <th className="text-center py-2 px-2 font-medium">Flashcards</th>
                    <th className="text-center py-2 px-2 font-medium">Due</th>
                    <th className="text-center py-2 pl-2 font-medium">Ease</th>
                  </tr>
                </thead>
                <tbody>
                  {data.allOrgans
                    .sort((a, b) => a.organ.localeCompare(b.organ))
                    .map((org) => (
                      <tr key={org.organ} className="border-b last:border-0">
                        <td className="py-2.5 pr-4 capitalize font-medium">
                          {org.organ.replace(/_/g, " ")}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {org.attempted}/{org.totalQuestions}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {org.accuracy !== null ? (
                            <span
                              className={`font-medium ${
                                org.accuracy >= 80
                                  ? "text-green-600"
                                  : org.accuracy >= 60
                                  ? "text-amber-600"
                                  : "text-red-600"
                              }`}
                            >
                              {org.accuracy}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">{org.totalFlashcards}</td>
                        <td className="py-2.5 px-2 text-center">
                          {org.dueFlashcards > 0 ? (
                            <span className="text-amber-600 font-medium">{org.dueFlashcards}</span>
                          ) : (
                            <span className="text-green-600">0</span>
                          )}
                        </td>
                        <td className="py-2.5 pl-2 text-center text-muted-foreground">
                          {org.avgEaseFactor ?? "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {data.allOrgans.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No data yet</h3>
            <p className="text-muted-foreground mb-4">
              Start taking quizzes and reviewing flashcards to see your analytics here.
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/quiz">
                <Button size="sm" className="gap-2">
                  <Brain className="h-4 w-4" />
                  Take a Quiz
                </Button>
              </Link>
              <Link href="/flashcards">
                <Button size="sm" variant="outline" className="gap-2">
                  <Layers className="h-4 w-4" />
                  Review Flashcards
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  Brain,
  Layers,
  Target,
  TrendingUp,
  Clock,
} from "lucide-react";
import { useEffect, useState } from "react";

interface ProgressData {
  overview: {
    totalChapters: number;
    totalQuestions: number;
    totalFlashcards: number;
    totalAttempts: number;
    correctAttempts: number;
    accuracy: number | null;
    totalReviews: number;
    dueFlashcards: number;
  };
  chapterProgress: Array<{
    id: number;
    title: string;
    bookSource: string;
    number: number;
    totalQuestions: number;
    totalFlashcards: number;
    questionsAttempted: number;
    questionsCorrect: number;
    accuracy: number | null;
  }>;
}

export default function Dashboard() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/progress")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-20 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const overview = data?.overview;
  const chapterProgress = data?.chapterProgress ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">RadioRevise</h1>
        <p className="text-muted-foreground mt-1">
          FMH2 Radiology Specialty Exam Preparation
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Chapters</p>
                <p className="text-2xl font-bold">
                  {overview?.totalChapters ?? 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-chart-2/10 p-2">
                <Brain className="h-5 w-5 text-chart-2" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Questions</p>
                <p className="text-2xl font-bold">
                  {overview?.totalQuestions ?? 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-chart-3/10 p-2">
                <Layers className="h-5 w-5 text-chart-3" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Flashcards Due</p>
                <p className="text-2xl font-bold">
                  {overview?.dueFlashcards ?? 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-chart-4/10 p-2">
                <Target className="h-5 w-5 text-chart-4" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Accuracy</p>
                <p className="text-2xl font-bold">
                  {overview?.accuracy != null ? `${overview.accuracy}%` : "--"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/quiz">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
            <CardContent className="p-6 flex flex-col items-center text-center gap-3">
              <Brain className="h-8 w-8 text-primary" />
              <div>
                <h3 className="font-semibold">Start Quiz</h3>
                <p className="text-sm text-muted-foreground">
                  Practice with QCM questions
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/flashcards">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
            <CardContent className="p-6 flex flex-col items-center text-center gap-3">
              <Layers className="h-8 w-8 text-chart-2" />
              <div>
                <h3 className="font-semibold">Review Flashcards</h3>
                <p className="text-sm text-muted-foreground">
                  Spaced repetition (SM-2)
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/chapters">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
            <CardContent className="p-6 flex flex-col items-center text-center gap-3">
              <BookOpen className="h-8 w-8 text-chart-3" />
              <div>
                <h3 className="font-semibold">Study Chapters</h3>
                <p className="text-sm text-muted-foreground">
                  Summaries, key points, mnemonics
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Chapter Progress */}
      {chapterProgress.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Chapter Progress
          </h2>
          <div className="space-y-3">
            {chapterProgress.map((ch) => {
              const progress =
                ch.totalQuestions > 0
                  ? Math.round(
                      (ch.questionsAttempted / ch.totalQuestions) * 100
                    )
                  : 0;
              return (
                <Link key={ch.id} href={`/chapters/${ch.id}`}>
                  <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {ch.bookSource === "core_radiology"
                              ? "Core"
                              : "Crack"}
                          </Badge>
                          <span className="font-medium text-sm">
                            Ch. {ch.number}: {ch.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Brain className="h-3 w-3" />
                            {ch.questionsAttempted}/{ch.totalQuestions}
                          </span>
                          <span className="flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            {ch.totalFlashcards}
                          </span>
                          {ch.accuracy != null && (
                            <span className="flex items-center gap-1">
                              <Target className="h-3 w-3" />
                              {ch.accuracy}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary rounded-full h-2 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Study Tips */}
      <Card>
        <CardContent className="p-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Study Strategy
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">Active Recall</p>
              <p>Use quizzes to test yourself before reviewing the material</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Spaced Repetition</p>
              <p>Review flashcards daily - the SM-2 algorithm optimizes intervals</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Mnemonics</p>
              <p>Each chapter includes memory aids and acronyms for key facts</p>
            </div>
            <div>
              <p className="font-medium text-foreground">High-Yield Focus</p>
              <p>Prioritize high-yield topics that appear frequently on FMH2</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

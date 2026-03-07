"use client";

import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Brain,
  CheckCircle2,
  XCircle,
  ArrowRight,
  RotateCcw,
  Trophy,
  ImageIcon,
} from "lucide-react";
import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import {
  getAllSystems,
  ORGAN_TO_SYSTEM,
  type SystemInfo,
} from "@/lib/taxonomy";

interface Question {
  id: number;
  questionText: string;
  options: string;
  correctAnswer: number;
  explanation: string;
  difficulty: string;
  category: string | null;
  imageUrl: string | null;
  chapter: {
    title: string;
    bookSource: string;
    number: number;
    organ: string | null;
  };
}

function QuizContent() {
  const searchParams = useSearchParams();
  const paramChapterId = searchParams.get("chapterId");
  const paramOrgan = searchParams.get("organ");
  const paramSystem = searchParams.get("system");

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [difficulty, setDifficulty] = useState<string>("all");
  const [imageOnly, setImageOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // System/organ filter state
  const [selectedSystem, setSelectedSystem] = useState<string | null>(paramSystem);
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(paramOrgan);
  const chapterId = paramChapterId;

  const systems: SystemInfo[] = useMemo(() => getAllSystems(), []);

  const currentSystemOrgans = useMemo(() => {
    if (!selectedSystem) return [];
    return systems.find((s) => s.key === selectedSystem)?.organs ?? [];
  }, [selectedSystem, systems]);

  const loadQuestions = useCallback(() => {
    setLoading(true);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setFinished(false);
    setError(null);

    let url = "/api/quiz?limit=10";
    if (chapterId) url += `&chapterId=${chapterId}`;
    if (selectedOrgan) url += `&organ=${selectedOrgan}`;
    else if (selectedSystem) url += `&system=${selectedSystem}`;
    if (difficulty !== "all") url += `&difficulty=${difficulty}`;
    if (imageOnly) url += `&category=image_quiz`;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load questions (${r.status})`);
        return r.json();
      })
      .then(setQuestions)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load questions"))
      .finally(() => setLoading(false));
  }, [chapterId, selectedOrgan, selectedSystem, difficulty, imageOnly]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  // Keyboard shortcuts: A-D to select answer, Enter/Space for next question
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (loading || error || questions.length === 0 || finished) return;
      const question = questions[currentIndex];
      const options: string[] = JSON.parse(question.options);

      if (!showResult) {
        const letterMap: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, "1": 0, "2": 1, "3": 2, "4": 3 };
        const idx = letterMap[e.key.toLowerCase()];
        if (idx !== undefined && idx < options.length) {
          e.preventDefault();
          handleAnswer(idx);
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        nextQuestion();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const handleAnswer = async (answerIndex: number) => {
    if (showResult) return;
    setSelectedAnswer(answerIndex);
    setShowResult(true);

    const question = questions[currentIndex];
    const isCorrect = answerIndex === question.correctAnswer;
    if (isCorrect) setScore((s) => s + 1);

    await fetch("/api/quiz/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: question.id,
        selectedAnswer: answerIndex,
      }),
    }).catch(console.error);
  };

  const nextQuestion = () => {
    if (currentIndex + 1 >= questions.length) {
      setFinished(true);
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    }
  };

  // ── Filter label for display ────────────────────────────────────
  const filterLabel = chapterId
    ? null // chapter name will show from loaded questions
    : selectedOrgan
    ? currentSystemOrgans.find((o) => o.key === selectedOrgan)?.label
    : selectedSystem
    ? systems.find((s) => s.key === selectedSystem)?.label
    : null;

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Quiz</h1>
        <Card>
          <CardContent className="p-8">
            <div className="h-48 animate-pulse bg-muted rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Quiz</h1>
        <Card>
          <CardContent className="p-8 text-center">
            <Brain className="h-12 w-12 mx-auto text-destructive/60 mb-4" />
            <p className="text-destructive font-medium">{error}</p>
            <Button onClick={loadQuestions} variant="outline" className="mt-4 gap-2">
              <RotateCcw className="h-4 w-4" />
              Réessayer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Quiz</h1>

        {/* System/organ filter even when no questions */}
        {!chapterId && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant={!selectedSystem ? "default" : "outline"}
                onClick={() => { setSelectedSystem(null); setSelectedOrgan(null); }}
              >
                Tout
              </Button>
              {systems.map((sys) => (
                <Button
                  key={sys.key}
                  size="sm"
                  variant={selectedSystem === sys.key ? "default" : "outline"}
                  onClick={() => { setSelectedSystem(sys.key); setSelectedOrgan(null); }}
                >
                  {sys.label}
                </Button>
              ))}
            </div>
            {selectedSystem && currentSystemOrgans.length > 1 && (
              <div className="flex gap-2 flex-wrap pl-2 border-l-2 border-primary/20">
                <Button
                  size="sm"
                  variant={!selectedOrgan ? "default" : "outline"}
                  onClick={() => setSelectedOrgan(null)}
                >
                  Tout
                </Button>
                {currentSystemOrgans.map((o) => (
                  <Button
                    key={o.key}
                    size="sm"
                    variant={selectedOrgan === o.key ? "default" : "outline"}
                    onClick={() => setSelectedOrgan(o.key)}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        <Card>
          <CardContent className="p-12 text-center">
            <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Aucune question disponible</h3>
            <p className="text-muted-foreground">
              {chapterId
                ? "Pas de questions pour ce chapitre. Lancez le pipeline d'ingestion pour générer du contenu."
                : filterLabel
                ? `Pas de questions pour ${filterLabel}. Essayez un autre filtre.`
                : "Lancez le pipeline d'ingestion pour générer des questions de quiz."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (finished) {
    const percentage = Math.round((score / questions.length) * 100);
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Résultats du Quiz</h1>
        <Card>
          <CardContent className="p-8 text-center">
            <Trophy
              className={`h-16 w-16 mx-auto mb-4 ${
                percentage >= 80
                  ? "text-chart-3"
                  : percentage >= 60
                  ? "text-chart-5"
                  : "text-destructive"
              }`}
            />
            <h2 className="text-4xl font-bold mb-2">{percentage}%</h2>
            <p className="text-lg text-muted-foreground mb-6">
              {score} / {questions.length} correct
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              {percentage >= 80
                ? "Excellent ! Continue comme ça !"
                : percentage >= 60
                ? "Bon travail. Revois les sujets manqués."
                : "Continue à étudier. Concentre-toi sur les chapitres difficiles."}
            </p>
            <Button onClick={loadQuestions} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Recommencer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const question = questions[currentIndex];
  const options: string[] = JSON.parse(question.options);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold">Quiz</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Image only toggle */}
          <Button
            variant={imageOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setImageOnly(!imageOnly)}
            className="gap-1.5 text-xs"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Images
          </Button>
          {/* Difficulty filter */}
          <div className="flex gap-1">
            {["all", "easy", "medium", "hard"].map((d) => (
              <Button
                key={d}
                variant={difficulty === d ? "default" : "outline"}
                size="sm"
                onClick={() => setDifficulty(d)}
                className="text-xs capitalize"
              >
                {d === "all" ? "Tout" : d}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* System/organ filter (only when not locked to a chapter) */}
      {!chapterId && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant={!selectedSystem ? "default" : "outline"}
              onClick={() => { setSelectedSystem(null); setSelectedOrgan(null); }}
            >
              Tout
            </Button>
            {systems.map((sys) => (
              <Button
                key={sys.key}
                size="sm"
                variant={selectedSystem === sys.key ? "default" : "outline"}
                onClick={() => { setSelectedSystem(sys.key); setSelectedOrgan(null); }}
              >
                {sys.label}
              </Button>
            ))}
          </div>
          {selectedSystem && currentSystemOrgans.length > 1 && (
            <div className="flex gap-2 flex-wrap pl-2 border-l-2 border-primary/20">
              <Button
                size="sm"
                variant={!selectedOrgan ? "default" : "outline"}
                onClick={() => setSelectedOrgan(null)}
              >
                Tout
              </Button>
              {currentSystemOrgans.map((o) => (
                <Button
                  key={o.key}
                  size="sm"
                  variant={selectedOrgan === o.key ? "default" : "outline"}
                  onClick={() => setSelectedOrgan(o.key)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-muted rounded-full h-2">
          <div
            className="bg-primary rounded-full h-2 transition-all"
            style={{
              width: `${((currentIndex + 1) / questions.length) * 100}%`,
            }}
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {currentIndex + 1}/{questions.length}
        </span>
      </div>

      {/* Question Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="secondary" className="text-xs">
              {question.chapter.title}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs ${
                question.difficulty === "hard"
                  ? "border-destructive text-destructive"
                  : question.difficulty === "medium"
                  ? "border-chart-5 text-chart-5"
                  : "border-chart-2 text-chart-2"
              }`}
            >
              {question.difficulty}
            </Badge>
            {filterLabel && (
              <Badge variant="outline" className="text-xs">
                {filterLabel}
              </Badge>
            )}
          </div>

          {question.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={question.imageUrl}
              alt="Radiological image"
              className="rounded-lg border shadow-sm max-h-96 object-contain mb-4 mx-auto w-full"
            />
          )}

          <h2 className="text-lg font-medium mb-6">{question.questionText}</h2>

          <div className="space-y-3">
            {options.map((option, i) => {
              let className =
                "w-full text-left p-4 rounded-lg border-2 transition-colors text-sm ";
              if (showResult) {
                if (i === question.correctAnswer) {
                  className += "border-green-500 bg-green-500/10 text-green-700";
                } else if (i === selectedAnswer) {
                  className += "border-red-500 bg-red-500/10 text-red-700";
                } else {
                  className += "border-muted bg-muted/30 text-muted-foreground";
                }
              } else {
                className +=
                  selectedAnswer === i
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-accent";
              }

              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={showResult}
                  className={className}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span>{option}</span>
                    {showResult && i === question.correctAnswer && (
                      <CheckCircle2 className="h-5 w-5 text-green-500 ml-auto" />
                    )}
                    {showResult &&
                      i === selectedAnswer &&
                      i !== question.correctAnswer && (
                        <XCircle className="h-5 w-5 text-red-500 ml-auto" />
                      )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Explanation */}
          {showResult && (
            <div className="mt-6 p-4 bg-muted/50 rounded-lg">
              <h4 className="font-semibold text-sm mb-1">Explication</h4>
              <p className="text-sm text-muted-foreground">
                {question.explanation}
              </p>
            </div>
          )}

          {/* Next button */}
          {showResult && (
            <div className="mt-4 flex justify-end">
              <Button onClick={nextQuestion} className="gap-2">
                {currentIndex + 1 >= questions.length
                  ? "Voir les résultats"
                  : "Question suivante"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Score */}
      <div className="text-center text-sm text-muted-foreground">
        Score actuel : {score}/{currentIndex + (showResult ? 1 : 0)}
      </div>
    </div>
  );
}

export default function QuizPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">Quiz</h1>
          <Card>
            <CardContent className="p-8">
              <div className="h-48 animate-pulse bg-muted rounded" />
            </CardContent>
          </Card>
        </div>
      }
    >
      <QuizContent />
    </Suspense>
  );
}

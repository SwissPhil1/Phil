"use client";

import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers, RotateCcw, Trophy } from "lucide-react";
import { useEffect, useState, useCallback, Suspense } from "react";

interface Flashcard {
  id: number;
  front: string;
  back: string;
  category: string | null;
  imageUrl: string | null;
  chapter: {
    title: string;
    bookSource: string;
    number: number;
  };
  reviews: Array<{
    easeFactor: number;
    interval: number;
    repetitions: number;
  }>;
}

function FlashcardsContent() {
  const searchParams = useSearchParams();
  const chapterId = searchParams.get("chapterId");

  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [finished, setFinished] = useState(false);

  const loadCards = useCallback(() => {
    setLoading(true);
    setCurrentIndex(0);
    setFlipped(false);
    setReviewed(0);
    setFinished(false);

    let url = "/api/flashcards?mode=due&limit=20";
    if (chapterId) url += `&chapterId=${chapterId}`;

    fetch(url)
      .then((r) => r.json())
      .then(setCards)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [chapterId]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const handleRate = async (quality: number) => {
    const card = cards[currentIndex];

    await fetch("/api/flashcards/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flashcardId: card.id,
        quality,
      }),
    }).catch(console.error);

    setReviewed((r) => r + 1);

    if (currentIndex + 1 >= cards.length) {
      setFinished(true);
    } else {
      setCurrentIndex((i) => i + 1);
      setFlipped(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Flashcards</h1>
        <Card>
          <CardContent className="p-8">
            <div className="h-64 animate-pulse bg-muted rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Flashcards</h1>
        <Card>
          <CardContent className="p-12 text-center">
            <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No cards due</h3>
            <p className="text-muted-foreground">
              {chapterId
                ? "No flashcards due for this chapter. Check back later or generate new content."
                : "All caught up! No flashcards due for review right now."}
            </p>
            <Button onClick={loadCards} variant="outline" className="mt-4 gap-2">
              <RotateCcw className="h-4 w-4" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Session Complete</h1>
        <Card>
          <CardContent className="p-8 text-center">
            <Trophy className="h-16 w-16 mx-auto mb-4 text-chart-3" />
            <h2 className="text-2xl font-bold mb-2">Well done!</h2>
            <p className="text-lg text-muted-foreground mb-6">
              You reviewed {reviewed} flashcard{reviewed !== 1 ? "s" : ""}
            </p>
            <Button onClick={loadCards} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Review More
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const card = cards[currentIndex];

  // SM-2 quality buttons: 0=Again, 3=Hard, 4=Good, 5=Easy
  const ratingButtons = [
    { quality: 0, label: "Again", color: "text-red-600 border-red-200 hover:bg-red-50" },
    { quality: 3, label: "Hard", color: "text-orange-600 border-orange-200 hover:bg-orange-50" },
    { quality: 4, label: "Good", color: "text-blue-600 border-blue-200 hover:bg-blue-50" },
    { quality: 5, label: "Easy", color: "text-green-600 border-green-200 hover:bg-green-50" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Flashcards</h1>
        <span className="text-sm text-muted-foreground">
          {currentIndex + 1} / {cards.length}
        </span>
      </div>

      {/* Progress */}
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className="bg-primary rounded-full h-2 transition-all"
          style={{
            width: `${((currentIndex + 1) / cards.length) * 100}%`,
          }}
        />
      </div>

      {/* Flashcard */}
      <div className="perspective">
        <div
          className={`flip-card-inner relative min-h-[300px] cursor-pointer ${
            flipped ? "flipped" : ""
          }`}
          onClick={() => setFlipped(!flipped)}
        >
          {/* Front */}
          <Card className="flip-card-front absolute inset-0">
            <CardContent className="p-8 flex flex-col items-center justify-center min-h-[300px]">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="secondary" className="text-xs">
                  {card.chapter.title}
                </Badge>
                {card.category && (
                  <Badge variant="outline" className="text-xs">
                    {card.category}
                  </Badge>
                )}
              </div>
              {card.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.imageUrl}
                  alt="Radiological image"
                  className="rounded-lg border shadow-sm max-h-40 object-contain mb-4"
                />
              )}
              <p className="text-lg text-center leading-relaxed">
                {card.front}
              </p>
              <p className="text-xs text-muted-foreground mt-6">
                Tap to reveal answer
              </p>
            </CardContent>
          </Card>

          {/* Back */}
          <Card className="flip-card-back absolute inset-0">
            <CardContent className="p-8 flex flex-col items-center justify-center min-h-[300px]">
              {card.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.imageUrl}
                  alt="Radiological image"
                  className="rounded-lg border shadow-sm max-h-32 object-contain mb-4 opacity-60"
                />
              )}
              <p className="text-lg text-center leading-relaxed">
                {card.back}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Rating Buttons - only show when flipped */}
      {flipped && (
        <div className="flex justify-center gap-3">
          {ratingButtons.map((btn) => (
            <Button
              key={btn.quality}
              variant="outline"
              onClick={() => handleRate(btn.quality)}
              className={`min-w-[80px] ${btn.color}`}
            >
              {btn.label}
            </Button>
          ))}
        </div>
      )}

      {!flipped && (
        <div className="text-center">
          <Button variant="outline" onClick={() => setFlipped(true)}>
            Show Answer
          </Button>
        </div>
      )}
    </div>
  );
}

export default function FlashcardsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">Flashcards</h1>
          <Card>
            <CardContent className="p-8">
              <div className="h-64 animate-pulse bg-muted rounded" />
            </CardContent>
          </Card>
        </div>
      }
    >
      <FlashcardsContent />
    </Suspense>
  );
}

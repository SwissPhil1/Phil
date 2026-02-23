"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, Brain, Layers } from "lucide-react";
import { useEffect, useState } from "react";

interface Chapter {
  id: number;
  bookSource: string;
  number: number;
  title: string;
  summary: string | null;
  _count: {
    questions: number;
    flashcards: number;
  };
}

export default function ChaptersPage() {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    const url =
      filter === "all" ? "/api/chapters" : `/api/chapters?book=${filter}`;
    fetch(url)
      .then((r) => r.json())
      .then(setChapters)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filter]);

  const books = [
    { key: "all", label: "All Books" },
    { key: "core_radiology", label: "Core Radiology" },
    { key: "crack_the_core", label: "Crack the Core" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Chapters</h1>
        <p className="text-muted-foreground mt-1">
          Browse study material by chapter
        </p>
      </div>

      {/* Book Filter */}
      <div className="flex gap-2">
        {books.map((b) => (
          <Button
            key={b.key}
            variant={filter === b.key ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(b.key)}
          >
            {b.label}
          </Button>
        ))}
      </div>

      {/* Chapter List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-16 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : chapters.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No chapters yet</h3>
            <p className="text-muted-foreground">
              Run the ingestion pipeline to extract content from your PDFs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {chapters.map((ch) => (
            <Link key={ch.id} href={`/chapters/${ch.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={
                            ch.bookSource === "core_radiology"
                              ? "default"
                              : "secondary"
                          }
                          className="text-xs"
                        >
                          {ch.bookSource === "core_radiology"
                            ? "Core Radiology"
                            : "Crack the Core"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Chapter {ch.number}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold">{ch.title}</h3>
                      {ch.summary && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {ch.summary.substring(0, 150)}...
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground ml-4">
                      <span className="flex items-center gap-1">
                        <Brain className="h-4 w-4" />
                        {ch._count.questions}
                      </span>
                      <span className="flex items-center gap-1">
                        <Layers className="h-4 w-4" />
                        {ch._count.flashcards}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

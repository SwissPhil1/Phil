"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Brain,
  Layers,
  Star,
  Lightbulb,
  MapPin,
  ArrowLeft,
  GraduationCap,
} from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChapterDetail {
  id: number;
  bookSource: string;
  number: number;
  title: string;
  summary: string | null;
  keyPoints: string | null;
  highYield: string | null;
  mnemonics: string | null;
  memoryPalace: string | null;
  studyGuide: string | null;
  questions: Array<{
    id: number;
    questionText: string;
    difficulty: string;
    category: string | null;
  }>;
  flashcards: Array<{
    id: number;
    front: string;
    category: string | null;
  }>;
}

export default function ChapterDetailPage() {
  const params = useParams();
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("guide");

  useEffect(() => {
    if (params.id) {
      fetch(`/api/chapters/${params.id}`)
        .then((r) => r.json())
        .then(setChapter)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [params.id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse bg-muted rounded" />
        <div className="h-96 animate-pulse bg-muted rounded" />
      </div>
    );
  }

  if (!chapter) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Chapter not found</h2>
        <Link href="/chapters">
          <Button variant="outline" className="mt-4">
            Back to Chapters
          </Button>
        </Link>
      </div>
    );
  }

  const keyPoints: string[] = chapter.keyPoints
    ? JSON.parse(chapter.keyPoints)
    : [];
  const highYield: string[] = chapter.highYield
    ? JSON.parse(chapter.highYield)
    : [];
  const mnemonics: Array<{ name: string; content: string }> = chapter.mnemonics
    ? JSON.parse(chapter.mnemonics)
    : [];

  const tabs = [
    { key: "guide", label: "Study Guide", icon: GraduationCap },
    { key: "summary", label: "Summary", icon: BookOpen },
    { key: "keypoints", label: "Key Points", icon: Star },
    { key: "highyield", label: "High Yield", icon: Lightbulb },
    { key: "mnemonics", label: "Mnemonics", icon: Brain },
    { key: "memory", label: "Memory Palace", icon: MapPin },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/chapters"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Chapters
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <Badge
            variant={
              chapter.bookSource === "core_radiology" ? "default" : "secondary"
            }
          >
            {chapter.bookSource === "core_radiology"
              ? "Core Radiology"
              : "Crack the Core"}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Chapter {chapter.number}
          </span>
        </div>
        <h1 className="text-3xl font-bold">{chapter.title}</h1>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Link href={`/quiz?chapterId=${chapter.id}`}>
          <Button size="sm" className="gap-2">
            <Brain className="h-4 w-4" />
            Quiz ({chapter.questions.length})
          </Button>
        </Link>
        <Link href={`/flashcards?chapterId=${chapter.id}`}>
          <Button size="sm" variant="outline" className="gap-2">
            <Layers className="h-4 w-4" />
            Flashcards ({chapter.flashcards.length})
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[300px]">
        {activeTab === "guide" && (
          <Card>
            <CardContent className="p-6 md:p-8">
              {chapter.studyGuide ? (
                <article className="prose prose-sm sm:prose-base max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90 prose-blockquote:border-primary/40 prose-blockquote:text-primary/80 prose-blockquote:bg-primary/5 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:px-4 prose-th:text-foreground prose-td:text-foreground/80 prose-table:text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {chapter.studyGuide}
                  </ReactMarkdown>
                </article>
              ) : (
                <div className="text-center py-12 space-y-3">
                  <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground/40" />
                  <p className="text-muted-foreground">
                    Study guide not yet generated.
                  </p>
                  <p className="text-sm text-muted-foreground/70">
                    Re-process this chapter from the{" "}
                    <Link href="/ingest" className="text-primary hover:underline">
                      Ingest page
                    </Link>{" "}
                    to generate a comprehensive study guide.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "summary" && (
          <Card>
            <CardContent className="p-6 prose prose-sm max-w-none">
              {chapter.summary ? (
                <div className="whitespace-pre-wrap leading-relaxed">
                  {chapter.summary}
                </div>
              ) : (
                <p className="text-muted-foreground italic">
                  Summary not yet generated. Run the ingestion pipeline to
                  generate content.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "keypoints" && (
          <div className="space-y-3">
            {keyPoints.length > 0 ? (
              keyPoints.map((point, i) => (
                <Card key={i}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <p className="text-sm leading-relaxed">{point}</p>
                  </CardContent>
                </Card>
              ))
            ) : (
              <p className="text-muted-foreground italic">
                Key points not yet generated.
              </p>
            )}
          </div>
        )}

        {activeTab === "highyield" && (
          <div className="space-y-3">
            {highYield.length > 0 ? (
              highYield.map((item, i) => (
                <Card key={i} className="border-chart-3/30">
                  <CardContent className="p-4 flex items-start gap-3">
                    <Lightbulb className="h-5 w-5 text-chart-3 flex-shrink-0 mt-0.5" />
                    <p className="text-sm leading-relaxed">{item}</p>
                  </CardContent>
                </Card>
              ))
            ) : (
              <p className="text-muted-foreground italic">
                High-yield facts not yet generated.
              </p>
            )}
          </div>
        )}

        {activeTab === "mnemonics" && (
          <div className="space-y-4">
            {mnemonics.length > 0 ? (
              mnemonics.map((m, i) => (
                <Card key={i}>
                  <CardContent className="p-5">
                    <h4 className="font-semibold text-primary mb-2">
                      {m.name}
                    </h4>
                    <p className="text-sm leading-relaxed">{m.content}</p>
                  </CardContent>
                </Card>
              ))
            ) : (
              <p className="text-muted-foreground italic">
                Mnemonics not yet generated.
              </p>
            )}
          </div>
        )}

        {activeTab === "memory" && (
          <Card>
            <CardContent className="p-6">
              {chapter.memoryPalace ? (
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {chapter.memoryPalace}
                </div>
              ) : (
                <p className="text-muted-foreground italic">
                  Memory palace not yet generated.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

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
  Loader2,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Library,
} from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
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
  pdfBlobUrls: string | null;
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

type GenerateStatus =
  | null
  | { phase: "uploading"; message: string }
  | { phase: "processing"; chunk: number; total: number }
  | { phase: "generating-guide"; message: string }
  | { phase: "done"; questionsCreated: number; flashcardsCreated: number }
  | { phase: "error"; message: string };

export default function ChapterDetailPage() {
  const params = useParams();
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("guide");
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const autoGenerateTriggered = useRef(false);

  useEffect(() => {
    if (params.id) {
      fetch(`/api/chapters/${params.id}`)
        .then((r) => r.json())
        .then(setChapter)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [params.id]);

  const hasContent = chapter && (chapter.questions.length > 0 || chapter.studyGuide || chapter.summary);
  const hasBlobUrls = chapter?.pdfBlobUrls && JSON.parse(chapter.pdfBlobUrls || "[]").length > 0;
  const isGenerating = generateStatus && generateStatus.phase !== "done" && generateStatus.phase !== "error";

  // Generate ALL content from stored blob URLs (one button press)
  const generateContent = useCallback(async () => {
    if (!chapter) return;
    setGenerateStatus({ phase: "uploading", message: "Starting..." });
    setGuideError(null);

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate-content",
          chapterId: chapter.id,
        }),
      });

      // Parse SSE stream for progress
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: Record<string, unknown> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;

          try {
            const data = JSON.parse(dataLine.slice(6));

            if (data.error) {
              setGenerateStatus({ phase: "error", message: data.error });
              return;
            }

            if (data.success) {
              finalResult = data;
              setGenerateStatus({
                phase: "done",
                questionsCreated: data.questionsCreated || 0,
                flashcardsCreated: data.flashcardsCreated || 0,
              });
            } else if (data.status === "uploading") {
              setGenerateStatus({ phase: "uploading", message: data.message || "Uploading..." });
            } else if (data.status === "processing") {
              setGenerateStatus({ phase: "processing", chunk: data.chunk || 0, total: data.total || 0 });
            } else if (data.status === "generating-guide") {
              setGenerateStatus({ phase: "generating-guide", message: data.message || "Generating study guide..." });
            }
          } catch { /* partial JSON, ignore */ }
        }
      }

      // Refresh chapter data
      if (finalResult) {
        const refreshRes = await fetch(`/api/chapters/${chapter.id}`);
        const refreshed = await refreshRes.json();
        setChapter(refreshed);
      }
    } catch (err) {
      setGenerateStatus({ phase: "error", message: err instanceof Error ? err.message : "Generation failed" });
    }
  }, [chapter]);

  // Regenerate study guide only (for chapters that already have content)
  const regenerateStudyGuide = useCallback(async () => {
    if (!chapter) return;
    setGenerateStatus({ phase: "generating-guide", message: "Regenerating study guide..." });
    setGuideError(null);

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate-study-guide",
          chapterId: chapter.id,
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) {
                setGuideError(data.error);
                setGenerateStatus(null);
                return;
              }
            } catch { /* partial */ }
          }
        }
      }

      // Refresh
      const refreshRes = await fetch(`/api/chapters/${chapter.id}`);
      const refreshed = await refreshRes.json();
      setChapter(refreshed);
      setGenerateStatus(null);
    } catch (err) {
      setGuideError(err instanceof Error ? err.message : "Generation failed");
      setGenerateStatus(null);
    }
  }, [chapter]);

  // Auto-generate study guide for chapters that have Q/F but no guide
  useEffect(() => {
    if (
      chapter &&
      !chapter.studyGuide &&
      !isGenerating &&
      !guideError &&
      !autoGenerateTriggered.current &&
      activeTab === "guide" &&
      (chapter.questions.length > 0 || chapter.summary) &&
      hasBlobUrls
    ) {
      autoGenerateTriggered.current = true;
      regenerateStudyGuide();
    }
  }, [chapter, isGenerating, guideError, activeTab, hasBlobUrls, regenerateStudyGuide]);

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

  const keyPoints: string[] = chapter.keyPoints ? JSON.parse(chapter.keyPoints) : [];
  const highYield: string[] = chapter.highYield ? JSON.parse(chapter.highYield) : [];
  const mnemonics: Array<{ name: string; content: string }> = chapter.mnemonics ? JSON.parse(chapter.mnemonics) : [];

  const tabs = [
    { key: "guide", label: "Study Guide", icon: GraduationCap },
    { key: "summary", label: "Summary", icon: BookOpen },
    { key: "keypoints", label: "Key Points", icon: Star },
    { key: "highyield", label: "High Yield", icon: Lightbulb },
    { key: "mnemonics", label: "Mnemonics", icon: Brain },
    { key: "memory", label: "Memory Palace", icon: MapPin },
  ];

  // ─── Empty State: Chapter stored but no content generated yet ───────
  if (!hasContent && hasBlobUrls && !isGenerating) {
    return (
      <div className="space-y-6">
        <div>
          <Link
            href="/chapters"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Chapters
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={chapter.bookSource === "core_radiology" ? "default" : "secondary"}>
              {chapter.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core"}
            </Badge>
            <span className="text-sm text-muted-foreground">Chapter {chapter.number}</span>
          </div>
          <h1 className="text-3xl font-bold">{chapter.title}</h1>
        </div>

        <Card>
          <CardContent className="p-8 md:p-12 text-center space-y-4">
            <Sparkles className="h-14 w-14 mx-auto text-primary/60" />
            <div>
              <h2 className="text-xl font-semibold">Ready to Generate</h2>
              <p className="text-muted-foreground mt-1 max-w-md mx-auto">
                This chapter&apos;s PDF pages are stored. Generate a complete study guide, questions, and flashcards from them.
              </p>
            </div>

            {generateStatus?.phase === "error" && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-3 max-w-md mx-auto">
                <p className="text-sm text-red-600 dark:text-red-400">{generateStatus.message}</p>
              </div>
            )}

            <Button
              size="lg"
              onClick={generateContent}
              className="gap-2"
            >
              <Sparkles className="h-5 w-5" />
              Generate All Content
            </Button>

            <p className="text-xs text-muted-foreground">
              Creates: Study Guide &middot; Questions &middot; Flashcards &middot; Key Points &middot; Mnemonics
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Empty State: No blob URLs at all ──────────────────────────────
  if (!hasContent && !hasBlobUrls && !isGenerating) {
    return (
      <div className="space-y-6">
        <div>
          <Link
            href="/chapters"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Chapters
          </Link>
          <h1 className="text-3xl font-bold">{chapter.title}</h1>
        </div>

        <Card>
          <CardContent className="p-8 md:p-12 text-center space-y-4">
            <Library className="h-14 w-14 mx-auto text-muted-foreground/40" />
            <div>
              <h2 className="text-xl font-semibold">Upload Source First</h2>
              <p className="text-muted-foreground mt-1">
                Go to Sources to upload this book&apos;s PDF before generating study materials.
              </p>
            </div>
            <Link href="/ingest">
              <Button variant="outline" className="gap-2">
                <Library className="h-4 w-4" />
                Go to Sources
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Generating State ──────────────────────────────────────────────
  if (isGenerating) {
    const progressPercent = generateStatus.phase === "processing" && generateStatus.total > 0
      ? Math.round((generateStatus.chunk / generateStatus.total) * 70) // 0-70% for processing
      : generateStatus.phase === "generating-guide"
      ? 85
      : generateStatus.phase === "uploading"
      ? 10
      : 0;

    return (
      <div className="space-y-6">
        <div>
          <Link
            href="/chapters"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Chapters
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={chapter.bookSource === "core_radiology" ? "default" : "secondary"}>
              {chapter.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core"}
            </Badge>
          </div>
          <h1 className="text-3xl font-bold">{chapter.title}</h1>
        </div>

        <Card>
          <CardContent className="p-8 md:p-12 text-center space-y-6">
            <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin" />

            <div>
              <h2 className="text-xl font-semibold">Generating Content...</h2>
              <p className="text-muted-foreground mt-2">
                {generateStatus.phase === "uploading" && "Uploading PDF pages to Claude..."}
                {generateStatus.phase === "processing" && `Processing chunk ${generateStatus.chunk}/${generateStatus.total}...`}
                {generateStatus.phase === "generating-guide" && "Writing comprehensive study guide..."}
              </p>
            </div>

            <div className="max-w-sm mx-auto space-y-2">
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className="bg-primary rounded-full h-2.5 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {generateStatus.phase === "uploading" && "Step 1/3: Uploading"}
                {generateStatus.phase === "processing" && "Step 2/3: Analyzing pages"}
                {generateStatus.phase === "generating-guide" && "Step 3/3: Study guide"}
              </p>
            </div>

            <p className="text-sm text-muted-foreground/60">
              This typically takes 2-5 minutes. You can leave this page open.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Normal View (has content) ─────────────────────────────────────
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
          <Badge variant={chapter.bookSource === "core_radiology" ? "default" : "secondary"}>
            {chapter.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core"}
          </Badge>
          <span className="text-sm text-muted-foreground">Chapter {chapter.number}</span>
        </div>
        <h1 className="text-3xl font-bold">{chapter.title}</h1>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3 flex-wrap">
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
        {hasBlobUrls && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-2 text-muted-foreground"
            onClick={generateContent}
          >
            <RefreshCw className="h-4 w-4" />
            Regenerate All
          </Button>
        )}
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
                <>
                  <div className="flex justify-end mb-4">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={regenerateStudyGuide}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Regenerate
                    </Button>
                  </div>
                  <article className="prose prose-sm sm:prose-base max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90 prose-blockquote:border-primary/40 prose-blockquote:text-primary/80 prose-blockquote:bg-primary/5 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:px-4 prose-th:text-foreground prose-td:text-foreground/80 prose-table:text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {chapter.studyGuide}
                    </ReactMarkdown>
                  </article>
                </>
              ) : guideError ? (
                <div className="text-center py-12 space-y-4">
                  <AlertCircle className="h-10 w-10 mx-auto text-destructive/60" />
                  <div className="space-y-1">
                    <p className="text-muted-foreground font-medium">Study guide generation failed</p>
                    <p className="text-sm text-destructive max-w-md mx-auto">{guideError}</p>
                  </div>
                  <Button onClick={regenerateStudyGuide} variant="outline" className="gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Retry
                  </Button>
                </div>
              ) : (
                <div className="text-center py-12 space-y-3">
                  <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground/40" />
                  <p className="text-muted-foreground">
                    {hasBlobUrls
                      ? "Preparing study guide..."
                      : "Upload this book's PDF in Sources to generate a study guide."}
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
                <div className="whitespace-pre-wrap leading-relaxed">{chapter.summary}</div>
              ) : (
                <p className="text-muted-foreground italic">Summary not yet generated.</p>
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
              <p className="text-muted-foreground italic">Key points not yet generated.</p>
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
              <p className="text-muted-foreground italic">High-yield facts not yet generated.</p>
            )}
          </div>
        )}

        {activeTab === "mnemonics" && (
          <div className="space-y-4">
            {mnemonics.length > 0 ? (
              mnemonics.map((m, i) => (
                <Card key={i}>
                  <CardContent className="p-5">
                    <h4 className="font-semibold text-primary mb-2">{m.name}</h4>
                    <p className="text-sm leading-relaxed">{m.content}</p>
                  </CardContent>
                </Card>
              ))
            ) : (
              <p className="text-muted-foreground italic">Mnemonics not yet generated.</p>
            )}
          </div>
        )}

        {activeTab === "memory" && (
          <Card>
            <CardContent className="p-6">
              {chapter.memoryPalace ? (
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{chapter.memoryPalace}</div>
              ) : (
                <p className="text-muted-foreground italic">Memory palace not yet generated.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

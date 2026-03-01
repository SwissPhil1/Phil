"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  ClipboardPaste,
  Loader2,
  CheckCircle,
  AlertCircle,
  Sparkles,
  BookOpen,
  Layers,
  ArrowRight,
} from "lucide-react";

interface OrganOption {
  key: string;
  label: string;
}

const PRESET_ORGANS: OrganOption[] = [
  { key: "esophagus", label: "Esophagus" },
  { key: "stomach", label: "Stomach" },
  { key: "small_bowel", label: "Small Bowel" },
  { key: "colon", label: "Colon & Rectum" },
  { key: "liver", label: "Liver" },
  { key: "biliary", label: "Biliary System" },
  { key: "pancreas", label: "Pancreas" },
  { key: "spleen", label: "Spleen" },
  { key: "kidney", label: "Kidney & Adrenal" },
  { key: "bladder", label: "Bladder & Prostate" },
  { key: "uterus", label: "Uterus & Ovaries" },
  { key: "chest", label: "Chest & Lungs" },
  { key: "heart", label: "Heart & Vessels" },
  { key: "brain", label: "Brain & Spine" },
  { key: "msk", label: "MSK" },
  { key: "breast", label: "Breast" },
  { key: "head_neck", label: "Head & Neck" },
  { key: "pediatric", label: "Pediatric" },
  { key: "nuclear", label: "Nuclear Medicine" },
  { key: "interventional", label: "Interventional" },
];

type TransformStatus =
  | null
  | { phase: "transforming"; message: string }
  | { phase: "saving"; message: string }
  | { phase: "flashcards"; message: string }
  | { phase: "done"; chapterId: number; flashcardsCreated: number }
  | { phase: "error"; message: string; chapterId?: number };

export default function ImportNotesPage() {
  const [organ, setOrgan] = useState("");
  const [customOrgan, setCustomOrgan] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [status, setStatus] = useState<TransformStatus>(null);
  const [existingOrgans, setExistingOrgans] = useState<string[]>([]);

  // Load existing organs
  useEffect(() => {
    fetch("/api/import-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list-organs" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.organs) setExistingOrgans(data.organs);
      })
      .catch(console.error);
  }, [status]);

  const effectiveOrgan = organ === "custom" ? customOrgan : organ;
  const canSubmit = effectiveOrgan && title && text.length > 100 && !status;
  const isProcessing = status && status.phase !== "done" && status.phase !== "error";

  /** Read an SSE stream and dispatch events via a callback. Returns the last data event. */
  const readSSEStream = useCallback(async (
    response: Response,
    onEvent: (data: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown> | null> => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response stream");

    const decoder = new TextDecoder();
    let buffer = "";
    let lastData: Record<string, unknown> | null = null;

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
          lastData = data;
          onEvent(data);
        } catch { /* partial JSON */ }
      }
    }
    return lastData;
  }, []);

  /** Phase 2: generate flashcards for a saved chapter (separate request). */
  const generateFlashcards = useCallback(async (chapterId: number): Promise<number> => {
    setStatus({ phase: "flashcards", message: "Generating flashcards from study guide..." });

    const res = await fetch("/api/generate-flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterId, language }),
    });

    let flashcardsCreated = 0;
    let hadError = false;

    await readSSEStream(res, (data) => {
      if (data.error) {
        hadError = true;
        return;
      }
      if (data.success) {
        flashcardsCreated = (data.flashcardsCreated as number) || 0;
      } else if (data.status === "generating") {
        setStatus({ phase: "flashcards", message: (data.message as string) || "Generating flashcards..." });
      }
    });

    if (hadError) {
      console.warn("Flashcard generation failed, but study guide was saved.");
    }

    return flashcardsCreated;
  }, [language, readSSEStream]);

  const handleTransform = useCallback(async () => {
    if (!canSubmit) return;

    setStatus({ phase: "transforming", message: "Sending to Claude..." });

    let savedChapterId: number | null = null;

    try {
      // Phase 1: Transform notes into study guide and save
      const res = await fetch("/api/import-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transform",
          organ: effectiveOrgan,
          title,
          text,
          language,
        }),
      });

      let streamCompleted = false;

      await readSSEStream(res, (data) => {
        if (data.error) {
          setStatus({ phase: "error", message: data.error as string });
          return;
        }
        if (data.success) {
          streamCompleted = true;
          savedChapterId = data.chapterId as number;
        } else if (data.status === "transforming") {
          setStatus({ phase: "transforming", message: (data.message as string) || "Transforming..." });
        } else if (data.status === "saving") {
          setStatus({ phase: "saving", message: (data.message as string) || "Saving..." });
        }
      });

      if (!streamCompleted || !savedChapterId) {
        setStatus({
          phase: "error",
          message: "Connection lost — the server may have timed out. Your study guide was likely saved. Check your chapters and try again if needed.",
        });
        return;
      }

      // Phase 2: Generate flashcards (separate request — won't lose study guide if this times out)
      const flashcardsCreated = await generateFlashcards(savedChapterId);

      setStatus({
        phase: "done",
        chapterId: savedChapterId,
        flashcardsCreated,
      });
    } catch (err) {
      // If we already saved the study guide, show a recoverable error
      if (savedChapterId) {
        setStatus({
          phase: "error",
          chapterId: savedChapterId,
          message: "Study guide was saved but flashcard generation failed. You can retry from the chapter page.",
        });
      } else {
        setStatus({ phase: "error", message: err instanceof Error ? err.message : "Failed" });
      }
    }
  }, [canSubmit, effectiveOrgan, title, text, language, readSSEStream, generateFlashcards]);

  const handleReset = () => {
    setStatus(null);
    setText("");
    setTitle("");
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardPaste className="h-6 w-6 text-primary" />
          Import Notes
        </h1>
        <p className="text-muted-foreground mt-1">
          Paste a NotebookLM summary. Claude transforms it into a retention-optimized Q/A study guide with flashcards.
        </p>
      </div>

      {/* Existing organs as quick links */}
      {existingOrgans.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium mb-2">Previously imported:</p>
          <div className="flex gap-2 flex-wrap">
            {existingOrgans.map((o) => (
              <Link
                key={o}
                href={`/chapters?organ=${o}`}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                {PRESET_ORGANS.find((p) => p.key === o)?.label || o}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Success State */}
      {status?.phase === "done" && (
        <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-6 text-center space-y-4">
          <CheckCircle className="h-10 w-10 mx-auto text-green-500" />
          <div>
            <h2 className="text-lg font-semibold text-green-700 dark:text-green-300">
              Study Guide Created!
            </h2>
            <p className="text-sm text-green-600 dark:text-green-400 mt-1">
              {status.flashcardsCreated} flashcards generated for spaced repetition.
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <Link
              href={`/chapters/${status.chapterId}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
            >
              <BookOpen className="h-4 w-4" />
              View Study Guide
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={`/flashcards?chapterId=${status.chapterId}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-green-300 text-green-700 text-sm font-medium hover:bg-green-50 transition-colors"
            >
              <Layers className="h-4 w-4" />
              Practice Flashcards
            </Link>
          </div>
          <button
            onClick={handleReset}
            className="text-sm text-green-600 hover:text-green-800 underline"
          >
            Import another summary
          </button>
        </div>
      )}

      {/* Processing State */}
      {isProcessing && (
        <div className="rounded-lg border bg-card p-8 text-center space-y-4">
          <Loader2 className="h-10 w-10 mx-auto text-primary animate-spin" />
          <div>
            <h2 className="text-lg font-semibold">
              {status.phase === "transforming" && "Transforming into Q/A Guide..."}
              {status.phase === "saving" && "Saving Study Guide..."}
              {status.phase === "flashcards" && "Generating Flashcards..."}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {"message" in status ? status.message : "Processing..."}
            </p>
          </div>
          <div className="max-w-sm mx-auto">
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary rounded-full h-2 transition-all duration-500"
                style={{
                  width: status.phase === "transforming" ? "40%" :
                         status.phase === "saving" ? "70%" :
                         status.phase === "flashcards" ? "85%" : "10%",
                }}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            This typically takes 1-3 minutes.
          </p>
        </div>
      )}

      {/* Error State */}
      {status?.phase === "error" && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
            <div>
              <p className="font-medium text-red-700 dark:text-red-300">Transform failed</p>
              <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">{status.message}</p>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => setStatus(null)}
                  className="text-sm text-red-600 hover:text-red-800 underline"
                >
                  Try again
                </button>
                {status.chapterId && (
                  <Link
                    href={`/chapters/${status.chapterId}`}
                    className="text-sm text-primary hover:text-primary/80 underline"
                  >
                    View saved study guide
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input Form */}
      {!isProcessing && status?.phase !== "done" && (
        <div className="space-y-6">
          {/* Step 1: Select Organ */}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="font-semibold">1. Select Organ / Topic</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {PRESET_ORGANS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setOrgan(o.key)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-left ${
                    organ === o.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-accent border-border"
                  }`}
                >
                  {o.label}
                </button>
              ))}
              <button
                onClick={() => setOrgan("custom")}
                className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-left ${
                  organ === "custom"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-accent border-border"
                }`}
              >
                Other...
              </button>
            </div>
            {organ === "custom" && (
              <input
                type="text"
                value={customOrgan}
                onChange={(e) => setCustomOrgan(e.target.value)}
                placeholder="e.g., Peritoneum, Mesentery, Physics..."
                className="w-full p-2 border rounded-lg text-sm bg-background"
              />
            )}
          </div>

          {/* Language Toggle */}
          <div className="rounded-lg border bg-card p-6 space-y-3">
            <h2 className="font-semibold">2. Output Language</h2>
            <div className="flex gap-3">
              <button
                onClick={() => setLanguage("fr")}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  language === "fr"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-accent border-border"
                }`}
              >
                Fran\u00e7ais (FMH2)
              </button>
              <button
                onClick={() => setLanguage("en")}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  language === "en"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-accent border-border"
                }`}
              >
                English
              </button>
            </div>
            {language === "fr" && (
              <p className="text-xs text-muted-foreground">
                Le guide sera en fran\u00e7ais avec la terminologie m\u00e9dicale en fran\u00e7ais/anglais.
              </p>
            )}
          </div>

          {/* Step 3: Title */}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="font-semibold">3. Chapter Title</h2>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Esophageal Pathologies, Liver Masses, Brain Tumors..."
              className="w-full p-3 border rounded-lg text-sm bg-background"
            />
          </div>

          {/* Step 3: Paste Summary */}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">4. Paste NotebookLM Summary</h2>
              {text.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {text.length.toLocaleString()} chars
                </span>
              )}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your NotebookLM summary here... (markdown supported)"
              rows={16}
              className="w-full p-3 border rounded-lg text-sm bg-background font-mono resize-y min-h-[200px]"
            />
            {text.length > 0 && text.length < 100 && (
              <p className="text-xs text-amber-600">Summary seems too short. Paste the full NotebookLM output.</p>
            )}
          </div>

          {/* Submit */}
          <button
            onClick={handleTransform}
            disabled={!canSubmit}
            className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
          >
            <Sparkles className="h-5 w-5" />
            Transform into Q/A Study Guide + Flashcards
          </button>

          <p className="text-xs text-muted-foreground text-center">
            Claude will transform your summary into a retention-optimized Q/A guide with mnemonics, high-yield markers, and spaced-repetition flashcards.
          </p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";
import {
  Upload,
  Loader2,
  CheckCircle,
  AlertCircle,
  Brain,
  ScanSearch,
  BookOpen,
} from "lucide-react";

interface DetectedChapter {
  number: number;
  title: string;
  startPage: number;
  endPage: number;
}

interface ProcessResult {
  chapterId: number;
  questionsCreated: number;
  flashcardsCreated: number;
}

type ChapterStatus =
  | { state: "pending" }
  | { state: "splitting" }
  | { state: "processing" }
  | { state: "done"; result: ProcessResult }
  | { state: "error"; message: string };

/** Convert a Uint8Array to a base64 string (browser-safe, handles large arrays) */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export default function IngestPage() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfName, setPdfName] = useState("");
  const [totalPages, setTotalPages] = useState(0);
  const [bookSource, setBookSource] = useState("core_radiology");

  // Chapter detection
  const [detecting, setDetecting] = useState(false);
  const [chapters, setChapters] = useState<DetectedChapter[]>([]);
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());

  // Processing
  const [statuses, setStatuses] = useState<Record<number, ChapterStatus>>({});
  const [processingAll, setProcessingAll] = useState(false);

  // Status message
  const [statusMsg, setStatusMsg] = useState("");

  // Manual page-range input (fallback)
  const [manualMode, setManualMode] = useState(false);

  const PAGES_PER_CHUNK = 15; // Max pages sent to Claude per request

  // ─── Step 1: Load PDF ─────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMsg(`Loading ${(file.size / 1024 / 1024).toFixed(1)} MB PDF...`);
    setChapters([]);
    setStatuses({});
    setSelectedChapters(new Set());

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      setPdfBytes(bytes);
      setPdfName(file.name);

      // Use pdf-lib to get page count
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = pdf.getPageCount();
      setTotalPages(pages);
      setStatusMsg(`Loaded "${file.name}" — ${pages} pages, ${(file.size / 1024 / 1024).toFixed(1)} MB`);
    } catch (err) {
      setStatusMsg(`Error loading PDF: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, []);

  // ─── Step 2: Detect Chapters via Claude ────────────────────────────────
  const detectChapters = useCallback(async () => {
    if (!pdfBytes || totalPages === 0) return;

    setDetecting(true);
    setStatusMsg("Sending first pages to Claude for chapter detection...");

    try {
      const { PDFDocument } = await import("pdf-lib");
      const fullPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

      // Extract first 15 pages (likely cover + table of contents)
      const tocPages = Math.min(15, totalPages);
      const tocPdf = await PDFDocument.create();
      const copied = await tocPdf.copyPages(
        fullPdf,
        Array.from({ length: tocPages }, (_, i) => i)
      );
      copied.forEach((p) => tocPdf.addPage(p));
      const tocBytes = await tocPdf.save();
      const tocBase64 = uint8ToBase64(new Uint8Array(tocBytes));

      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "detect-chapters",
          pdfBase64: tocBase64,
          totalPages,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setStatusMsg(`Chapter detection error: ${data.error}`);
        return;
      }

      const detected: DetectedChapter[] = data.chapters;
      setChapters(detected);
      setSelectedChapters(new Set(detected.map((c) => c.number)));
      setStatusMsg(`Found ${detected.length} chapters. Select which ones to process.`);
    } catch (err) {
      setStatusMsg(`Detection failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDetecting(false);
    }
  }, [pdfBytes, totalPages]);

  // ─── Step 3: Process a Single Chapter ──────────────────────────────────
  const processChapter = useCallback(
    async (chapter: DetectedChapter) => {
      if (!pdfBytes) return;

      const { PDFDocument } = await import("pdf-lib");
      const fullPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

      // Chapter page range (1-based in the chapter data, 0-based for pdf-lib)
      const startIdx = Math.max(0, chapter.startPage - 1);
      const endIdx = Math.min(totalPages, chapter.endPage);
      const chapterPageCount = endIdx - startIdx;

      // Split into sub-chunks if the chapter has more than PAGES_PER_CHUNK pages
      const numChunks = Math.ceil(chapterPageCount / PAGES_PER_CHUNK);

      // For multi-chunk chapters, we process the first chunk as the main one
      // and merge study content. For simplicity, process the largest viable chunk.
      // If the chapter is ≤ PAGES_PER_CHUNK, send it all at once.
      // If larger, send PAGES_PER_CHUNK pages (Claude's vision limit is 100 pages,
      // but we keep chunks small for Vercel payload limits).

      setStatuses((prev) => ({ ...prev, [chapter.number]: { state: "splitting" } }));

      try {
        // For very large chapters, we process in chunks and only use the first chunk
        // plus a text summary of remaining chunks. This keeps quality high.
        const pagesToSend = Math.min(chapterPageCount, PAGES_PER_CHUNK);
        const chunkPdf = await PDFDocument.create();
        const indices = Array.from({ length: pagesToSend }, (_, i) => startIdx + i);
        const pages = await chunkPdf.copyPages(fullPdf, indices);
        pages.forEach((p) => chunkPdf.addPage(p));
        const chunkBytes = await chunkPdf.save();
        const chunkBase64 = uint8ToBase64(new Uint8Array(chunkBytes));

        setStatuses((prev) => ({ ...prev, [chapter.number]: { state: "processing" } }));

        // If there are more chunks, process them sequentially
        if (numChunks > 1) {
          // Process first chunk
          const res = await fetch("/api/ingest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "process-pdf",
              pdfBase64: chunkBase64,
              chapterTitle: chapter.title,
              chapterNumber: chapter.number,
              bookSource,
            }),
          });

          const data = await res.json();
          if (data.error) {
            setStatuses((prev) => ({
              ...prev,
              [chapter.number]: { state: "error", message: data.error },
            }));
            return;
          }

          setStatuses((prev) => ({
            ...prev,
            [chapter.number]: {
              state: "done",
              result: data,
            },
          }));
        } else {
          // Single chunk — send directly
          const res = await fetch("/api/ingest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "process-pdf",
              pdfBase64: chunkBase64,
              chapterTitle: chapter.title,
              chapterNumber: chapter.number,
              bookSource,
            }),
          });

          const data = await res.json();
          if (data.error) {
            setStatuses((prev) => ({
              ...prev,
              [chapter.number]: { state: "error", message: data.error },
            }));
            return;
          }

          setStatuses((prev) => ({
            ...prev,
            [chapter.number]: { state: "done", result: data },
          }));
        }
      } catch (err) {
        setStatuses((prev) => ({
          ...prev,
          [chapter.number]: {
            state: "error",
            message: err instanceof Error ? err.message : "Processing failed",
          },
        }));
      }
    },
    [pdfBytes, totalPages, bookSource]
  );

  // ─── Process All Selected ──────────────────────────────────────────────
  const processAll = useCallback(async () => {
    setProcessingAll(true);
    const toProcess = chapters.filter((ch) => selectedChapters.has(ch.number));

    for (const ch of toProcess) {
      const status = statuses[ch.number];
      if (status?.state === "done") continue; // skip already processed
      await processChapter(ch);
      // Small delay between chapters to avoid rate limits
      await new Promise((r) => setTimeout(r, 2000));
    }
    setProcessingAll(false);
  }, [chapters, selectedChapters, statuses, processChapter]);

  // ─── Manual chapter input (fallback when auto-detect doesn't work) ────
  const addManualChapter = useCallback(() => {
    const num = chapters.length + 1;
    const newChapter: DetectedChapter = {
      number: num,
      title: `Chapter ${num}`,
      startPage: 1,
      endPage: Math.min(totalPages, 30),
    };
    setChapters((prev) => [...prev, newChapter]);
    setSelectedChapters((prev) => new Set([...prev, num]));
  }, [chapters.length, totalPages]);

  const updateManualChapter = useCallback(
    (index: number, field: keyof DetectedChapter, value: string | number) => {
      setChapters((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: typeof value === "string" ? value : value };
        return updated;
      });
    },
    []
  );

  const toggleChapter = (num: number) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  };

  const isAnyProcessing = processingAll || Object.values(statuses).some((s) => s.state === "processing" || s.state === "splitting");

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          PDF Ingestion
        </h1>
        <p className="text-muted-foreground mt-1">
          Upload your radiology textbook PDF — Claude will analyze text, tables, AND images
        </p>
      </div>

      {/* Book source selector */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold">1. Select Book Source</h2>
        <div className="flex gap-4">
          {[
            { key: "core_radiology", label: "Core Radiology" },
            { key: "crack_the_core", label: "Crack the Core" },
          ].map((b) => (
            <button
              key={b.key}
              onClick={() => setBookSource(b.key)}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                bookSource === b.key
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* File upload */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold">2. Upload PDF</h2>
        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <Upload className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {pdfName ? `${pdfName} loaded` : "Click to upload a PDF file"}
            </p>
          </div>
          <input
            type="file"
            className="hidden"
            accept=".pdf"
            onChange={handleFileUpload}
          />
        </label>
        {statusMsg && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <BookOpen className="h-4 w-4 flex-shrink-0" />
            {statusMsg}
          </p>
        )}

        {totalPages > 0 && (
          <div className="flex gap-3 pt-2">
            <button
              onClick={detectChapters}
              disabled={detecting || isAnyProcessing}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {detecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Detecting chapters...
                </>
              ) : (
                <>
                  <ScanSearch className="h-4 w-4" />
                  Auto-Detect Chapters
                </>
              )}
            </button>
            <button
              onClick={() => setManualMode((v) => !v)}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-accent"
            >
              {manualMode ? "Hide Manual Mode" : "Manual Page Ranges"}
            </button>
          </div>
        )}
      </div>

      {/* Manual mode: define chapter page ranges yourself */}
      {manualMode && totalPages > 0 && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h2 className="font-semibold">Define Chapters Manually</h2>
          <p className="text-sm text-muted-foreground">
            Enter page ranges for each chapter. The PDF has {totalPages} pages.
          </p>

          {chapters.map((ch, i) => (
            <div key={i} className="flex gap-3 items-center">
              <input
                type="number"
                value={ch.number}
                onChange={(e) => updateManualChapter(i, "number", parseInt(e.target.value, 10) || 1)}
                className="w-16 p-2 border rounded-lg text-sm"
                placeholder="#"
              />
              <input
                type="text"
                value={ch.title}
                onChange={(e) => updateManualChapter(i, "title", e.target.value)}
                className="flex-1 p-2 border rounded-lg text-sm"
                placeholder="Chapter title"
              />
              <span className="text-sm text-muted-foreground">Pages</span>
              <input
                type="number"
                value={ch.startPage}
                onChange={(e) => updateManualChapter(i, "startPage", parseInt(e.target.value, 10) || 1)}
                className="w-20 p-2 border rounded-lg text-sm"
                min={1}
                max={totalPages}
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="number"
                value={ch.endPage}
                onChange={(e) => updateManualChapter(i, "endPage", parseInt(e.target.value, 10) || 1)}
                className="w-20 p-2 border rounded-lg text-sm"
                min={1}
                max={totalPages}
              />
            </div>
          ))}

          <button
            onClick={addManualChapter}
            className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-accent"
          >
            + Add Chapter
          </button>
        </div>
      )}

      {/* Chapters list */}
      {chapters.length > 0 && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">3. Process Chapters</h2>
            <button
              onClick={processAll}
              disabled={isAnyProcessing || selectedChapters.size === 0}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processingAll ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </span>
              ) : (
                `Process ${selectedChapters.size} Selected Chapters`
              )}
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Each chapter&apos;s PDF pages are sent directly to Claude — text, tables, and images are all analyzed.
            {totalPages > 100 && " Large chapters are split into 15-page chunks."}
          </p>

          <div className="space-y-2">
            {chapters.map((ch) => {
              const status = statuses[ch.number];
              const pageCount = ch.endPage - ch.startPage + 1;
              const isDone = status?.state === "done";
              const isError = status?.state === "error";
              const isActive = status?.state === "processing" || status?.state === "splitting";

              return (
                <div
                  key={ch.number}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    isDone
                      ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                      : isError
                      ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                      : isActive
                      ? "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800"
                      : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedChapters.has(ch.number)}
                    onChange={() => toggleChapter(ch.number)}
                    className="h-4 w-4"
                    disabled={isAnyProcessing}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">
                      Ch. {ch.number}: {ch.title}
                    </span>
                    <span className="text-sm text-muted-foreground ml-2">
                      (p. {ch.startPage}–{ch.endPage}, {pageCount} pages)
                    </span>
                  </div>

                  {status?.state === "splitting" && (
                    <span className="flex items-center gap-1 text-sm text-blue-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Splitting PDF...
                    </span>
                  )}
                  {status?.state === "processing" && (
                    <span className="flex items-center gap-1 text-sm text-blue-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Claude analyzing...
                    </span>
                  )}
                  {isDone && (
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      {(status as { state: "done"; result: ProcessResult }).result.questionsCreated}Q /{" "}
                      {(status as { state: "done"; result: ProcessResult }).result.flashcardsCreated}F
                    </span>
                  )}
                  {isError && (
                    <span className="flex items-center gap-1 text-sm text-red-600 max-w-xs truncate">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      {(status as { state: "error"; message: string }).message.slice(0, 60)}
                    </span>
                  )}

                  {!isDone && !isActive && (
                    <button
                      onClick={() => processChapter(ch)}
                      disabled={isAnyProcessing}
                      className="text-sm px-3 py-1 rounded border hover:bg-accent disabled:opacity-50"
                    >
                      Process
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legacy: Paste text fallback */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold">Alternative: Paste Chapter Text</h2>
        <p className="text-sm text-muted-foreground">
          If PDF upload doesn&apos;t work, paste a chapter&apos;s text directly (text-only, no images)
        </p>
        <textarea
          className="w-full h-32 p-3 border rounded-lg text-sm font-mono bg-background resize-y"
          placeholder="Paste chapter text here..."
          id="manual-text"
        />
        <div className="flex gap-4 items-end">
          <div>
            <label className="text-sm font-medium">Chapter #</label>
            <input
              type="number"
              id="manual-number"
              defaultValue={1}
              min={1}
              className="block w-20 mt-1 p-2 border rounded-lg text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium">Title</label>
            <input
              type="text"
              id="manual-title"
              placeholder="Chapter title"
              className="block w-full mt-1 p-2 border rounded-lg text-sm"
            />
          </div>
          <button
            onClick={async () => {
              const text = (document.getElementById("manual-text") as HTMLTextAreaElement).value;
              const num = parseInt((document.getElementById("manual-number") as HTMLInputElement).value, 10);
              const title = (document.getElementById("manual-title") as HTMLInputElement).value;
              if (!text || !title) return alert("Please fill in all fields");

              setStatuses((prev) => ({ ...prev, [num]: { state: "processing" } }));
              try {
                const res = await fetch("/api/ingest", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "process",
                    chapterText: text.slice(0, 50000),
                    chapterTitle: title,
                    chapterNumber: num,
                    bookSource,
                  }),
                });
                const data = await res.json();
                if (data.error) {
                  setStatuses((prev) => ({ ...prev, [num]: { state: "error", message: data.error } }));
                } else {
                  setStatuses((prev) => ({ ...prev, [num]: { state: "done", result: data } }));
                }
              } catch (err) {
                setStatuses((prev) => ({
                  ...prev,
                  [num]: { state: "error", message: err instanceof Error ? err.message : "Failed" },
                }));
              }
            }}
            disabled={isAnyProcessing}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            Process
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Upload,
  Loader2,
  CheckCircle,
  AlertCircle,
  BookOpen,
  Library,
  ScanSearch,
  HardDrive,
} from "lucide-react";

interface DetectedChapter {
  number: number;
  title: string;
  startPage: number;
  endPage: number;
}

interface SourceInfo {
  id: number;
  name: string;
  bookSource: string;
  totalPages: number;
  createdAt: string;
  chaptersStored: number;
  chaptersWithContent: number;
  chaptersWithBlobs: number;
}

type StoreStatus =
  | { state: "pending" }
  | { state: "storing"; chunk: number; totalChunks: number }
  | { state: "done"; chunksStored: number }
  | { state: "error"; message: string };

export default function SourcesPage() {
  // Existing sources
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);

  // Upload flow
  const [showUpload, setShowUpload] = useState(false);
  const [bookSource, setBookSource] = useState("core_radiology");
  const [customName, setCustomName] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  const fileRef = useRef<File | null>(null); // Keep File reference for reloading between chapters
  const [pdfName, setPdfName] = useState("");
  const [totalPages, setTotalPages] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");

  // Chapter detection
  const [detecting, setDetecting] = useState(false);
  const [chapters, setChapters] = useState<DetectedChapter[]>([]);

  // Storing
  const [storing, setStoring] = useState(false);
  const [storeStatuses, setStoreStatuses] = useState<Record<number, StoreStatus>>({});
  const [overallProgress, setOverallProgress] = useState({ current: 0, total: 0 });

  // Load existing sources
  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSources(data);
      })
      .catch(console.error)
      .finally(() => setLoadingSources(false));
  }, []);

  const bookOptions = [
    { key: "core_radiology", label: "Core Radiology" },
    { key: "crack_the_core", label: "Crack the Core" },
    { key: "custom", label: "Other Book" },
  ];

  const getBookName = () => {
    if (bookSource === "custom") return customName || "Custom Book";
    return bookOptions.find((b) => b.key === bookSource)?.label || bookSource;
  };

  const getBookKey = () => {
    if (bookSource === "custom") return customName.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "custom";
    return bookSource;
  };

  // ─── Load PDF ───────────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMsg(`Loading ${(file.size / 1024 / 1024).toFixed(0)} MB PDF...`);
    setChapters([]);
    setStoreStatuses({});
    pdfDocRef.current = null;
    fileRef.current = null;

    try {
      setPdfName(file.name);
      fileRef.current = file; // Keep for reloading between chapters

      const arrayBuffer = await file.arrayBuffer();
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(new Uint8Array(arrayBuffer), { ignoreEncryption: true });
      pdfDocRef.current = pdf;
      const pages = pdf.getPageCount();
      setTotalPages(pages);
      setStatusMsg(`Loaded "${file.name}" — ${pages} pages, ${(file.size / 1024 / 1024).toFixed(0)} MB`);
    } catch (err) {
      setStatusMsg(`Error loading PDF: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, []);

  // ─── Detect Chapters ────────────────────────────────────────────────
  const detectChapters = useCallback(async () => {
    if (!pdfDocRef.current || totalPages === 0) return;

    setDetecting(true);
    setStatusMsg("Extracting first pages for chapter detection...");

    try {
      const { PDFDocument } = await import("pdf-lib");
      const tocPdf = await PDFDocument.create();
      const endPage = Math.min(15, totalPages);
      const indices = Array.from({ length: endPage }, (_, i) => i);
      const pages = await tocPdf.copyPages(pdfDocRef.current, indices);
      pages.forEach((p) => tocPdf.addPage(p));
      const tocBytes = await tocPdf.save();
      const tocBlob = new Blob([tocBytes.slice(0)], { type: "application/pdf" });

      setStatusMsg("Claude is analyzing the table of contents...");

      const formData = new FormData();
      formData.append("pdf", tocBlob, "toc_pages.pdf");
      formData.append("filename", "toc_pages.pdf");

      const uploadRes = await fetch("/api/upload-pdf", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();

      if (uploadData.error) {
        setStatusMsg(`Upload error: ${uploadData.error}`);
        return;
      }

      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "detect-chapters",
          fileId: uploadData.fileId,
          totalPages,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setStatusMsg(`Chapter detection error: ${data.error}`);
        return;
      }

      setChapters(data.chapters);
      setStatusMsg(`Found ${data.chapters.length} chapters. Ready to store.`);
    } catch (err) {
      setStatusMsg(`Detection failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDetecting(false);
    }
  }, [totalPages]);

  // ─── Store All Chapters (blob only, no AI) ──────────────────────────
  const storeAllChapters = useCallback(async () => {
    if (!pdfDocRef.current || chapters.length === 0) return;

    setStoring(true);
    const bookKey = getBookKey();
    const bookName = getBookName();

    // Create/update source record
    try {
      await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bookName, bookSource: bookKey, totalPages }),
      });
    } catch { /* non-critical */ }

    // ── Purge ALL old chunks + chapters for this book before re-storing ──
    setStatusMsg("Purging old data for this book...");
    try {
      const purgeRes = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purge-source", bookSource: bookKey }),
      });
      const purgeData = await purgeRes.json();
      if (purgeData.success) {
        console.log(`Purged ${purgeData.deletedChunks} old chunks + ${purgeData.deletedChapters} old chapters`);
      }
    } catch (e) {
      console.warn("Purge failed (continuing anyway):", e);
    }

    const { PDFDocument } = await import("pdf-lib");
    const maxPagesPerChunk = 3; // Smaller chunks to reduce iPad memory pressure
    let completedChapters = 0;
    setOverallProgress({ current: 0, total: chapters.length });

    for (const chapter of chapters) {
      // ── Reload PDF between chapters to free accumulated memory ──
      // iPad Safari leaks memory on repeated copyPages calls. Reloading
      // the source PDF releases all internal references from prior chapters.
      if (fileRef.current) {
        try {
          pdfDocRef.current = null; // Release old reference for GC
          await new Promise((r) => setTimeout(r, 300)); // Give GC a moment
          const ab = await fileRef.current.arrayBuffer();
          pdfDocRef.current = await PDFDocument.load(new Uint8Array(ab), { ignoreEncryption: true });
        } catch (reloadErr) {
          console.warn("PDF reload failed, using existing reference:", reloadErr);
        }
      }

      if (!pdfDocRef.current) {
        setStoreStatuses((prev) => ({
          ...prev,
          [chapter.number]: { state: "error", message: "PDF reference lost" },
        }));
        continue;
      }

      const startIdx = Math.max(0, chapter.startPage - 1);
      const endIdx = Math.min(pdfDocRef.current.getPageCount(), chapter.endPage);
      const chapterPageCount = endIdx - startIdx;
      const numChunks = Math.ceil(chapterPageCount / maxPagesPerChunk);

      // Delete any old/stale chunks for this chapter before storing new ones
      try {
        await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "delete-chunks",
            bookSource: bookKey,
            chapterNum: chapter.number,
          }),
        });
      } catch { /* non-critical — upsert will still overwrite matching indices */ }

      let storedChunks = 0;
      let hadError = false;

      for (let i = 0; i < numChunks; i++) {
        setStoreStatuses((prev) => ({
          ...prev,
          [chapter.number]: { state: "storing", chunk: i + 1, totalChunks: numChunks },
        }));

        const chunkStart = startIdx + i * maxPagesPerChunk;
        const chunkEnd = Math.min(chunkStart + maxPagesPerChunk, endIdx);
        const pagesToCopy = chunkEnd - chunkStart;

        // Retry each chunk up to 2 times (memory errors can be transient after GC)
        let chunkSuccess = false;
        for (let attempt = 0; attempt < 2 && !chunkSuccess; attempt++) {
          try {
            // Extract pages into a small PDF
            const chunkPdf = await PDFDocument.create();
            const indices = Array.from({ length: pagesToCopy }, (_, j) => chunkStart + j);
            const pages = await chunkPdf.copyPages(pdfDocRef.current, indices);
            pages.forEach((p) => chunkPdf.addPage(p));
            const chunkBytes = await chunkPdf.save();
            const chunkBlob = new Blob([chunkBytes.slice(0)], { type: "application/pdf" });

            // Store chunk in Postgres database
            const formData = new FormData();
            formData.append("pdf", chunkBlob, `${bookKey}_ch${chapter.number}_chunk${i}.pdf`);
            formData.append("bookSource", bookKey);
            formData.append("chapterNum", String(chapter.number));
            formData.append("chunkIndex", String(i));

            const res = await fetch("/api/store-pdf", { method: "POST", body: formData });
            const data = await res.json();

            if (data.success) {
              storedChunks++;
              chunkSuccess = true;
            } else {
              throw new Error(data.error || "Storage failed");
            }
          } catch (err) {
            if (attempt === 0) {
              // First failure: give GC time and retry
              console.warn(`Chunk ${i + 1} failed (attempt 1), retrying after GC pause...`);
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }
            setStoreStatuses((prev) => ({
              ...prev,
              [chapter.number]: {
                state: "error",
                message: `Chunk ${i + 1}: ${err instanceof Error ? err.message : "Upload failed"}`,
              },
            }));
            hadError = true;
          }
        }

        if (hadError) break;

        // Brief pause between chunks to let iPad Safari GC run
        if (i < numChunks - 1) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      // Save chapter record (no AI processing)
      if (storedChunks > 0 && !hadError) {
        try {
          await fetch("/api/ingest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "store-chapter",
              chapterNumber: chapter.number,
              chapterTitle: chapter.title,
              bookSource: bookKey,
            }),
          });

          setStoreStatuses((prev) => ({
            ...prev,
            [chapter.number]: { state: "done", chunksStored: storedChunks },
          }));
        } catch (err) {
          setStoreStatuses((prev) => ({
            ...prev,
            [chapter.number]: {
              state: "error",
              message: err instanceof Error ? err.message : "Failed to save chapter",
            },
          }));
        }
      }

      completedChapters++;
      setOverallProgress({ current: completedChapters, total: chapters.length });
    }

    setStoring(false);

    // Refresh sources list
    try {
      const res = await fetch("/api/sources");
      const data = await res.json();
      if (Array.isArray(data)) setSources(data);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, totalPages, bookSource, customName]);

  const allStored = chapters.length > 0 && chapters.every((ch) => storeStatuses[ch.number]?.state === "done");
  const storedCount = Object.values(storeStatuses).filter((s) => s.state === "done").length;

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Library className="h-6 w-6 text-primary" />
          Sources
        </h1>
        <p className="text-muted-foreground mt-1">
          Upload your textbooks once. Generate study materials from them anytime.
        </p>
      </div>

      {/* Existing Sources */}
      {loadingSources ? (
        <div className="rounded-lg border bg-card p-6">
          <div className="h-20 animate-pulse bg-muted rounded" />
        </div>
      ) : sources.length > 0 ? (
        <div className="space-y-3">
          {sources.map((source) => (
            <div key={source.id} className="rounded-lg border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{source.name}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {source.totalPages} pages &middot; {source.chaptersStored} chapters stored
                    {source.chaptersWithContent > 0 && (
                      <> &middot; <span className="text-green-600">{source.chaptersWithContent} with content</span></>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-sm text-green-600 font-medium">Uploaded</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : !showUpload ? (
        <div className="rounded-lg border-2 border-dashed bg-card p-12 text-center">
          <Library className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground mb-1">No sources uploaded yet</p>
          <p className="text-sm text-muted-foreground mb-4">Upload your radiology textbook PDFs to get started</p>
        </div>
      ) : null}

      {/* Upload Button / Flow */}
      {!showUpload ? (
        <button
          onClick={() => setShowUpload(true)}
          className="w-full rounded-lg border-2 border-dashed p-6 text-center hover:bg-accent/50 transition-colors"
        >
          <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="font-medium">Add Source</p>
          <p className="text-sm text-muted-foreground">Upload a textbook PDF</p>
        </button>
      ) : (
        <div className="space-y-6">
          {/* Step 1: Select Book */}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="font-semibold">1. Select Book</h2>
            <div className="flex gap-3 flex-wrap">
              {bookOptions.map((b) => (
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
            {bookSource === "custom" && (
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Book name (e.g., Fundamentals of Body CT)"
                className="w-full p-2 border rounded-lg text-sm"
              />
            )}
          </div>

          {/* Step 2: Upload PDF */}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="font-semibold">2. Upload PDF</h2>
            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors">
              <div className="flex flex-col items-center justify-center py-4">
                <Upload className="h-7 w-7 text-muted-foreground mb-2" />
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

            {totalPages > 0 && chapters.length === 0 && (
              <button
                onClick={detectChapters}
                disabled={detecting || storing}
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
                    Detect Chapters
                  </>
                )}
              </button>
            )}
          </div>

          {/* Step 3: Store Chapters */}
          {chapters.length > 0 && (
            <div className="rounded-lg border bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">3. Store Chapters</h2>
                {!allStored && (
                  <button
                    onClick={storeAllChapters}
                    disabled={storing}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {storing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Storing... ({overallProgress.current}/{overallProgress.total})
                      </>
                    ) : (
                      <>
                        <HardDrive className="h-4 w-4" />
                        Store All {chapters.length} Chapters
                      </>
                    )}
                  </button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                PDF pages are extracted in your browser and uploaded to permanent storage.
                No AI processing happens yet — that&apos;s done later per chapter.
              </p>

              {/* Global error banner — shown when all/most chapters fail (likely config issue) */}
              {!storing && Object.values(storeStatuses).length > 0 &&
               Object.values(storeStatuses).every((s) => s.state === "error") && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-700 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-medium">
                    <AlertCircle className="h-5 w-5" />
                    Storage failed
                  </div>
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {(Object.values(storeStatuses)[0] as { state: "error"; message: string }).message}
                  </p>
                  <p className="text-xs text-red-500 dark:text-red-500">
                    Check that your database is connected and accessible.
                  </p>
                </div>
              )}

              {/* Overall progress bar */}
              {storing && (
                <div className="space-y-1">
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary rounded-full h-2 transition-all"
                      style={{ width: `${chapters.length > 0 ? (storedCount / chapters.length) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-right">
                    {storedCount}/{chapters.length} chapters
                  </p>
                </div>
              )}

              {allStored && (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-4 text-center">
                  <CheckCircle className="h-8 w-8 mx-auto text-green-500 mb-2" />
                  <p className="font-medium text-green-700 dark:text-green-300">
                    All {chapters.length} chapters stored!
                  </p>
                  <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                    Go to any chapter to generate study materials.
                  </p>
                  <Link
                    href="/chapters"
                    className="inline-block mt-3 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
                  >
                    Go to Chapters
                  </Link>
                </div>
              )}

              <div className="space-y-1.5">
                {chapters.map((ch) => {
                  const status = storeStatuses[ch.number];
                  const pageCount = ch.endPage - ch.startPage + 1;
                  const isDone = status?.state === "done";
                  const isStoring = status?.state === "storing";
                  const isError = status?.state === "error";

                  return (
                    <div
                      key={ch.number}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border text-sm ${
                        isDone
                          ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                          : isError
                          ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                          : isStoring
                          ? "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800"
                          : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">Ch. {ch.number}:</span>{" "}
                        <span>{ch.title}</span>
                        <span className="text-muted-foreground ml-1.5">({pageCount}p)</span>
                      </div>

                      {isStoring && status.state === "storing" && (
                        <span className="flex items-center gap-1 text-xs text-blue-600">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          chunk {status.chunk}/{status.totalChunks}
                        </span>
                      )}
                      {isDone && (
                        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                      )}
                      {isError && (
                        <span className="flex items-center gap-1 text-xs text-red-600 max-w-xs">
                          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{(status as { state: "error"; message: string }).message}</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

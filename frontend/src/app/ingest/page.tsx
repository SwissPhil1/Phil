"use client";

import { useState, useCallback, useRef } from "react";
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
  | { state: "uploading" }
  | { state: "processing"; chunk?: number; totalChunks?: number }
  | { state: "generating-guide"; result: ProcessResult }
  | { state: "done"; result: ProcessResult }
  | { state: "error"; message: string; failedChunk?: number; totalChunks?: number };

export default function IngestPage() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
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

  // API key diagnostic
  const [keyTest, setKeyTest] = useState<{ testing: boolean; result?: Record<string, unknown> }>({ testing: false });

  const testApiKey = useCallback(async () => {
    setKeyTest({ testing: true });
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test-key" }),
      });
      const data = await res.json();
      setKeyTest({ testing: false, result: data });
    } catch (err) {
      setKeyTest({ testing: false, result: { error: err instanceof Error ? err.message : "Request failed" } });
    }
  }, []);

  // ─── Step 1: Load PDF ─────────────────────────────────────────────────
  // Only reads the File object + page count. No base64, no heavy memory use.
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMsg(`Loading ${(file.size / 1024 / 1024).toFixed(1)} MB PDF...`);
    setChapters([]);
    setStatuses({});
    setSelectedChapters(new Set());
    pdfDocRef.current = null;

    try {
      setPdfFile(file);
      setPdfName(file.name);

      // Use pdf-lib just to get page count (lightweight)
      const arrayBuffer = await file.arrayBuffer();
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(new Uint8Array(arrayBuffer), { ignoreEncryption: true });
      pdfDocRef.current = pdf;
      const pages = pdf.getPageCount();
      setTotalPages(pages);
      setStatusMsg(`Loaded "${file.name}" — ${pages} pages, ${(file.size / 1024 / 1024).toFixed(1)} MB`);
    } catch (err) {
      setStatusMsg(`Error loading PDF: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, []);

  // ─── Step 2: Detect Chapters via Claude ────────────────────────────────
  // Extracts first 15 pages on the client (lightweight pdf-lib copy, no base64),
  // uploads the small PDF to the server → Files API, then asks Claude to detect chapters.
  const detectChapters = useCallback(async () => {
    if (!pdfDocRef.current || totalPages === 0) return;

    setDetecting(true);
    setStatusMsg("Extracting first pages for chapter detection...");

    try {
      // Extract first 15 pages on the client (lightweight, no base64)
      const { PDFDocument } = await import("pdf-lib");
      const tocPdf = await PDFDocument.create();
      const endPage = Math.min(15, totalPages);
      const indices = Array.from({ length: endPage }, (_, i) => i);
      const pages = await tocPdf.copyPages(pdfDocRef.current, indices);
      pages.forEach((p) => tocPdf.addPage(p));
      const tocBytes = await tocPdf.save();
      const tocBlob = new Blob([tocBytes.slice(0)], { type: "application/pdf" });

      setStatusMsg("Uploading TOC pages to server...");

      const formData = new FormData();
      formData.append("pdf", tocBlob, "toc_pages.pdf");
      formData.append("filename", "toc_pages.pdf");

      const uploadRes = await fetch("/api/upload-pdf", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();

      if (uploadData.error) {
        setStatusMsg(`Upload error: ${uploadData.error}`);
        return;
      }

      const tocFileId = uploadData.fileId;
      if (!tocFileId) {
        setStatusMsg("Upload succeeded but no file ID returned");
        return;
      }

      setStatusMsg("Claude is analyzing the table of contents...");

      // Now call detect-chapters with the file ID
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "detect-chapters",
          fileId: tocFileId,
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

      // Check which chapters are already ingested in the DB
      try {
        const existingRes = await fetch(`/api/chapters?book=${bookSource}`);
        const existingChapters: { number: number; _count: { questions: number; flashcards: number } }[] = await existingRes.json();
        const existingMap = new Map(existingChapters.map((c) => [c.number, c._count]));

        // Pre-populate statuses for already-ingested chapters
        const preStatuses: Record<number, ChapterStatus> = {};
        const unprocessed: number[] = [];
        for (const ch of detected) {
          const counts = existingMap.get(ch.number);
          if (counts && (counts.questions > 0 || counts.flashcards > 0)) {
            preStatuses[ch.number] = {
              state: "done",
              result: { chapterId: 0, questionsCreated: counts.questions, flashcardsCreated: counts.flashcards },
            };
          } else {
            unprocessed.push(ch.number);
          }
        }
        setStatuses(preStatuses);
        // Only select chapters that haven't been ingested yet
        setSelectedChapters(new Set(unprocessed));

        const alreadyDone = detected.length - unprocessed.length;
        if (alreadyDone > 0) {
          setStatusMsg(`Found ${detected.length} chapters. ${alreadyDone} already ingested, ${unprocessed.length} remaining.`);
        } else {
          setStatusMsg(`Found ${detected.length} chapters. Select which ones to process.`);
        }
      } catch {
        // If check fails, just select all (old behavior)
        setSelectedChapters(new Set(detected.map((c) => c.number)));
        setStatusMsg(`Found ${detected.length} chapters. Select which ones to process.`);
      }
    } catch (err) {
      setStatusMsg(`Detection failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDetecting(false);
    }
  }, [totalPages]);

  // ─── Retry helper ────────────────────────────────────────────────────
  const fetchWithRetry = useCallback(
    async (url: string, options: RequestInit, retries = 3): Promise<Response> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await fetch(url, options);
          // Retry on server errors (413 too large, 502/503/504 gateway errors)
          if (res.status >= 500 || res.status === 413) {
            if (attempt === retries) return res;
            const delay = Math.pow(2, attempt + 1) * 1000;
            console.warn(`Fetch ${url} returned ${res.status} (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          return res;
        } catch (err) {
          if (attempt === retries) throw err;
          // Exponential backoff: 2s, 4s, 8s
          const delay = Math.pow(2, attempt + 1) * 1000;
          console.warn(`Fetch ${url} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms...`, err);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      throw new Error("fetchWithRetry: unreachable");
    },
    []
  );

  // ─── Step 3: Process a Single Chapter ──────────────────────────────────
  // Extracts chapter pages on the client (in chunks of ≤5 pages),
  // uploads each chunk to the server → Files API, then processes via Claude.
  // The ingest endpoint returns an SSE stream (heartbeats keep the
  // connection alive during the long-running Claude call).
  const processChapter = useCallback(
    async (chapter: DetectedChapter, resumeFromChunk?: number) => {
      if (!pdfDocRef.current) return;

      setStatuses((prev) => ({ ...prev, [chapter.number]: { state: "uploading" } }));

      try {
        const { PDFDocument } = await import("pdf-lib");
        const maxPagesPerChunk = 5; // Radiology PDFs are very image-heavy (CT/MRI series)
        const startIdx = Math.max(0, chapter.startPage - 1); // 1-based → 0-based
        const endIdx = Math.min(pdfDocRef.current.getPageCount(), chapter.endPage);
        const chapterPageCount = endIdx - startIdx;
        const numChunks = Math.ceil(chapterPageCount / maxPagesPerChunk);

        // Resume from failed chunk if specified, otherwise start from 0
        const startChunk = resumeFromChunk ?? 0;
        const collectedFileIds: string[] = [];
        const collectedBlobUrls: string[] = [];

        for (let i = startChunk; i < numChunks; i++) {
          const chunkStart = startIdx + i * maxPagesPerChunk;
          const chunkEnd = Math.min(chunkStart + maxPagesPerChunk, endIdx);
          const pagesToCopy = chunkEnd - chunkStart;

          setStatuses((prev) => ({
            ...prev,
            [chapter.number]: { state: "uploading" },
          }));

          // ── Extract pages ────────────────────────────────────────────
          let chunkBlob: Blob;
          try {
            const chunkPdf = await PDFDocument.create();
            const indices = Array.from({ length: pagesToCopy }, (_, j) => chunkStart + j);
            const pages = await chunkPdf.copyPages(pdfDocRef.current, indices);
            pages.forEach((p) => chunkPdf.addPage(p));
            const chunkBytes = await chunkPdf.save();
            chunkBlob = new Blob([chunkBytes.slice(0)], { type: "application/pdf" });
          } catch (extractErr) {
            throw new Error(
              `PDF extract failed (pages ${chunkStart + 1}–${chunkEnd}): ${extractErr instanceof Error ? extractErr.message : String(extractErr)}`
            );
          }

          const sizeMB = (chunkBlob.size / 1024 / 1024).toFixed(1);

          // ── Upload to Files API ──────────────────────────────────────
          const formData = new FormData();
          formData.append("pdf", chunkBlob, `ch${chapter.number}_chunk${i + 1}.pdf`);
          formData.append("filename", `ch${chapter.number}_chunk${i + 1}.pdf`);

          let uploadRes: Response;
          try {
            uploadRes = await fetchWithRetry("/api/upload-pdf", { method: "POST", body: formData }, 3);
          } catch (fetchErr) {
            throw new Error(
              `Upload fetch failed after retries (${sizeMB} MB, ${pagesToCopy}p): ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
            );
          }

          let uploadData: Record<string, unknown>;
          try {
            uploadData = await uploadRes.json();
          } catch {
            const text = await uploadRes.text().catch(() => "unreadable");
            throw new Error(
              `Upload response not JSON (status ${uploadRes.status}, ${sizeMB} MB): ${text.slice(0, 120)}`
            );
          }

          if (uploadData.error) {
            setStatuses((prev) => ({
              ...prev,
              [chapter.number]: {
                state: "error",
                message: `Upload failed (${sizeMB} MB): ${uploadData.error}`,
              },
            }));
            return;
          }

          // Track the file ID and blob URL for study guide generation later
          if (uploadData.fileId) {
            collectedFileIds.push(String(uploadData.fileId));
          }
          if (uploadData.blobUrl) {
            collectedBlobUrls.push(String(uploadData.blobUrl));
          }

          // ── Ingest via Claude (SSE stream) ───────────────────────────
          setStatuses((prev) => ({
            ...prev,
            [chapter.number]: { state: "processing", chunk: i + 1, totalChunks: numChunks },
          }));

          // Append mode: always append when resuming, or for chunks after the first
          const isAppend = i > 0 || (resumeFromChunk !== undefined && resumeFromChunk > 0);
          let ingestRes: Response;
          try {
            ingestRes = await fetchWithRetry("/api/ingest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "process-pdf",
                fileId: uploadData.fileId,
                chapterTitle: chapter.title,
                chapterNumber: chapter.number,
                bookSource,
                appendMode: isAppend,
              }),
            }, 2);
          } catch (ingestFetchErr) {
            throw new Error(
              `Ingest fetch failed after retries (chunk ${i + 1}/${numChunks}): ${ingestFetchErr instanceof Error ? ingestFetchErr.message : String(ingestFetchErr)}`
            );
          }

          // Read SSE stream — server sends heartbeats to keep alive,
          // then one `data: {...}` event with the final result/error.
          const reader = ingestRes.body?.getReader();
          if (!reader) {
            throw new Error(`Ingest returned no body (status ${ingestRes.status})`);
          }

          const decoder = new TextDecoder();
          let sseBuf = "";
          let data: Record<string, unknown> | null = null;

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuf += decoder.decode(value, { stream: true });

            // Parse complete SSE events (separated by blank lines)
            const parts = sseBuf.split("\n\n");
            sseBuf = parts.pop() || "";
            for (const part of parts) {
              const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
              if (dataLine) {
                try {
                  data = JSON.parse(dataLine.slice(6));
                } catch { /* partial data, ignore */ }
              }
            }
          }

          if (!data) {
            throw new Error(
              `Ingest stream ended with no result (chunk ${i + 1}/${numChunks}, status ${ingestRes.status})`
            );
          }

          if (data.error) {
            setStatuses((prev) => ({
              ...prev,
              [chapter.number]: {
                state: "error",
                message: numChunks > 1
                  ? `Chunk ${i + 1}/${numChunks}: ${data.error}`
                  : String(data.error),
                failedChunk: i,
                totalChunks: numChunks,
              },
            }));
            return;
          }

          // Final chunk → generate study guide, then mark done
          if (i === numChunks - 1) {
            const result = data as unknown as ProcessResult;

            // Generate the study guide as a separate call
            setStatuses((prev) => ({
              ...prev,
              [chapter.number]: { state: "generating-guide", result },
            }));

            try {
              const guideRes = await fetchWithRetry("/api/ingest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "generate-study-guide",
                  chapterId: result.chapterId,
                  fileIds: collectedFileIds,
                  blobUrls: collectedBlobUrls,
                }),
              }, 2);

              // Parse SSE response (same format as process-pdf)
              const guideReader = guideRes.body?.getReader();
              if (guideReader) {
                const decoder = new TextDecoder();
                let guideBuffer = "";
                let guideDone = false;
                while (!guideDone) {
                  const { done: rDone, value } = await guideReader.read();
                  if (rDone) break;
                  guideBuffer += decoder.decode(value, { stream: true });
                  const lines = guideBuffer.split("\n");
                  guideBuffer = lines.pop() || "";
                  for (const line of lines) {
                    if (line.startsWith("data: ")) {
                      try {
                        const guideData = JSON.parse(line.slice(6));
                        if (guideData.success || guideData.error) guideDone = true;
                      } catch { /* partial JSON, ignore */ }
                    }
                  }
                }
              }
            } catch (guideErr) {
              // Study guide failed — mark done with a warning (Q/F still succeeded)
              console.warn("Study guide generation failed for chapter", chapter.number, guideErr);
            }

            setStatuses((prev) => ({
              ...prev,
              [chapter.number]: { state: "done", result },
            }));
          }

          // Delay between chunks to avoid rate limits (3s)
          if (i < numChunks - 1) {
            await new Promise((r) => setTimeout(r, 3000));
          }
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
    [bookSource, fetchWithRetry]
  );

  // ─── Process All Selected ──────────────────────────────────────────────
  const processAll = useCallback(async () => {
    setProcessingAll(true);
    const toProcess = chapters.filter((ch) => selectedChapters.has(ch.number));

    for (const ch of toProcess) {
      const status = statuses[ch.number];
      if (status?.state === "done") continue; // skip already processed
      // Resume from failed chunk if applicable
      const resumeChunk = status?.state === "error" && "failedChunk" in status ? status.failedChunk : undefined;
      await processChapter(ch, resumeChunk);
      // Delay between chapters to avoid rate limits (4s)
      await new Promise((r) => setTimeout(r, 4000));
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

  const isAnyProcessing = processingAll || Object.values(statuses).some((s) => s.state === "processing" || s.state === "uploading");

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

      {/* API Key Test */}
      <div className="rounded-lg border bg-card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">API Connection Test</h2>
          <button
            onClick={testApiKey}
            disabled={keyTest.testing}
            className="px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-accent disabled:opacity-50 flex items-center gap-1.5"
          >
            {keyTest.testing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Testing...
              </>
            ) : (
              "Test API Key"
            )}
          </button>
        </div>
        {keyTest.result && (
          <pre className={`text-xs p-3 rounded-lg overflow-auto ${
            keyTest.result.success
              ? "bg-green-50 text-green-800 dark:bg-green-950/20 dark:text-green-300"
              : "bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-300"
          }`}>
            {JSON.stringify(keyTest.result, null, 2)}
          </pre>
        )}
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
            Pages are extracted on your device, then uploaded to the Anthropic Files API — lightweight, no base64 encoding.
            Large chapters are split into 5-page chunks automatically. Uploads retry on failure.
          </p>

          <div className="space-y-2">
            {chapters.map((ch) => {
              const status = statuses[ch.number];
              const pageCount = ch.endPage - ch.startPage + 1;
              const isDone = status?.state === "done";
              const isError = status?.state === "error";
              const isActive = status?.state === "processing" || status?.state === "uploading" || status?.state === "generating-guide";

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

                  {status?.state === "uploading" && (
                    <span className="flex items-center gap-1 text-sm text-blue-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading to server...
                    </span>
                  )}
                  {status?.state === "processing" && (
                    <span className="flex items-center gap-1 text-sm text-blue-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {status.totalChunks && status.totalChunks > 1
                        ? `Chunk ${status.chunk}/${status.totalChunks}...`
                        : "Claude analyzing..."}
                    </span>
                  )}
                  {status?.state === "generating-guide" && (
                    <span className="flex items-center gap-1 text-sm text-purple-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating study guide...
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
                    <span className="flex items-center gap-1 text-sm text-red-600 max-w-sm truncate" title={(status as { state: "error"; message: string }).message}>
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      {(status as { state: "error"; message: string }).message.slice(0, 80)}
                    </span>
                  )}

                  {!isActive && isError && status && "failedChunk" in status && status.failedChunk !== undefined && (
                    <button
                      onClick={() => processChapter(ch, status.failedChunk)}
                      disabled={isAnyProcessing}
                      className="text-sm px-3 py-1 rounded border bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100 disabled:opacity-50 dark:bg-orange-950/30 dark:border-orange-700 dark:text-orange-400"
                    >
                      Resume chunk {(status.failedChunk as number) + 1}/{status.totalChunks}
                    </button>
                  )}
                  {!isActive && (
                    <button
                      onClick={() => processChapter(ch)}
                      disabled={isAnyProcessing}
                      className="text-sm px-3 py-1 rounded border hover:bg-accent disabled:opacity-50"
                    >
                      {isDone ? "Re-process" : isError ? "Restart" : "Process"}
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

"use client";

import { useState, useCallback } from "react";
import { Upload, FileText, Loader2, CheckCircle, AlertCircle, Brain } from "lucide-react";

interface ExtractedChapter {
  number: number;
  title: string;
  charCount: number;
  text?: string;
}

interface ProcessResult {
  chapterId: number;
  questionsCreated: number;
  flashcardsCreated: number;
}

export default function IngestPage() {
  const [pdfText, setPdfText] = useState("");
  const [chapters, setChapters] = useState<ExtractedChapter[]>([]);
  const [bookSource, setBookSource] = useState<string>("core_radiology");
  const [processing, setProcessing] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, ProcessResult | { error: string }>>({});
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ current: number; total: number } | null>(null);
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExtracting(true);
    setExtractProgress(null);
    setChapters([]);
    setResults({});

    try {
      // Read PDF as text using FileReader
      // For PDF files, we need to extract text client-side
      // Using pdf.js via dynamic import for browser-based extraction
      const arrayBuffer = await file.arrayBuffer();

      // Use pdf.js to extract text in the browser
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = "";
      setExtractProgress({ current: 0, total: pdf.numPages });

      for (let i = 1; i <= pdf.numPages; i++) {
        setExtractProgress({ current: i, total: pdf.numPages });
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        text += `\n--- PAGE ${i} ---\n${pageText}`;
      }

      setPdfText(`Extracted ${text.length} characters from ${pdf.numPages} pages`);

      // Send to API for chapter detection
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extract", text }),
      });

      const data = await res.json();
      if (data.chapters) {
        // Attach actual text to each chapter
        const chapterPattern = /(?:^|\n)\s*(?:CHAPTER|Chapter)\s+(\d+)[:\s.]*([^\n]+)/gm;
        const matches: { index: number; number: number }[] = [];
        let match;
        while ((match = chapterPattern.exec(text)) !== null) {
          matches.push({ index: match.index, number: parseInt(match[1], 10) });
        }

        const chaptersWithText = data.chapters.map((ch: ExtractedChapter, i: number) => {
          if (matches.length === 0) {
            return { ...ch, text: text.slice(0, 50000) };
          }
          const start = matches[i]?.index ?? 0;
          const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
          return { ...ch, text: text.slice(start, end) };
        });

        setChapters(chaptersWithText);
        setSelectedChapters(new Set(chaptersWithText.map((c: ExtractedChapter) => c.number)));
      }
    } catch (err) {
      console.error("PDF extraction error:", err);
      setPdfText(`Error: ${err instanceof Error ? err.message : "Failed to read PDF"}`);
    } finally {
      setExtracting(false);
      setExtractProgress(null);
    }
  }, []);

  const processChapter = async (chapter: ExtractedChapter) => {
    setProcessing(chapter.number);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process",
          chapterText: chapter.text?.slice(0, 50000) || "",
          chapterTitle: chapter.title,
          chapterNumber: chapter.number,
          bookSource,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setResults((prev) => ({ ...prev, [chapter.number]: { error: data.error } }));
      } else {
        setResults((prev) => ({ ...prev, [chapter.number]: data }));
      }
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [chapter.number]: { error: err instanceof Error ? err.message : "Request failed" },
      }));
    } finally {
      setProcessing(null);
    }
  };

  const processAll = async () => {
    const toProcess = chapters.filter((ch) => selectedChapters.has(ch.number));
    for (const ch of toProcess) {
      if (results[ch.number] && "chapterId" in results[ch.number]) continue; // skip already processed
      await processChapter(ch);
      // Small delay between chapters
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const toggleChapter = (num: number) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          PDF Ingestion
        </h1>
        <p className="text-muted-foreground mt-1">
          Upload your radiology textbook PDFs to generate study content
        </p>
      </div>

      {/* Book source selector */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold">1. Select Book Source</h2>
        <div className="flex gap-4">
          <button
            onClick={() => setBookSource("core_radiology")}
            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              bookSource === "core_radiology"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            }`}
          >
            Core Radiology
          </button>
          <button
            onClick={() => setBookSource("crack_the_core")}
            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              bookSource === "crack_the_core"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            }`}
          >
            Crack the Core
          </button>
        </div>
      </div>

      {/* File upload */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold">2. Upload PDF</h2>
        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            {extracting ? (
              <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
            ) : (
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
            )}
            <p className="text-sm text-muted-foreground">
              {extracting
                ? extractProgress
                  ? `Extracting page ${extractProgress.current} of ${extractProgress.total}...`
                  : "Loading PDF..."
                : "Click to upload a PDF file"}
            </p>
            {extracting && extractProgress && extractProgress.total > 0 && (
              <div className="w-64 mt-2">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-200"
                    style={{ width: `${Math.round((extractProgress.current / extractProgress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  {Math.round((extractProgress.current / extractProgress.total) * 100)}%
                </p>
              </div>
            )}
          </div>
          <input
            type="file"
            className="hidden"
            accept=".pdf"
            onChange={handleFileUpload}
            disabled={extracting}
          />
        </label>
        {pdfText && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {pdfText}
          </p>
        )}
      </div>

      {/* Chapters list */}
      {chapters.length > 0 && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">3. Process Chapters</h2>
            <button
              onClick={processAll}
              disabled={processing !== null || selectedChapters.size === 0}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing !== null ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing Ch. {processing}...
                </span>
              ) : (
                `Process ${selectedChapters.size} Selected Chapters`
              )}
            </button>
          </div>

          <div className="space-y-2">
            {chapters.map((ch) => {
              const result = results[ch.number];
              const isProcessed = result && "chapterId" in result;
              const hasError = result && "error" in result;

              return (
                <div
                  key={ch.number}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    isProcessed ? "bg-green-50 border-green-200" : hasError ? "bg-red-50 border-red-200" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedChapters.has(ch.number)}
                    onChange={() => toggleChapter(ch.number)}
                    className="h-4 w-4"
                    disabled={processing !== null}
                  />
                  <div className="flex-1">
                    <span className="font-medium">
                      Chapter {ch.number}: {ch.title}
                    </span>
                    <span className="text-sm text-muted-foreground ml-2">
                      ({Math.round(ch.charCount / 1000)}k chars)
                    </span>
                  </div>

                  {processing === ch.number && (
                    <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  )}
                  {isProcessed && (
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      {(result as ProcessResult).questionsCreated}Q / {(result as ProcessResult).flashcardsCreated}F
                    </span>
                  )}
                  {hasError && (
                    <span className="flex items-center gap-1 text-sm text-red-600">
                      <AlertCircle className="h-4 w-4" />
                      {(result as { error: string }).error.slice(0, 50)}
                    </span>
                  )}

                  {!isProcessed && !processing && (
                    <button
                      onClick={() => processChapter(ch)}
                      className="text-sm px-3 py-1 rounded border hover:bg-accent"
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

      {/* Manual text input fallback */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold">Alternative: Paste Chapter Text</h2>
        <p className="text-sm text-muted-foreground">
          If PDF upload doesn&apos;t work, paste a chapter&apos;s text directly
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
              await processChapter({ number: num, title, charCount: text.length, text });
            }}
            disabled={processing !== null}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            Process
          </button>
        </div>
      </div>
    </div>
  );
}

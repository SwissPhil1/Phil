"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Chapter {
  id: number;
  number: number;
  title: string;
  organ: string | null;
  bookSource: string;
  studyGuide: string;
}

/** Post-process HTML to add callout classes to blockquotes based on content */
function classifyCallouts(html: string): string {
  return html
    .replace(/<blockquote>/g, `<blockquote data-needs-classify="true">`)
    .replace(
      /<blockquote data-needs-classify="true">([\s\S]*?)(?=<\/blockquote>)/g,
      (_match, content: string) => {
        const text = content.replace(/<[^>]*>/g, "");
        let cls = "";
        if (text.includes("💡") || text.includes("PEARL")) cls = "callout-pearl";
        else if (text.includes("🔴") || text.includes("PITFALL") || text.includes("DANGER") || text.includes("TRAP")) cls = "callout-pitfall";
        else if (text.includes("⚡") || text.includes("HIGH YIELD")) cls = "callout-highyield";
        else if (text.includes("🧠") || text.includes("MNEMONIC")) cls = "callout-mnemonic";
        else if (text.includes("🎯") || text.includes("STOP &amp; THINK") || text.includes("STOP & THINK")) cls = "callout-think";
        else if (text.includes("✅") || text.includes("KEY POINT")) cls = "callout-keypoint";
        else if (text.includes("⚖️") || text.includes("VS:")) cls = "callout-vs";
        return `<blockquote class="${cls}">${content}`;
      }
    );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function DownloadChaptersButton() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");

  async function handleDownload() {
    setLoading(true);
    setProgress("Fetching chapters...");

    try {
      const res = await fetch("/api/chapters/download-all");
      if (!res.ok) throw new Error("Failed to fetch chapters");
      const chapters: Chapter[] = await res.json();

      if (chapters.length === 0) {
        setProgress("No chapters with study guides found");
        setLoading(false);
        return;
      }

      setProgress("Preparing printable document...");

      const { marked } = await import("marked");

      // Build HTML for each chapter
      const chaptersHtml: string[] = [];
      for (const ch of chapters) {
        const rawHtml = await marked(ch.studyGuide, { gfm: true, breaks: true });
        const styledHtml = classifyCallouts(rawHtml);
        const subtitle = [ch.organ, ch.bookSource.replace(/_/g, " ")].filter(Boolean).join(" — ");

        chaptersHtml.push(`
          <div class="chapter">
            <div class="chapter-header">
              <h1 class="chapter-title">Ch. ${ch.number}: ${escapeHtml(ch.title)}</h1>
              <div class="chapter-subtitle">${escapeHtml(subtitle)}</div>
            </div>
            ${styledHtml}
          </div>
        `);
      }

      // Open print window with all chapters
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        setProgress("Pop-up blocked — please allow pop-ups and try again");
        setLoading(false);
        return;
      }

      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>RadioRevise — All Chapters</title>
  <style>
    @media print {
      .chapter { page-break-before: always; }
      .chapter:first-child { page-break-before: avoid; }
      .no-print { display: none !important; }
      body { padding: 0; }
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      line-height: 1.65;
      color: #1a1a1a;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }

    /* Print banner */
    .print-banner {
      background: #2563eb;
      color: white;
      padding: 16px 24px;
      border-radius: 10px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .print-banner h2 { font-size: 16px; font-weight: 600; }
    .print-banner p { font-size: 12px; opacity: 0.9; }
    .print-btn {
      background: white;
      color: #2563eb;
      border: none;
      padding: 10px 24px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
    }
    .print-btn:hover { background: #f0f0f0; }

    /* Chapter styling */
    .chapter { padding-top: 8px; }
    .chapter-header { margin-bottom: 20px; padding-bottom: 14px; border-bottom: 2px solid #e5e7eb; }
    .chapter-title { font-size: 22px; font-weight: 700; margin-bottom: 4px; color: #111; }
    .chapter-subtitle { font-size: 11px; color: #6b7280; }

    h1 { font-size: 20px; font-weight: 700; margin-top: 28px; margin-bottom: 8px; }
    h2 { font-size: 17px; font-weight: 700; margin-top: 24px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid rgba(59,130,246,0.15); }
    h3 { font-size: 14px; font-weight: 600; margin-top: 18px; margin-bottom: 6px; }
    h4 { font-size: 12px; font-weight: 600; margin-top: 14px; margin-bottom: 4px; }
    p { margin-bottom: 8px; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    ul, ol { margin-left: 20px; margin-bottom: 8px; }
    li { margin-bottom: 3px; }
    a { color: #2563eb; text-decoration: underline; }
    hr { border: none; border-top: 2px dashed #d1d5db; margin: 20px 0; }
    code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 10px; font-family: monospace; }
    img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; }
    thead { background: #f9fafb; }
    th { padding: 6px 8px; text-align: left; font-weight: 600; border-bottom: 2px solid #e5e7eb; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; }

    /* Callout boxes */
    blockquote {
      border-left: 4px solid #9ca3af;
      border-radius: 0 8px 8px 0;
      padding: 10px 14px;
      margin: 12px 0;
      background: #f9fafb;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    blockquote p { margin-bottom: 4px; }
    blockquote.callout-pearl { border-left-color: #f59e0b; background: #fffbeb; }
    blockquote.callout-pearl p { color: #78350f; }
    blockquote.callout-pitfall { border-left-color: #ef4444; background: #fef2f2; }
    blockquote.callout-pitfall p { color: #7f1d1d; }
    blockquote.callout-highyield { border-left-color: #f97316; background: #fff7ed; }
    blockquote.callout-highyield p { color: #7c2d12; }
    blockquote.callout-mnemonic { border-left-color: #a855f7; background: #faf5ff; }
    blockquote.callout-mnemonic p { color: #581c87; }
    blockquote.callout-think { border-left-color: #3b82f6; background: #eff6ff; }
    blockquote.callout-think p { color: #1e3a8a; }
    blockquote.callout-keypoint { border-left-color: #10b981; background: #ecfdf5; }
    blockquote.callout-keypoint p { color: #064e3b; }
    blockquote.callout-vs { border-left-color: #6366f1; background: #eef2ff; }
    blockquote.callout-vs p { color: #312e81; }
  </style>
</head>
<body>
  <div class="no-print print-banner">
    <div>
      <h2>RadioRevise — ${chapters.length} Chapters</h2>
      <p>Use your browser's Save as PDF option for best results</p>
    </div>
    <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
  </div>
  ${chaptersHtml.join("\n")}
</body>
</html>`);

      printWindow.document.close();
      setProgress(`Done! ${chapters.length} chapters ready to print/save as PDF.`);
    } catch (err) {
      setProgress(err instanceof Error ? err.message : "Download failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={handleDownload} disabled={loading} variant="outline" className="gap-2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {loading ? "Preparing..." : "Download All Chapters (PDF)"}
      </Button>
      {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
    </div>
  );
}

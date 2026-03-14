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

/** CSS embedded in each PDF – mirrors the app's callout styling */
function getPdfStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.6;
      color: #1a1a1a;
      padding: 40px;
      max-width: 700px;
    }
    .header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e5e7eb; }
    .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .header .subtitle { font-size: 11px; color: #6b7280; }
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
    code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 10px; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10px; }
    thead { background: #f9fafb; }
    th { padding: 6px 8px; text-align: left; font-weight: 600; border-bottom: 2px solid #e5e7eb; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; }
    tr:nth-child(even) { background: #fafafa; }

    /* Callout boxes – matching the app's colored blockquotes */
    blockquote {
      border-left: 4px solid #9ca3af;
      border-radius: 0 8px 8px 0;
      padding: 10px 14px;
      margin: 12px 0;
      background: #f9fafb;
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
  `;
}

/** Post-process HTML to add callout classes to blockquotes based on content */
function classifyCallouts(html: string): string {
  return html.replace(/<blockquote>/g, (match) => {
    return `<blockquote data-needs-classify="true">`;
  }).replace(/<blockquote data-needs-classify="true">([\s\S]*?)(?=<\/blockquote>)/g, (_match, content: string) => {
    const text = content.replace(/<[^>]*>/g, ""); // strip tags to inspect text
    let cls = "";
    if (text.includes("💡") || text.includes("PEARL")) cls = "callout-pearl";
    else if (text.includes("🔴") || text.includes("PITFALL") || text.includes("DANGER") || text.includes("TRAP")) cls = "callout-pitfall";
    else if (text.includes("⚡") || text.includes("HIGH YIELD")) cls = "callout-highyield";
    else if (text.includes("🧠") || text.includes("MNEMONIC")) cls = "callout-mnemonic";
    else if (text.includes("🎯") || text.includes("STOP &amp; THINK") || text.includes("STOP & THINK")) cls = "callout-think";
    else if (text.includes("✅") || text.includes("KEY POINT")) cls = "callout-keypoint";
    else if (text.includes("⚖️") || text.includes("VS:")) cls = "callout-vs";
    return `<blockquote class="${cls}">${content}`;
  });
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

      setProgress(`Generating ${chapters.length} PDFs...`);

      // Dynamic imports to avoid loading these heavy libs on page load
      const [{ default: jsPDF }, { default: JSZip }, { marked }] = await Promise.all([
        import("jspdf"),
        import("jszip"),
        import("marked"),
      ]);

      const zip = new JSZip();

      // Create a hidden container for rendering
      const container = document.createElement("div");
      container.style.position = "absolute";
      container.style.left = "-9999px";
      container.style.top = "0";
      container.style.width = "700px"; // Fixed width for consistent rendering
      document.body.appendChild(container);

      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        setProgress(`PDF ${i + 1}/${chapters.length}: ${ch.title}`);

        // Convert markdown to HTML
        const rawHtml = await marked(ch.studyGuide, { gfm: true, breaks: true });
        const styledHtml = classifyCallouts(rawHtml);

        const subtitle = [ch.organ, ch.bookSource.replace(/_/g, " ")].filter(Boolean).join(" — ");

        // Build full HTML document
        const fullHtml = `
          <div class="header">
            <h1>${escapeHtml(ch.title)}</h1>
            <div class="subtitle">${escapeHtml(subtitle)}</div>
          </div>
          ${styledHtml}
        `;

        // Render into hidden container
        container.innerHTML = `<style>${getPdfStyles()}</style>${fullHtml}`;

        // Use jsPDF html() to render the styled HTML to PDF
        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

        await new Promise<void>((resolve) => {
          doc.html(container, {
            callback: () => resolve(),
            x: 0,
            y: 0,
            width: 170, // mm usable width (A4 = 210mm - 2*20mm margins)
            windowWidth: 700, // matches container width
            margin: [15, 20, 15, 20], // top, right, bottom, left in mm
            autoPaging: "text",
            html2canvas: {
              scale: 2, // Higher quality rendering
              useCORS: true,
              letterRendering: true,
            },
          });
        });

        // Sanitize filename
        const safeName = ch.title
          .replace(/[/\\?%*:|"<>]/g, "-")
          .replace(/\s+/g, " ")
          .trim();
        const fileName = `${String(ch.number).padStart(2, "0")} - ${safeName}.pdf`;

        zip.file(fileName, doc.output("arraybuffer"));
      }

      // Clean up
      document.body.removeChild(container);

      setProgress("Creating ZIP file...");
      const blob = await zip.generateAsync({ type: "blob" });
      // Use native browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "RadioRevise-Chapters.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setProgress(`Done! ${chapters.length} chapters downloaded.`);
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
        {loading ? "Downloading..." : "Download All Chapters (PDF)"}
      </Button>
      {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

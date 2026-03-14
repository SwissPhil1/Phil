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
      const [{ default: jsPDF }, { default: JSZip }] = await Promise.all([
        import("jspdf"),
        import("jszip"),
      ]);

      const zip = new JSZip();

      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        setProgress(`PDF ${i + 1}/${chapters.length}: ${ch.title}`);

        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        const usableWidth = pageWidth - margin * 2;
        let y = margin;

        // Title
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        const titleLines = doc.splitTextToSize(ch.title, usableWidth);
        doc.text(titleLines, margin, y);
        y += titleLines.length * 8 + 4;

        // Subtitle (organ / source)
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(120, 120, 120);
        const subtitle = [ch.organ, ch.bookSource.replace(/_/g, " ")].filter(Boolean).join(" — ");
        doc.text(subtitle, margin, y);
        y += 8;
        doc.setTextColor(0, 0, 0);

        // Separator line
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, y, pageWidth - margin, y);
        y += 8;

        // Study guide content
        const lines = ch.studyGuide.split("\n");

        for (const line of lines) {
          const trimmed = line.trimStart();

          // Detect heading levels
          const h1Match = trimmed.match(/^# (.+)/);
          const h2Match = trimmed.match(/^## (.+)/);
          const h3Match = trimmed.match(/^### (.+)/);

          if (h1Match) {
            y += 4;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            const wrapped = doc.splitTextToSize(h1Match[1], usableWidth);
            if (y + wrapped.length * 7 > pageHeight - margin) {
              doc.addPage();
              y = margin;
            }
            doc.text(wrapped, margin, y);
            y += wrapped.length * 7 + 3;
          } else if (h2Match) {
            y += 3;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(13);
            const wrapped = doc.splitTextToSize(h2Match[1], usableWidth);
            if (y + wrapped.length * 6 > pageHeight - margin) {
              doc.addPage();
              y = margin;
            }
            doc.text(wrapped, margin, y);
            y += wrapped.length * 6 + 2;
          } else if (h3Match) {
            y += 2;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            const wrapped = doc.splitTextToSize(h3Match[1], usableWidth);
            if (y + wrapped.length * 5 > pageHeight - margin) {
              doc.addPage();
              y = margin;
            }
            doc.text(wrapped, margin, y);
            y += wrapped.length * 5 + 2;
          } else if (trimmed === "" || trimmed === "---") {
            y += 3;
          } else {
            // Regular text (including bullet points)
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            const indent = trimmed.startsWith("- ") || trimmed.startsWith("• ") ? 4 : 0;
            const text = trimmed.startsWith("- ") ? "• " + trimmed.slice(2) : trimmed;
            const wrapped = doc.splitTextToSize(text, usableWidth - indent);

            for (const wLine of wrapped) {
              if (y > pageHeight - margin) {
                doc.addPage();
                y = margin;
              }
              doc.text(wLine, margin + indent, y);
              y += 4.5;
            }
          }
        }

        // Sanitize filename
        const safeName = ch.title
          .replace(/[/\\?%*:|"<>]/g, "-")
          .replace(/\s+/g, " ")
          .trim();
        const fileName = `${String(ch.number).padStart(2, "0")} - ${safeName}.pdf`;

        zip.file(fileName, doc.output("arraybuffer"));
      }

      setProgress("Creating ZIP file...");
      const blob = await zip.generateAsync({ type: "blob" });
      // Use native browser download instead of file-saver
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

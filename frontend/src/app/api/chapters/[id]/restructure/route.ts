import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  CLAUDE_MODEL,
  getClaudeClient,
  callClaudeStreamWithRetry,
} from "@/lib/claude";
import { buildRestructurePrompt } from "@/lib/restructure-prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Restructure a study guide — single-pass pipeline:
 *
 *   1. Send the study guide to Claude with the restructure prompt
 *   2. Save the result as a new chapter
 *
 * The restructure prompt includes thorough content preservation instructions.
 * The user reviews the output against the original, so automated verification
 * is unnecessary and was causing timeouts on large guides.
 *
 * For optional post-hoc verification, use the /reconcile endpoint separately.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chapterId = parseInt(id, 10);

  if (isNaN(chapterId)) {
    return NextResponse.json({ error: "Invalid chapter ID" }, { status: 400 });
  }

  let body: { language?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Default values will be used
  }
  const language = body.language || "fr";

  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  if (!chapter.studyGuide) {
    return NextResponse.json(
      { error: "No study guide exists yet. Generate one first." },
      { status: 400 }
    );
  }

  // Use SSE streaming for progress updates
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      // Heartbeat to prevent connection timeout
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 5000);

      // Guard timeout: send a proper error before Vercel kills the function
      // maxDuration is 800s, so fire at 750s to leave margin
      let guardFired = false;
      const guardTimeout = setTimeout(() => {
        guardFired = true;
        try {
          send({ error: "Restructure timed out — the study guide may be too large. Try splitting it into smaller chapters." });
          clearInterval(heartbeat);
          controller.close();
        } catch { /* stream already closed */ }
      }, 750_000);

      try {
        const client = getClaudeClient();
        const studyGuide = chapter.studyGuide!;
        const inputWords = studyGuide.split(/\s+/).length;

        // Words-to-tokens ratio for medical text with markdown/tables/callouts ≈ 1.4 tokens/word
        // Allow headroom for additions (differential tables, STOP & THINK, etc.)
        const restructureTokens = Math.min(128000, Math.max(16000, Math.round(inputWords * 1.1 * 1.4)));

        // ══════════════════════════════════════════════════════
        // Single pass: Restructure the study guide
        // ══════════════════════════════════════════════════════
        send({
          status: "restructuring",
          message: `Restructuring study guide (~${inputWords.toLocaleString()} words)...`,
        });

        const restructuredGuide = await callClaudeStreamWithRetry(
          client,
          {
            model: CLAUDE_MODEL,
            max_tokens: restructureTokens,
            messages: [{ role: "user", content: buildRestructurePrompt(studyGuide, language) }],
          },
          (charCount) => {
            const words = Math.round(charCount / 5);
            const pct = Math.min(99, Math.round((words / inputWords) * 100));
            send({
              status: "restructuring",
              message: `Restructuring... ~${words.toLocaleString()} words generated (${pct}%)`,
            });
          },
          1,       // maxRetries — conserve time budget
          90_000,  // stall timeout
          660_000, // 11 min overall timeout per attempt
        );

        // ══════════════════════════════════════════════════════
        // Save as new chapter
        // ══════════════════════════════════════════════════════
        send({ status: "saving", message: "Saving restructured study guide..." });

        const maxChapter = await prisma.chapter.findFirst({
          where: { bookSource: "notebook_import" },
          orderBy: { number: "desc" },
          select: { number: true },
        });
        const nextNumber = (maxChapter?.number ?? 0) + 1;

        const outputWords = restructuredGuide.split(/\s+/).length;
        const newChapter = await prisma.chapter.create({
          data: {
            bookSource: "notebook_import",
            number: nextNumber,
            title: `${chapter.title} restructurée`,
            organ: chapter.organ,
            studyGuide: restructuredGuide,
            summary: chapter.summary,
            sourceChapterId: chapterId,
          },
        });

        // Word count delta warning
        const wordDelta = outputWords / inputWords;
        const warning = wordDelta < 0.85
          ? ` ⚠️ Output is ${Math.round((1 - wordDelta) * 100)}% shorter — consider running Reconcile to check for missing facts.`
          : "";

        send({
          success: true,
          newChapterId: newChapter.id,
          originalChapterId: chapterId,
          message: `Study guide restructured! ${inputWords.toLocaleString()} → ${outputWords.toLocaleString()} words. New chapter: "${newChapter.title}"${warning}`,
        });
      } catch (err) {
        console.error("Restructure error:", err);
        if (!guardFired) {
          const raw = err instanceof Error ? err.message : "Restructure failed";
          const isTimeout = raw.includes("timed out") || raw.includes("stalled");
          const msg = isTimeout
            ? "Restructure timed out — the study guide may be too large. Try splitting it into smaller chapters or try again."
            : raw;
          send({ error: msg });
        }
      } finally {
        clearTimeout(guardTimeout);
        clearInterval(heartbeat);
        if (!guardFired) {
          try { controller.close(); } catch { /* already closed */ }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

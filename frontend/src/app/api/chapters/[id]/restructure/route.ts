import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  CLAUDE_MODEL,
  CLAUDE_MODEL_FAST,
  getClaudeClient,
  callClaudeStreamWithRetry,
} from "@/lib/claude";
import {
  buildExtractFactsPrompt,
  buildRestructurePrompt,
  buildVerifyPrompt,
  buildPatchPrompt,
  countFactLines,
  parseMissingFacts,
} from "@/lib/restructure-prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Restructure a study guide — Pass 1 only (extraction-first pipeline):
 *
 *   1. Extract all discrete facts into a categorized checklist
 *   2. Restructure the study guide into the target format
 *   3. Verify completeness: compare fact checklist against restructured output
 *   4. Patch any missing facts back into the restructured guide
 *
 * Steps 1 & 2 run in parallel for speed.
 * Creates a NEW chapter with the result so the user can compare.
 * Returns the factList via SSE so the frontend can forward it to the reconcile endpoint (Pass 2).
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

        // Large study guides can take 6-10 min per call to stream fully.
        // Default 5 min overall timeout is too short — increase to 11 min.
        // The 750s guard timeout protects against exceeding Vercel's maxDuration.
        const heavyCallOverallTimeout = 660_000; // 11 min per API call
        const heavyCallMaxRetries = 1; // limit retries to conserve time budget

        // Words-to-tokens ratio for medical text with markdown formatting ≈ 1.3 tokens/word
        const extractTokens = Math.min(64000, Math.max(8000, Math.round(inputWords * 1.3)));
        const restructureTokens = Math.min(128000, Math.max(16000, Math.round(inputWords * 0.85 * 1.3)));
        const verifyTokens = (factCount: number) => Math.min(32000, Math.max(4000, Math.round(factCount * 30)));
        const patchTokens = Math.min(128000, Math.max(16000, Math.round(inputWords * 0.95 * 1.3)));

        // ══════════════════════════════════════════════════════
        // Steps 1 & 2 (parallel): Extract facts + Restructure
        // ══════════════════════════════════════════════════════
        send({
          status: "extracting",
          message: "Step 1-2/4: Extracting facts & restructuring in parallel...",
        });

        const [factList, restructuredGuide] = await Promise.all([
          // Step 1: Extract facts (categorized)
          callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: extractTokens,
              messages: [{ role: "user", content: buildExtractFactsPrompt(studyGuide, language) }],
            },
            (charCount) => {
              const lines = Math.round(charCount / 40);
              send({
                status: "extracting",
                message: `Step 1/4: Extracting facts... (~${lines} facts so far)`,
              });
            },
            heavyCallMaxRetries,
            90_000,
            heavyCallOverallTimeout,
          ),
          // Step 2: Restructure
          callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: restructureTokens,
              messages: [{ role: "user", content: buildRestructurePrompt(studyGuide, language) }],
            },
            (charCount) => {
              const words = Math.round(charCount / 5);
              send({
                status: "restructuring",
                message: `Step 2/4: Restructuring... (~${words.toLocaleString()} words generated)`,
              });
            },
            heavyCallMaxRetries,
            90_000,
            heavyCallOverallTimeout,
          ),
        ]);

        const factCount = countFactLines(factList);
        send({
          status: "restructuring",
          message: `Steps 1-2 complete: ${factCount} facts extracted, guide restructured.`,
        });

        // ══════════════════════════════════════════════════════
        // Step 3: Verify completeness
        // ══════════════════════════════════════════════════════
        send({
          status: "verifying",
          message: `Step 3/4: Verifying all ${factCount} facts are present...`,
        });

        // Verification is a presence-check task — use the fast model for speed
        const verifyResult = await callClaudeStreamWithRetry(
          client,
          {
            model: CLAUDE_MODEL_FAST,
            max_tokens: verifyTokens(factCount),
            messages: [{ role: "user", content: buildVerifyPrompt(factList, restructuredGuide, language) }],
          },
          undefined,
          1,
        );

        const verifyParsed = parseMissingFacts(verifyResult);
        let finalGuide = restructuredGuide;

        if (!verifyParsed.hasMissing) {
          send({
            status: "verifying",
            message: `Step 3 complete: All ${factCount} facts preserved! No patching needed.`,
          });
        } else {
          send({
            status: "patching",
            message: `Step 4/4: Patching ${verifyParsed.missingCount} missing fact(s)...`,
          });

          // ══════════════════════════════════════════════════════
          // Step 4: Patch missing facts
          // ══════════════════════════════════════════════════════
          finalGuide = await callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: patchTokens,
              messages: [{ role: "user", content: buildPatchPrompt(restructuredGuide, verifyParsed.missingText, language) }],
            },
            (charCount) => {
              const words = Math.round(charCount / 5);
              send({
                status: "patching",
                message: `Step 4/4: Patching... (~${words.toLocaleString()} words generated)`,
              });
            },
            heavyCallMaxRetries,
            90_000,
            heavyCallOverallTimeout,
          );

          send({
            status: "patching",
            message: `Patching complete: ${verifyParsed.missingCount} missing fact(s) recovered.`,
          });
        }

        // ══════════════════════════════════════════════════════
        // Save as new chapter
        // ══════════════════════════════════════════════════════
        send({ status: "saving", message: "Saving restructured study guide as new chapter..." });

        const maxChapter = await prisma.chapter.findFirst({
          where: { bookSource: "notebook_import" },
          orderBy: { number: "desc" },
          select: { number: true },
        });
        const nextNumber = (maxChapter?.number ?? 0) + 1;

        const newChapter = await prisma.chapter.create({
          data: {
            bookSource: "notebook_import",
            number: nextNumber,
            title: `${chapter.title} restructurée`,
            organ: chapter.organ,
            studyGuide: finalGuide,
            summary: chapter.summary,
          },
        });

        const patchNote = verifyParsed.missingCount > 0
          ? ` (${verifyParsed.missingCount} missing facts recovered)`
          : " (zero-loss verified)";
        send({
          success: true,
          newChapterId: newChapter.id,
          originalChapterId: chapterId,
          factList,
          factCount,
          message: `Study guide restructured${patchNote}! New chapter created: "${newChapter.title}"`,
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

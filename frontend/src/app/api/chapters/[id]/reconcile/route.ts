import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  CLAUDE_MODEL,
  getClaudeClient,
  callClaudeStreamWithRetry,
} from "@/lib/claude";
import {
  buildExtractFactsPrompt,
  buildPass2RestructurePrompt,
  buildVerifyPrompt,
  buildPatchPrompt,
  countFactLines,
  parseMissingFacts,
  applyPatches,
} from "@/lib/reconcile-prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Reconcile a study guide against a reference — generic "compare X vs Y" tool.
 *
 * Compares the target chapter's studyGuide (Y) against a reference fact list or
 * reference text (X), finds what's missing in Y, and integrates it smartly.
 *
 * Pipeline:
 *   1. Get or extract fact list from reference
 *   2. (Optional) Polish pass: smooth integration and flow
 *   3. Verify completeness against fact list
 *   4. Patch any missing facts naturally
 *   5. Save the reconciled result
 *
 * Designed to be called after /restructure (Pass 1) but also works standalone
 * for any scenario where content fidelity needs to be verified.
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

  let body: {
    factList?: string;
    referenceText?: string;
    language?: string;
    polish?: boolean;
    saveInPlace?: boolean;
  } = {};
  try {
    body = await request.json();
  } catch {
    // Default values will be used
  }

  const {
    factList: providedFactList,
    referenceText,
    language = "fr",
    polish = true,
    saveInPlace = true,
  } = body;

  if (!providedFactList && !referenceText) {
    return NextResponse.json(
      { error: "Either factList or referenceText must be provided." },
      { status: 400 }
    );
  }

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
      let guardFired = false;
      const guardTimeout = setTimeout(() => {
        guardFired = true;
        try {
          send({ error: "Reconcile timed out — the study guide may be too large. Try again or split into smaller chapters." });
          clearInterval(heartbeat);
          controller.close();
        } catch { /* stream already closed */ }
      }, 750_000);

      try {
        const client = getClaudeClient();
        let targetText = chapter.studyGuide!;
        const inputWords = targetText.split(/\s+/).length;

        const heavyCallOverallTimeout = 660_000; // 11 min per API call
        const heavyCallMaxRetries = 1;

        // Token budgets
        const extractTokens = Math.min(64000, Math.max(8000, Math.round(inputWords * 1.3)));
        const polishTokens = Math.min(128000, Math.max(16000, Math.round(inputWords * 1.1 * 1.3)));

        // Determine total steps for progress messages
        const totalSteps = polish ? 3 : 2; // polish+verify+patch or verify+patch
        let currentStep = 0;

        // ══════════════════════════════════════════════════════
        // Step 0: Get or extract fact list
        // ══════════════════════════════════════════════════════
        let factList: string;

        if (providedFactList) {
          factList = providedFactList;
          send({
            status: "reconciling",
            message: "Using cached fact list from restructure pass...",
          });
        } else {
          currentStep++;
          send({
            status: "extracting",
            message: `Reconcile — Step ${currentStep}/${totalSteps + 1}: Extracting facts from reference...`,
          });

          factList = await callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: extractTokens,
              messages: [{ role: "user", content: buildExtractFactsPrompt(referenceText!, language) }],
            },
            (charCount) => {
              const lines = Math.round(charCount / 40);
              send({
                status: "extracting",
                message: `Reconcile — Step ${currentStep}/${totalSteps + 1}: Extracting facts... (~${lines} so far)`,
              });
            },
            heavyCallMaxRetries,
            90_000,
            heavyCallOverallTimeout,
          );
        }

        const factCount = countFactLines(factList);
        const verifyTokens = Math.min(32000, Math.max(4000, Math.round(factCount * 30)));

        // ══════════════════════════════════════════════════════
        // Step 1 (optional): Polish pass
        // ══════════════════════════════════════════════════════
        if (polish) {
          currentStep++;
          send({
            status: "polishing",
            message: `Reconcile — Step ${currentStep}/${totalSteps}: Polish pass — integrating and smoothing flow...`,
          });

          targetText = await callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: polishTokens,
              messages: [{ role: "user", content: buildPass2RestructurePrompt(targetText, language) }],
            },
            (charCount) => {
              const words = Math.round(charCount / 5);
              send({
                status: "polishing",
                message: `Reconcile — Step ${currentStep}/${totalSteps}: Polishing... (~${words.toLocaleString()} words generated)`,
              });
            },
            heavyCallMaxRetries,
            90_000,
            heavyCallOverallTimeout,
          );

          send({
            status: "polishing",
            message: `Reconcile — Step ${currentStep}/${totalSteps} complete: Guide polished.`,
          });
        }

        // ══════════════════════════════════════════════════════
        // Step 2: Verify completeness
        // ══════════════════════════════════════════════════════
        currentStep++;
        send({
          status: "verifying",
          message: `Reconcile — Step ${currentStep}/${totalSteps}: Verifying all ${factCount} facts are present...`,
        });

        // Sonnet for accuracy — reduces false positives that trigger unnecessary patching
        const verifyResult = await callClaudeStreamWithRetry(
          client,
          {
            model: CLAUDE_MODEL,
            max_tokens: verifyTokens,
            messages: [{ role: "user", content: buildVerifyPrompt(factList, targetText, language) }],
          },
          undefined,
          1,
        );

        const { hasMissing, missingText, missingCount } = parseMissingFacts(verifyResult);

        if (!hasMissing) {
          send({
            status: "verifying",
            message: `Reconcile — Step ${currentStep}/${totalSteps} complete: All ${factCount} facts preserved!`,
          });
        } else {
          // ══════════════════════════════════════════════════════
          // Step 3: Targeted patch — only generate missing content, then merge
          // ══════════════════════════════════════════════════════
          currentStep++;
          send({
            status: "patching",
            message: `Reconcile — Step ${currentStep}/${totalSteps}: Patching ${missingCount} missing fact(s)...`,
          });

          const targetedPatchTokens = Math.min(16000, Math.max(2000, Math.round(missingCount * 200)));
          const patchContent = await callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: targetedPatchTokens,
              messages: [{ role: "user", content: buildPatchPrompt(targetText, missingText, language) }],
            },
            (charCount) => {
              const facts = Math.round(charCount / 80);
              send({
                status: "patching",
                message: `Reconcile — Step ${currentStep}/${totalSteps}: Formatting ${facts} missing fact(s)...`,
              });
            },
            heavyCallMaxRetries,
            90_000,
            300_000, // targeted patch is fast — 5 min max
          );

          targetText = applyPatches(targetText, patchContent);

          send({
            status: "patching",
            message: `Patching complete: ${missingCount} missing fact(s) recovered.`,
          });
        }

        // ══════════════════════════════════════════════════════
        // Save
        // ══════════════════════════════════════════════════════
        if (saveInPlace) {
          send({ status: "saving", message: "Saving reconciled study guide..." });

          await prisma.chapter.update({
            where: { id: chapterId },
            data: { studyGuide: targetText },
          });
        }

        const patchNote = missingCount > 0
          ? ` (${missingCount} missing facts recovered)`
          : " (zero-loss verified)";
        send({
          success: true,
          chapterId,
          missingCount,
          message: `Reconcile complete${patchNote}!`,
        });
      } catch (err) {
        console.error("Reconcile error:", err);
        if (!guardFired) {
          const raw = err instanceof Error ? err.message : "Reconcile failed";
          const isTimeout = raw.includes("timed out") || raw.includes("stalled");
          const msg = isTimeout
            ? "Reconcile timed out — the study guide may be too large. Try again or split into smaller chapters."
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

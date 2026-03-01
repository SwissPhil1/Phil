import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  CLAUDE_MODEL,
  getClaudeClient,
  callClaudeStreamWithRetry,
} from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Build the prompt to transform a NotebookLM summary into a retention-optimized Q/A guide.
 */
function buildTransformPrompt(organ: string, originalText: string, language: string): string {
  // Estimate input word count to scale the output target dynamically
  const inputWordCount = originalText.split(/\s+/).length;
  // Output should be at least as long as the input, with a floor of 8000 and no hard ceiling
  const minWords = Math.max(8000, Math.round(inputWordCount * 1.2));
  const maxWords = Math.max(15000, Math.round(inputWordCount * 1.8));

  const langInstruction = language === "fr"
    ? `
═══════════════════════════════════════════════════════
LANGUAGE: FRENCH (CRITICAL)
═══════════════════════════════════════════════════════
Write the ENTIRE study guide in FRENCH. This includes:
- All questions and answers in French
- All explanations, pearls, traps, mnemonics in French
- All table headers and content in French
- The rapid-fire section and cheat sheet in French
- Keep standard medical/radiological terminology in BOTH languages where helpful:
  e.g., "Bec d'oiseau (Bird's beak)", "Signe de la coquille d'oeuf (Eggshell sign)"
- The FMH2 exam is in French — the student must learn the French terminology
- Callout labels stay as-is: PEARL, TRAP, HIGH YIELD, MNEMONIC (universally recognized)
`
    : "";

  return `You are the combined voice of:
1. A SENIOR RADIOLOGIST PROFESSOR with 30+ years of FMH2 exam question-writing experience
2. A HARVARD MEMORY SCIENCE INSTRUCTOR who specializes in medical education retention and spaced repetition

You are given a NotebookLM-generated summary about "${organ}" radiology. Your job is to transform it into a MAXIMUM RETENTION Q/A study guide.
${langInstruction}
═══════════════════════════════════════════════════════
CRITICAL: SMART FUSION — NO FACT LEFT BEHIND
═══════════════════════════════════════════════════════

The input below may contain MULTIPLE overlapping study guides covering the same organ from different angles (e.g., anatomy, benign masses, malignant masses, diffuse disease, vascular, trauma). These overlap heavily but each contains UNIQUE details the others miss.

**Your mission: SMART DEDUPLICATION**
- Do NOT repeat the same fact multiple times — merge overlapping content into ONE rich Q/A per topic
- BUT: when merging, keep the RICHEST version. If section A says "caudate drains into IVC" and section B adds "this explains Budd-Chiari sparing and compensatory hypertrophy with C/RL ratio >0.75 = 99% specific", the merged Q/A must include ALL of those details
- Organize the merged content into a logical learning flow: Anatomy → Modalities → Benign → Malignant → Diffuse/Metabolic → Vascular → Cystic → Trauma → Management → Signs & Aunt Minnies
- Cross-reference between topics to build connections (e.g., "We saw in the cirrhosis section that... this explains why HCC shows washout")
- Add COMPARISON TABLES wherever multiple entities share features (e.g., FNH vs Adenoma vs HCC table)

**The output must preserve every UNIQUE fact** from the input — no number, sign name, differential, pearl, or management point should be lost. Redundant repetitions should be merged, not deleted.

═══════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════

1. EVERY SINGLE FACT must become a Q/A pair: "### Q: [question]\\n**A:** [answer]"
2. Add HIGH YIELD markers, TRAPS, PEARLS, and MNEMONICS generously — but keep each PEARL/PITFALL concise (1-2 sentences max)
3. Add any MISSING FMH2-testable topics you notice are absent from the summary
4. Create an EXAM-DAY CHEAT SHEET in a code block at the very end
5. Verify medical accuracy — correct any errors you find
6. For EACH major pathology, add a Radiopaedia link: [Radiopaedia: PathologyName](https://radiopaedia.org/articles/pathology-name) — use the standard Radiopaedia URL format with hyphens for spaces. This gives students direct access to radiological images and cases.
7. Use these callout styles throughout:

> 💡 **PEARL:** [clinical insight]
> 🔴 **TRAP:** [common exam mistake]
> ⚡ **HIGH YIELD:** [must-know fact]
> 🧠 **MNEMONIC:** [memory aid]
> 🎯 **STOP & THINK:** [active recall question]

8. Use markdown tables for comparisons
9. Bold all classic signs and diagnosis names
10. Target: EXHAUSTIVE, ${minWords.toLocaleString()}-${maxWords.toLocaleString()} words (the input is ~${inputWordCount.toLocaleString()} words — your output must be significantly longer)

═══════════════════════════════════════════════════════
REQUIRED SECTION ORDER
═══════════════════════════════════════════════════════

Follow this skeleton for MAXIMUM understanding, learning, and retention.
Order follows: Learn → Apply → Recognize Patterns → Discriminate → Encode → Test → Review → Reference.

## 🎯 Overview & Exam Strategy
---
## 🔬 Anatomy & Normal Findings
---
## 📚 Core Pathologies — Systematic Deep Dive
(### subheading per pathology, each with Quick-Facts table, Imaging table, inline callouts, STOP & THINK, Radiopaedia link)
---
## 🔧 Imaging Protocols & Technique (if applicable)
---
## 📊 Differential Diagnosis Master Tables
(Consolidate ALL differentials into organized tables: "causes of X", lesion comparisons, imaging sign comparisons)
---
## ⚖️ "How to Tell Them Apart" — Comparison Section
---
## 🧠 Mnemonics — All in One Place
---
## ⚡ High-Yield Rapid-Fire + Active Recall Self-Test
(MERGED: quick-fire drills + deeper active recall. 50+ items for large inputs, 30+ for small ones)
---
## 📋 Pre-Exam Rapid Review Checklist
---
## EXAM-DAY CHEAT SHEET (in code block)

If content doesn't fit these sections, create ### subsections within "Core Pathologies" or add a dedicated ## section. NEVER silently drop content.

═══════════════════════════════════════════════════════
ORIGINAL NOTEBOOKLM SUMMARY (~${inputWordCount.toLocaleString()} words)
═══════════════════════════════════════════════════════

${originalText}

═══════════════════════════════════════════════════════

Transform the above into the ultimate Q/A retention guide following the section order above. Preserve EVERY fact. Do NOT wrap output in code fences — return raw markdown only.`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "transform") {
      return handleTransform(body);
    } else if (action === "list-organs") {
      return handleListOrgans();
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error: unknown) {
    console.error("Import notes error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * List all unique organs that have imported notes.
 */
async function handleListOrgans() {
  const chapters = await prisma.chapter.findMany({
    where: { bookSource: "notebook_import", organ: { not: null } },
    select: { organ: true },
    distinct: ["organ"],
    orderBy: { organ: "asc" },
  });
  const organs = chapters.map((c) => c.organ).filter(Boolean);
  return NextResponse.json({ organs });
}

/**
 * Transform a pasted NotebookLM summary into a Q/A study guide + flashcards.
 * Uses SSE streaming for progress updates.
 */
async function handleTransform(body: { organ: string; title: string; text: string; language?: string }) {
  const { organ, title, text, language = "fr" } = body;

  if (!organ || !title || !text) {
    return NextResponse.json({ error: "Missing organ, title, or text" }, { status: 400 });
  }

  // Store the readable organ name (not a slug) so it displays properly in UI
  const organDisplay = organ.trim();

  // Use SSE for progress
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      // Heartbeat to prevent proxy/gateway/browser timeouts
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch { /* controller already closed */ }
      }, 8000);

      try {
        // Step 1: Transform via Claude
        send({ status: "transforming", message: "Claude is transforming your summary into Q/A format..." });

        const client = getClaudeClient();
        // Scale max_tokens based on input size — large combined summaries need more room
        const inputWords = text.split(/\s+/).length;
        const dynamicMaxTokens = inputWords > 5000 ? 64000 : 32000;

        const studyGuide = await callClaudeStreamWithRetry(
          client,
          {
            model: CLAUDE_MODEL,
            max_tokens: dynamicMaxTokens,
            messages: [{ role: "user", content: buildTransformPrompt(organ, text, language) }],
          },
          (charCount) => {
            const words = Math.round(charCount / 5);
            send({ status: "transforming", message: `Generating study guide... (~${words.toLocaleString()} words so far)` });
          },
        );

        send({ status: "saving", message: "Saving study guide..." });

        // Step 2: Find next chapter number for notebook_import
        const maxChapter = await prisma.chapter.findFirst({
          where: { bookSource: "notebook_import" },
          orderBy: { number: "desc" },
          select: { number: true },
        });
        const nextNumber = (maxChapter?.number ?? 0) + 1;

        // Step 3: Create chapter record
        const chapter = await prisma.chapter.create({
          data: {
            bookSource: "notebook_import",
            number: nextNumber,
            title,
            organ: organDisplay,
            rawText: text,
            studyGuide,
            summary: text.substring(0, 500),
          },
        });

        // Flashcards are now generated in a separate request via /api/generate-flashcards
        // This prevents the combined pipeline from exceeding Vercel's timeout
        send({
          success: true,
          chapterId: chapter.id,
          flashcardsCreated: 0,
          message: "Study guide saved. Flashcards will be generated next.",
        });
      } catch (err) {
        console.error("Transform error:", err);
        send({ error: err instanceof Error ? err.message : "Transform failed" });
      } finally {
        clearInterval(heartbeat);
        controller.close();
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

import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getClient(): Anthropic {
  return new Anthropic();
}

/** Race a promise against a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function callClaudeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  timeoutMs = 180_000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, "Claude API call");
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      const isTimeout = apiErr.message?.includes("timed out");
      const isRetryable = isTimeout || apiErr.status === 429 || apiErr.status === 529 || (apiErr.status && apiErr.status >= 500);
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = apiErr.status === 429 ? 60000 : Math.pow(2, attempt) * 5000;
      console.warn(`Claude API error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

/**
 * Build the prompt to transform a NotebookLM summary into a retention-optimized Q/A guide.
 */
function buildTransformPrompt(organ: string, originalText: string, language: string): string {
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
RULES
═══════════════════════════════════════════════════════

1. EVERY SINGLE FACT must become a Q/A pair: "### Q: [question]\\n**A:** [answer]"
2. Add HIGH YIELD markers, TRAPS, PEARLS, and MNEMONICS generously
3. Add any MISSING FMH2-testable topics you notice are absent from the summary
4. Create a RAPID-FIRE drill section at the end (30+ items)
5. Create an EXAM-DAY CHEAT SHEET in a code block at the very end
6. Verify medical accuracy — correct any errors you find
7. Use these callout styles throughout:

> 💡 **PEARL:** [clinical insight]
> 🔴 **TRAP:** [common exam mistake]
> ⚡ **HIGH YIELD:** [must-know fact]
> 🧠 **MNEMONIC:** [memory aid]
> 🎯 **STOP & THINK:** [active recall question]

8. Use markdown tables for comparisons
9. Bold all classic signs and diagnosis names
10. Target: comprehensive, 8000-15000 words

═══════════════════════════════════════════════════════
ORIGINAL NOTEBOOKLM SUMMARY
═══════════════════════════════════════════════════════

${originalText}

═══════════════════════════════════════════════════════

Transform the above into the ultimate Q/A retention guide. Do NOT wrap output in code fences — return raw markdown only.`;
}

/**
 * Build prompt to extract flashcards from the study guide.
 */
function buildFlashcardPrompt(studyGuide: string, language: string): string {
  const langNote = language === "fr"
    ? "IMPORTANT: The study guide is in French. Write ALL flashcard front/back text in FRENCH. Keep medical terms in both languages where helpful (e.g., \"Bec d'oiseau / Bird's beak\").\n\n"
    : "";

  return `${langNote}Extract ALL Q/A pairs from this study guide and return them as a JSON array of flashcards.

Each flashcard should have:
- "front": The question (concise, exam-style)
- "back": The answer (concise but complete)
- "category": One of "anatomy", "pathology", "imaging", "differential", "mnemonic", "clinical"

Extract EVERY Q/A pair from the guide. Also extract key facts from tables, rapid-fire sections, and high-yield boxes as additional flashcards. Aim for 50-100+ flashcards.

Return ONLY a valid JSON array, no other text. Example:
[{"front":"What is the classic sign of achalasia?","back":"Bird's beak — smooth distal tapering of the esophagus","category":"pathology"}]

STUDY GUIDE:
${studyGuide}`;
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

  const organKey = organ.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_");

  // Use SSE for progress
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // Step 1: Transform via Claude
        send({ status: "transforming", message: "Claude is transforming your summary into Q/A format..." });

        const client = getClient();
        const studyGuide = await callClaudeWithRetry(async () => {
          const response = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 16000,
            messages: [{ role: "user", content: buildTransformPrompt(organ, text, language) }],
          });
          return (response.content[0] as { type: "text"; text: string }).text;
        });

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
            organ: organKey,
            rawText: text,
            studyGuide,
            summary: text.substring(0, 500),
          },
        });

        // Step 4: Generate flashcards via Claude
        send({ status: "flashcards", message: "Generating flashcards from study guide..." });

        let flashcardsCreated = 0;
        try {
          const flashcardJson = await callClaudeWithRetry(async () => {
            const response = await client.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 16000,
              messages: [{ role: "user", content: buildFlashcardPrompt(studyGuide, language) }],
            });
            return (response.content[0] as { type: "text"; text: string }).text;
          });

          // Parse flashcards — handle potential markdown wrapping
          let cleaned = flashcardJson.trim();
          if (cleaned.startsWith("```")) {
            cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
          }

          const flashcards: { front: string; back: string; category: string }[] = JSON.parse(cleaned);

          if (Array.isArray(flashcards) && flashcards.length > 0) {
            await prisma.flashcard.createMany({
              data: flashcards.map((fc) => ({
                chapterId: chapter.id,
                front: fc.front,
                back: fc.back,
                category: fc.category || "pathology",
              })),
            });
            flashcardsCreated = flashcards.length;
          }
        } catch (fcErr) {
          console.warn("Flashcard generation failed (non-fatal):", fcErr);
          send({ status: "warning", message: "Flashcard generation had issues, but study guide was saved." });
        }

        send({
          success: true,
          chapterId: chapter.id,
          flashcardsCreated,
          message: `Created study guide with ${flashcardsCreated} flashcards`,
        });
      } catch (err) {
        console.error("Transform error:", err);
        send({ error: err instanceof Error ? err.message : "Transform failed" });
      } finally {
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

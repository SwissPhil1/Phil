import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getClient(): Anthropic {
  return new Anthropic();
}

/**
 * Stream a Claude response with retry logic.
 */
async function callClaudeStreamWithRetry(
  client: Anthropic,
  params: { model: string; max_tokens: number; messages: Anthropic.Messages.MessageParam[] },
  onProgress?: (charCount: number) => void,
  maxRetries = 3,
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const stream = client.messages.stream(params);
      let text = "";
      let lastReport = 0;

      stream.on("text", (chunk) => {
        text += chunk;
        if (onProgress && text.length - lastReport > 500) {
          lastReport = text.length;
          onProgress(text.length);
        }
      });

      await stream.finalMessage();
      if (onProgress) onProgress(text.length);
      return text;
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      const isRetryable = apiErr.status === 429 || apiErr.status === 529 || (apiErr.status && apiErr.status >= 500);
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = apiErr.status === 429 ? 60000 : Math.pow(2, attempt) * 5000;
      console.warn(`Claude stream error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

function buildRestructurePrompt(studyGuide: string, language: string): string {
  const langInstruction = language === "fr"
    ? `
═══════════════════════════════════════════════════════
LANGUAGE: FRENCH (CRITICAL)
═══════════════════════════════════════════════════════
The study guide is in FRENCH. Keep it ENTIRELY in French.
- All corrections, additions, and improvements must be in French
- Keep standard medical/radiological terminology in BOTH languages where helpful:
  e.g., "Bec d'oiseau (Bird's beak)", "Signe de la coquille d'oeuf (Eggshell sign)"
- Callout labels stay as-is: PEARL, TRAP/PITFALL, HIGH YIELD, MNEMONIC (universally recognized)
`
    : "";

  return `You are the combined voice of:
1. A SENIOR RADIOLOGIST PROFESSOR with 30+ years of FMH2 exam question-writing experience
2. A HARVARD MEMORY SCIENCE INSTRUCTOR who specializes in medical education retention and spaced repetition

You are given an EXISTING study guide that may have been manually edited over time, causing inconsistencies, formatting issues, missing elements, or disorganization. Your job is to RESTRUCTURE, CORRECT, and IMPROVE it while keeping the EXACT same formatting system.
${langInstruction}
═══════════════════════════════════════════════════════
TASK: RESTRUCTURE & IMPROVE
═══════════════════════════════════════════════════════

1. **KEEP EXACTLY the same formatting system**, with:
   - The callouts: 💡 PEARL, 🔴 PITFALL/TRAP, ⚡ HIGH YIELD, 🧠 MNEMONIC, 🎯 STOP & THINK, ✅ KEY POINT, ⚖️ VS
   - Markdown tables (Quick-Facts, Imaging Appearances, Differential)
   - The Q/A format (### Q: ... / **A:** ...)
   - The standard sections (Overview, Anatomy, Core Pathologies, High-Yield Rapid-Fire, Mnemonics, Comparisons, Key Points, Pre-Exam Checklist, Active Recall, Cheat Sheet, etc.)
   - Separators ---
   - Checklists - [ ] ⚡
   - Radiopaedia links: [Radiopaedia: Name](https://radiopaedia.org/articles/name)

2. **CORRECT**:
   - Medical/radiological factual errors
   - Incorrect or imprecise radiological signs
   - Incomplete or erroneous differential diagnoses
   - Imaging appearance tables (CT, MRI, US, X-ray) — verify accuracy
   - Spelling and grammar errors
   - Formatting inconsistencies (broken tables, malformed callouts, missing emoji prefixes)

3. **IMPROVE**:
   - Add important missing facts for the FMH2 exam
   - Complete incomplete mnemonics
   - Enrich PEARLs and PITFALLs with clinical nuances
   - Add STOP & THINK questions where key concepts lack them
   - Complete comparison tables if entities are missing
   - Re-organize sections if the flow is disrupted
   - Ensure EVERY major pathology has a Quick-Facts table and Imaging Appearances table
   - Ensure ALL sections of the standard structure are present and properly ordered

4. **DO NOT**:
   - Delete any correct existing content
   - Summarize or shorten — the guide must remain EXHAUSTIVE
   - Wrap output in code fences — return raw markdown only

═══════════════════════════════════════════════════════
REQUIRED SECTION ORDER (restructure to match this if needed)
═══════════════════════════════════════════════════════

## 🎯 Overview & Exam Strategy
---
## 🔬 Anatomy & Normal Findings
---
## 📚 Core Pathologies — Systematic Deep Dive
(### subheading per pathology, each with Quick-Facts table, Imaging table, inline callouts, STOP & THINK, Radiopaedia link)
---
## ⚡ High-Yield Rapid-Fire Section
---
## 📊 Differential Diagnosis Master Tables
---
## 🧠 Mnemonics — All in One Place
---
## ⚖️ "How to Tell Them Apart" — Comparison Section
---
## 🔧 Imaging Protocols & Technique (if applicable)
---
## ✅ Key Points — All in One Place
---
## 📋 Pre-Exam Rapid Review Checklist
---
## 🎯 Active Recall Self-Test
---
## EXAM-DAY CHEAT SHEET (in code block)

═══════════════════════════════════════════════════════
STUDY GUIDE TO RESTRUCTURE
═══════════════════════════════════════════════════════

${studyGuide}

═══════════════════════════════════════════════════════

Restructure, correct, and improve the study guide above. Preserve ALL correct content. Output ONLY the restructured guide — no preamble, no wrapping code fences. Return raw markdown only.`;
}

/**
 * Restructure a study guide: correct, improve, and re-organize it.
 * Creates a NEW chapter with the restructured content so the user can compare.
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

      // Heartbeat to prevent timeout
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 8000);

      try {
        send({ status: "restructuring", message: "Claude is analyzing and restructuring the study guide..." });

        const client = getClient();

        // Scale max_tokens based on input size
        const inputWords = chapter.studyGuide!.split(/\s+/).length;
        const dynamicMaxTokens = inputWords > 8000 ? 64000 : 32000;

        const restructuredGuide = await callClaudeStreamWithRetry(
          client,
          {
            model: "claude-sonnet-4-20250514",
            max_tokens: dynamicMaxTokens,
            messages: [{ role: "user", content: buildRestructurePrompt(chapter.studyGuide!, language) }],
          },
          (charCount) => {
            const words = Math.round(charCount / 5);
            send({ status: "restructuring", message: `Restructuring... (~${words.toLocaleString()} words generated)` });
          },
        );

        send({ status: "saving", message: "Saving restructured study guide as new chapter..." });

        // Find next chapter number for notebook_import
        const maxChapter = await prisma.chapter.findFirst({
          where: { bookSource: "notebook_import" },
          orderBy: { number: "desc" },
          select: { number: true },
        });
        const nextNumber = (maxChapter?.number ?? 0) + 1;

        // Create a new chapter with the restructured content
        const newChapter = await prisma.chapter.create({
          data: {
            bookSource: "notebook_import",
            number: nextNumber,
            title: `${chapter.title} restructurée`,
            organ: chapter.organ,
            studyGuide: restructuredGuide,
            summary: chapter.summary,
          },
        });

        send({
          success: true,
          newChapterId: newChapter.id,
          originalChapterId: chapterId,
          message: `Study guide restructured! New chapter created: "${newChapter.title}"`,
        });
      } catch (err) {
        console.error("Restructure error:", err);
        send({ error: err instanceof Error ? err.message : "Restructure failed" });
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

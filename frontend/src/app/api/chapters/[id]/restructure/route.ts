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
  // Compute input metrics to enforce output completeness
  const inputWordCount = studyGuide.split(/\s+/).length;
  const qaCount = (studyGuide.match(/###\s*Q:/gi) || []).length;
  const tableCount = (studyGuide.match(/\|.*\|.*\|/g) || []).length;
  const calloutCount = (studyGuide.match(/>\s*[💡🔴⚡🧠🎯✅⚖️]/g) || []).length;
  const linkCount = (studyGuide.match(/\[Radiopaedia/gi) || []).length;
  const minOutputWords = Math.max(inputWordCount, Math.round(inputWordCount * 1.1));

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
🚨 CONTENT PRESERVATION PROTOCOL (HIGHEST PRIORITY) 🚨
═══════════════════════════════════════════════════════

This is the MOST IMPORTANT instruction. Content loss during restructuring is UNACCEPTABLE.

**BEFORE you begin writing, mentally perform this inventory of the input:**
1. Count every Q/A pair (### Q: / **A:**) — there are approximately ${qaCount} in the input
2. List every distinct pathology, syndrome, sign, entity, and classification mentioned
3. List every table and its content — there are approximately ${tableCount} table rows in the input
4. List every callout (PEARL, TRAP, HIGH YIELD, MNEMONIC, STOP & THINK, KEY POINT, VS) — there are approximately ${calloutCount}
5. List every Radiopaedia link — there are approximately ${linkCount}
6. List every numeric value, threshold, measurement, percentage, and scoring system
7. List every mnemonic, acronym, and memory aid
8. List every differential diagnosis list and comparison

**WHILE restructuring, apply these ABSOLUTE rules:**
- Every Q/A pair from the input MUST appear in the output — reorganized into the correct section, but NEVER deleted
- Every table from the input MUST be preserved (may be reformatted/enhanced, but all data rows kept)
- Every callout (PEARL, TRAP, etc.) MUST be preserved (may be moved to the appropriate section)
- Every Radiopaedia link MUST be preserved
- Every numeric value/threshold/measurement MUST be preserved exactly
- Every entity/pathology/syndrome mentioned MUST appear in the output
- If a topic doesn't fit neatly into the standard sections, create an appropriate subsection — do NOT silently drop it
- Content that appears informal or hand-written (short notes, abbreviations, incomplete sentences) must be PRESERVED and can be cleaned up, but the medical facts they contain must NOT be lost

**AFTER writing, mentally verify:**
- The output contains AT LEAST as many Q/A pairs as the input (${qaCount}+)
- No pathology, syndrome, sign, or entity from the input is missing
- All numeric values are present
- All callouts are present
- All comparison tables are present with all their rows

**OUTPUT LENGTH:** The input is ~${inputWordCount.toLocaleString()} words. Your output MUST be at least ${minOutputWords.toLocaleString()} words. If your output is shorter than the input, you have LOST content — go back and find what you dropped.

═══════════════════════════════════════════════════════
TASK: RESTRUCTURE & IMPROVE
═══════════════════════════════════════════════════════

1. **KEEP EXACTLY the same formatting system**, with:
   - The callouts: 💡 PEARL, 🔴 PITFALL/TRAP, ⚡ HIGH YIELD, 🧠 MNEMONIC, 🎯 STOP & THINK, ✅ KEY POINT, ⚖️ VS
   - Markdown tables (Quick-Facts, Imaging Appearances, Differential)
   - The Q/A format (### Q: ... / **A:** ...)
   - The standard sections (see REQUIRED SECTION ORDER below)
   - Separators ---
   - Checklists - [ ] ⚡
   - Radiopaedia links: [Radiopaedia: Name](https://radiopaedia.org/articles/name)

2. **CORRECT** (without removing the underlying content):
   - Medical/radiological factual errors — fix the fact, keep the Q/A
   - Incorrect or imprecise radiological signs — correct the description, keep the entry
   - Incomplete or erroneous differential diagnoses — fix and complete, don't delete
   - Imaging appearance tables (CT, MRI, US, X-ray) — verify accuracy, keep all rows
   - Spelling and grammar errors
   - Formatting inconsistencies (broken tables, malformed callouts, missing emoji prefixes)

3. **IMPROVE** (additive only — never remove to "improve"):
   - Add important missing facts for the FMH2 exam
   - Complete incomplete mnemonics
   - Enrich PEARLs and PITFALLs with clinical nuances
   - Add STOP & THINK questions where key concepts lack them
   - Complete comparison tables if entities are missing — add rows, never remove existing ones
   - Re-organize sections if the flow is disrupted
   - Ensure EVERY major pathology has a Quick-Facts table and Imaging Appearances table
   - Ensure ALL sections of the standard structure are present and properly ordered
   - If the input has a rapid-fire/drill section with N questions, the output must have AT LEAST N questions (add more if needed)

4. **DO NOT** (HARD RULES):
   - ❌ NEVER delete any Q/A pair, even if it seems redundant — merge content into the richer version instead
   - ❌ NEVER summarize or shorten — the guide must remain EXHAUSTIVE
   - ❌ NEVER drop a pathology, syndrome, sign, or entity that exists in the input
   - ❌ NEVER reduce the number of items in drill/rapid-fire sections
   - ❌ NEVER remove table rows or callouts
   - ❌ NEVER omit staging systems, classifications, or scoring systems present in the input
   - ❌ NEVER wrap output in code fences (except the cheat sheet) — return raw markdown only
   - ❌ NEVER write a preamble or commentary — output the guide directly

═══════════════════════════════════════════════════════
HANDLING DUPLICATES & OVERLAPPING CONTENT
═══════════════════════════════════════════════════════

The input may contain the same topic covered multiple times (e.g., two Q/As about Mirizzi syndrome). When this happens:
- MERGE into ONE comprehensive Q/A that contains ALL details from BOTH versions
- Keep the RICHEST version as the base and ADD any unique facts from the other
- If version A says "Mirizzi = calcul comprimant CHC" and version B adds "plus fréquent avec insertion basse du canal cystique, diagnostic par MRCP, traitement = cholécystectomie + exploration VB", the merged version must include ALL of these details
- Place the merged Q/A in the most appropriate section
- NEVER resolve a duplicate by simply deleting one version — always merge first

═══════════════════════════════════════════════════════
REQUIRED SECTION ORDER (restructure to match this)
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

**IMPORTANT:** If the input contains content that does not fit into any of the above sections (e.g., management/treatment details, pediatric pathologies, trauma, complications, special techniques), create an appropriate ### subsection within "Core Pathologies" or add a dedicated ## section. NEVER silently drop content because it doesn't match a predefined section.

═══════════════════════════════════════════════════════
STUDY GUIDE TO RESTRUCTURE (~${inputWordCount.toLocaleString()} words, ~${qaCount} Q/A pairs, ~${calloutCount} callouts, ~${linkCount} Radiopaedia links)
═══════════════════════════════════════════════════════

${studyGuide}

═══════════════════════════════════════════════════════

Restructure, correct, and improve the study guide above. Remember: CONTENT PRESERVATION IS YOUR #1 PRIORITY. Your output must contain every fact, Q/A, table, callout, link, and numeric value from the input — reorganized and enhanced, but NEVER deleted. Output ONLY the restructured guide — no preamble, no wrapping code fences. Return raw markdown only.`;
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

        // Scale max_tokens based on input size — output must be at least as long as input
        // ~0.75 tokens per word for French text, plus headroom for improvements
        const inputWords = chapter.studyGuide!.split(/\s+/).length;
        const estimatedOutputTokens = Math.round(inputWords * 1.3 * 0.75);
        const dynamicMaxTokens = Math.min(128000, Math.max(32000, estimatedOutputTokens));

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

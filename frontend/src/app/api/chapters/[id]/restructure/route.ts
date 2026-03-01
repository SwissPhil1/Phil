import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  CLAUDE_MODEL,
  CLAUDE_MODEL_FAST,
  getClaudeClient,
  callClaudeStreamWithRetry,
} from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

// ── Step 1: Extract all discrete facts into a flat checklist ─────────────────

function buildExtractFactsPrompt(studyGuide: string, language: string): string {
  const langNote = language === "fr"
    ? "\nThe study guide is in French. Extract facts in the same language they appear (French with English medical terms where present).\n"
    : "";

  return `You are a meticulous medical knowledge extractor. Your ONLY job is to extract EVERY discrete fact, concept, value, and relationship from the study guide below into a flat checklist.
${langNote}
RULES:
- Extract ONE fact per line in "- [ ]" format
- Each fact must be self-contained and ATOMIC (one concept per line)
- Include ALL of the following categories — miss NOTHING:
  • Named pathologies, syndromes, signs, and entities
  • Numeric values, thresholds, measurements, percentages, scoring systems
  • Associations and causal relationships (e.g., "Caroli associated with medullary sponge kidney")
  • Imaging characteristics and signs (e.g., "HCC = arterial enhancement + portal washout")
  • Differential diagnosis items
  • Mnemonics and memory aids (verbatim text)
  • Clinical pearls and pitfalls (the specific teaching point)
  • Classifications, grading, and staging systems (with their criteria)
  • Treatment/management details
  • Anatomical facts, normal variants, normal measurements
  • Radiopaedia links (preserve the URL)
  • Comparisons between entities (e.g., "FNH vs adenoma: central scar in FNH")
  • Exam strategy tips and high-yield pointers
- Do NOT summarize or paraphrase — preserve the SPECIFIC detail and values
- Do NOT group or categorize — output a FLAT list
- Do NOT skip "obvious" or "basic" facts — extract EVERYTHING
- If a Q/A pair contains multiple facts, extract EACH as a separate line
- If a table contains N data rows, extract the key fact from EACH row

OUTPUT FORMAT (nothing else):
- [ ] fact 1
- [ ] fact 2
- [ ] fact 3
...

═══════════════════════════════════════════════════════
STUDY GUIDE TO EXTRACT FROM:
═══════════════════════════════════════════════════════

${studyGuide}

═══════════════════════════════════════════════════════
Extract every discrete fact now. Output ONLY the checklist — no preamble, no commentary, no categories.`;
}

// ── Step 2: Restructure prompt (existing logic, unchanged) ──────────────────

function buildRestructurePrompt(studyGuide: string, language: string): string {
  const inputWordCount = studyGuide.split(/\s+/).length;
  const qaCount = (studyGuide.match(/###\s*Q:/gi) || []).length;
  const tableCount = (studyGuide.match(/\|.*\|.*\|/g) || []).length;
  const calloutCount = (studyGuide.match(/>\s*[💡🔴⚡🧠🎯✅⚖️]/g) || []).length;
  const linkCount = (studyGuide.match(/\[Radiopaedia/gi) || []).length;

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
- **Clinical reasoning frameworks** (🎯 STOP & THINK questions, decision trees, "ask yourself: is it mobile? is there Doppler?" approaches) are THINKING TOOLS, not just facts — preserve them as COMPLETE units with their full reasoning structure intact. Do NOT reduce them to simple facts
- **Management summary sections** (consolidated surgical indications, treatment decision tables, "drainage vs surgery" comparisons, indication lists with absolute vs relative categories) must be kept as STANDALONE units — do NOT scatter their content across individual pathology subsections. If the original groups management decisions together, keep them grouped

**AFTER writing, mentally verify:**
- Every distinct pathology, syndrome, sign, or entity from the input appears in the output
- All numeric values are present
- All callouts are present
- All comparison tables are present with all their rows

**OUTPUT LENGTH & STYLE:** The input is ~${inputWordCount.toLocaleString()} words. Your output should be MORE CONDENSED and DIRECT than the input — aim for ~70-85% of the input length. Achieve this by:
- Merging duplicate Q/A pairs into single comprehensive entries instead of keeping both
- Making answers direct and to-the-point (no filler phrases, no restating the question)
- Using tables and bullet points instead of verbose paragraphs
- Removing redundant explanations while keeping ALL medical facts and data
- Being concise does NOT mean losing content — every fact, value, and entity must still be present, just expressed more efficiently

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
   - **CONSOLIDATED DIFFERENTIAL TABLES (CRITICAL):** For the "📊 Differential Diagnosis Master Tables" section, you MUST generate comprehensive consolidated differential tables — even if the original does NOT have them organized this way. Scan the ENTIRE guide and extract every differential diagnosis point into organized, exam-ready tables. Differentials to consolidate include:
     • "Causes of X" tables (e.g., causes of gallbladder wall thickening, causes of biliary strictures, causes of intrahepatic duct dilatation)
     • Lesion comparison tables (e.g., intravesicular masses: mobility, Doppler, shadow type, size thresholds)
     • Imaging sign comparison tables (e.g., acoustic shadow types: clean vs dirty vs comet-tail vs absent)
     • Any recurring differential mentioned across multiple Q/As that would benefit from side-by-side consolidation
     A student should be able to use this section ALONE to review ALL differentials for the topic. This section adds significant learning value and should be thorough

4. **DO NOT** (HARD RULES):
   - ❌ NEVER drop a pathology, syndrome, sign, or entity that exists in the input
   - ❌ NEVER remove table rows or callouts
   - ❌ NEVER omit staging systems, classifications, or scoring systems present in the input
   - ❌ NEVER wrap output in code fences (except the cheat sheet) — return raw markdown only
   - ❌ NEVER write a preamble or commentary — output the guide directly
   - ✅ DO merge duplicate/redundant Q/A pairs into single comprehensive entries
   - ✅ DO condense verbose answers into direct, fact-dense responses
   - ✅ DO prefer tables and bullets over long paragraphs

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
(MUST be comprehensive. Consolidate ALL differentials from the chapter into organized tables: "causes of X", lesion comparisons, imaging sign comparisons. Generate these even if not explicitly organized this way in the input. This section should be usable as a standalone differential review)
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

// ── Step 3: Verify completeness of restructured guide against fact list ──────

function buildVerifyPrompt(factList: string, restructuredText: string, language: string): string {
  const langNote = language === "fr"
    ? "\nBoth the fact list and the restructured guide are in French. Compare semantic content regardless of exact wording.\n"
    : "";

  return `You are a meticulous medical content auditor. Your ONLY job is to verify that EVERY fact from the extraction checklist appears in the restructured study guide.
${langNote}
VERIFICATION RULES:
- A fact is PRESENT if its core medical content appears ANYWHERE in the restructured guide — it may be:
  • Reworded or paraphrased (as long as the specific value/concept is preserved)
  • Merged into a larger answer or table row
  • Moved to a different section
  • Expressed as part of a comparison or differential
  As long as the SPECIFIC medical information is findable, mark it as present.

- A fact is MISSING if:
  • The specific numeric value, threshold, or measurement cannot be found
  • The specific association/relationship is not mentioned anywhere
  • The entity/pathology/sign is not referenced at all
  • A mnemonic's exact content is absent
  • A Radiopaedia link URL is gone

- Be GENEROUS with "present" — if the information is there in ANY form, it counts
- Be STRICT about genuinely absent information — specific numbers, specific associations, specific entities

OUTPUT FORMAT:
If ALL facts are present, output EXACTLY this line and nothing else:
ALL_FACTS_PRESENT

If ANY facts are missing, output in this EXACT format:
MISSING_FACTS:
- missing fact 1
- missing fact 2
- missing fact 3

Do NOT include facts that ARE present. ONLY list what is genuinely MISSING.
Do NOT add commentary, explanations, or section headers — just the list.

═══════════════════════════════════════════════════════
FACT CHECKLIST (extracted from the original):
═══════════════════════════════════════════════════════

${factList}

═══════════════════════════════════════════════════════
RESTRUCTURED GUIDE (to verify against):
═══════════════════════════════════════════════════════

${restructuredText}

═══════════════════════════════════════════════════════
Now verify each fact. Output ONLY the result in the format specified above.`;
}

// ── Step 4: Patch missing facts into the restructured guide ─────────────────

function buildPatchPrompt(restructuredText: string, missingFacts: string, language: string): string {
  const langNote = language === "fr"
    ? "\nThe guide is in French. Keep all insertions in French with bilingual medical terms where appropriate.\n"
    : "";

  return `You are a medical study guide editor. The restructured guide below is MISSING some facts that were in the original. Your job is to INSERT these missing facts into the most logical locations.
${langNote}
RULES:
- INSERT each missing fact into the MOST APPROPRIATE existing section of the guide
- Use the SAME formatting system as the rest of the guide:
  • Q/A pairs: ### Q: ... / **A:** ...
  • Callouts: 💡 PEARL, 🔴 PITFALL/TRAP, ⚡ HIGH YIELD, 🧠 MNEMONIC, 🎯 STOP & THINK, ✅ KEY POINT
  • Markdown tables where appropriate
  • Radiopaedia links: [Radiopaedia: Name](URL)
- If a missing fact naturally ENRICHES an existing Q/A answer, add it to that answer
- If a missing fact is a standalone concept, create a new Q/A pair or callout
- If a missing fact belongs in the checklist section, add it there
- Do NOT remove, reword, modify, or reorder ANY existing content — ONLY ADD
- Do NOT change the structure or formatting of existing content
- Output the COMPLETE guide with all missing facts integrated

MISSING FACTS TO INSERT:
${missingFacts}

═══════════════════════════════════════════════════════
RESTRUCTURED GUIDE (insert missing facts into this):
═══════════════════════════════════════════════════════

${restructuredText}

═══════════════════════════════════════════════════════
Output the COMPLETE guide with all missing facts inserted. No preamble, no commentary, no code fences — raw markdown only.`;
}

// ── Helper: count fact lines in extraction output ───────────────────────────

function countFactLines(text: string): number {
  return text.split("\n").filter(l => l.trim().startsWith("- [ ]") || l.trim().startsWith("- [x]")).length;
}

// ── Helper: parse missing facts from verify output ──────────────────────────

function parseMissingFacts(verifyResult: string): { hasMissing: boolean; missingText: string; missingCount: number } {
  const trimmed = verifyResult.trim();
  if (trimmed.startsWith("ALL_FACTS_PRESENT")) {
    return { hasMissing: false, missingText: "", missingCount: 0 };
  }
  const missingText = trimmed.replace(/^MISSING_FACTS:\s*/i, "").trim();
  const missingCount = missingText.split("\n").filter(l => l.trim().startsWith("-")).length;
  return { hasMissing: missingCount > 0, missingText, missingCount };
}

/**
 * Restructure a study guide using a 4-step extraction-first pipeline:
 *   1. Extract all discrete facts into a flat checklist
 *   2. Restructure the study guide into the target format
 *   3. Verify completeness: compare fact checklist against restructured output
 *   4. Patch any missing facts back into the restructured guide
 *
 * Steps 1 & 2 run in parallel for speed.
 * Creates a NEW chapter with the final result so the user can compare.
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

        // ══════════════════════════════════════════════════════
        // STEPS 1 & 2 (parallel): Extract facts + Restructure
        // ══════════════════════════════════════════════════════
        send({
          status: "extracting",
          message: "Steps 1-2/4: Extracting facts & restructuring in parallel...",
        });

        const extractTokens = Math.min(64000, Math.max(8000, Math.round(inputWords * 0.75)));
        const restructureTokens = Math.min(128000, Math.max(16000, Math.round(inputWords * 0.85 * 0.75)));

        const [factList, restructuredGuide] = await Promise.all([
          // Step 1: Extract facts
          callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: extractTokens,
              messages: [{ role: "user", content: buildExtractFactsPrompt(studyGuide, language) }],
            },
            (charCount) => {
              const lines = Math.round(charCount / 40); // rough estimate: ~40 chars per fact line
              send({
                status: "extracting",
                message: `Step 1/4: Extracting facts... (~${lines} facts so far)`,
              });
            },
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
          ),
        ]);

        const factCount = countFactLines(factList);
        send({
          status: "restructuring",
          message: `Steps 1-2/4 complete: ${factCount} facts extracted, guide restructured.`,
        });

        // ══════════════════════════════════════════════════════
        // STEP 3: Verify completeness
        // ══════════════════════════════════════════════════════
        send({
          status: "verifying",
          message: `Step 3/4: Verifying all ${factCount} facts are present in restructured guide...`,
        });

        const verifyTokens = Math.min(32000, Math.max(4000, Math.round(factCount * 30)));
        const verifyResult = await callClaudeStreamWithRetry(
          client,
          {
            model: CLAUDE_MODEL_FAST,
            max_tokens: verifyTokens,
            messages: [{ role: "user", content: buildVerifyPrompt(factList, restructuredGuide, language) }],
          },
          undefined,
          1, // fewer retries for verification to save time
        );

        const { hasMissing, missingText, missingCount } = parseMissingFacts(verifyResult);

        let finalGuide = restructuredGuide;

        if (!hasMissing) {
          send({
            status: "verifying",
            message: `Step 3/4 complete: All ${factCount} facts preserved! No patching needed.`,
          });
        } else {
          send({
            status: "verifying",
            message: `Step 3/4 complete: ${missingCount} missing fact(s) detected. Patching...`,
          });

          // ══════════════════════════════════════════════════════
          // STEP 4: Patch missing facts
          // ══════════════════════════════════════════════════════
          send({
            status: "patching",
            message: `Step 4/4: Inserting ${missingCount} missing fact(s) into the restructured guide...`,
          });

          const patchTokens = Math.min(128000, Math.max(16000, Math.round(inputWords * 0.90 * 0.75)));
          finalGuide = await callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: patchTokens,
              messages: [{ role: "user", content: buildPatchPrompt(restructuredGuide, missingText, language) }],
            },
            (charCount) => {
              const words = Math.round(charCount / 5);
              send({
                status: "patching",
                message: `Step 4/4: Patching... (~${words.toLocaleString()} words generated)`,
              });
            },
          );

          send({
            status: "patching",
            message: `Step 4/4 complete: ${missingCount} missing fact(s) inserted.`,
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

        const patchNote = hasMissing ? ` (${missingCount} missing facts recovered)` : " (zero-loss)";
        send({
          success: true,
          newChapterId: newChapter.id,
          originalChapterId: chapterId,
          message: `Study guide restructured${patchNote}! New chapter created: "${newChapter.title}"`,
        });
      } catch (err) {
        console.error("Restructure error:", err);
        if (!guardFired) {
          const msg = err instanceof Error ? err.message : "Restructure failed";
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

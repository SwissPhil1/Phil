/**
 * Shared prompt builders and helpers for study guide restructuring and reconciliation.
 * Used by both /api/chapters/[id]/restructure and /api/chapters/[id]/reconcile.
 */

// ── Step 1: Extract all discrete facts into a flat checklist ─────────────────

export function buildExtractFactsPrompt(studyGuide: string, language: string): string {
  const langNote = language === "fr"
    ? "\nThe study guide is in French. Extract facts in the same language they appear (French with English medical terms where present).\n"
    : "";

  return `You are a meticulous medical knowledge extractor. Your ONLY job is to extract EVERY discrete fact, concept, value, and relationship from the study guide below into a CATEGORIZED checklist.
${langNote}
RULES:
- Extract ONE fact per line in "- [ ]" format
- Each fact must be self-contained and ATOMIC (one concept per line)
- CATEGORIZE facts under the headings below — this enables precise verification later
- Do NOT summarize or paraphrase — preserve the SPECIFIC detail and values
- Do NOT skip "obvious" or "basic" facts — extract EVERYTHING
- If a Q/A pair contains multiple facts, extract EACH as a separate line
- If a table contains N data rows, extract the key fact from EACH row

OUTPUT FORMAT — use EXACTLY these category headings:

## ANATOMY & NORMAL VALUES
(Normal anatomy, normal variants, normal measurements, embryology)
- [ ] fact
- [ ] fact

## NUMERIC VALUES & THRESHOLDS
(Measurements, percentages, scoring systems, size cutoffs, pressure values)
- [ ] fact
- [ ] fact

## NAMED SIGNS & IMAGING APPEARANCES
(Classic signs, imaging characteristics by modality, appearance descriptors)
- [ ] fact
- [ ] fact

## PATHOLOGIES & SYNDROMES
(Named diseases, syndromes, entities — what they are, their pathophysiology)
- [ ] fact
- [ ] fact

## ASSOCIATIONS & CAUSAL RELATIONSHIPS
(X causes Y, X is associated with Y, X increases risk of Y)
- [ ] fact
- [ ] fact

## DIFFERENTIAL DIAGNOSIS
(DDx lists, "causes of X", distinguishing features between entities)
- [ ] fact
- [ ] fact

## CLASSIFICATIONS, GRADING & STAGING
(Staging systems, grading criteria, classification schemes with their criteria)
- [ ] fact
- [ ] fact

## MANAGEMENT & TREATMENT
(Surgical indications, treatment options, drainage vs surgery, follow-up)
- [ ] fact
- [ ] fact

## MNEMONICS & MEMORY AIDS
(Verbatim mnemonic text, acronyms, memory hooks — preserve exact wording)
- [ ] fact
- [ ] fact

## CLINICAL PEARLS & PITFALLS
(Teaching points, exam traps, common mistakes, clinical reasoning tips)
- [ ] fact
- [ ] fact

## RADIOPAEDIA LINKS
(Preserve each URL exactly)
- [ ] fact
- [ ] fact

## COMPARISONS & "HOW TO TELL APART"
(Side-by-side comparisons, distinguishing features, VS tables)
- [ ] fact
- [ ] fact

## EXAM STRATEGY & HIGH-YIELD POINTERS
(Exam tips, high-yield markers, "always think of X when you see Y")
- [ ] fact
- [ ] fact

═══════════════════════════════════════════════════════
STUDY GUIDE TO EXTRACT FROM:
═══════════════════════════════════════════════════════

${studyGuide}

═══════════════════════════════════════════════════════
Extract every discrete fact now. Output ONLY the categorized checklist — no preamble, no commentary outside the category headings.`;
}

// ── Step 2: Restructure prompt ──────────────────────────────────────────────

export function buildRestructurePrompt(studyGuide: string, language: string): string {
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
   - Enrich PEARLs and PITFALLs with clinical nuances — but keep each PEARL/PITFALL concise (1-2 sentences max, do NOT expand into paragraphs)
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

This skeleton is designed for MAXIMUM understanding, learning, and retention.
The order follows a learning-science progression: Learn → Apply → Recognize Patterns → Discriminate → Encode → Test → Review → Reference.

## 🎯 Overview & Exam Strategy
(Schema activation: what this chapter covers, exam weight, approach)
---
## 🔬 Anatomy & Normal Findings
(Foundation: build the baseline before pathology)
---
## 📚 Core Pathologies — Systematic Deep Dive
(### subheading per pathology, each with Quick-Facts table, Imaging table, inline callouts, STOP & THINK, Radiopaedia link)
---
## 🔧 Imaging Protocols & Technique (if applicable)
(Practical application: what to order and how — applies knowledge from core pathologies)
---
## 📊 Differential Diagnosis Master Tables
(Pattern recognition: consolidate ALL differentials from the chapter into organized tables — "causes of X", lesion comparisons, imaging sign comparisons. Generate these even if not explicitly organized this way in the input. This section should be usable as a standalone differential review)
---
## ⚖️ "How to Tell Them Apart" — Comparison Section
(Discrimination learning: side-by-side entities that get confused on exam)
---
## 🧠 Mnemonics — All in One Place
(Memory encoding: comes AFTER comparisons so it encodes what was just compared)
---
## ⚡ High-Yield Rapid-Fire + Active Recall Self-Test
(MERGED testing section: quick-fire pattern → answer drills + deeper active recall questions together. If the input has separate rapid-fire and self-test sections, MERGE them here. The output must have AT LEAST as many items as the input had across both sections combined)
---
## 📋 Pre-Exam Rapid Review Checklist
(Systematic "have I seen everything?" checklist format)
---
## EXAM-DAY CHEAT SHEET (in code block)
(Final reference: fits on one screen, the distilled essence)

**IMPORTANT:** If the input contains content that does not fit into any of the above sections (e.g., management/treatment details, pediatric pathologies, trauma, complications, special techniques), create an appropriate ### subsection within "Core Pathologies" or add a dedicated ## section. NEVER silently drop content because it doesn't match a predefined section.

═══════════════════════════════════════════════════════
STUDY GUIDE TO RESTRUCTURE (~${inputWordCount.toLocaleString()} words, ~${qaCount} Q/A pairs, ~${calloutCount} callouts, ~${linkCount} Radiopaedia links)
═══════════════════════════════════════════════════════

${studyGuide}

═══════════════════════════════════════════════════════

Restructure, correct, and improve the study guide above. Remember: CONTENT PRESERVATION IS YOUR #1 PRIORITY. Your output must contain every fact, Q/A, table, callout, link, and numeric value from the input — reorganized and enhanced, but NEVER deleted. Output ONLY the restructured guide — no preamble, no wrapping code fences. Return raw markdown only.`;
}

// ── Step 3: Verify completeness of restructured guide against fact list ──────

export function buildVerifyPrompt(factList: string, restructuredText: string, language: string): string {
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

export function buildPatchPrompt(restructuredText: string, missingFacts: string, language: string): string {
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

// ── Pass 2 restructure prompt: polish pass for natural integration ───────────

export function buildPass2RestructurePrompt(studyGuide: string, language: string): string {
  const inputWordCount = studyGuide.split(/\s+/).length;

  const langInstruction = language === "fr"
    ? `
═══════════════════════════════════════════════════════
LANGUAGE: FRENCH (CRITICAL)
═══════════════════════════════════════════════════════
The study guide is in FRENCH. Keep it ENTIRELY in French.
- Keep standard medical/radiological terminology in BOTH languages where helpful
- Callout labels stay as-is: PEARL, TRAP/PITFALL, HIGH YIELD, MNEMONIC
`
    : "";

  return `You are the combined voice of:
1. A SENIOR RADIOLOGIST PROFESSOR with 30+ years of FMH2 exam question-writing experience
2. A HARVARD MEMORY SCIENCE INSTRUCTOR who specializes in medical education retention
${langInstruction}
═══════════════════════════════════════════════════════
TASK: POLISH PASS (Pass 2 of 2)
═══════════════════════════════════════════════════════

This study guide has ALREADY been restructured and had missing facts patched back in. However, the patched facts may feel "bolted on" rather than naturally integrated. Your job is to do a POLISH PASS:

1. **INTEGRATE** patched facts naturally into the flow — move them to the right location, merge them into existing Q/As where appropriate
2. **SMOOTH** transitions between sections — ensure logical flow within each section
3. **FIX** any formatting inconsistencies (broken tables, mismatched callout styles, orphaned content)
4. **DEDUPLICATE** — if the same fact now appears twice (once from original restructure, once from patching), merge into one comprehensive entry
5. **VERIFY** the section order matches the required skeleton below

**ABSOLUTE RULES:**
- ❌ NEVER remove ANY fact, Q/A, table, callout, link, or numeric value
- ❌ NEVER change the medical content of any fact
- ✅ DO move content to better locations within the guide
- ✅ DO merge duplicate entries into single comprehensive ones
- ✅ DO fix formatting and improve flow
- ✅ DO keep PEARLs and PITFALLs concise (1-2 sentences max)

**OUTPUT LENGTH:** The output should be ~${inputWordCount.toLocaleString()} words (same as input, ±10%). This is a polish, not a condensation or expansion.

═══════════════════════════════════════════════════════
REQUIRED SECTION ORDER
═══════════════════════════════════════════════════════

## 🎯 Overview & Exam Strategy
---
## 🔬 Anatomy & Normal Findings
---
## 📚 Core Pathologies — Systematic Deep Dive
---
## 🔧 Imaging Protocols & Technique (if applicable)
---
## 📊 Differential Diagnosis Master Tables
---
## ⚖️ "How to Tell Them Apart" — Comparison Section
---
## 🧠 Mnemonics — All in One Place
---
## ⚡ High-Yield Rapid-Fire + Active Recall Self-Test
---
## 📋 Pre-Exam Rapid Review Checklist
---
## EXAM-DAY CHEAT SHEET (in code block)

═══════════════════════════════════════════════════════
STUDY GUIDE TO POLISH (~${inputWordCount.toLocaleString()} words)
═══════════════════════════════════════════════════════

${studyGuide}

═══════════════════════════════════════════════════════
Polish the guide above. Output ONLY the polished guide — no preamble, no code fences. Raw markdown only.`;
}

// ── Helper: count fact lines in extraction output ───────────────────────────

export function countFactLines(text: string): number {
  return text.split("\n").filter(l => l.trim().startsWith("- [ ]") || l.trim().startsWith("- [x]")).length;
}

// ── Helper: parse missing facts from verify output ──────────────────────────

export function parseMissingFacts(verifyResult: string): { hasMissing: boolean; missingText: string; missingCount: number } {
  const trimmed = verifyResult.trim();
  if (trimmed.startsWith("ALL_FACTS_PRESENT")) {
    return { hasMissing: false, missingText: "", missingCount: 0 };
  }
  const missingText = trimmed.replace(/^MISSING_FACTS:\s*/i, "").trim();
  const missingCount = missingText.split("\n").filter(l => l.trim().startsWith("-")).length;
  return { hasMissing: missingCount > 0, missingText, missingCount };
}

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

// ── Step 2: Restructure prompt (simplified — 5 clear rules, no contradictions) ──

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

You are given an EXISTING study guide to RESTRUCTURE. Reorganize it for maximum comprehension, learning, and long-term retention.
${langInstruction}
═══════════════════════════════════════════════════════
5 RULES (follow ALL of them strictly)
═══════════════════════════════════════════════════════

**RULE 1 — ZERO FACT LOSS**
Every medical fact, numeric value, sign, pathology, mnemonic, Radiopaedia link, and callout from the input MUST appear in the output. When the input has duplicate Q/As on the same topic, MERGE them into ONE comprehensive Q/A (keep the richest version, add unique details from the other). Correct factual errors. Add important missing FMH2-testable facts.

Input stats: ~${qaCount} Q/A pairs, ~${calloutCount} callouts, ~${linkCount} Radiopaedia links, ~${tableCount} table rows.

**RULE 2 — EACH CONCEPT HAS ONE HOME + ONE RECALL MAX**
This is the anti-repetition rule. Each concept appears in exactly 2 places:

| Place | Role | Format |
|-------|------|--------|
| **HOME** | Full explanation | Q/A in Core Pathologies, Anatomy, or a Comparison table |
| **RECALL** | Short drill (pick ONE) | Rapid-Fire (1-line Q/A) OR Differential table OR Cheat Sheet |

What each zone does (and does NOT do):
- **Quick-Facts table** (top of each pathology): ONLY numbers, names, and 3-word identifiers. NOT a summary of the Q/A below it. Max 5 rows per pathology.
- **Rapid-Fire**: Reformulated 1-line drills. Do NOT copy-paste from the detailed Q/As — rephrase as a quick-fire question.
- **Checklist**: Topic tracker ONLY. Format: "- [ ] Topic name" — no facts, no numbers, no explanations embedded.
- **Cheat Sheet**: Max 30 lines in a code block. Only what you'd forget under exam stress. "keyword = keyword" format.

FORBIDDEN: same fact in Q/A + Quick-Facts + Rapid-Fire + Checklist + Cheat Sheet. If it's well-drilled in Rapid-Fire, it does NOT go in Cheat Sheet.

**RULE 3 — PRESERVE FORMAT**
- Q/A: ### Q: [question] / **A:** [answer]
- Callouts: > 💡 **PEARL**, > 🔴 **TRAP/PITFALL**, > ⚡ **HIGH YIELD**, > 🧠 **MNEMONIC**, > 🎯 **STOP & THINK**, > ✅ **KEY POINT**
- Markdown tables for Quick-Facts, Imaging, Comparisons, Differentials
- Radiopaedia links per major pathology: [Radiopaedia: Name](URL)
- Section separators: ---
- PEARLs and PITFALLs: 1-2 sentences max each
- Clinical reasoning frameworks (STOP & THINK, decision trees) = preserve as complete units
- Management summary sections = keep grouped, do NOT scatter across pathologies

**RULE 4 — CONSOLIDATED DIFFERENTIALS**
For the "📊 Differential Diagnosis Master Tables" section: scan the ENTIRE guide, extract EVERY differential point, and consolidate into organized tables:
- "Causes of X" tables
- Lesion comparison tables
- Imaging sign comparison tables
Generate these even if the input doesn't have them organized this way. A student must be able to review ALL differentials from this section alone.

**RULE 5 — NEVER DO THESE**
- ❌ Convert Q/A to narrative text (Q/A forces active recall; narrative is passive)
- ❌ Wrap output in code fences (except the Cheat Sheet)
- ❌ Write a preamble or commentary
- ❌ Silently drop content that doesn't fit a section (create a subsection instead)
- ❌ Expand PEARLs/PITFALLs into paragraphs

═══════════════════════════════════════════════════════
REQUIRED SECTION ORDER
═══════════════════════════════════════════════════════

## 🎯 Overview & Exam Strategy
---
## 🔬 Anatomy & Normal Findings
---
## 📚 Core Pathologies — Systematic Deep Dive
(### per pathology: Quick-Facts table [max 5 rows, numbers/names only] + Imaging table + Q/A + callouts + STOP & THINK + Radiopaedia link)
---
## 🔧 Imaging Protocols & Technique (if applicable)
---
## 📊 Differential Diagnosis Master Tables
(ALL differentials consolidated — usable standalone for review)
---
## ⚖️ "How to Tell Them Apart" — Comparison Section
---
## 🧠 Mnemonics — All in One Place
---
## ⚡ High-Yield Rapid-Fire + Active Recall Self-Test
(1-line Q/A drills, reformulated — NOT copied from detailed Q/As. At least as many items as the input)
---
## 📋 Pre-Exam Rapid Review Checklist
(TOPICS ONLY: "- [ ] Topic name" — no facts embedded)
---
## EXAM-DAY CHEAT SHEET (code block, max 30 lines)
(keyword = keyword format. Only what you'd forget under exam stress. Do NOT repeat Rapid-Fire content)

═══════════════════════════════════════════════════════
STUDY GUIDE TO RESTRUCTURE (~${inputWordCount.toLocaleString()} words)
═══════════════════════════════════════════════════════

${studyGuide}

═══════════════════════════════════════════════════════

Restructure the guide above following the 5 rules. Preserve every fact. Each concept in max 2 zones. Output raw markdown only — no preamble, no code fences.`;
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

  // Extract section headings from the restructured guide for reference
  const sectionHeadings = restructuredText.match(/^## .+$/gm)?.join('\n') || '';

  return `You are a medical study guide editor. The restructured guide is MISSING some facts. Your job is to FORMAT these missing facts as study guide content, grouped by which section they belong in.
${langNote}
RULES:
- Format each missing fact using the SAME formatting system as the guide:
  • Q/A pairs: ### Q: ... / **A:** ...
  • Callouts: > 💡 PEARL, > 🔴 PITFALL/TRAP, > ⚡ HIGH YIELD, > 🧠 MNEMONIC, > 🎯 STOP & THINK, > ✅ KEY POINT
  • Markdown tables where appropriate
  • Radiopaedia links: [Radiopaedia: Name](URL)
- Group the formatted content under the EXACT section heading where it belongs
- Use the section headings listed below (with their emojis)
- Output ONLY the new content to add — do NOT reproduce the existing guide

OUTPUT FORMAT (only include sections that have new content to add):

## [Exact section heading from the guide]

[formatted new content for this section]

## [Another section heading]

[formatted new content for this section]

SECTION HEADINGS IN THE GUIDE:
${sectionHeadings}

MISSING FACTS TO FORMAT AND PLACE:
${missingFacts}

Format and group the missing facts now. Output ONLY the new content grouped by section heading — no preamble, no commentary, no code fences.`;
}

// ── Helper: apply targeted patches into the restructured guide ───────────────

const SECTION_MARKERS = ['🎯', '🔬', '📚', '🔧', '📊', '⚖️', '🧠', '⚡', '📋', 'EXAM-DAY'];

export function applyPatches(guide: string, patchOutput: string): string {
  // Split patch output into blocks by ## headings
  const blocks: { heading: string; content: string }[] = [];
  const parts = patchOutput.split(/(?=^## )/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const newlineIdx = trimmed.indexOf('\n');
    if (newlineIdx === -1) continue;
    const heading = trimmed.substring(0, newlineIdx).trim();
    const content = trimmed.substring(newlineIdx + 1).trim();
    if (heading.startsWith('## ') && content) {
      blocks.push({ heading, content });
    }
  }

  if (blocks.length === 0) return guide;

  const guideLines = guide.split('\n');
  const unmatched: string[] = [];

  for (const block of blocks) {
    // Find matching section by emoji/marker
    const marker = SECTION_MARKERS.find(m => block.heading.includes(m));
    if (!marker) {
      unmatched.push(block.content);
      continue;
    }

    // Find the section line in the guide
    let sectionLineIdx = -1;
    for (let i = 0; i < guideLines.length; i++) {
      if (guideLines[i].startsWith('## ') && guideLines[i].includes(marker)) {
        sectionLineIdx = i;
        break;
      }
    }

    if (sectionLineIdx === -1) {
      unmatched.push(block.content);
      continue;
    }

    // Find the next ## heading (end of this section)
    let nextSectionIdx = guideLines.length;
    for (let i = sectionLineIdx + 1; i < guideLines.length; i++) {
      if (guideLines[i].startsWith('## ')) {
        nextSectionIdx = i;
        break;
      }
    }

    // Insert before any trailing --- separator, or before the next section heading
    let insertIdx = nextSectionIdx;
    for (let i = nextSectionIdx - 1; i > sectionLineIdx; i--) {
      if (guideLines[i].trim() === '---') {
        insertIdx = i;
        break;
      }
    }

    // Splice the new content in
    const contentLines = block.content.split('\n');
    guideLines.splice(insertIdx, 0, '', ...contentLines, '');
  }

  let result = guideLines.join('\n');

  // Append unmatched content before EXAM-DAY CHEAT SHEET or at end
  if (unmatched.length > 0) {
    const extra = unmatched.join('\n\n');
    const cheatIdx = result.indexOf('\n## EXAM-DAY');
    if (cheatIdx >= 0) {
      result = result.substring(0, cheatIdx) + '\n\n' + extra + '\n' + result.substring(cheatIdx);
    } else {
      result += '\n\n' + extra;
    }
  }

  return result;
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

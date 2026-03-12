/**
 * Prompt builder for study guide restructuring.
 * Used by /api/chapters/[id]/restructure.
 */

export function buildRestructurePrompt(studyGuide: string, language: string): string {
  const inputWordCount = studyGuide.split(/\s+/).length;
  const qaCount = (studyGuide.match(/###\s*Q:/gi) || []).length;
  const tableCount = (studyGuide.match(/\|.*\|.*\|/g) || []).length;
  const calloutCount = (studyGuide.match(/>\s*[💡🔴⚡🧠🎯✅⚖️]/g) || []).length;
  const linkCount = (studyGuide.match(/\[Radiopaedia/gi) || []).length;
  const stopThinkCount = (studyGuide.match(/STOP\s*&\s*THINK/gi) || []).length;
  const cheatSheetMatch = studyGuide.match(/```[\s\S]*?```/);
  const cheatSheetLines = cheatSheetMatch ? cheatSheetMatch[0].split('\n').length : 0;

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
WHY EACH SECTION EXISTS (your restructuring decisions must respect these)
═══════════════════════════════════════════════════════

Each section serves a distinct cognitive purpose. Understanding this prevents you from merging, truncating, or dropping sections:
- **Overview**: Advance organizer — frames what to learn and why (Ausubel)
- **Anatomy**: Schema building — baseline mental model before pathology (Piaget)
- **Core Pathologies Q/As**: Active recall — forces retrieval practice, the #1 evidence-based retention technique (Roediger & Karpicke)
- **Quick-Facts tables**: Cognitive scaffolding — gives the brain a "folder" before detailed Q/As (Sweller's Cognitive Load Theory). NOT a summary.
- **STOP & THINK questions**: Elaborative interrogation — asking "why?" creates deeper encoding than any other technique (Generation Effect, Slamecka & Graf). NEVER DROP THESE.
- **Callouts (PEARL/TRAP/HIGH YIELD)**: Emotional tagging — surprise and fear markers enhance memory encoding (McGaugh)
- **Differential Tables + Comparisons**: Interleaved discrimination — forces "which one is it?" thinking (Bjork)
- **Mnemonics**: Elaborative encoding aids — semantic hooks for retrieval
- **Rapid-Fire**: Testing effect — speed retrieval drilling in a DIFFERENT format than the detailed Q/As creates desirable difficulty (Bjork & Bjork)
- **Checklist**: Self-regulated learning — metacognitive self-monitoring: "can I explain this?" (Zimmerman)
- **Cheat Sheet**: Priming under stress — recency effect for exam-day last-minute review. Covers what you'd FORGET, not what you know.

═══════════════════════════════════════════════════════
5 RULES (follow ALL of them strictly)
═══════════════════════════════════════════════════════

**RULE 1 — ZERO FACT LOSS**
Every medical fact, numeric value, sign, pathology, mnemonic, Radiopaedia link, and callout from the input MUST appear in the output. When the input has duplicate Q/As on the same topic, MERGE them into ONE comprehensive Q/A (keep the richest version, add unique details from the other). Correct factual errors. Add important missing FMH2-testable facts.

Input stats: ~${qaCount} Q/A pairs, ~${calloutCount} callouts, ~${linkCount} Radiopaedia links, ~${tableCount} table rows, ${stopThinkCount} STOP & THINK questions, ${cheatSheetLines > 0 ? `${cheatSheetLines}-line cheat sheet` : 'no cheat sheet yet'}.
Your output MUST preserve at least ${stopThinkCount} STOP & THINK questions.${cheatSheetLines > 0 ? ` If the input has a cheat sheet, your output cheat sheet must cover ALL its categories — never truncate it.` : ''}

**PROTECTED ELEMENTS (NEVER drop these — they are the highest-value content):**
- 🎯 STOP & THINK questions — elaborative interrogation has the highest retention ROI of any technique. Preserve EVERY one from the input. If a STOP & THINK exists only as a standalone prompt (not a Q/A), anchor it as a > 🎯 callout in Core Pathologies.
- Management/treatment recommendations — actionable knowledge tested on exam day (e.g., "drainage si collection", "surveillance CA++", "prise de poids")
- Specific imaging descriptors — concrete findings that ARE the exam answer (e.g., "scalloping hépatique", "central dot sign", "starburst desmoplastique")
- Syndrome associations — links between pathologies (e.g., "carcinoïde ↔ syndrome carcinoïde si méta hépatiques", "cœliaque ↔ dermatite herpétiforme")
- Every Aunt Minnie sign paired with its pathology
- Every cheat sheet category from the input

**Guiding principle: If in doubt, KEEP the fact. A slightly longer guide costs the student nothing; a missing fact costs exam marks.**

**ORPHAN FACT PROTECTION (CRITICAL):** Some facts in the input may appear ONLY in the Cheat Sheet, Rapid-Fire, or Aunt Minnie lists WITHOUT a corresponding Q/A in Core Pathologies. These "orphan facts" are the most vulnerable to being lost. For EVERY fact you find that lacks a Q/A anchor, CREATE a new ### Q: / **A:** pair in the appropriate Core Pathologies subsection BEFORE placing it in any reference zone. This includes:
- Classic Aunt Minnie signs mentioned only in summary zones
- Syndrome associations mentioned only in the cheat sheet
- STOP & THINK prompts that lack a Q/A anchor
- Management pearls mentioned only in the cheat sheet

**RULE 2 — EACH CONCEPT HAS ONE HOME + ONE RECALL MAX**
This is the anti-repetition rule. Each concept appears in exactly 2 places:

| Place | Role | Format |
|-------|------|--------|
| **HOME** | Full explanation | Q/A in Core Pathologies, Anatomy, or a Comparison table |
| **RECALL** | Short drill (pick ONE) | Rapid-Fire (1-line Q/A) OR Differential table OR Cheat Sheet |

What each zone does (and does NOT do):
- **Quick-Facts table** (top of each pathology): Schema scaffolding ONLY — numbers, names, and 3-word identifiers that create a mental "folder" for the Q/As below. NOT a summary. Max 5 rows per pathology.
- **Rapid-Fire**: Reformulated 1-line drills in a DIFFERENT phrasing from the detailed Q/As. Do NOT copy-paste — rephrase as a quick-fire question. This format difference creates desirable difficulty, strengthening memory.
- **Checklist**: Metacognitive self-test ONLY. Format: "- [ ] Topic name" — NEVER include numbers, measurements, percentages, or factual statements. ONLY topic names or topic pairs (e.g., "- [ ] Crohn vs TB ileo-caecale"). If you find yourself writing a number or measurement in a checklist item, STOP — that belongs in Rapid-Fire.
- **Cheat Sheet**: NO LINE CAP — include everything the student would forget under exam stress. Organize by category (e.g., URGENCES, CHIFFRES CLÉS, SIGNES, MNÉMONIQUES, DIFFÉRENTIELS, IMAGERIE, GESTION, AUNT MINNIES, ASSOCIATIONS, PIÈGES). Use "keyword = keyword" format. Do NOT repeat Rapid-Fire content. The cheat sheet is a PRIMING tool for the last 10 minutes before the exam, not a summary of the guide.
- **Mnemonics section**: Each mnemonic has exactly 2 appearances total: (a) HOME = Mnemonics section (full Q/A with letter-by-letter breakdown), (b) RECALL = pick ONE: either an inline 🧠 callout in Core Pathologies OR a Rapid-Fire entry. Choose whichever is closest to the learning context. NEVER both callout AND rapid-fire for the same mnemonic.

FORBIDDEN: same fact appearing 3+ times across Q/A + Quick-Facts + Rapid-Fire + Checklist + Cheat Sheet. Maximum 2 zones per concept (one HOME, one RECALL).

**RULE 3 — PRESERVE FORMAT**
- Q/A: ### Q: [question] / **A:** [answer]
- Callouts MUST use blockquote prefix: > 💡 **PEARL**, > 🔴 **TRAP/PITFALL**, > ⚡ **HIGH YIELD**, > 🧠 **MNEMONIC**, > 🎯 **STOP & THINK**, > ✅ **KEY POINT**
  (The > prefix is MANDATORY for correct markdown rendering — never omit it)
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
- ❌ Omit the > prefix on callouts
- ❌ Drop or omit STOP & THINK questions — they have the highest retention value of any element
- ❌ Truncate the cheat sheet below the input's cheat sheet size — every category from the input must appear in the output
- ❌ Place cross-cutting associations inside a single pathology section — put them in ### Cross-Cutting Associations at the end of Core Pathologies

═══════════════════════════════════════════════════════
REQUIRED SECTION ORDER
═══════════════════════════════════════════════════════

## 🎯 Overview & Exam Strategy
---
## 🔬 Anatomy & Normal Findings
---
## 📚 Core Pathologies — Systematic Deep Dive
(### per pathology: Quick-Facts table [max 5 rows] + Imaging table + Q/A + callouts + STOP & THINK + Radiopaedia link)
(### Cross-Cutting Associations — at the END of this section, for facts that span multiple pathologies: syndromes like VACTERL, contrast-related pitfalls, multi-system associations, syndromic links)
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
(1-line Q/A drills, reformulated — NOT copied from detailed Q/As. At least as many items as the input. Cover every topic from Core Pathologies.)
---
## 📋 Pre-Exam Rapid Review Checklist
(TOPICS ONLY: "- [ ] Topic name" — ZERO numbers, ZERO facts, ZERO measurements. Just topic names.)
---
## EXAM-DAY CHEAT SHEET (in code block)
(No line cap. Organize by category. "keyword = keyword" format. Only what you'd forget under exam stress. Do NOT repeat Rapid-Fire content. Cover ALL categories from the input cheat sheet.)

If content doesn't fit any section, create a ### subsection in Core Pathologies. NEVER silently drop content.

═══════════════════════════════════════════════════════
STUDY GUIDE TO RESTRUCTURE (~${inputWordCount.toLocaleString()} words)
═══════════════════════════════════════════════════════

${studyGuide}

═══════════════════════════════════════════════════════

Restructure the guide above following the 5 rules. Preserve every fact — especially orphan facts that lack Q/A anchors and STOP & THINK questions. Each concept in max 2 zones. Output raw markdown only — no preamble, no code fences.`;
}

// ── Chunking utilities for large guides ─────────────────────────────────────

/** Split a study guide into sections by `## ` headings */
export function splitIntoSections(studyGuide: string): { heading: string; body: string }[] {
  const lines = studyGuide.split('\n');
  const sections: { heading: string; body: string }[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentHeading || currentLines.length > 0) {
        sections.push({ heading: currentHeading, body: currentLines.join('\n') });
      }
      currentHeading = line;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentHeading || currentLines.length > 0) {
    sections.push({ heading: currentHeading, body: currentLines.join('\n') });
  }
  return sections;
}

/** Group sections into chunks of roughly `targetWords` words */
export function groupSectionsIntoChunks(
  sections: { heading: string; body: string }[],
  targetWords = 15000
): { heading: string; body: string }[][] {
  const chunks: { heading: string; body: string }[][] = [];
  let current: { heading: string; body: string }[] = [];
  let currentWordCount = 0;

  for (const section of sections) {
    const sectionWords = section.body.split(/\s+/).length;
    // If adding this section exceeds target AND we already have content, start new chunk
    if (currentWordCount > 0 && currentWordCount + sectionWords > targetWords) {
      chunks.push(current);
      current = [section];
      currentWordCount = sectionWords;
    } else {
      current.push(section);
      currentWordCount += sectionWords;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/** Build a prompt for restructuring a single chunk of a larger guide */
export function buildChunkRestructurePrompt(
  chunkText: string,
  chunkIndex: number,
  totalChunks: number,
  sectionHeadings: string[],
  allHeadings: string[],
  language: string,
): string {
  const wordCount = chunkText.split(/\s+/).length;

  const langInstruction = language === "fr"
    ? `Write ENTIRELY in French. Keep medical terminology in both languages where helpful.
Callout labels stay as-is: PEARL, TRAP/PITFALL, HIGH YIELD, MNEMONIC.`
    : "";

  const contextNote = totalChunks > 1
    ? `
This is chunk ${chunkIndex + 1} of ${totalChunks}. The full guide has these sections:
${allHeadings.map(h => `  ${sectionHeadings.includes(h) ? '→' : ' '} ${h}`).join('\n')}

Sections marked with → are in THIS chunk. Restructure ONLY the content provided below.
Do NOT generate content for sections not in this chunk.
Do NOT add Overview, Cheat Sheet, Rapid-Fire, or Checklist sections — those will be handled in other chunks.
`
    : "";

  return `You are a SENIOR RADIOLOGIST PROFESSOR restructuring a study guide for optimal retention.
${langInstruction}
${contextNote}
RULES:
1. ZERO FACT LOSS — preserve every fact, number, sign, mnemonic, link, callout
2. Merge duplicate Q/As into one rich Q/A (keep the richest version)
3. Preserve format: ### Q: / **A:**, callouts with > prefix, markdown tables
4. Correct factual errors. Add missing FMH2-testable facts where obvious.
5. Do NOT convert Q/A to narrative text
6. Do NOT wrap output in code fences
7. Do NOT write a preamble — start directly with the content

═══════════════════════════════════════════════════════
CONTENT TO RESTRUCTURE (~${wordCount.toLocaleString()} words)
═══════════════════════════════════════════════════════

${chunkText}

═══════════════════════════════════════════════════════

Restructure the content above. Preserve every fact. Output raw markdown only.`;
}

import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";

// Force this route to be dynamic — never pre-render at build time
export const dynamic = "force-dynamic";

// Allow up to 300s for Claude to process PDF pages (requires Vercel Pro plan)
export const maxDuration = 300;

interface StudyContent {
  summary: string;
  keyPoints: string[];
  highYield: string[];
  mnemonics: { name: string; content: string }[];
  memoryPalace?: string;
  questions: {
    questionText: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
    difficulty: string;
    category: string;
  }[];
  flashcards: {
    front: string;
    back: string;
    category: string;
  }[];
}

function getClient(): Anthropic {
  return new Anthropic();
}

/**
 * Retry wrapper for Anthropic API calls (non-streaming).
 * Retries on transient errors: 429 (rate limit), 529 (overloaded), 500+ (server errors).
 * Uses exponential backoff: 5s, 10s, 20s.
 */
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
  timeoutMs = 180_000 // 3 minute timeout per call
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, "Claude API call");
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      const isTimeout = apiErr.message?.includes("timed out");
      const isRetryable = isTimeout || apiErr.status === 429 || apiErr.status === 529 || (apiErr.status && apiErr.status >= 500);
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 5000; // 5s, 10s, 20s
      console.warn(`Claude API ${isTimeout ? "timed out" : `returned ${apiErr.status}`}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("callClaudeWithRetry: unreachable");
}

/**
 * Streaming wrapper for Anthropic API calls.
 * Uses stream: true to support long-running requests (>10 min) like large PDF study guides.
 * Collects streamed text deltas into the full response string.
 * Retries on transient errors with exponential backoff.
 */
async function callClaudeStreamingWithRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: () => Promise<any>,
  onTextDelta?: (text: string) => void,
  maxRetries = 5
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let fullText = "";
      const stream = await fn();
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta"
        ) {
          fullText += event.delta.text;
          onTextDelta?.(event.delta.text);
        }
      }
      return fullText;
    } catch (err: unknown) {
      const apiErr = err as { status?: number; headers?: Record<string, string> };
      const isRetryable =
        apiErr.status === 429 ||
        apiErr.status === 529 ||
        (apiErr.status && apiErr.status >= 500);
      if (!isRetryable || attempt === maxRetries) throw err;

      // For rate limits (429), use longer delays to respect per-minute token budgets
      let delay: number;
      if (apiErr.status === 429) {
        // Parse retry-after header if available, otherwise default to 60s
        const retryAfter = apiErr.headers?.["retry-after"];
        delay = retryAfter ? Math.max(parseInt(retryAfter, 10) * 1000, 30000) : 60000;
      } else {
        delay = Math.pow(2, attempt) * 5000;
      }

      console.warn(
        `Claude streaming returned ${apiErr.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("callClaudeStreamingWithRetry: unreachable");
}

/**
 * Build the elite study guide prompt.
 * Written as if a senior radiologist professor + Harvard memory science instructor collaborated.
 */
function buildStudyGuidePrompt(chapterTitle: string, crossRefNote: string): string {
  return `Write an EXHAUSTIVE, VISUALLY ENGAGING study guide for the topic: "${chapterTitle}".

You are the combined voice of:
1. A SENIOR RADIOLOGIST PROFESSOR with 30+ years of FMH2 exam question-writing experience
2. A HARVARD MEMORY SCIENCE INSTRUCTOR who specializes in medical education mnemonics and spaced repetition

This is for the Swiss FMH2 radiology specialty exam — one of the hardest radiology exams in Europe. The student CANNOT afford to miss ANY topic. Cover EVERYTHING with the depth of a textbook but the engagement of the best teacher they've ever had.${crossRefNote}

CRITICAL: This chapter may contain 50-300 pages of dense radiology content (especially when merging multiple books). Your study guide must cover ALL of it — every pathology, every imaging sign, every differential diagnosis, every classic finding. If there are 20 different pathologies, ALL 20 must appear with full imaging characteristics. Do NOT condense or skip.

BREADTH-FIRST RULE: Cover ALL organ systems and ALL pathologies before going into deep detail on any single one. If this is a GI chapter, you MUST cover esophagus, stomach, duodenum, small bowel, colon, rectum, liver, biliary, pancreas, spleen, peritoneum, and mesentery — NOT just the liver. Allocate space proportionally across all topics. Do NOT spend 80% of the guide on the first organ system and rush through the rest.

RETENTION-FIRST APPROACH: The goal is MAXIMUM RETENTION. For each major section/topic:
1. Start with a BRIEF INTRO (3-5 sentences) that gives the big picture — what the topic is, why it matters, and the essential concepts to anchor everything else
2. Then immediately follow with the essential facts, key points, and mnemonics INLINE (right where they are relevant)
3. Then add Q&A / active recall questions to reinforce what was just taught
4. This pattern repeats for each major topic: Brief intro → Essential info → Q&A → next topic

This "teach then test" pattern maximises retention. Do NOT dump all Q&A at the end — sprinkle it throughout.

═══════════════════════════════════════════════════════
VISUAL FORMATTING RULES (CRITICAL — follow these EXACTLY)
═══════════════════════════════════════════════════════

Use these emoji-prefixed blockquotes to create visually distinct callout boxes throughout the guide. Use them GENEROUSLY — aim for at least 40+ callouts across the entire guide. Place them INLINE where they are relevant (not just in a separate section):

> 💡 **PEARL:** [clinical insight or teaching point that experienced radiologists know]

> 🔴 **PITFALL:** [common mistake, look-alike, or trap — what gets people WRONG on the exam]

> ⚡ **HIGH YIELD:** [must-know exam fact — if you learn nothing else, learn this]

> 🧠 **MNEMONIC:** [memory aid with full explanation of what each letter/part means]

> 🎯 **STOP & THINK:** [active recall question — pause and answer before reading on]

> ✅ **KEY POINT:** [essential takeaway that ties a section together]

> ⚖️ **VS:** [side-by-side comparison of commonly confused entities]

IMPORTANT: Place mnemonics (🧠), key points (✅), and high-yield facts (⚡) INLINE right after the content they relate to — NOT only in a separate section. This way the student sees the memory aid exactly when they need it. The dedicated sections later serve as a gathered reference of all callouts.

═══════════════════════════════════════════════════════
REQUIRED STRUCTURE (follow this EXACT order)
═══════════════════════════════════════════════════════

## 🎯 Overview & Exam Strategy

A brief, punchy introduction (5-8 sentences) covering:
- What this chapter covers and WHY it matters for FMH2
- The 3-5 most important things to know from this entire chapter (the "if you only remember 5 things" list)
- Strategic approach: what to master first vs. what's lower priority
- Common exam question patterns from this topic

> ✅ **KEY POINT:** [The single most important takeaway from this entire chapter]

---

## 🔬 Anatomy & Normal Findings

Start with a brief intro (2-3 sentences): what anatomy is relevant and why understanding normal is crucial for spotting pathology.

- Relevant anatomy with spatial relationships and landmarks
- Normal appearances on EACH modality (X-ray, CT, MRI, US) — be specific
- Use a comparison table:

| Structure | X-ray | CT | MRI (T1) | MRI (T2) | US |
|-----------|-------|----|-----------|-----------|-----|
| ...       | ...   | ...| ...       | ...       | ... |

- Normal variants that mimic pathology — each gets a 🔴 PITFALL callout
- Developmental anatomy when relevant

> 🎯 **STOP & THINK:** [Quick active recall question about normal anatomy]

**Answer:** [Answer]

---

## 📚 Core Pathologies — Systematic Deep Dive

Walk through EVERY pathology/topic in the chapter. Use ### subheadings for each pathology.

FOR EACH PATHOLOGY, follow this retention-optimised pattern:

**1. Brief intro** (2-3 sentences): What is this pathology? Why does it matter? What's the one thing to remember?

**2. Quick-Facts Header Table:**
| Feature | Detail |
|---------|--------|
| Incidence | ... |
| Age/Sex | ... |
| Risk Factors | ... |
| Modality of Choice | ... |
| Classic Sign | **...** |

**3. Pathophysiology** — 2-3 sentences explaining the mechanism

**4. Imaging Appearances Table:**
| Modality | Appearance | Key Finding |
|----------|------------|-------------|
| X-ray | ... | ... |
| CT (non-contrast) | ... | ... |
| CT (contrast) | ... | ... |
| MRI (T1) | ... | ... |
| MRI (T2/FLAIR) | ... | ... |
| MRI (DWI/ADC) | ... | ... |
| US | ... | ... |

**5. INLINE callouts** — place these RIGHT HERE with the pathology they relate to:
- 💡 PEARL callouts for clinical correlations
- 🔴 PITFALL callouts for look-alikes and exam traps
- ⚡ HIGH YIELD callouts for the most testable facts
- 🧠 MNEMONIC if there's a useful memory aid for this specific pathology
- ✅ KEY POINT to summarise the essential takeaway

**6. Active recall** — 1-2 quick STOP & THINK questions right after the pathology:

> 🎯 **STOP & THINK:** [Question about this specific pathology]

**Answer:** [Answer]

**7. Radiopaedia Link** — for each major pathology:
[Radiopaedia: PathologyName](https://radiopaedia.org/articles/pathology-name)

**8. Differential Diagnosis** — what else could look like this?
**9. Key Distinguishing Features** — use ⚖️ VS callouts for confusing pairs

Separate major pathology groups with horizontal rules (---).

---

## ⚡ High-Yield Rapid-Fire Section

The 30-50 most testable facts from this chapter, gathered in one place. Format as a checklist so students can self-assess:

- [ ] ⚡ First high-yield fact
- [ ] ⚡ Second high-yield fact
- [ ] ⚡ Third high-yield fact
...

Group by sub-topic with bold sub-headers. Every fact should be ONE sentence — dense, specific, and examable.

---

## 📊 Differential Diagnosis Master Tables

Create MULTIPLE comprehensive comparison tables. Each table groups related entities:

| Diagnosis | Key Finding | Distinguishing Feature | Modality of Choice | Classic Sign |
|-----------|-------------|----------------------|-------------------|-------------|
| ... | ... | ... | ... | **...** |

Mark dangerous "CANNOT MISS" diagnoses with 🔴 in the table.
Include at least 3-5 separate differential tables covering different clinical scenarios from this chapter.

---

## 🧠 Mnemonics — All in One Place

Gather ALL mnemonics from the guide here as a quick reference. Create **8-15 mnemonics** covering the major topics. For EACH mnemonic:

> 🧠 **MNEMONIC: [THE MNEMONIC]**
> - **[Letter/Part 1]** = [what it stands for]
> - **[Letter/Part 2]** = [what it stands for]
> - ...
> *Mental image: [vivid, memorable, even humorous imagery to cement it]*

Make the imagery vivid, unusual, and emotionally engaging — that's what makes it stick.

---

## ⚖️ "How to Tell Them Apart" — Comparison Section

Side-by-side comparisons of the most commonly confused entities from this chapter:

| Feature | Entity A | Entity B |
|---------|----------|----------|
| Age | ... | ... |
| Location | ... | ... |
| CT appearance | ... | ... |
| MRI signal | ... | ... |
| Key distinguisher | ... | ... |

Include 🔴 PITFALL callouts for the trickiest pairs that appear on exams.

---

## 🔧 Imaging Protocols & Technique

If the chapter discusses protocols, contrast phases, or technique, include:
- Protocol tables (sequence, parameters, timing)
- Contrast phase timing and what enhances when
- Technical pearls for optimal image acquisition
- Common artifacts and how to avoid them

Skip this section entirely if the chapter doesn't cover protocols.

---

## ✅ Key Points — All in One Place

Gather ALL key points from the guide here for quick review:

> ✅ **KEY POINT:** [Each essential takeaway, one per callout]

---

## 📋 Pre-Exam Rapid Review Checklist

A condensed 10-minute review. Format as checklist:

**[Sub-topic 1]**
- [ ] [Pathology A]: [#1 finding in ≤10 words]
- [ ] [Pathology B]: [#1 finding in ≤10 words]

**[Sub-topic 2]**
- [ ] [Pathology C]: [#1 finding in ≤10 words]
...

Cover EVERY pathology from the chapter in this checklist. This is the "last look before the exam."

---

## 🎯 Active Recall Self-Test

25-40 questions covering the FULL breadth of the chapter. Mix question types:

> 🎯 **STOP & THINK:** What is the classic sign of [pathology] on CT?

**Answer:** [Detailed answer with explanation]

> 🎯 **STOP & THINK:** A 55-year-old presents with [symptoms]. CT shows [finding]. What is the most likely diagnosis and what is the next step?

**Answer:** [Detailed answer]

> 🎯 **STOP & THINK:** Name 4 causes of [imaging finding] and the key distinguishing feature of each.

**Answer:** [Detailed answer]

Include clinical scenario questions, "name the sign" questions, differential diagnosis questions, and "next best step" questions.

═══════════════════════════════════════════════════════
STYLE RULES
═══════════════════════════════════════════════════════
- **Bold** for ALL classic signs, diagnosis names, and critical terms
- *Italics* for modality-specific descriptions and subtle findings
- Use markdown tables LIBERALLY — aim for at least 15+ tables throughout
- Use blockquote callouts (💡🔴⚡🧠🎯✅⚖️) GENEROUSLY — at least 40+ total
- Place callouts INLINE where relevant AND gather them in dedicated sections (Mnemonics, Key Points, High-Yield)
- Use \`- [ ]\` checklists for rapid-review and high-yield sections
- Use horizontal rules (---) between major pathology sections
- Be EXHAUSTIVELY detailed — cover every pathology, finding, and concept from the source material
- For EVERY major pathology, include a Radiopaedia link: [Radiopaedia: PathologyName](https://radiopaedia.org/articles/pathology-name) — use the standard Radiopaedia URL format with hyphens for spaces (e.g., hepatocellular-carcinoma, focal-nodular-hyperplasia). Place the link right after the pathology heading or in the Quick-Facts table
- NO filler text, NO generic introductions — every sentence must teach something specific
- Target length: 10000-20000 words — this is a comprehensive reference, not a summary
- Do NOT wrap the output in code fences — return raw markdown only
- Write with the authority of an expert and the warmth of a mentor who genuinely wants the student to pass`;
}

/**
 * Extract a useful error message from an Anthropic SDK error.
 * The SDK puts the message in different places depending on the error type.
 */
function getAnthropicErrorMessage(err: unknown): string | null {
  if (!err) return null;
  const e = err as { status?: number; message?: string; error?: { type?: string; message?: string } };
  const detail = e.error?.message || e.message || null;
  if (e.status && detail) {
    return `Anthropic API error (${e.status}): ${detail}`;
  }
  return detail;
}

export async function POST(request: Request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { action } = body;

    if (!action || typeof action !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'action' field" }, { status: 400 });
    }

    if (action === "test-key") {
      return handleTestKey();
    } else if (action === "detect-chapters") {
      return handleDetectChapters(body);
    } else if (action === "process-pdf") {
      return handleProcessPdf(body);
    } else if (action === "process") {
      return handleProcessText(body);
    } else if (action === "generate-study-guide") {
      return handleGenerateStudyGuide(body);
    } else if (action === "store-chapter") {
      return handleStoreChapter(body);
    } else if (action === "delete-chunks") {
      // Delete all PDF chunks for a given bookSource + chapterNum (cleanup before re-storing)
      const { bookSource: bs, chapterNum: cn } = body;
      if (!bs || cn === undefined) {
        return NextResponse.json({ error: "Missing bookSource or chapterNum" }, { status: 400 });
      }
      const deleted = await prisma.pdfChunk.deleteMany({
        where: { bookSource: bs, chapterNum: cn },
      });
      return NextResponse.json({ success: true, deleted: deleted.count });
    } else if (action === "purge-source") {
      // Nuclear option: delete ALL data for an entire book source
      // Must delete in FK order: attempts/reviews → questions/flashcards → chapters, then chunks
      const { bookSource: bs } = body;
      if (!bs) {
        return NextResponse.json({ error: "Missing bookSource" }, { status: 400 });
      }

      // Find all chapter IDs for this source
      const chapterIds = (
        await prisma.chapter.findMany({ where: { bookSource: bs }, select: { id: true } })
      ).map((c) => c.id);

      if (chapterIds.length > 0) {
        // Find question IDs to delete their attempts
        const questionIds = (
          await prisma.question.findMany({ where: { chapterId: { in: chapterIds } }, select: { id: true } })
        ).map((q) => q.id);

        // Find flashcard IDs to delete their reviews
        const flashcardIds = (
          await prisma.flashcard.findMany({ where: { chapterId: { in: chapterIds } }, select: { id: true } })
        ).map((f) => f.id);

        // Delete in FK order (deepest children first)
        if (questionIds.length > 0) {
          await prisma.questionAttempt.deleteMany({ where: { questionId: { in: questionIds } } });
        }
        if (flashcardIds.length > 0) {
          await prisma.flashcardReview.deleteMany({ where: { flashcardId: { in: flashcardIds } } });
        }
        await prisma.question.deleteMany({ where: { chapterId: { in: chapterIds } } });
        await prisma.flashcard.deleteMany({ where: { chapterId: { in: chapterIds } } });
      }

      const deletedChapters = await prisma.chapter.deleteMany({ where: { bookSource: bs } });
      const deletedChunks = await prisma.pdfChunk.deleteMany({ where: { bookSource: bs } });

      return NextResponse.json({
        success: true,
        deletedChunks: deletedChunks.count,
        deletedChapters: deletedChapters.count,
      });
    } else if (action === "generate-content") {
      return handleGenerateContent(body);
    } else if (action === "merge-study-guide") {
      return handleMergeStudyGuide(body);
    } else if (action === "seed") {
      return handleSeed();
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'detect-chapters', 'process-pdf', 'process', 'generate-study-guide', 'store-chapter', 'delete-chunks', 'generate-content', or 'seed'." },
        { status: 400 }
      );
    }
  } catch (error: unknown) {
    console.error("Ingest error:", error);

    // Extract detailed info from Anthropic API errors
    const anthropicError = error as { status?: number; error?: { type?: string; message?: string } };
    if (anthropicError.status && anthropicError.error) {
      return NextResponse.json(
        {
          error: `Anthropic API error (${anthropicError.status}): ${anthropicError.error.message || "Unknown"}`,
          errorType: anthropicError.error.type,
          status: anthropicError.status,
        },
        { status: anthropicError.status }
      );
    }

    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Quick diagnostic: test that the API key works by sending a trivial message.
 * Does NOT expose the key or environment variable names in the response.
 */
async function handleTestKey() {
  const isKeySet = !!process.env.ANTHROPIC_API_KEY;

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 20,
      messages: [{ role: "user", content: "Reply with just the word: OK" }],
    });
    const text = (response.content[0] as { type: "text"; text: string }).text;
    return NextResponse.json({
      success: true,
      keyConfigured: isKeySet,
      model: response.model,
      reply: text,
    });
  } catch (error: unknown) {
    const apiErr = error as { status?: number; error?: { type?: string; message?: string }; message?: string };
    return NextResponse.json({
      success: false,
      keyConfigured: isKeySet,
      errorStatus: apiErr.status,
      errorType: apiErr.error?.type,
      errorMessage: apiErr.error?.message || apiErr.message || "Connection test failed",
    });
  }
}

/**
 * Detect chapters by sending the first pages of the PDF to Claude.
 * Supports both fileId (Files API) and pdfBase64 (legacy) modes.
 */
async function handleDetectChapters(body: {
  fileId?: string;
  pdfBase64?: string;
  totalPages: number;
}) {
  const { fileId, pdfBase64, totalPages } = body;
  if (!fileId && !pdfBase64) {
    return NextResponse.json({ error: "Must provide either 'fileId' or 'pdfBase64'" }, { status: 400 });
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured. Add it in Vercel → Settings → Environment Variables and redeploy." },
      { status: 500 }
    );
  }

  const promptText = `This is the beginning of a radiology textbook PDF file (total ${totalPages} pages in the PDF file).
Analyze the table of contents or chapter headings visible in these pages.

Return a JSON array of chapters with this exact format:
[
  { "number": 1, "title": "Chapter Title", "startPage": 1, "endPage": 30 },
  { "number": 2, "title": "Next Chapter", "startPage": 31, "endPage": 58 }
]

CRITICAL — Page numbering rules:
- "startPage" and "endPage" must be PHYSICAL PDF page positions, counting from the very first page of this PDF file as page 1.
- Do NOT use the printed/typeset page numbers shown in the headers, footers, or table of contents of the book. Those are DIFFERENT from the physical PDF page positions.
- Most textbooks have front matter (cover, preface, table of contents, etc.) before Chapter 1 starts. So if the ToC says "Chapter 1 starts on page 1" but there are 12 pages of front matter, then the PHYSICAL PDF startPage for Chapter 1 would be 13 (not 1).
- To figure out the correct mapping: look at what physical PDF page you are currently viewing, and what printed page number is shown on it. The difference tells you the offset.
- Example: If you can see that the 14th physical page of this PDF shows printed page number "2", then the offset is 12 (printed + 12 = physical PDF page). Apply this offset to ALL page numbers from the table of contents.
- Each chapter's endPage should be the last page BEFORE the next chapter starts (i.e. next chapter's startPage minus 1).
- The last chapter's endPage should be ${totalPages} (the total page count of the PDF).
- Your page numbers must cover the ENTIRE PDF from page 1 to ${totalPages} without gaps or overlaps.
- If no clear chapter structure is visible, divide the ${totalPages} pages into logical sections of ~30-50 pages each.
- Return ONLY valid JSON, no markdown fences or explanation.`;

  const response = fileId
    ? await callClaudeWithRetry(() =>
        client.beta.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          betas: ["files-api-2025-04-14"],
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "file", file_id: fileId } },
              { type: "text", text: promptText },
            ],
          }],
        })
      )
    : await callClaudeWithRetry(() =>
        client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf" as const, data: pdfBase64! } },
              { type: "text", text: promptText },
            ],
          }],
        })
      );

  let responseText = (response.content[0] as { type: "text"; text: string }).text.trim();

  // Strip markdown code fences if present
  if (responseText.startsWith("```")) {
    responseText = responseText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  // Try to extract JSON array from the response (Claude may add text around it)
  let chapters;
  try {
    chapters = JSON.parse(responseText);
  } catch {
    // Fallback: find the JSON array within the text
    const arrayMatch = responseText.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        chapters = JSON.parse(arrayMatch[0]);
      } catch {
        // Still failed
      }
    }
  }

  if (chapters && Array.isArray(chapters)) {
    return NextResponse.json({ chapters });
  }

  return NextResponse.json(
    { error: `Failed to parse chapter detection response. Claude returned: ${responseText.slice(0, 300)}` },
    { status: 500 }
  );
}

/**
 * Process a PDF chunk: send pages to Claude for analysis, save results.
 *
 * Uses SSE (Server-Sent Events) streaming to keep the HTTP connection alive
 * during the long-running Claude API call.  Heartbeat comments are sent every
 * 8 seconds so that proxies / gateways / Safari don't close the connection.
 * The final result (or error) is sent as a single `data:` event.
 */
async function handleProcessPdf(body: {
  fileId?: string;
  pdfBase64?: string;
  chapterTitle: string;
  chapterNumber: number;
  bookSource: string;
  appendMode?: boolean;
}) {
  const { fileId, pdfBase64, chapterTitle, chapterNumber, bookSource, appendMode } = body;

  // Quick validation — return normal JSON errors (fast, no streaming needed)
  if (!chapterTitle || !chapterNumber || !bookSource) {
    return NextResponse.json(
      { error: "Missing required fields: chapterTitle, chapterNumber, bookSource" },
      { status: 400 }
    );
  }
  if (!fileId && !pdfBase64) {
    return NextResponse.json(
      { error: "Must provide either 'fileId' or 'pdfBase64'" },
      { status: 400 }
    );
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured. Add it in Vercel → Settings → Environment Variables and redeploy." },
      { status: 500 }
    );
  }

  // ── Build prompts ──────────────────────────────────────────────────────
  const fullPrompt = `You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

You are looking at actual pages from a radiology textbook — Chapter ${chapterNumber}: "${chapterTitle}".

IMPORTANT: You can see the IMAGES in these pages (X-rays, CT scans, MRI images, ultrasound, diagrams, anatomical illustrations). Use them to create better study materials. Reference specific imaging findings you can see.

Generate comprehensive study materials as a JSON object with exactly these fields:

{
  "summary": "A detailed summary (2-3 paragraphs) covering main concepts. Reference key imaging findings visible in the chapter's figures.",
  "keyPoints": ["8-12 key points — include imaging-specific points like 'On CT, finding X appears as...'"],
  "highYield": ["5-8 high-yield facts for the exam, including classic imaging signs"],
  "mnemonics": [{"name": "Mnemonic name", "content": "Explanation"}],
  "questions": [
    {
      "questionText": "MCQ question — include image-based questions like 'A CT shows X finding. What is the most likely diagnosis?'",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correctAnswer": 0,
      "explanation": "Detailed explanation referencing the imaging appearance",
      "difficulty": "medium",
      "category": "topic area"
    }
  ],
  "flashcards": [
    {
      "front": "Question (include imaging-based cards like 'What is the classic CT appearance of X?')",
      "back": "Detailed answer with imaging characteristics",
      "category": "topic area"
    }
  ]
}

Requirements:
- Generate 8-15 questions with varying difficulty (easy/medium/hard)
- Generate 15-25 flashcards
- Generate 3-5 mnemonics
- Include image-based questions that reference imaging findings from the chapter
- Questions should mimic RadPrimer / FMH2 exam style
- Focus on diagnostic imaging findings, differential diagnoses, and classic signs
- Return ONLY valid JSON, no markdown fences`;

  const appendPrompt = `You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

You are looking at additional pages from Chapter ${chapterNumber}: "${chapterTitle}" of a radiology textbook.
Earlier pages of this chapter have already been processed. Focus on generating questions and flashcards from the NEW content on these pages.

IMPORTANT: You can see the IMAGES in these pages. Reference specific imaging findings you can see.

Generate study materials as a JSON object with exactly these fields:

{
  "summary": "",
  "keyPoints": ["3-5 key points from these specific pages"],
  "highYield": ["2-4 high-yield facts from these pages"],
  "mnemonics": [],
  "questions": [
    {
      "questionText": "MCQ question based on content from these pages",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correctAnswer": 0,
      "explanation": "Detailed explanation",
      "difficulty": "medium",
      "category": "topic area"
    }
  ],
  "flashcards": [
    {
      "front": "Question from these pages",
      "back": "Answer with imaging characteristics",
      "category": "topic area"
    }
  ]
}

Requirements:
- Generate 8-15 questions with varying difficulty (easy/medium/hard)
- Generate 15-25 flashcards
- Focus on content unique to THESE pages — avoid duplicating earlier material
- Questions should mimic RadPrimer / FMH2 exam style
- Return ONLY valid JSON, no markdown fences`;

  const promptText = appendMode ? appendPrompt : fullPrompt;

  // ── SSE streaming response ─────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* controller already closed */ }
      };

      // Heartbeat every 8s keeps proxies / gateways / Safari alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch { /* ignore */ }
      }, 8000);

      try {
        // Call Claude with retry on transient errors (529 overloaded, 429 rate limit)
        const response = fileId
          ? await callClaudeWithRetry(() =>
              client.beta.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 8000,
                betas: ["files-api-2025-04-14"],
                messages: [{
                  role: "user",
                  content: [
                    { type: "document", source: { type: "file", file_id: fileId } },
                    { type: "text", text: promptText },
                  ],
                }],
              })
            )
          : await callClaudeWithRetry(() =>
              client.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 8000,
                messages: [{
                  role: "user",
                  content: [
                    { type: "document", source: { type: "base64", media_type: "application/pdf" as const, data: pdfBase64! } },
                    { type: "text", text: promptText },
                  ],
                }],
              })
            );

        // Parse Claude's JSON response
        let responseText = (response.content[0] as { type: "text"; text: string }).text.trim();
        if (responseText.startsWith("```")) {
          responseText = responseText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        }

        let content: StudyContent;
        try {
          content = JSON.parse(responseText);
        } catch {
          sendEvent({ error: "Failed to parse AI response as JSON", raw: responseText.slice(0, 200) });
          return;
        }

        // Save to database
        const result = appendMode
          ? await appendContentToDB(content, chapterNumber, bookSource)
          : await saveContentToDB(content, chapterTitle, chapterNumber, bookSource);

        sendEvent(result);
      } catch (err: unknown) {
        console.error("Process PDF error:", err);
        const errMsg = getAnthropicErrorMessage(err) || (err instanceof Error ? err.message : "Processing failed");
        sendEvent({ error: errMsg });
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
    },
  });
}

/**
 * Legacy: Process a chapter from plain text (kept for backward compatibility / manual paste).
 */
async function handleProcessText(body: {
  chapterText: string;
  chapterTitle: string;
  chapterNumber: number;
  bookSource: string;
}) {
  const { chapterText, chapterTitle, chapterNumber, bookSource } = body;

  if (!chapterText || !chapterTitle || !chapterNumber || !bookSource) {
    return NextResponse.json(
      { error: "Missing required fields: chapterText, chapterTitle, chapterNumber, bookSource" },
      { status: 400 }
    );
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured. Add it in Vercel → Settings → Environment Variables and redeploy." },
      { status: 500 }
    );
  }

  const prompt = `You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

Based on the following chapter content, generate comprehensive study materials in JSON format.

Chapter: ${chapterTitle}

Content:
${chapterText.slice(0, 50000)}

Generate a JSON object with exactly these fields:

{
  "summary": "A detailed summary of the chapter (2-3 paragraphs) covering the main concepts.",
  "keyPoints": ["List of 8-12 key points"],
  "highYield": ["List of 5-8 high-yield facts"],
  "mnemonics": [{"name": "Mnemonic name", "content": "Explanation"}],
  "questions": [{"questionText": "MCQ question", "options": ["A", "B", "C", "D"], "correctAnswer": 0, "explanation": "Why", "difficulty": "medium", "category": "topic"}],
  "flashcards": [{"front": "Question", "back": "Answer", "category": "topic"}]
}

Important:
- Generate 8-15 questions, varying difficulty (easy/medium/hard)
- Generate 15-25 flashcards
- Generate 3-5 mnemonics
- Questions should mimic RadPrimer intermediate level
- Focus on diagnostic imaging findings and differential diagnoses
- Return ONLY valid JSON, no markdown.`;

  const response = await callClaudeWithRetry(() =>
    client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    })
  );

  let responseText = (response.content[0] as { type: "text"; text: string }).text.trim();
  if (responseText.startsWith("```")) {
    responseText = responseText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let content: StudyContent;
  try {
    content = JSON.parse(responseText);
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response as JSON" }, { status: 500 });
  }

  return await saveStudyContent(content, chapterTitle, chapterNumber, bookSource, chapterText.slice(0, 100000));
}

/**
 * Save study content (questions, flashcards, chapter data) to the database.
 */
/**
 * Core DB save: upsert chapter + replace questions/flashcards. Returns plain object.
 */
async function saveContentToDB(
  content: StudyContent,
  chapterTitle: string,
  chapterNumber: number,
  bookSource: string,
  rawText?: string
) {
  // Defensive coercion — Claude's JSON might have unexpected types
  const chapter = await prisma.chapter.upsert({
    where: { bookSource_number: { bookSource: String(bookSource), number: Number(chapterNumber) } },
    update: {
      title: String(chapterTitle),
      rawText: rawText || null,
      summary: content.summary != null ? String(content.summary) : null,
      keyPoints: JSON.stringify(content.keyPoints || []),
      highYield: JSON.stringify(content.highYield || []),
      mnemonics: JSON.stringify(content.mnemonics || []),
      memoryPalace: content.memoryPalace != null ? String(content.memoryPalace) : null,
    },
    create: {
      bookSource: String(bookSource),
      number: Number(chapterNumber),
      title: String(chapterTitle),
      rawText: rawText || null,
      summary: content.summary != null ? String(content.summary) : null,
      keyPoints: JSON.stringify(content.keyPoints || []),
      highYield: JSON.stringify(content.highYield || []),
      mnemonics: JSON.stringify(content.mnemonics || []),
      memoryPalace: content.memoryPalace != null ? String(content.memoryPalace) : null,
    },
  });

  // Clear old questions/flashcards
  await prisma.questionAttempt.deleteMany({ where: { question: { chapterId: chapter.id } } });
  await prisma.question.deleteMany({ where: { chapterId: chapter.id } });
  await prisma.flashcardReview.deleteMany({ where: { flashcard: { chapterId: chapter.id } } });
  await prisma.flashcard.deleteMany({ where: { chapterId: chapter.id } });

  const questions = Array.isArray(content.questions) ? content.questions : [];
  for (const q of questions) {
    await prisma.question.create({
      data: {
        chapterId: chapter.id,
        questionText: String(q.questionText || ""),
        options: JSON.stringify(q.options || []),
        correctAnswer: Number(q.correctAnswer) || 0,
        explanation: String(q.explanation || ""),
        difficulty: String(q.difficulty || "medium"),
        category: q.category ? String(q.category) : null,
      },
    });
  }

  const flashcards = Array.isArray(content.flashcards) ? content.flashcards : [];
  for (const f of flashcards) {
    await prisma.flashcard.create({
      data: {
        chapterId: chapter.id,
        front: String(f.front || ""),
        back: String(f.back || ""),
        category: f.category ? String(f.category) : null,
      },
    });
  }

  return {
    success: true,
    chapterId: chapter.id,
    questionsCreated: questions.length,
    flashcardsCreated: flashcards.length,
  };
}

/** Wrapper for non-streaming callers */
async function saveStudyContent(
  content: StudyContent,
  chapterTitle: string,
  chapterNumber: number,
  bookSource: string,
  rawText?: string
) {
  const result = await saveContentToDB(content, chapterTitle, chapterNumber, bookSource, rawText);
  return NextResponse.json(result);
}

/**
 * Core DB append: add questions/flashcards to existing chapter. Returns plain object.
 */
async function appendContentToDB(
  content: StudyContent,
  chapterNumber: number,
  bookSource: string
) {
  const chapter = await prisma.chapter.findUnique({
    where: { bookSource_number: { bookSource: String(bookSource), number: Number(chapterNumber) } },
  });

  if (!chapter) {
    return { error: "Chapter not found for appending" };
  }

  const existingKeyPoints: string[] = JSON.parse(chapter.keyPoints || "[]");
  const existingHighYield: string[] = JSON.parse(chapter.highYield || "[]");

  await prisma.chapter.update({
    where: { id: chapter.id },
    data: {
      keyPoints: JSON.stringify([...existingKeyPoints, ...(content.keyPoints || [])]),
      highYield: JSON.stringify([...existingHighYield, ...(content.highYield || [])]),
    },
  });

  const questions = Array.isArray(content.questions) ? content.questions : [];
  for (const q of questions) {
    await prisma.question.create({
      data: {
        chapterId: chapter.id,
        questionText: String(q.questionText || ""),
        options: JSON.stringify(q.options || []),
        correctAnswer: Number(q.correctAnswer) || 0,
        explanation: String(q.explanation || ""),
        difficulty: String(q.difficulty || "medium"),
        category: q.category ? String(q.category) : null,
      },
    });
  }

  const flashcards = Array.isArray(content.flashcards) ? content.flashcards : [];
  for (const f of flashcards) {
    await prisma.flashcard.create({
      data: {
        chapterId: chapter.id,
        front: String(f.front || ""),
        back: String(f.back || ""),
        category: f.category ? String(f.category) : null,
      },
    });
  }

  const totalQuestions = await prisma.question.count({ where: { chapterId: chapter.id } });
  const totalFlashcards = await prisma.flashcard.count({ where: { chapterId: chapter.id } });

  return {
    success: true,
    chapterId: chapter.id,
    questionsCreated: totalQuestions,
    flashcardsCreated: totalFlashcards,
  };
}

/**
 * Generate a comprehensive study guide for an existing chapter.
 *
 * Two modes:
 * 1. With fileIds (right after ingest): sends actual PDF pages to Claude →
 *    study guide based on the REAL textbook content.
 * 2. Without fileIds (regenerate from chapter page): uses the chapter's
 *    accumulated metadata (summary, key points, etc.) as context.
 *
 * This is separate from chunk processing because:
 * - Markdown inside JSON is fragile (quotes, newlines break parsing)
 * - The study guide should be holistic (full chapter context)
 * - Raw markdown output avoids all JSON escaping issues
 *
 * Uses SSE streaming (heartbeats) to survive long Claude calls.
 */
async function handleGenerateStudyGuide(body: {
  chapterId?: number;
  chapterNumber?: number;
  bookSource?: string;
  fileIds?: string[];
}) {
  const { chapterId, chapterNumber, bookSource, fileIds } = body;

  // Look up the chapter
  const chapter = chapterId
    ? await prisma.chapter.findUnique({ where: { id: chapterId } })
    : chapterNumber && bookSource
      ? await prisma.chapter.findUnique({
          where: { bookSource_number: { bookSource: String(bookSource), number: Number(chapterNumber) } },
        })
      : null;

  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured." },
      { status: 500 }
    );
  }

  // Merge all PDF chunks into ≤100-page parts for complete coverage
  let mergedFileIds: string[] = [];
  const hasProvidedFileIds = Array.isArray(fileIds) && fileIds.length > 0;

  if (!hasProvidedFileIds) {
    // No fresh file IDs — merge stored chunks into PDFs and upload
    try {
      mergedFileIds = await mergeAndUploadChapterPdf(client, chapter.bookSource, chapter.number);
      if (mergedFileIds.length > 0) {
        console.log(`Merged PDF uploaded for chapter ${chapter.number} (${mergedFileIds.length} part(s))`);
      }
    } catch (err) {
      console.warn("Failed to merge/upload chapter PDF:", err instanceof Error ? err.message : err);
    }
  }

  const hasFileIds = hasProvidedFileIds || mergedFileIds.length > 0;

  // ── Find related chapters from other book sources ───────────────────────
  // Match by title similarity: extract key topic words and find chapters
  // from other books that cover the same topic (e.g., both have "Thoracic")
  // Generic words that appear in nearly every radiology chapter title — exclude them
  const titleStopWords = [
    "chapter", "section", "part", "the", "and", "for", "with", "from",
    "imaging", "radiology", "radiologic", "radiological", "diagnostic",
    "introduction", "overview", "principles", "approach", "review",
  ];
  const titleWords = chapter.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !titleStopWords.includes(w));

  // Only cross-reference if we have meaningful topic words (not just generic terms)
  const relatedChapters = titleWords.length > 0
    ? await prisma.chapter.findMany({
        where: {
          bookSource: { not: chapter.bookSource },
          AND: titleWords.map((word) => ({
            title: { contains: word, mode: "insensitive" as const },
          })),
        },
      })
    : [];

  // Build cross-reference context from related chapters
  function formatChapterContext(ch: NonNullable<typeof chapter>) {
    const kp: string[] = JSON.parse(ch.keyPoints || "[]");
    const hy: string[] = JSON.parse(ch.highYield || "[]");
    const mn: Array<{ name: string; content: string }> = JSON.parse(ch.mnemonics || "[]");
    return `### ${ch.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core"} — Chapter ${ch.number}: ${ch.title}

**Summary:** ${ch.summary || "(not available)"}

**Key Points:**
${kp.length > 0 ? kp.map((p) => `- ${p}`).join("\n") : "(none)"}

**High-Yield Facts:**
${hy.length > 0 ? hy.map((h) => `- ${h}`).join("\n") : "(none)"}

**Mnemonics:**
${mn.length > 0 ? mn.map((m) => `**${m.name}:** ${m.content}`).join("\n") : "(none)"}`;
  }

  const crossRefBlock = relatedChapters.length > 0
    ? `\n\n## Additional Source Material (from other textbooks on the same topic)\n\n${relatedChapters.map(formatChapterContext).join("\n\n---\n\n")}`
    : "";

  const sourceNames = [
    chapter.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core",
    ...relatedChapters.map((rc) => rc.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core"),
  ];
  const uniqueSources = [...new Set(sourceNames)];

  // ── Build the prompt ────────────────────────────────────────────────────
  const crossRefNote = relatedChapters.length > 0
    ? `\n\nIMPORTANT: You have material from multiple textbooks (${uniqueSources.join(" + ")}). Synthesize ALL sources into ONE unified guide. Where the books complement each other, combine their content. Where they differ or one adds detail the other lacks, include both perspectives. Do NOT separate content by book — integrate it into a single cohesive narrative.`
    : "";

  const studyGuideInstructions = buildStudyGuidePrompt(chapter.title, crossRefNote);

  // Build complete chapter data (ALL questions, flashcards, key points from every page)
  const fullChapterData = await buildFullChapterContext(chapter.id, chapter.bookSource, chapter.number, chapter.title);
  const fullContextBlock = `${fullChapterData}${crossRefBlock}`;

  // Collect all file IDs: merged parts + any provided file IDs
  const allFileIds = mergedFileIds.length > 0
    ? mergedFileIds
    : (hasProvidedFileIds ? fileIds! : []);

  // ── SSE streaming response ─────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* controller already closed */ }
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch { /* ignore */ }
      }, 8000);

      try {
        let studyGuide: string;

        if (allFileIds.length > 0) {
          // PDF-based: use per-part generation + synthesis for large chapters
          studyGuide = await generateStudyGuideFromParts(
            client,
            allFileIds,
            chapter.title,
            studyGuideInstructions,
            `You are an expert radiology educator. You can see EVERY page of this radiology textbook chapter — all images, diagrams, tables, and text. Use ALL of it to create the most complete study guide possible. Do not skip any topic or imaging finding.`,
            sendEvent,
          );
        } else {
          // No PDF available — use complete processed data from every page
          studyGuide = await callClaudeStreamingWithRetry(() =>
            client.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 32000,
              stream: true,
              messages: [{
                role: "user",
                content: `You are an expert radiology educator. Below is the COMPLETE processed data from every page of this chapter — including all questions, flashcards, key points, and high-yield facts. Use ALL of this data to create a comprehensive study guide. Do not skip any topic.\n\n${fullContextBlock}\n\n---\n\n${studyGuideInstructions}`,
              }],
            })
          );

          studyGuide = studyGuide.trim();
          if (studyGuide.startsWith("```")) {
            studyGuide = studyGuide.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```$/, "");
          }
        }

        // Save directly to the chapter
        await prisma.chapter.update({
          where: { id: chapter.id },
          data: { studyGuide },
        });

        sendEvent({
          success: true,
          chapterId: chapter.id,
          studyGuideLength: studyGuide.length,
          mode: hasFileIds ? "pdf" : "metadata",
          sources: uniqueSources,
          crossReferencedChapters: relatedChapters.map((rc) => ({
            id: rc.id,
            bookSource: rc.bookSource,
            number: rc.number,
            title: rc.title,
          })),
        });
      } catch (err: unknown) {
        console.error("Study guide generation error:", err);
        const errMsg = getAnthropicErrorMessage(err) || "Study guide generation failed";

        // Fallback: if file-based failed, use complete processed data (every Q, F, key point)
        if (hasFileIds) {
          console.log("File-based study guide failed, falling back to full processed data...");
          try {
            let studyGuide = await callClaudeStreamingWithRetry(() =>
              client.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 32000,
                stream: true,
                messages: [{
                  role: "user",
                  content: `You are an expert radiology educator. Below is the COMPLETE processed data from every page of this chapter — including all questions, flashcards, key points, and high-yield facts. Use ALL of this data to create a comprehensive study guide. Do not skip any topic.\n\n${fullContextBlock}\n\n---\n\n${studyGuideInstructions}`,
                }],
              })
            );

            studyGuide = studyGuide.trim();
            if (studyGuide.startsWith("```")) {
              studyGuide = studyGuide.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```$/, "");
            }

            await prisma.chapter.update({
              where: { id: chapter.id },
              data: { studyGuide },
            });

            sendEvent({
              success: true,
              chapterId: chapter.id,
              studyGuideLength: studyGuide.length,
              mode: "data-fallback",
              sources: uniqueSources,
            });
            return;
          } catch (fallbackErr) {
            console.error("Data fallback also failed:", fallbackErr);
          }
        }

        sendEvent({ error: errMsg });
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
    },
  });
}

/**
 * Store chapter metadata without any AI processing.
 * Called during source upload to create/update the chapter record.
 * PDF chunks are stored separately in the PdfChunk table via /api/store-pdf.
 */
async function handleStoreChapter(body: {
  chapterNumber: number;
  chapterTitle: string;
  bookSource: string;
}) {
  const { chapterNumber, chapterTitle, bookSource } = body;

  if (!chapterNumber || !chapterTitle || !bookSource) {
    return NextResponse.json(
      { error: "Missing required fields: chapterNumber, chapterTitle, bookSource" },
      { status: 400 }
    );
  }

  const chapter = await prisma.chapter.upsert({
    where: { bookSource_number: { bookSource: String(bookSource), number: Number(chapterNumber) } },
    update: {
      title: String(chapterTitle),
    },
    create: {
      bookSource: String(bookSource),
      number: Number(chapterNumber),
      title: String(chapterTitle),
    },
  });

  // Count stored PDF chunks for this chapter
  const pdfChunkCount = await prisma.pdfChunk.count({
    where: { bookSource: String(bookSource), chapterNum: Number(chapterNumber) },
  });

  return NextResponse.json({
    success: true,
    chapterId: chapter.id,
    pdfChunksStored: pdfChunkCount,
  });
}

/**
 * Merge all PDF chunks for a chapter into PDFs and upload to Anthropic Files API.
 * Splits into ≤100-page parts (Anthropic's per-document limit) and returns
 * an array of file IDs — one per part.
 */
async function mergeAndUploadChapterPdf(
  client: Anthropic,
  bookSource: string,
  chapterNum: number,
): Promise<string[]> {
  const chunks = await prisma.pdfChunk.findMany({
    where: { bookSource, chapterNum },
    orderBy: { chunkIndex: "asc" },
  });
  if (chunks.length === 0) return [];

  const mergedPdf = await PDFDocument.create();
  for (const chunk of chunks) {
    try {
      const chunkPdf = await PDFDocument.load(Buffer.from(chunk.data), { ignoreEncryption: true });
      const pages = await mergedPdf.copyPages(chunkPdf, chunkPdf.getPageIndices());
      pages.forEach((p) => mergedPdf.addPage(p));
    } catch (err) {
      console.warn(`Failed to merge chunk ${chunk.chunkIndex}:`, err instanceof Error ? err.message : err);
    }
  }

  const totalPages = mergedPdf.getPageCount();
  if (totalPages === 0) return [];

  return splitAndUploadPdf(client, mergedPdf, `ch${chapterNum}`);
}

/**
 * Split a PDFDocument into ≤100-page parts and upload each to Anthropic Files API.
 * Returns an array of file IDs.
 */
async function splitAndUploadPdf(
  client: Anthropic,
  sourcePdf: PDFDocument,
  fileNamePrefix: string,
  maxPagesPerPart = 20,
): Promise<string[]> {
  const totalPages = sourcePdf.getPageCount();
  if (totalPages === 0) return [];

  const numParts = Math.ceil(totalPages / maxPagesPerPart);
  const fileIds: string[] = [];

  for (let part = 0; part < numParts; part++) {
    const startPage = part * maxPagesPerPart;
    const endPage = Math.min(startPage + maxPagesPerPart, totalPages);
    const pageCount = endPage - startPage;

    const partPdf = await PDFDocument.create();
    const pages = await partPdf.copyPages(
      sourcePdf,
      Array.from({ length: pageCount }, (_, i) => startPage + i),
    );
    pages.forEach((p) => partPdf.addPage(p));

    const partBytes = await partPdf.save();
    const suffix = numParts > 1
      ? `_part${part + 1}of${numParts}_${pageCount}pages`
      : `_complete_${pageCount}pages`;
    const file = new File(
      [Buffer.from(partBytes)],
      `${fileNamePrefix}${suffix}.pdf`,
      { type: "application/pdf" },
    );
    const uploaded = await client.beta.files.upload({ file });
    fileIds.push(uploaded.id);
  }

  return fileIds;
}

/**
 * Build comprehensive chapter context from ALL processed data.
 * Includes summary, key points, high yield, mnemonics, AND every question
 * and flashcard — these contain detailed knowledge from every page.
 */
async function buildFullChapterContext(
  chapterId: number,
  bookSource: string,
  chapterNumber: number,
  chapterTitle: string,
): Promise<string> {
  const ch = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: {
      questions: { select: { questionText: true, options: true, explanation: true, category: true } },
      flashcards: { select: { front: true, back: true, category: true } },
    },
  });
  if (!ch) return "(chapter not found)";

  const kp: string[] = JSON.parse(ch.keyPoints || "[]");
  const hy: string[] = JSON.parse(ch.highYield || "[]");
  const mn: Array<{ name: string; content: string }> = JSON.parse(ch.mnemonics || "[]");
  const bookName = bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core";

  // Questions contain detailed knowledge from every page
  const questionBlock = ch.questions.length > 0
    ? ch.questions.map((q, i) => {
        const opts: string[] = JSON.parse(q.options || "[]");
        return `Q${i + 1}${q.category ? ` [${q.category}]` : ""}: ${q.questionText}\n${opts.join(" | ")}\nExplanation: ${q.explanation}`;
      }).join("\n\n")
    : "(none)";

  // Flashcards cover every detail from every page
  const flashcardBlock = ch.flashcards.length > 0
    ? ch.flashcards.map((f) => `- **${f.front}** → ${f.back}`).join("\n")
    : "(none)";

  return `## ${bookName} — Chapter ${chapterNumber}: ${chapterTitle}

### Summary
${ch.summary || "(not available)"}

### Key Points (from all pages)
${kp.length > 0 ? kp.map((p) => `- ${p}`).join("\n") : "(none)"}

### High-Yield Facts (from all pages)
${hy.length > 0 ? hy.map((h) => `- ${h}`).join("\n") : "(none)"}

### Mnemonics
${mn.length > 0 ? mn.map((m) => `**${m.name}:** ${m.content}`).join("\n") : "(none)"}

### All Questions (${ch.questions.length} — covering every topic in the chapter)
${questionBlock}

### All Flashcards (${ch.flashcards.length} — detailed knowledge from every page)
${flashcardBlock}`;
}

/**
 * If a study guide was truncated (output hit the token limit before finishing),
 * continue generating from where it stopped using assistant message prefill.
 * Claude sees what it already wrote and seamlessly continues.
 *
 * Returns the complete study guide (original + any continuations).
 */
async function continueStudyGuideIfTruncated(
  client: Anthropic,
  chapterTitle: string,
  partialGuide: string,
  sendEvent: (data: Record<string, unknown>) => void,
  maxContinuations = 2,
): Promise<string> {
  // "Active Recall" is near the very end of the required study guide template.
  // If it's missing, the guide was almost certainly truncated by the output limit.
  const COMPLETION_MARKER = "Active Recall";
  let fullGuide = partialGuide;

  const CONTINUE_PROMPT = `Your previous response was cut short by the output length limit. Continue EXACTLY where you stopped. Rules:
- Do NOT repeat ANY content already written above
- Pick up from the last incomplete section or sentence
- Continue through ALL remaining sections of the study guide
- Maintain the same formatting, depth, and callout style (💡 PEARL, 🔴 PITFALL, ⚡ HIGH YIELD, 🧠 MNEMONIC, 🎯 STOP & THINK, etc.)
- Make sure to complete all remaining sections including: High-Yield Rapid-Fire, Differential Diagnosis Tables, Mnemonics & Memory Palace, Comparisons, Imaging Protocols, Pre-Exam Review Checklist, and Active Recall Self-Test`;

  for (let attempt = 1; attempt <= maxContinuations; attempt++) {
    if (fullGuide.includes(COMPLETION_MARKER)) break;

    sendEvent({
      status: "generating-guide",
      message: `Study guide was truncated — continuing generation (${attempt}/${maxContinuations})...`,
    });

    // Keep the last portion of the guide to stay within context limits
    const prefill = fullGuide.length > 60000 ? fullGuide.slice(-60000) : fullGuide;

    // Text-only continuation — no PDFs needed, just assistant prefill
    const continuation = await callClaudeStreamingWithRetry(() =>
      client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 32000,
        stream: true,
        messages: [
          {
            role: "user",
            content: `You are an expert radiology educator creating an exhaustive study guide for "${chapterTitle}" for the Swiss FMH2 radiology exam.`,
          },
          {
            role: "assistant",
            content: prefill,
          },
          {
            role: "user",
            content: CONTINUE_PROMPT,
          },
        ],
      })
    );

    fullGuide += "\n\n" + continuation.trim();
  }

  return fullGuide;
}

/**
 * Generate a study guide from potentially large PDFs by processing parts
 * individually and synthesizing if they won't all fit in one context window.
 *
 * - 1 part: send directly as a single Claude call with the PDF
 * - 2+ parts: extract detailed content from each part separately,
 *   then synthesize into one unified guide (text-only final call)
 */
async function generateStudyGuideFromParts(
  client: Anthropic,
  fileIds: string[],
  chapterTitle: string,
  guidePrompt: string,
  introText: string,
  sendEvent: (data: Record<string, unknown>) => void,
): Promise<string> {
  // Single part — fits in one context window, generate directly with PDF
  if (fileIds.length === 1) {
    let guide = await callClaudeStreamingWithRetry(() =>
      client.beta.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 32000,
        stream: true,
        betas: ["files-api-2025-04-14"],
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "file", file_id: fileIds[0] } },
            { type: "text", text: `${introText}\n\n${guidePrompt}` },
          ],
        }],
      })
    );

    guide = guide.trim();
    if (guide.startsWith("```")) {
      guide = guide.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```$/, "");
    }

    guide = await continueStudyGuideIfTruncated(
      client, chapterTitle, guide, sendEvent
    );
    return guide;
  }

  // Multiple parts — extract detailed content from each, then synthesize
  const partExtracts: string[] = [];

  for (let i = 0; i < fileIds.length; i++) {
    // Proactive delay between calls to avoid rate limit (30K tokens/min)
    if (i > 0) {
      sendEvent({
        status: "generating-guide",
        message: `Waiting for rate limit window before part ${i + 1} of ${fileIds.length}...`,
      });
      await new Promise((r) => setTimeout(r, 65000));
    }

    sendEvent({
      status: "generating-guide",
      message: `Analyzing PDF part ${i + 1} of ${fileIds.length}...`,
    });

    const extract = await callClaudeStreamingWithRetry(() =>
      client.beta.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16000,
        stream: true,
        betas: ["files-api-2025-04-14"],
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "file", file_id: fileIds[i] } },
            {
              type: "text",
              text: `You are an expert radiology educator. Extract ALL medical knowledge from these PDF pages for "${chapterTitle}". This is part ${i + 1} of ${fileIds.length}.

Be EXHAUSTIVE — capture EVERYTHING from every page:
- Every pathology, finding, and diagnosis mentioned
- Every imaging sign with its description (what it looks like on CT, MRI, US, X-ray)
- Every differential diagnosis list
- Classic presentations and their imaging appearances
- Anatomical landmarks and normal variants
- Key measurements, grading systems, and classifications
- Pearl/pitfall/high-yield facts
- Any tables, algorithms, or decision frameworks

Format as structured markdown with clear headings per organ/topic. Do not skip anything — I need every detail from every page.`,
            },
          ],
        }],
      })
    );

    partExtracts.push(extract.trim());
  }

  // Delay before synthesis to respect rate limits
  sendEvent({
    status: "generating-guide",
    message: `Waiting for rate limit window before synthesis...`,
  });
  await new Promise((r) => setTimeout(r, 65000));

  // Synthesize all extracts into one study guide
  sendEvent({
    status: "generating-guide",
    message: `Synthesizing ${fileIds.length} parts into comprehensive study guide...`,
  });

  const combinedExtracts = partExtracts
    .map((ext, i) => `## Extracted Content — Part ${i + 1} of ${fileIds.length}\n\n${ext}`)
    .join("\n\n---\n\n");

  let guide = await callClaudeStreamingWithRetry(() =>
    client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 32000,
      stream: true,
      messages: [{
        role: "user",
        content: `You are an expert radiology educator. Below are detailed extracts from ALL pages of "${chapterTitle}" (extracted from the actual textbook PDF across ${fileIds.length} parts). Use ALL of this content to create the most comprehensive study guide possible. Do not skip any topic, pathology, or imaging finding.\n\n${combinedExtracts}\n\n---\n\n${guidePrompt}`,
      }],
    })
  );

  guide = guide.trim();
  if (guide.startsWith("```")) {
    guide = guide.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```$/, "");
  }

  guide = await continueStudyGuideIfTruncated(
    client, chapterTitle, guide, sendEvent
  );
  return guide;
}

/**
 * Generate ALL content for a chapter from stored PDF chunks.
 * This is the "one button press" action: re-uploads chunks to Anthropic,
 * processes each chunk for Q/F/summary, then generates a study guide.
 *
 * SSE events:
 *   { status: "uploading", message: "..." }
 *   { status: "processing", chunk: N, total: M }
 *   { status: "generating-guide" }
 *   { success: true, questionsCreated: N, flashcardsCreated: M }
 *   { error: "..." }
 */
async function handleGenerateContent(body: { chapterId: number }) {
  const { chapterId } = body;

  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  // Load stored PDF chunks from the database
  const pdfChunks = await prisma.pdfChunk.findMany({
    where: { bookSource: chapter.bookSource, chapterNum: chapter.number },
    orderBy: { chunkIndex: "asc" },
  });

  if (pdfChunks.length === 0) {
    return NextResponse.json(
      { error: "No stored PDF pages for this chapter. Upload the source PDF first on the Sources page." },
      { status: 400 }
    );
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured." },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* closed */ }
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch { /* ignore */ }
      }, 8000);

      try {
        // ── Step 1: Upload stored DB chunks to Anthropic Files API ──
        sendEvent({ status: "uploading", message: `Uploading ${pdfChunks.length} PDF chunks to Claude...` });
        const fileIds: string[] = [];

        for (let i = 0; i < pdfChunks.length; i++) {
          try {
            const chunk = pdfChunks[i];
            const file = new File(
              [Buffer.from(chunk.data)],
              `ch${chapter.number}_chunk${i + 1}.pdf`,
              { type: "application/pdf" }
            );
            const uploaded = await client.beta.files.upload({ file });
            fileIds.push(uploaded.id);
          } catch (err) {
            sendEvent({ status: "warning", message: `Chunk ${i + 1} upload failed: ${err instanceof Error ? err.message : String(err)}` });
          }
        }

        if (fileIds.length === 0) {
          sendEvent({ error: "All PDF chunk uploads to Claude failed." });
          return;
        }

        sendEvent({ status: "uploading", message: `${fileIds.length} chunks uploaded to Claude.` });

        // ── Step 2: Process chunks in batches for Q/F/summary ────────────────
        // Group file IDs into batches of 5 to reduce total API calls
        // (e.g. 45 chunks → 9 batches instead of 45 individual calls)
        const BATCH_SIZE = 5;
        const batches: string[][] = [];
        for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
          batches.push(fileIds.slice(i, i + BATCH_SIZE));
        }

        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
          const batch = batches[batchIdx];
          sendEvent({ status: "processing", chunk: batchIdx + 1, total: batches.length });

          const isAppend = batchIdx > 0;

          // Build content array: attach all file IDs in this batch as documents
          const contentParts: Array<{ type: "document"; source: { type: "file"; file_id: string } } | { type: "text"; text: string }> = [];
          for (const fid of batch) {
            contentParts.push({ type: "document", source: { type: "file", file_id: fid } });
          }

          const promptText = isAppend
            ? `You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

You are looking at additional pages from Chapter ${chapter.number}: "${chapter.title}" of a radiology textbook.
Earlier pages of this chapter have already been processed. Focus on generating questions and flashcards from the NEW content on these pages.

IMPORTANT: You can see the IMAGES in these pages. Reference specific imaging findings you can see.

Generate study materials as a JSON object with exactly these fields:

{
  "summary": "",
  "keyPoints": ["3-5 key points from these specific pages"],
  "highYield": ["2-4 high-yield facts from these pages"],
  "mnemonics": [],
  "questions": [
    {
      "questionText": "MCQ question based on content from these pages",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correctAnswer": 0,
      "explanation": "Detailed explanation",
      "difficulty": "medium",
      "category": "topic area"
    }
  ],
  "flashcards": [
    {
      "front": "Question from these pages",
      "back": "Answer with imaging characteristics",
      "category": "topic area"
    }
  ]
}

Requirements:
- Generate 8-15 questions with varying difficulty (easy/medium/hard)
- Generate 15-25 flashcards
- Focus on content unique to THESE pages — avoid duplicating earlier material
- Questions should mimic RadPrimer / FMH2 exam style
- Return ONLY valid JSON, no markdown fences`
            : `You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

You are looking at actual pages from a radiology textbook — Chapter ${chapter.number}: "${chapter.title}".

IMPORTANT: You can see the IMAGES in these pages (X-rays, CT scans, MRI images, ultrasound, diagrams, anatomical illustrations). Use them to create better study materials. Reference specific imaging findings you can see.

Generate comprehensive study materials as a JSON object with exactly these fields:

{
  "summary": "A detailed summary (2-3 paragraphs) covering main concepts. Reference key imaging findings visible in the chapter's figures.",
  "keyPoints": ["8-12 key points — include imaging-specific points like 'On CT, finding X appears as...'"],
  "highYield": ["5-8 high-yield facts for the exam, including classic imaging signs"],
  "mnemonics": [{"name": "Mnemonic name", "content": "Explanation"}],
  "questions": [
    {
      "questionText": "MCQ question — include image-based questions like 'A CT shows X finding. What is the most likely diagnosis?'",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correctAnswer": 0,
      "explanation": "Detailed explanation referencing the imaging appearance",
      "difficulty": "medium",
      "category": "topic area"
    }
  ],
  "flashcards": [
    {
      "front": "Question (include imaging-based cards like 'What is the classic CT appearance of X?')",
      "back": "Detailed answer with imaging characteristics",
      "category": "topic area"
    }
  ]
}

Requirements:
- Generate 8-15 questions with varying difficulty (easy/medium/hard)
- Generate 15-25 flashcards
- Generate 3-5 mnemonics
- Include image-based questions that reference imaging findings from the chapter
- Questions should mimic RadPrimer / FMH2 exam style
- Focus on diagnostic imaging findings, differential diagnoses, and classic signs
- Return ONLY valid JSON, no markdown fences`;

          contentParts.push({ type: "text", text: promptText });

          try {
            const response = await callClaudeWithRetry(() =>
              client.beta.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 16000,
                betas: ["files-api-2025-04-14"],
                messages: [{ role: "user", content: contentParts }],
              })
            );

            let responseText = (response.content[0] as { type: "text"; text: string }).text.trim();
            if (responseText.startsWith("```")) {
              responseText = responseText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
            }

            let content: StudyContent;
            try {
              content = JSON.parse(responseText);
            } catch {
              sendEvent({ status: "warning", message: `Batch ${batchIdx + 1}/${batches.length}: Failed to parse JSON, skipping` });
              continue;
            }

            if (isAppend) {
              await appendContentToDB(content, chapter.number, chapter.bookSource);
            } else {
              await saveContentToDB(content, chapter.title, chapter.number, chapter.bookSource);
            }
          } catch (err) {
            sendEvent({
              status: "warning",
              message: `Batch ${batchIdx + 1}/${batches.length} failed: ${err instanceof Error ? err.message : String(err)}. Skipping.`,
            });
          }

          // Brief delay between batches to avoid rate limits
          if (batchIdx < batches.length - 1) {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }

        // ── Step 3: Generate study guide ──────────────────────────────
        sendEvent({ status: "generating-guide", message: "Generating comprehensive study guide..." });

        // Find related chapters from other books for cross-referencing
        const titleStopWords2 = [
          "chapter", "section", "part", "the", "and", "for", "with", "from",
          "imaging", "radiology", "radiologic", "radiological", "diagnostic",
          "introduction", "overview", "principles", "approach", "review",
        ];
        const titleWords = chapter.title
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 3 && !titleStopWords2.includes(w));

        const relatedChapters = titleWords.length > 0
          ? await prisma.chapter.findMany({
              where: {
                bookSource: { not: chapter.bookSource },
                AND: titleWords.map((word) => ({
                  title: { contains: word, mode: "insensitive" as const },
                })),
              },
            })
          : [];

        function formatCtx(ch: NonNullable<typeof chapter>) {
          const kp: string[] = JSON.parse(ch.keyPoints || "[]");
          const hy: string[] = JSON.parse(ch.highYield || "[]");
          return `### ${ch.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core"} — Ch. ${ch.number}: ${ch.title}
**Summary:** ${ch.summary || "(not available)"}
**Key Points:** ${kp.length > 0 ? kp.map((p) => `- ${p}`).join("\n") : "(none)"}
**High-Yield:** ${hy.length > 0 ? hy.map((h) => `- ${h}`).join("\n") : "(none)"}`;
        }

        const crossRefBlock = relatedChapters.length > 0
          ? `\n\n## Additional Source Material\n\n${relatedChapters.map(formatCtx).join("\n\n---\n\n")}`
          : "";

        const uniqueSources = [...new Set([
          chapter.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core",
          ...relatedChapters.map((rc) => rc.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core"),
        ])];

        const crossRefNote = relatedChapters.length > 0
          ? `\n\nIMPORTANT: You have material from multiple textbooks (${uniqueSources.join(" + ")}). Synthesize ALL sources into ONE unified guide.`
          : "";

        const guidePrompt = buildStudyGuidePrompt(chapter.title, crossRefNote);

        // Merge all chunks into PDFs so Claude sees every page, image, table
        sendEvent({ status: "generating-guide", message: "Merging all PDF pages..." });
        const fullChapterData = await buildFullChapterContext(chapter.id, chapter.bookSource, chapter.number, chapter.title);

        let studyGuide = "";

        try {
          const mergedFileIds = await mergeAndUploadChapterPdf(client, chapter.bookSource, chapter.number);
          if (mergedFileIds.length === 0) throw new Error("Failed to merge PDF chunks");

          sendEvent({ status: "generating-guide", message: "Claude is reading the complete chapter..." });

          // Use per-part generation + synthesis for large chapters
          studyGuide = await generateStudyGuideFromParts(
            client,
            mergedFileIds,
            chapter.title,
            guidePrompt,
            `You are an expert radiology educator. You can see EVERY page of this radiology textbook chapter — all images, diagrams, tables, and text. Use ALL of it to create the most complete study guide possible. Do not skip any topic or imaging finding.${crossRefBlock}`,
            sendEvent,
          );
        } catch (guideErr) {
          // Merged PDF approach failed — use complete processed data from every chunk
          console.error("Merged PDF study guide failed, using full processed data:", guideErr);
          sendEvent({ status: "generating-guide", message: "Generating from complete processed data..." });

          studyGuide = await callClaudeStreamingWithRetry(() =>
            client.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 32000,
              stream: true,
              messages: [{
                role: "user",
                content: `You are an expert radiology educator. Below is the COMPLETE processed data from every page of this chapter — including all questions, flashcards, key points, and high-yield facts extracted from the textbook. Use ALL of this data to create a comprehensive study guide. Do not skip any topic.\n\n${fullChapterData}${crossRefBlock}\n\n---\n\n${guidePrompt}`,
              }],
            })
          );

          studyGuide = studyGuide.trim();
          if (studyGuide.startsWith("```")) {
            studyGuide = studyGuide.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```$/, "");
          }
        }

        await prisma.chapter.update({
          where: { id: chapter.id },
          data: { studyGuide },
        });

        // ── Done ──────────────────────────────────────────────────────
        const totalQ = await prisma.question.count({ where: { chapterId: chapter.id } });
        const totalF = await prisma.flashcard.count({ where: { chapterId: chapter.id } });

        sendEvent({
          success: true,
          chapterId: chapter.id,
          questionsCreated: totalQ,
          flashcardsCreated: totalF,
          studyGuideLength: studyGuide.length,
          sources: uniqueSources,
        });
      } catch (err: unknown) {
        console.error("Content generation error:", err);
        const errMsg = getAnthropicErrorMessage(err) || "Content generation failed";
        sendEvent({ error: errMsg });
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
    },
  });
}

/**
 * Generate a unified study guide by merging PDFs from matching chapters
 * across different books (e.g., Core Radiology + Crack the Core for "GI Imaging").
 * Merges both books' PDF pages into one document so Claude can reference
 * all images/tables from both sources.
 */
async function handleMergeStudyGuide(body: { chapterId: number }) {
  const { chapterId } = body;

  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  // Find matching chapter(s) from other book(s) using title similarity
  const titleStopWords = [
    "chapter", "section", "part", "the", "and", "for", "with", "from",
    "imaging", "radiology", "radiologic", "radiological", "diagnostic",
    "introduction", "overview", "principles", "approach", "review",
  ];
  const titleWords = chapter.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !titleStopWords.includes(w));

  const relatedChapters = titleWords.length > 0
    ? await prisma.chapter.findMany({
        where: {
          bookSource: { not: chapter.bookSource },
          AND: titleWords.map((word) => ({
            title: { contains: word, mode: "insensitive" as const },
          })),
        },
      })
    : [];

  if (relatedChapters.length === 0) {
    return NextResponse.json({
      error: `No matching chapter found in other books for "${chapter.title}". Make sure both books are uploaded and have chapters stored.`,
    }, { status: 400 });
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* closed */ }
      };

      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: heartbeat\n\n`)); } catch { /* ignore */ }
      }, 8000);

      try {
        // Collect all chapters to merge (primary + related)
        const allChapters = [chapter, ...relatedChapters];
        const bookNames = allChapters.map((c) =>
          c.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core"
        );

        sendEvent({
          status: "merging",
          message: `Merging PDFs from ${[...new Set(bookNames)].join(" + ")} (${allChapters.length} chapters)...`,
        });

        // Merge all PDFs from all chapters into one document
        const mergedPdf = await PDFDocument.create();
        const chapterPageRanges: Array<{ bookSource: string; title: string; startPage: number; endPage: number }> = [];

        for (const ch of allChapters) {
          const startPage = mergedPdf.getPageCount();
          const chunks = await prisma.pdfChunk.findMany({
            where: { bookSource: ch.bookSource, chapterNum: ch.number },
            orderBy: { chunkIndex: "asc" },
          });

          for (const chunk of chunks) {
            try {
              const chunkPdf = await PDFDocument.load(Buffer.from(chunk.data), { ignoreEncryption: true });
              const pages = await mergedPdf.copyPages(chunkPdf, chunkPdf.getPageIndices());
              pages.forEach((p) => mergedPdf.addPage(p));
            } catch (err) {
              console.warn(`Failed to merge chunk:`, err instanceof Error ? err.message : err);
            }
          }

          const endPage = mergedPdf.getPageCount() - 1;
          if (endPage >= startPage) {
            chapterPageRanges.push({
              bookSource: ch.bookSource,
              title: ch.title,
              startPage: startPage + 1,
              endPage: endPage + 1,
            });
          }
        }

        const totalPages = mergedPdf.getPageCount();
        if (totalPages === 0) {
          sendEvent({ error: "No PDF pages found in any of the matched chapters." });
          return;
        }

        // Show detailed per-source page breakdown so the user can verify coverage
        const pageBreakdown = chapterPageRanges
          .map((r) => {
            const bookName = r.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core";
            const pageCount = r.endPage - r.startPage + 1;
            return `${bookName}: ${pageCount} pages ("${r.title}")`;
          })
          .join(" + ");

        sendEvent({
          status: "merging",
          message: `Merged ${totalPages} pages total: ${pageBreakdown}`,
          pageRanges: chapterPageRanges.map((r) => ({
            ...r,
            bookName: r.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core",
            pageCount: r.endPage - r.startPage + 1,
          })),
        });

        // Split into ≤80-page parts and upload each
        sendEvent({ status: "uploading", message: `Uploading merged PDF (${totalPages} pages) to Claude...` });

        const mergedFileIds = await splitAndUploadPdf(
          client,
          mergedPdf,
          `merged_${chapter.title.replace(/\s+/g, "_")}`,
        );

        if (mergedFileIds.length === 0) {
          sendEvent({ error: "Failed to upload merged PDF parts." });
          return;
        }

        sendEvent({ status: "uploading", message: `Uploaded ${mergedFileIds.length} PDF part(s) to Claude.` });

        // Build page range context so Claude knows which pages are from which book
        const rangeContext = chapterPageRanges
          .map((r) => `- Pages ${r.startPage}–${r.endPage}: ${r.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core"} — "${r.title}"`)
          .join("\n");

        const crossRefNote = `\n\nIMPORTANT: These PDFs contain pages from MULTIPLE textbooks covering the same topic:
${rangeContext}

Synthesize ALL sources into ONE unified study guide. Where the books complement each other, combine their content. Where they differ or one adds detail the other lacks, include both perspectives. Do NOT separate content by book — integrate it into a single cohesive narrative that draws from the best of both.`;

        const guidePrompt = buildStudyGuidePrompt(chapter.title, crossRefNote);

        sendEvent({ status: "generating-guide", message: `Claude is analyzing ${totalPages} pages from ${[...new Set(bookNames)].join(" + ")}...` });

        // Use per-part generation + synthesis to stay within context window limits
        const studyGuide = await generateStudyGuideFromParts(
          client,
          mergedFileIds,
          chapter.title,
          guidePrompt,
          `You are an expert radiology educator. These PDF pages are from radiology textbooks covering the same topic. You can see EVERY page — all images, diagrams, tables, and text. Use ALL of it to create the most comprehensive, unified study guide possible.`,
          sendEvent,
        );

        // Save the merged guide to the primary chapter
        await prisma.chapter.update({
          where: { id: chapter.id },
          data: { studyGuide },
        });

        // Also save to the related chapters so they all share the merged guide
        for (const rc of relatedChapters) {
          await prisma.chapter.update({
            where: { id: rc.id },
            data: { studyGuide },
          });
        }

        sendEvent({
          success: true,
          chapterId: chapter.id,
          studyGuideLength: studyGuide.length,
          sources: [...new Set(bookNames)],
          mergedPages: totalPages,
          matchedChapters: allChapters.map((c) => ({
            id: c.id,
            bookSource: c.bookSource,
            title: c.title,
          })),
        });
      } catch (err: unknown) {
        console.error("Merge study guide error:", err);
        const errMsg = getAnthropicErrorMessage(err) || "Merge study guide generation failed";
        sendEvent({ error: errMsg });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

async function handleSeed() {
  const existingChapters = await prisma.chapter.count();
  if (existingChapters > 0) {
    return NextResponse.json({
      message: `Database already has ${existingChapters} chapters. Skipping seed.`,
      skipped: true,
    });
  }

  return NextResponse.json({
    message: "To seed the database, run: npx tsx prisma/seed.ts (from frontend directory)",
    skipped: false,
  });
}

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { CLAUDE_MODEL, getClaudeClient } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Append new content to an existing study guide.
 * Takes raw text (e.g. from NotebookLM) and uses Claude to format it to match
 * the existing study guide style, then appends it.
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

  const body = await request.json();
  const { content, position = "end" } = body;

  if (!content || typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
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

      // Heartbeat to prevent timeout
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 8000);

      try {
        send({ status: "formatting", message: "Formatting new content to match study guide style..." });

        const client = getClaudeClient();

        // Take a sample of the existing guide (first ~3000 chars) for style reference
        const styleSample = chapter.studyGuide!.substring(0, 3000);

        const prompt = `You are a medical education content formatter. You are given NEW CONTENT to incorporate into an existing radiology study guide.

Your job: Transform the new content into the EXACT same format and style as the existing study guide. Match its structure, callout styles, level of detail, and markdown formatting precisely.

═══════════════════════════════════════════════════════
EXISTING STUDY GUIDE STYLE (for reference — match this format):
═══════════════════════════════════════════════════════
${styleSample}
...

═══════════════════════════════════════════════════════
FORMATTING RULES (use these callout styles):
═══════════════════════════════════════════════════════
> 💡 **PEARL:** [clinical insight]
> 🔴 **PITFALL:** [common mistake or trap]
> ⚡ **HIGH YIELD:** [must-know exam fact]
> 🧠 **MNEMONIC:** [memory aid]
> 🎯 **STOP & THINK:** [active recall question]
> ✅ **KEY POINT:** [essential takeaway]
> ⚖️ **VS:** [comparison]

Use markdown tables for comparisons. Bold all classic signs and diagnosis names.
Add Radiopaedia links where appropriate: [Radiopaedia: Name](https://radiopaedia.org/articles/name)

═══════════════════════════════════════════════════════
NEW CONTENT TO FORMAT AND INCORPORATE:
═══════════════════════════════════════════════════════
${content}

═══════════════════════════════════════════════════════

Transform the new content above into a well-structured section that seamlessly fits the existing study guide. Start with an appropriate ## heading. Include pearls, pitfalls, high-yield facts, mnemonics, tables, and active recall questions as appropriate.

Output ONLY the formatted section — no preamble, no wrapping code fences. Return raw markdown.`;

        // Stream the response
        const clientStream = client.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 16000,
          messages: [{ role: "user", content: prompt }],
        });

        let formattedContent = "";
        let lastReport = 0;

        clientStream.on("text", (chunk) => {
          formattedContent += chunk;
          if (formattedContent.length - lastReport > 500) {
            lastReport = formattedContent.length;
            const words = Math.round(formattedContent.length / 5);
            send({ status: "formatting", message: `Formatting... (~${words.toLocaleString()} words)` });
          }
        });

        await clientStream.finalMessage();

        send({ status: "saving", message: "Inserting into study guide..." });

        // Insert the formatted content at the chosen position
        const separator = "\n\n---\n\n";
        let updatedGuide: string;

        if (position === "start") {
          updatedGuide = formattedContent + separator + chapter.studyGuide;
        } else if (typeof position === "number") {
          // Insert after the section at the given index
          const sections = chapter.studyGuide!.split(/\n---\n/);
          const insertIdx = Math.min(position + 1, sections.length);
          sections.splice(insertIdx, 0, "\n" + formattedContent + "\n");
          updatedGuide = sections.join("\n---\n");
        } else {
          // "end" or any other value → append at the end
          updatedGuide = chapter.studyGuide + separator + formattedContent;
        }

        await prisma.chapter.update({
          where: { id: chapterId },
          data: { studyGuide: updatedGuide },
        });

        send({
          success: true,
          chapterId,
          addedLength: formattedContent.length,
          totalLength: updatedGuide.length,
          message: "Section added to study guide",
        });
      } catch (err) {
        console.error("Append section error:", err);
        send({ error: err instanceof Error ? err.message : "Failed to append section" });
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

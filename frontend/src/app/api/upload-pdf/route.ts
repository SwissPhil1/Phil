import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Allow up to 5 minutes for uploading to Files API
export const maxDuration = 300;

export const runtime = "nodejs";

/**
 * POST /api/upload-pdf
 *
 * Accepts a single PDF chunk (already page-extracted on the client) via FormData.
 * Uploads it directly to the Anthropic Files API and returns the file_id.
 *
 * The client handles PDF splitting — this route just proxies to Files API.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const pdfFile = formData.get("pdf") as File | null;
    const filename = (formData.get("filename") as string) || "chunk.pdf";

    if (!pdfFile) {
      return NextResponse.json({ error: "Missing 'pdf' file in form data" }, { status: 400 });
    }

    let client: Anthropic;
    try {
      client = new Anthropic();
    } catch {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured." },
        { status: 500 }
      );
    }

    // Re-create the File with proper name for the Files API
    const buffer = await pdfFile.arrayBuffer();
    const file = new File(
      [Buffer.from(buffer)],
      filename,
      { type: "application/pdf" }
    );

    const uploaded = await client.beta.files.upload({ file });

    return NextResponse.json({
      success: true,
      fileId: uploaded.id,
    });
  } catch (error: unknown) {
    console.error("Upload-pdf error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const chunk = formData.get("chunk") as Blob | null;
    const uploadId = formData.get("uploadId") as string | null;
    const chunkIndex = parseInt(formData.get("chunkIndex") as string, 10);
    const totalChunks = parseInt(formData.get("totalChunks") as string, 10);

    if (!chunk || !uploadId || isNaN(chunkIndex) || isNaN(totalChunks)) {
      return NextResponse.json(
        { error: "Missing required fields: chunk, uploadId, chunkIndex, totalChunks" },
        { status: 400 }
      );
    }

    // Validate uploadId to prevent path traversal
    if (!/^[a-zA-Z0-9-]+$/.test(uploadId)) {
      return NextResponse.json({ error: "Invalid uploadId" }, { status: 400 });
    }

    const uploadDir = path.join("/tmp", `pdf-upload-${uploadId}`);
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const buffer = Buffer.from(await chunk.arrayBuffer());
    await writeFile(path.join(uploadDir, `chunk-${chunkIndex}`), buffer);

    // Count how many chunks we have so far
    let receivedCount = 0;
    for (let i = 0; i < totalChunks; i++) {
      if (existsSync(path.join(uploadDir, `chunk-${i}`))) {
        receivedCount++;
      }
    }

    return NextResponse.json({
      received: chunkIndex,
      totalReceived: receivedCount,
      totalChunks,
      complete: receivedCount === totalChunks,
    });
  } catch (error) {
    console.error("Chunk upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to store chunk" },
      { status: 500 }
    );
  }
}

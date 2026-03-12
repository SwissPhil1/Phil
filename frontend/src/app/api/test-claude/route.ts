import { NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL } from "@/lib/claude";

export const dynamic = "force-dynamic";

/**
 * Quick test endpoint to verify the Anthropic API key works.
 * GET /api/test-claude
 * Returns a simple response or the exact error.
 */
export async function GET() {
  try {
    const client = getClaudeClient();
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 20,
      messages: [{ role: "user", content: "Say 'API works!' in exactly 2 words." }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "unknown";
    return NextResponse.json({ ok: true, response: text, model: CLAUDE_MODEL });
  } catch (err: unknown) {
    const errObj = err as { status?: number; error?: { message?: string; type?: string }; message?: string };
    return NextResponse.json({
      ok: false,
      status: errObj.status,
      type: errObj.error?.type,
      message: errObj.error?.message || errObj.message || String(err),
    }, { status: errObj.status || 500 });
  }
}

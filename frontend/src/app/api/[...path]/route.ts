import { NextRequest } from "next/server";

const BACKEND_URL = "https://phil-production.up.railway.app";

async function proxyRequest(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const search = request.nextUrl.search;
  const targetUrl = `${BACKEND_URL}${path}${search}`;

  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body:
        request.method !== "GET" && request.method !== "HEAD"
          ? await request.text()
          : undefined,
    });

    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type":
          res.headers.get("Content-Type") || "application/json",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Backend unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;

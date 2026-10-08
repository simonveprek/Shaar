import { NextResponse, type NextRequest } from "next/server";

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

/** CORS for the separate Next.js frontend. Webhooks are server-to-server and need no CORS. */
export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  const headers: Record<string, string> = { ...corsHeaders };
  if (allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};

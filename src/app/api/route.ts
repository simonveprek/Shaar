import { catalogJson } from "@/lib/api-catalog";

/** Machine-readable index of every route. Human docs: /docs. */
export async function GET() {
  return Response.json({
    name: "Shaar API",
    docs: "/docs",
    auth: "Send `Authorization: Bearer <Supabase access token>` to routes with auth: \"user\".",
    errors: "Errors are JSON { error, details? } with a matching HTTP status.",
    routes: catalogJson(),
  });
}

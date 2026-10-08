import { catalogJson } from "@/lib/api-catalog";

/** Machine-readable index of every route. Human docs: /docs. */
export async function GET() {
  return Response.json({
    name: "Shaar API",
    docs: "/docs",
    auth: "Routes with auth: \"user\" need the signed shaar_visitor cookie, set by the first POST /api/discover or /api/research.",
    errors: "Errors are JSON { error, details? } with a matching HTTP status.",
    routes: catalogJson(),
  });
}

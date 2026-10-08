import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`);

/** Wraps a route handler so thrown HttpErrors / ZodErrors become JSON error responses. */
export function handle<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return Response.json({ error: err.message, details: err.details }, { status: err.status });
      }
      if (err instanceof z.ZodError) {
        return Response.json({ error: "Invalid request", details: z.treeifyError(err) }, { status: 400 });
      }
      console.error(err);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
  return schema.parse(body);
}

type DbResult<T> = { data: T | null; error: { message: string } | null };

/** Returns the data of a Supabase query, throwing on a database error or a missing row. */
export function must<T>(result: DbResult<T>): T {
  check(result);
  if (result.data === null) throw new HttpError(500, "Database returned no data");
  return result.data;
}

/** Like `must`, but a missing row (from `maybeSingle()`) is returned as null. */
export function maybe<T>(result: DbResult<T>): T | null {
  check(result);
  return result.data;
}

/** Throws on a database error; for writes whose result isn't needed. The detail is logged, not sent to the client. */
export function check(result: { error: { message: string } | null }): void {
  if (!result.error) return;
  console.error("Database error:", result.error.message);
  throw new HttpError(500, "Database error");
}

/** Reads an integer query parameter. Missing or non-numeric values give the fallback; others are clamped to the range. */
export function intParam(value: string | null, { fallback, min, max }: { fallback: number; min: number; max: number }): number {
  const n = value === null || value.trim() === "" ? NaN : Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

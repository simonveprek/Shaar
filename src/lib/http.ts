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

/*
 * The browser's way into the API. Same origin, so the visitor cookie the
 * server sets goes along on its own. No sign-in screen, nothing to configure.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls this app's API as the current visitor. Throws ApiError with a plain message on failure. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiError(0, "No connection. Try again.");
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    // 503 is a setup problem with a plain message worth showing as is. Other server errors stay vague.
    const message =
      res.status === 503 && body?.error
        ? body.error
        : res.status >= 500
          ? "Shaar could not reach its sources. Try again."
          : (body?.error ?? "Something went wrong");
    throw new ApiError(res.status, message);
  }
  return body as T;
}

import { db } from "./supabase";
import { HttpError } from "./http";

export type AuthUser = { id: string; email?: string };

/**
 * Resolves the Supabase user from `Authorization: Bearer <access_token>`.
 * The frontend gets the token from `supabase.auth.getSession()`.
 */
export async function requireUser(req: Request): Promise<AuthUser> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new HttpError(401, "Missing bearer token");

  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid or expired token");
  return { id: data.user.id, email: data.user.email };
}

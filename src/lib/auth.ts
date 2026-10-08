import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./supabase";
import { env } from "./env";
import { HttpError } from "./http";

export type AuthUser = { id: string; email?: string };

/*
 * Who is asking. Either a Supabase access token (`Authorization: Bearer ...`,
 * for a separate frontend with its own sign-in), or a visitor of this site.
 *
 * Visitors never sign up. The first time one starts something, the server
 * creates a quiet Supabase user for them with the secret key and remembers the
 * browser with a signed, httpOnly cookie. Their files stay theirs, with no
 * login screen and no dependence on Supabase's anonymous sign-in setting.
 */

const VISITOR = "shaar_visitor";
const YEAR = 60 * 60 * 24 * 365;

const secret = () => env().VISITOR_SECRET ?? createHmac("sha256", env().SUPABASE_SECRET_KEY).update("shaar visitor").digest("hex");
const sign = (id: string) => createHmac("sha256", secret()).update(id).digest("base64url");

function verified(cookie: string | undefined): string | null {
  const [id, signature] = cookie?.split(".") ?? [];
  if (!id || !signature) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/**
 * The current user. Pass `{ visitor: "create" }` on the routes where a visit begins
 * (starting a search or a job); everywhere else an unknown visitor gets a 401.
 */
export async function requireUser(req: Request, opts: { visitor?: "create" } = {}): Promise<AuthUser> {
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) {
    const { data, error } = await db().auth.getUser(header.slice(7));
    if (error || !data.user) throw new HttpError(401, "Invalid or expired token");
    return { id: data.user.id, email: data.user.email };
  }

  const jar = await cookies();
  const known = verified(jar.get(VISITOR)?.value);
  if (known) return { id: known };
  if (opts.visitor !== "create") throw new HttpError(401, "Not signed in");

  const { data, error } = await db().auth.admin.createUser({
    email: `visitor-${randomUUID()}@visitors.shaar.invalid`,
    email_confirm: true,
    user_metadata: { visitor: true },
  });
  if (error || !data.user) throw new HttpError(500, `Could not create a visitor: ${error?.message ?? "unknown"}`);

  jar.set(VISITOR, `${data.user.id}.${sign(data.user.id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: YEAR,
  });
  return { id: data.user.id };
}

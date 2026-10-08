import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { HttpError } from "./http";

export type AuthUser = { id: string };

/*
 * Who is asking. Visitors never sign up: the first time one starts something,
 * they get a random id in a signed, httpOnly cookie, and everything they make
 * is stored under that id. Nobody can read another visitor's files without
 * forging the signature.
 */

const VISITOR = "shaar_visitor";
const YEAR = 60 * 60 * 24 * 365;

let cachedSecret: string | undefined;

/** VISITOR_SECRET if set, otherwise a random secret made once and kept in .data, so localhost needs no setup. */
function secret(): string {
  if (cachedSecret) return cachedSecret;
  if (process.env.VISITOR_SECRET) return (cachedSecret = process.env.VISITOR_SECRET);
  const file = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ? path.dirname(process.env.DATA_DIR) : ".data", "visitor-secret");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return (cachedSecret = readFileSync(file, "utf8").trim());
}

const sign = (id: string) => createHmac("sha256", secret()).update(id).digest("base64url");

function verified(cookie: string | undefined): string | null {
  const [id, signature] = cookie?.split(".") ?? [];
  if (!id || !signature) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/**
 * The current visitor. Pass `{ visitor: "create" }` on the routes where a visit begins
 * (starting a search or a job); everywhere else an unknown visitor gets a 401.
 */
export async function requireUser(_req: Request, opts: { visitor?: "create" } = {}): Promise<AuthUser> {
  const jar = await cookies();
  const known = verified(jar.get(VISITOR)?.value);
  if (known) return { id: known };
  if (opts.visitor !== "create") throw new HttpError(401, "Not signed in");

  const id = randomUUID();
  jar.set(VISITOR, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: YEAR,
  });
  return { id };
}

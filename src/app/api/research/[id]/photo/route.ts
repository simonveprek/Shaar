import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { photoSource, type DossierItem } from "@/lib/dossier";
import { handle, notFound } from "@/lib/http";
import { getJob } from "@/lib/research";

/*
 * The person's profile picture, served from here. Platform image links expire within days and many refuse
 * to load on other sites, so the first request fetches it once and keeps a copy next to the database.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const dir = () => path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ? path.dirname(process.env.DATA_DIR) : ".data", "photos");

export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]/photo">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await getJob(id, user.id);

  const file = path.join(dir(), `${id}`);
  const cached = await readFile(file).catch(() => null);
  const type = await readFile(`${file}.type`, "utf8").catch(() => null);
  if (cached && type) return image(cached, type);

  const profiles = await sql<DossierItem>(
    "select platform, kind, author, text, posted_at, url, metrics, media from scraped_items where job_id = $1 and kind = 'profile'",
    [id],
  );
  const source = photoSource(profiles);
  if (!source) throw notFound("Photo");

  const res = await fetch(source, { headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*" } }).catch(() => null);
  const contentType = res?.headers.get("content-type") ?? "";
  if (!res?.ok || !contentType.startsWith("image/")) throw notFound("Photo");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw notFound("Photo");

  await mkdir(dir(), { recursive: true });
  await Promise.all([writeFile(file, bytes), writeFile(`${file}.type`, contentType)]);
  return image(bytes, contentType);
});

const image = (bytes: Buffer, type: string) =>
  new Response(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });

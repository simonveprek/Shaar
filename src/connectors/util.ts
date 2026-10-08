import type { NormalizedItem } from "./types";

type Raw = Record<string, unknown>;

/** Reads a dotted path (e.g. "author.name") from a raw item. */
export function get(raw: unknown, path: string): unknown {
  let cur: unknown = raw;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Raw)[key];
  }
  return cur;
}

/** First non-empty string among the given paths. */
export function str(raw: unknown, ...paths: string[]): string | null {
  for (const p of paths) {
    const v = get(raw, p);
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** First finite number among the given paths. */
export function num(raw: unknown, ...paths: string[]): number | null {
  for (const p of paths) {
    const v = get(raw, p);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** First parseable date among the given paths, as ISO string. Accepts ISO strings and unix seconds/millis. */
export function date(raw: unknown, ...paths: string[]): string | null {
  for (const p of paths) {
    const v = get(raw, p);
    if (v === null || v === undefined || v === "") continue;
    let d: Date;
    if (typeof v === "number") d = new Date(v < 1e12 ? v * 1000 : v);
    else if (typeof v === "string" && /^\d+$/.test(v)) d = new Date(Number(v) < 1e12 ? Number(v) * 1000 : Number(v));
    else d = new Date(String(v));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/** Builds a metrics object from label -> paths, dropping missing values. */
export function metrics(raw: unknown, spec: Record<string, string[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [label, paths] of Object.entries(spec)) {
    const v = num(raw, ...paths);
    if (v !== null) out[label] = v;
  }
  return out;
}

/** Collects string URLs from the given paths (strings or arrays of strings / {url} objects). */
export function mediaUrls(raw: unknown, ...paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const v = get(raw, p);
    const list = Array.isArray(v) ? v : [v];
    for (const entry of list) {
      if (typeof entry === "string" && entry.startsWith("http")) out.push(entry);
      else if (entry && typeof entry === "object") {
        const url = str(entry, "url", "src", "uri");
        if (url?.startsWith("http")) out.push(url);
      }
    }
  }
  return [...new Set(out)].slice(0, 10);
}

/** Strips "@", whitespace and a trailing slash from a handle. */
export function cleanHandle(target: string): string {
  return target.trim().replace(/^@/, "").replace(/\/+$/, "");
}

export const isUrl = (target: string) => /^https?:\/\//i.test(target.trim());

/** Extracts the username from a URL like https://www.instagram.com/<user>/ or returns the cleaned handle. */
export function handleFrom(target: string, pathPrefix = ""): string {
  if (!isUrl(target)) return cleanHandle(target);
  const url = new URL(target.trim());
  const segments = url.pathname.split("/").filter(Boolean);
  const prefixSegments = pathPrefix.split("/").filter(Boolean);
  const rest = segments.slice(prefixSegments.length);
  return cleanHandle(rest[0] ?? "");
}

/** Stable id for the profile item of a handle, so profile data from several actors/items dedupes. */
export const profileId = (handle: string | null | undefined) => `profile:${(handle ?? "unknown").toLowerCase()}`;

/** Normalizes a profile URL or handle into a full URL on the given site. */
export function toUrl(target: string, base: string): string {
  if (isUrl(target)) return target.trim();
  return `${base}${cleanHandle(target)}/`;
}


/** Builds a NormalizedItem, filling defaults. */
export function item(fields: Partial<NormalizedItem> & Pick<NormalizedItem, "kind" | "externalId">): NormalizedItem {
  return { url: null, author: null, text: null, postedAt: null, metrics: {}, media: [], ...fields };
}

/** Joins non-empty text parts (e.g. title + description). */
export const joinText = (...parts: (string | null)[]) => parts.filter(Boolean).join("\n\n") || null;

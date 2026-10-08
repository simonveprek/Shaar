import { listConnectors } from "@/connectors";
import { parseProfileUrl, PROFILE_SITES } from "@/connectors/profile-url";
import { apify, TERMINAL_RUN_STATUSES } from "./apify";
import { env } from "./env";
import { maybe, must, notFound } from "./http";
import { db } from "./supabase";

/*
 * From a name to profiles. One Google search per platform for the name in
 * quotes, run as a single Apify actor run. Results that are real profile links
 * become candidates, ranked by how well their title matches the name. Nothing
 * is scraped until the visitor confirms which candidates are the person.
 */

const ACTOR = "apify/google-search-scraper";

export type Candidate = {
  id: string;
  platform: string;
  label: string;
  handle: string;
  url: string;
  title: string;
  snippet: string;
  /** 0 to 1, how closely the result's title matches the name. */
  match: number;
};

export type DiscoveryRow = {
  id: string;
  user_id: string;
  name: string;
  purpose: string | null;
  status: "searching" | "ready" | "failed";
  apify_run_id: string | null;
  candidates: Candidate[];
  error: string | null;
  created_at: string;
};

const LABELS = new Map(listConnectors().map((c) => [c.platform, c.label]));
const PER_PLATFORM = 2;

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Share of the name's words that appear in the result title or handle. */
function matchScore(name: string, title: string, handle: string): number {
  const want = words(name);
  if (!want.length) return 0;
  const have = new Set([...words(title), ...words(handle)]);
  const joinedHandle = words(handle).join("");
  const hits = want.filter((w) => have.has(w) || joinedHandle.includes(w)).length;
  return hits / want.length;
}

export async function startDiscovery(userId: string, name: string, purpose: string | null): Promise<DiscoveryRow> {
  const row = must(
    await db().from("discoveries").insert({ user_id: userId, name, purpose }).select().single<DiscoveryRow>(),
  );
  try {
    const queries = PROFILE_SITES.map((s) => `"${name.replace(/"/g, "")}" site:${s.site}`).join("\n");
    const run = await apify()
      .actor(ACTOR)
      .start(
        { queries, maxPagesPerQuery: 1, mobileResults: false, saveHtml: false },
        { maxTotalChargeUsd: env().APIFY_MAX_CHARGE_USD_PER_RUN },
      );
    return must(
      await db().from("discoveries").update({ apify_run_id: run.id }).eq("id", row.id).select().single<DiscoveryRow>(),
    );
  } catch (err) {
    return must(
      await db()
        .from("discoveries")
        .update({ status: "failed", error: `Could not start the search: ${err instanceof Error ? err.message : err}` })
        .eq("id", row.id)
        .select()
        .single<DiscoveryRow>(),
    );
  }
}

export async function getDiscovery(id: string, userId: string): Promise<DiscoveryRow> {
  const row = maybe(await db().from("discoveries").select().eq("id", id).eq("user_id", userId).maybeSingle<DiscoveryRow>());
  if (!row) throw notFound("Discovery");
  return row;
}

/** Checks the search; once it has finished, turns its results into ranked candidates. Safe to call repeatedly. */
export async function syncDiscovery(row: DiscoveryRow): Promise<DiscoveryRow> {
  if (row.status !== "searching" || !row.apify_run_id) return row;
  const run = await apify().run(row.apify_run_id).get();
  if (!run || !(TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status)) return row;

  const { items } = await apify().dataset(run.defaultDatasetId).listItems({ clean: true, limit: 50 });
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const page of items as { organicResults?: { title?: string; url?: string; description?: string }[] }[]) {
    for (const result of page.organicResults ?? []) {
      const ref = result.url ? parseProfileUrl(result.url) : null;
      if (!ref) continue;
      const id = `${ref.platform}:${ref.handle.toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const title = (result.title ?? "").trim();
      candidates.push({
        id,
        platform: ref.platform,
        label: LABELS.get(ref.platform) ?? ref.platform,
        handle: ref.handle,
        url: ref.url,
        title,
        snippet: (result.description ?? "").trim().slice(0, 220),
        match: matchScore(row.name, title, ref.handle),
      });
    }
  }

  // The best few per platform, closest matches first. Weak matches are dropped: likely someone else.
  const kept = candidates
    .filter((c) => c.match >= 0.5)
    .sort((a, b) => b.match - a.match)
    .filter((c, _, all) => all.filter((o) => o.platform === c.platform).indexOf(c) < PER_PLATFORM);

  const failed = run.status !== "SUCCEEDED" && kept.length === 0;
  // Conditional on still searching, so two pollers can't both write. The loser re-reads the winner's result.
  const updated = maybe(
    await db()
      .from("discoveries")
      .update({
        status: failed ? "failed" : "ready",
        candidates: kept,
        error: failed ? `Search ${run.status}` : null,
      })
      .eq("id", row.id)
      .eq("status", "searching")
      .select()
      .maybeSingle<DiscoveryRow>(),
  );
  return updated ?? getDiscovery(row.id, row.user_id);
}

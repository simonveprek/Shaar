import { listConnectors } from "@/connectors";
import { parseProfileUrl, PROFILE_SITES } from "@/connectors/profile-url";
import { apify, TERMINAL_RUN_STATUSES } from "./apify";
import { env } from "./env";
import { json, maybeOne, one } from "./db";
import { HttpError, notFound } from "./http";

/*
 * From a name to profiles. One Google search per platform for the name in
 * quotes, plus one open search for their own website, run as a single Apify
 * actor run. Results that are real profile links become candidates, ranked by
 * how well their title matches the name. A site whose domain carries the name
 * becomes a website candidate. Nothing is scraped until the visitor confirms
 * which candidates are the person.
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
  /** Google results read per platform. Null until the search has finished. */
  scanned: Record<string, number> | null;
  error: string | null;
  created_at: string;
};

const LABELS = new Map(listConnectors().map((c) => [c.platform, c.label]));

// Sites that are never a person's own website, even when their name is on them.
const NOT_OWN_SITE =
  /(^|\.)(instagram|tiktok|x|twitter|linkedin|youtube|facebook|reddit|threads|pinterest|wikipedia|wikidata|google|imdb|crunchbase|github|medium|amazon|apple|spotify|bloomberg|forbes|nytimes|bbc|cnn|theguardian|zoominfo|rocketreach|signalhire|peoplefinders|whitepages|spokeo)\.[a-z.]+$/i;

/** A site that is probably the person's own: its domain spells their name, like janedoe.com or jane-doe.design. */
export function ownSite(name: string, url: string): { host: string; origin: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (NOT_OWN_SITE.test(host)) return null;
  const label = words(host.split(".").slice(0, -1).join(" ")).join("");
  const parts = words(name).filter((w) => w.length > 1);
  if (!parts.length) return null;
  // Every part of the name, or at least the surname and the first initial, must be in the domain.
  const surname = parts[parts.length - 1];
  const spells = parts.every((w) => label.includes(w)) || (label.includes(surname) && label.startsWith(parts[0][0]));
  return spells ? { host, origin: parsed.origin } : null;
}
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
  apify(); // Fails with "Apify is not set up yet" before anything is saved.
  const row = await one<DiscoveryRow>("insert into discoveries (user_id, name, purpose) values ($1, $2, $3) returning *", [
    userId,
    name,
    purpose,
  ]);
  return launchSearch(row);
}

/**
 * Starts the search run. When the Apify plan has no free slot (a file may still be collecting), the search
 * stays queued and syncDiscovery starts it on a later poll.
 */
async function launchSearch(row: DiscoveryRow): Promise<DiscoveryRow> {
  try {
    const name = row.name.replace(/"/g, "");
    // One search per platform, and one open search where their own website would show up.
    const queries = [...PROFILE_SITES.map((s) => `"${name}" site:${s.site}`), `"${name}"`].join("\n");
    const run = await apify()
      .actor(ACTOR)
      .start(
        { queries, maxPagesPerQuery: 1, mobileResults: false, saveHtml: false },
        { maxTotalChargeUsd: env().APIFY_MAX_CHARGE_USD_PER_RUN },
      );
    const updated = await maybeOne<DiscoveryRow>(
      "update discoveries set apify_run_id = $1 where id = $2 and apify_run_id is null returning *",
      [run.id, row.id],
    );
    return updated ?? getDiscovery(row.id, row.user_id);
  } catch (err) {
    // A missing Apify token is a setup problem the visitor should hear about plainly, not a failed search.
    if (err instanceof HttpError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/concurrent actor runs|memory limit/i.test(message)) return row;
    return one<DiscoveryRow>("update discoveries set status = 'failed', error = $1 where id = $2 returning *", [
      `Could not start the search: ${message}`,
      row.id,
    ]);
  }
}

export async function getDiscovery(id: string, userId: string): Promise<DiscoveryRow> {
  const row = /^[0-9a-f-]{36}$/i.test(id)
    ? await maybeOne<DiscoveryRow>("select * from discoveries where id = $1 and user_id = $2", [id, userId])
    : null;
  if (!row) throw notFound("Discovery");
  return row;
}

/** Checks the search; once it has finished, turns its results into ranked candidates. Safe to call repeatedly. */
export async function syncDiscovery(row: DiscoveryRow): Promise<DiscoveryRow> {
  if (row.status !== "searching") return row;
  if (!row.apify_run_id) return launchSearch(row);
  const run = await apify().run(row.apify_run_id).get();
  if (!run || !(TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status)) return row;

  const { items } = await apify().dataset(run.defaultDatasetId).listItems({ clean: true, limit: 50 });
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const scanned: Record<string, number> = {};
  type Page = { searchQuery?: { term?: string }; organicResults?: { title?: string; url?: string; description?: string }[] };
  for (const page of items as Page[]) {
    // Each page answers one query, and each query names the site it searched.
    const term = page.searchQuery?.term ?? "";
    const site = PROFILE_SITES.find((s) => term.includes(`site:${s.site}`));
    if (site) scanned[site.platform] = (scanned[site.platform] ?? 0) + (page.organicResults?.length ?? 0);
    for (const result of page.organicResults ?? []) {
      const site = !result.url || parseProfileUrl(result.url) ? null : ownSite(row.name, result.url);
      if (site && !seen.has(`website:${site.host}`)) {
        seen.add(`website:${site.host}`);
        candidates.push({
          id: `website:${site.host}`,
          platform: "website",
          label: "Website",
          handle: site.host,
          url: site.origin,
          title: (result.title ?? "").trim(),
          snippet: (result.description ?? "").trim().slice(0, 220),
          match: 1,
        });
      }
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
  const updated = await maybeOne<DiscoveryRow>(
    `update discoveries set status = $1, candidates = $2::jsonb, error = $3, scanned = $5::jsonb
     where id = $4 and status = 'searching' returning *`,
    [failed ? "failed" : "ready", json(kept), failed ? `Search ${run.status}` : null, row.id, json(scanned)],
  );
  return updated ?? getDiscovery(row.id, row.user_id);
}

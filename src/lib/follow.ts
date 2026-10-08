import { listConnectors } from "@/connectors";
import { parseProfileUrl, type ProfileRef } from "@/connectors/profile-url";
import { cleanHandle } from "@/connectors/util";
import { matchScore, NOT_OWN_SITE } from "./discovery";

/*
 * Following the person's own links. People list their other accounts on their website and in their bios,
 * and those links are better evidence than any name search: Michael's site names an Instagram account that
 * no search for his name would find. Once a confirmed profile or their site is read, every account it links
 * to on a platform Shaar has not read yet is read too, in the same job.
 *
 * What counts as theirs:
 *   a link in one of their bios, one their site declares as theirs in JSON-LD (sameAs), or one a ChatGPT web
 *   search is sure of, always;
 *   any other link on their site or from the web search only when the handle spells their name, since sites
 *   link to friends and clients.
 * People keep second accounts (simon.veprek next to simonveprek), so a platform can have two. The second needs
 * a declared link, or a bio link whose handle spells their name. A website comes only from a bio or a sure web search, and a job
 * follows at most MAX_FOLLOWS accounts.
 */

export const MAX_FOLLOWS = 6;
const PER_PLATFORM = 2;

export type LinkSource = {
  platform: string;
  kind: string;
  links: string[];
  details: Record<string, unknown> | null;
};
export type Follow = { platform: string; target: string; from: string };
type RunLike = { platform: string; target: string; followed_from: string | null };

const CONNECTORS = new Map(listConnectors().map((c) => [c.platform, c.label]));

/** A link to a repository counts as a link to its owner's account. */
function profileOf(link: string): ProfileRef | null {
  const ref = parseProfileUrl(link);
  if (ref) return ref;
  const repo = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/[^/?#]+/i.exec(link);
  return repo ? parseProfileUrl(`https://github.com/${repo[1]}`) : null;
}

/** One key per account, so a handle and a URL for the same account match. */
function key(platform: string, target: string): string {
  if (platform === "website") return "website";
  const ref = parseProfileUrl(target);
  return `${platform}:${(ref?.handle ?? cleanHandle(target)).toLowerCase()}`;
}

/** Accounts to start for a job, from what its finished runs found. Pure, so pollers racing get the same answer. */
export function linksToFollow(name: string, runs: RunLike[], sources: LinkSource[]): Follow[] {
  const taken = new Set(runs.map((r) => key(r.platform, r.target)));
  // Accounts per platform, counting each account once however many actors read it.
  const perPlatform = new Map<string, number>();
  for (const k of taken) perPlatform.set(k.split(":")[0], (perPlatform.get(k.split(":")[0]) ?? 0) + 1);
  const count = (platform: string) => perPlatform.get(platform) ?? 0;
  const followed = new Set(runs.filter((r) => r.followed_from).map((r) => key(r.platform, r.target)));
  const out: Follow[] = [];

  // Bios first: what a person writes about their own accounts is the surest sign. Then the web search, then pages.
  const rank = (s: LinkSource) => (s.kind === "page" ? 2 : s.platform === "web" ? 1 : 0);
  const ordered = [...sources].sort((a, b) => rank(a) - rank(b));
  for (const source of ordered) {
    const declared = new Set(Array.isArray(source.details?.sameAs) ? (source.details.sameAs as string[]) : []);
    const searched = source.platform === "web";
    const bio = source.kind === "profile" && !searched;
    const from = searched ? "a web search" : bio ? `their ${CONNECTORS.get(source.platform) ?? source.platform} bio` : "their website";

    for (const link of source.links) {
      if (followed.size + out.length >= MAX_FOLLOWS) return out;
      const ref = profileOf(link);
      if (ref) {
        if (!CONNECTORS.has(ref.platform) || taken.has(key(ref.platform, ref.url))) continue;
        const named = matchScore(name, "", ref.handle) >= 0.5;
        const n = count(ref.platform);
        // A second account on a platform needs more than a bio link: a bio can point at a friend's account.
        const ok =
          n === 0 ? bio || declared.has(link) || named : n < PER_PLATFORM && (declared.has(link) || (bio && named));
        if (!ok) continue;
        out.push({ platform: ref.platform, target: ref.url, from });
        perPlatform.set(ref.platform, count(ref.platform) + 1);
        taken.add(key(ref.platform, ref.url));
        continue;
      }
      // A site from a bio, or one a web search is sure of, is theirs. One linked from their own site is usually
      // someone else's.
      if (!(bio || declared.has(link)) || count("website") > 0) continue;
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        continue;
      }
      const host = url.hostname.replace(/^www\./, "");
      if (NOT_OWN_SITE.test(host) || !/^https?:$/.test(url.protocol)) continue;
      out.push({ platform: "website", target: url.origin, from });
      perPlatform.set("website", 1);
      taken.add("website");
    }
  }
  return out;
}

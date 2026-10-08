import type { Connector } from "./types";
import { item, str } from "./util";

/*
 * The person's own website, read with apify/website-content-crawler: the home page and the pages it links
 * to, as plain text. It feeds the persona with how they describe themselves, in their own words.
 *
 * Personal sites say the most in two places a plain text crawl throws away: the footer, where the links to
 * their other accounts are, and the JSON-LD block, where many sites state a person's job, city, skills,
 * projects and other profiles outright. So the crawl keeps navigation and footers, saves Markdown for the
 * links, and every page's JSON-LD is read into `details`.
 */

const homepage = (target: string) => {
  const url = new URL(/^https?:\/\//i.test(target.trim()) ? target.trim() : `https://${target.trim()}`);
  return `${url.origin}/`;
};

const MAX_PAGES = 12;

type Node = Record<string, unknown>;
export type SiteProject = { name: string; url: string | null; description: string | null };
export type SiteDetails = {
  description: string | null;
  jobTitle: string | null;
  worksFor: string | null;
  location: string | null;
  skills: string[];
  projects: SiteProject[];
  /** Their other profiles, as the site itself declares them. The strongest evidence an account is theirs. */
  sameAs: string[];
};

/** Every object in a JSON-LD block, including those inside @graph and nested properties. */
function nodes(value: unknown, out: Node[] = [], depth = 0): Node[] {
  if (depth > 6 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const v of value) nodes(v, out, depth + 1);
    return out;
  }
  out.push(value as Node);
  for (const v of Object.values(value)) nodes(v, out, depth + 1);
  return out;
}

const types = (n: Node) => [n["@type"]].flat().map(String);
const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : v && typeof v === "object" && !Array.isArray(v) ? text((v as Node).name) : null;
const texts = (v: unknown): string[] => [v].flat().map(text).filter((s): s is string => Boolean(s));

const WORKS = /^(CreativeWork|SoftwareApplication|SoftwareSourceCode|WebApplication|MobileApplication|Product|Book|Article|BlogPosting|MusicAlbum|Movie|VisualArtwork|Project)$/;

/** What the page's JSON-LD says about the person and their work. */
export function siteDetails(raw: Node): SiteDetails {
  const all = nodes((raw.metadata as Node | undefined)?.jsonLd);
  const person = all.find((n) => types(n).includes("Person") && (n.jobTitle || n.sameAs || n.knowsAbout || n.worksFor));
  const address = person?.address as Node | undefined;
  const location = address
    ? [text(address.addressLocality), text(address.addressCountry)].filter(Boolean).join(", ") || null
    : text(person?.homeLocation);
  const projects = all
    .filter((n) => types(n).some((t) => WORKS.test(t)) && text(n.name))
    .map((n) => ({ name: text(n.name)!, url: text(n.url), description: text(n.description) }))
    .filter((p, i, list) => list.findIndex((o) => o.name === p.name) === i)
    .slice(0, 12);
  return {
    description: str(raw, "metadata.description"),
    jobTitle: text(person?.jobTitle),
    worksFor: text(person?.worksFor),
    location,
    skills: texts(person?.knowsAbout).slice(0, 20),
    projects,
    sameAs: [
      ...texts(person?.sameAs),
      ...all.flatMap((n) => texts(n.codeRepository)),
    ].filter((u) => /^https?:\/\//.test(u)),
  };
}

/** Absolute links in the page's Markdown, other than links back to the page itself. */
function markdownLinks(markdown: string | null, self: string): string[] {
  if (!markdown) return [];
  const found = [...markdown.matchAll(/\]\((https?:\/\/[^)\s]+)/g)].map((m) => m[1]);
  return [...new Set(found)].filter((u) => u.replace(/\/$/, "") !== self.replace(/\/$/, "")).slice(0, 80);
}

export const website: Connector = {
  platform: "website",
  label: "Website",
  targetHint: "Their website, like jane.com",
  notes: `Reads up to ${MAX_PAGES} pages of the site.`,
  actors: [
    {
      actorId: "apify/website-content-crawler",
      role: "profile",
      buildInput: (target) => ({
        startUrls: [{ url: homepage(target) }],
        crawlerType: "cheerio",
        maxCrawlPages: MAX_PAGES,
        maxCrawlDepth: 2,
        maxResults: MAX_PAGES,
        // Keep headers, navigation and footers: that is where a person links their other accounts.
        htmlTransformer: "none",
        removeElementsCssSelector:
          'script, style, noscript, svg, img[src^="data:"], [role="alert"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
        saveMarkdown: true,
        removeCookieWarnings: true,
        proxyConfiguration: { useApifyProxy: true },
      }),
      maxItems: () => MAX_PAGES,
      // The actor defaults to 8 GB, the whole free plan. A plain HTTP crawl of a dozen pages needs far less.
      memoryMbytes: 1024,
      normalize: (raw) => {
        const url = str(raw, "url", "crawl.loadedUrl");
        const body = str(raw, "text");
        if (!url || !body) return [];
        const title = str(raw, "metadata.title");
        const details = siteDetails(raw);
        return [
          item({
            kind: "page",
            externalId: url,
            url,
            author: title,
            text: [title, details.description, body].filter(Boolean).join("\n\n").slice(0, 8000),
            links: [...new Set([...details.sameAs, ...markdownLinks(str(raw, "markdown"), url)])],
            details,
          }),
        ];
      },
    },
  ],
};

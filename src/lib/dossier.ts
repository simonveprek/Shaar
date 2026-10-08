import { listConnectors } from "@/connectors";
import type { SiteDetails, SiteProject } from "@/connectors/website";
import type { PersonaProfile } from "./persona";

/*
 * The file. What a watcher could put together from someone's public posts:
 * where they are, when they are online, who they talk to and what they say.
 *
 * It only describes exposure. It never guesses at sensitive traits (politics
 * as a risk, religion, health, sexuality) and never scores a person. The point
 * is how much is already public, not a judgement of the person.
 */

export type DossierItem = {
  platform: string;
  kind: string;
  author: string | null;
  text: string | null;
  posted_at: string | null;
  url: string | null;
  metrics: Record<string, number>;
  /** Profile pictures for profiles, images for posts. */
  media?: string[];
  /** Links the person published in a bio. */
  links?: string[];
  /** Facts the source stated outright (see NormalizedItem.details). */
  details?: Record<string, unknown> | null;
};

export type DossierInput = {
  jobId: string;
  subjectName: string;
  items: DossierItem[];
  persona: PersonaProfile | null;
  /** When the file is compiled. Passed in so the result is reproducible. */
  now: Date;
  /** What a reading of their photo gives away, like where it was taken. Staged in the demo for now. */
  photoReading?: Dossier["photoReading"];
  /**
   * Accounts Shaar found on its own, and where the link was, like "their website". Keyed by
   * "platform:handle", or by platform for a website.
   */
  followed?: Record<string, string>;
};

export type Dossier = {
  fileNumber: string;
  compiledAt: string;
  subject: {
    name: string;
    oneLine: string | null;
    summary: string | null;
    /** The best public profile picture's source URL. Pages show it through /api/research/:id/photo. */
    photo: string | null;
    /** Their own website, from a confirmed site or a link in one of their bios. */
    website: { url: string; host: string; title: string | null } | null;
  };
  totals: {
    items: number;
    posts: number;
    platforms: number;
    reach: number;
    firstSeen: string | null;
    lastSeen: string | null;
    yearsVisible: number;
  };
  presence: {
    platform: string;
    label: string;
    handle: string | null;
    url: string | null;
    followers: number | null;
    posts: number;
    /** What there is to count on it: posts, or pages of a website, or repositories on GitHub. */
    count: { value: number; unit: "posts" | "pages" | "repos" };
    lastSeen: string | null;
    /** The account hides its posts from anyone outside it. */
    private: boolean;
    /** Where Shaar found the account when nobody confirmed it, like "their website". */
    via: string | null;
  }[];
  /** Who they are, from what their profiles and site state outright, then from what the persona read. */
  profile: {
    known: { label: string; value: string; source: string }[];
    work: { role: string | null; company: string | null; when: string | null }[];
    education: { school: string; degree: string | null; when: string | null }[];
    facts: { text: string; platform: string; confidence: "high" | "medium" | "low" }[];
    timeline: { date: string; event: string }[];
  };
  /** What their own website says. */
  website: {
    url: string;
    host: string;
    description: string | null;
    pages: { title: string; url: string; excerpt: string }[];
    projects: SiteProject[];
    skills: string[];
  } | null;
  /**
   * The class the system files them under, S to F, by how legible they are to it: S is fully mapped, F is a blank,
   * and a blank is a finding of its own. It is the satire this product exists for: it scores how much a watcher
   * has, never the person's worth.
   */
  assessment: {
    grade: "S" | "A" | "B" | "C" | "D" | "F";
    score: number;
    line: string;
    factors: { label: string; value: number }[];
  };
  /** What their photo gives away. */
  photoReading: { label: string; value: string; relevance: number }[] | null;
  /** What ChatGPT found about them on the open web: pages about them, and what those pages state. */
  web: {
    mentions: { title: string; url: string; source: string; date: string | null; summary: string | null }[];
    facts: { text: string; url: string; source: string }[];
  } | null;
  /** What they build in public, from GitHub. */
  code: {
    repos: { name: string; description: string | null; language: string | null; stars: number; url: string | null; lastWorked: string | null }[];
    languages: { label: string; count: number }[];
    actions: number;
  } | null;
  /** Posts by weekday (Monday first) and hour, in UTC. */
  routine: { grid: number[][]; peak: { day: number; hour: number; count: number } | null; busiestHours: number[] };
  /** Posts per month, oldest first, up to the last 24 months. */
  activity: { label: string; value: number }[];
  topics: { label: string; count: number }[];
  circle: { handle: string; count: number }[];
  quotes: { platform: string; text: string; postedAt: string | null; url: string | null; engagement: number }[];
  views: { topic: string; stance: string; evidence: string; platform: string }[];
  exposure: { score: number; factors: { label: string; detail: string; value: number }[] };
};

const LABELS = new Map(listConnectors().map((c) => [c.platform, c.label]));
const UNIT: Record<string, "pages" | "repos"> = { website: "pages", github: "repos" };
const COUNTED = { posts: "post", pages: "page", repos: "repo" } as const;
const DAY = 24 * 60 * 60 * 1000;

const engagement = (m: Record<string, number>) =>
  (m.likes ?? 0) + (m.comments ?? 0) * 2 + (m.replies ?? 0) * 2 + (m.shares ?? 0) * 3 + (m.reposts ?? 0) * 3 + (m.upvotes ?? 0);

/** A stable file number from the job, like 0417-K. */
function fileNumber(id: string): string {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const n = Math.abs(h);
  return `${String(n % 10000).padStart(4, "0")}-${"ABCDEFGHJKLMNPRSTVWXZ"[(n >>> 14) % 21]}`;
}

function counted<T>(values: T[]): Map<T, number> {
  const map = new Map<T, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return map;
}

const top = <T,>(map: Map<T, number>, n: number) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

// Where a profile picture is most likely a clear photo of the face, best first.
const PHOTO_ORDER = ["linkedin", "instagram", "x", "tiktok", "threads", "facebook", "github", "youtube", "pinterest", "reddit"];

/** The profile picture to show for the person, or null. */
export function photoSource(items: DossierItem[]): string | null {
  const profiles = items.filter((i) => i.kind === "profile" && i.media?.length);
  profiles.sort((a, b) => rank(a.platform) - rank(b.platform));
  return profiles[0]?.media?.[0] ?? null;
}
const rank = (platform: string) => (PHOTO_ORDER.indexOf(platform) + 1 || 99);

// Platforms and big sites that are never someone's own website.
const NOT_A_WEBSITE =
  /(^|\.)(instagram|tiktok|x|twitter|linkedin|youtube|youtu|facebook|fb|reddit|threads|pinterest|google|apple|wikipedia|t)\.(com|net|org|be|co|me)$/i;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Pages of their site, home page first: it is where a site says who they are. */
const sitePages = (items: DossierItem[]) =>
  items
    .filter((i) => i.kind === "page" && i.url)
    .sort((a, b) => new URL(a.url!).pathname.length - new URL(b.url!).pathname.length);

/** Their website: a crawled site first, then a link from a bio, then a URL written in a bio. */
function findWebsite(items: DossierItem[]): Dossier["subject"]["website"] {
  const page = sitePages(items)[0];
  if (page?.url) {
    const host = hostOf(page.url);
    if (host) return { url: new URL(page.url).origin, host, title: page.author };
  }
  const profiles = items.filter((i) => i.kind === "profile");
  const written = profiles.flatMap((p) => [...(p.text ?? "").matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]));
  for (const link of [...profiles.flatMap((p) => p.links ?? []), ...written]) {
    const host = hostOf(link);
    if (host && !NOT_A_WEBSITE.test(host)) return { url: link, host, title: null };
  }
  return null;
}

const detail = (item: DossierItem | undefined, key: string): string | null => {
  const v = item?.details?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

type Work = Dossier["profile"]["work"][number];
type School = { school: string | null; degree: string | null; period: string | null };

/** Who they are. A fact a source states outright beats one the persona inferred, and says where it is from. */
function buildProfile(items: DossierItem[], persona: PersonaProfile | null): Dossier["profile"] {
  const of = (platform: string, kind = "profile") => items.find((i) => i.platform === platform && i.kind === kind);
  const site = items.find((i) => i.kind === "page" && (i.details?.jobTitle || i.details?.location || i.details?.worksFor));
  const linkedin = of("linkedin");
  const github = of("github");
  const work = ((linkedin?.details?.work as { role: string | null; company: string | null; from: string | null; to: string | null }[]) ?? [])
    .map<Work>((w) => ({ role: w.role, company: w.company, when: [w.from, w.to].filter(Boolean).join(" to ") || null }));
  const current = work.find((w) => /present/i.test(w.when ?? ""));

  const known: Dossier["profile"]["known"] = [];
  const add = (label: string, options: [string | null | undefined, string][]) => {
    const hit = options.find(([value]) => value);
    if (hit) known.push({ label, value: hit[0]!, source: hit[1] });
  };
  add("Works as", [
    [detail(site, "jobTitle"), "Their website"],
    [current?.role, "LinkedIn"],
    [detail(linkedin, "headline"), "LinkedIn"],
    [persona?.demographics?.occupation, "Read from their posts"],
  ]);
  add("Works at", [
    [detail(site, "worksFor"), "Their website"],
    [current?.company, "LinkedIn"],
    [detail(github, "company"), "GitHub"],
  ]);
  add("Lives in", [
    [detail(site, "location"), "Their website"],
    [detail(linkedin, "location"), "LinkedIn"],
    [detail(github, "location"), "GitHub"],
    [persona?.demographics?.location, "Read from their posts"],
  ]);
  add("Age", [[persona?.demographics?.age_range, "Read from their posts"]]);
  // Only the language names; the model sometimes explains each one ("English, used in most posts").
  const languages = (persona?.demographics?.languages ?? []).map((l) => l.split(/\s+[—–-]\s+|\s*[(,:;]/)[0].trim());
  add("Speaks", [[[...new Set(languages.filter((l) => l && l.length < 24))].join(", "), "Read from their posts"]]);

  return {
    known,
    work: work.slice(0, 6),
    education: ((linkedin?.details?.education as School[]) ?? [])
      .filter((e): e is School & { school: string } => Boolean(e.school))
      .map((e) => ({ school: e.school, degree: e.degree, when: e.period })),
    facts: (persona?.notable_facts ?? []).slice(0, 8).map((f) => ({
      text: f.fact,
      // A fact can rest on several sources, given as "github, website".
      platform: f.source_platform
        .split(/\s*,\s*/)
        .map((p) => LABELS.get(p.toLowerCase()) ?? p)
        .join(", "),
      confidence: f.confidence,
    })),
    timeline: (persona?.timeline ?? []).slice(0, 8),
  };
}

/** Their website as they present it: what it says about them, their projects and skills, and the pages read. */
function buildWebsite(items: DossierItem[]): Dossier["website"] {
  const pages = sitePages(items);
  if (!pages.length) return null;
  const details = pages.map((p) => (p.details ?? {}) as Partial<SiteDetails>);
  const origin = new URL(pages[0].url!).origin;
  const projects = details
    .flatMap((d) => d.projects ?? [])
    .filter((p, i, all) => all.findIndex((o) => o.name.toLowerCase() === p.name.toLowerCase()) === i)
    // The site itself is not one of its projects.
    .filter((p) => !p.url || hostOf(p.url) !== hostOf(origin) || new URL(p.url).pathname.length > 1)
    .slice(0, 8);
  return {
    url: origin,
    host: hostOf(origin) ?? origin,
    description: details.find((d) => d.description)?.description ?? null,
    pages: pages.slice(0, 8).map((p) => {
      const lines = (p.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      // Skip the title and description repeated at the top, and keep the first real sentence or two.
      const body = lines.filter((l) => l !== p.author && l.length > 40).join(" ");
      return { title: p.author ?? new URL(p.url!).pathname, url: p.url!, excerpt: body.slice(0, 220) };
    }),
    projects,
    skills: [...new Set(details.flatMap((d) => d.skills ?? []))].slice(0, 16),
  };
}

/** Pages about them and what those pages state, newest first. Their own accounts and site are not mentions. */
function buildWeb(items: DossierItem[]): Dossier["web"] {
  const handles = items
    .filter((i) => i.kind === "profile" && i.author && i.platform !== "web")
    .map((i) => i.author!.toLowerCase().replace(/^@/, ""));
  const siteHost = sitePages(items)[0]?.url ? hostOf(sitePages(items)[0].url!) : null;
  const theirOwn = (url: string) => {
    const host = hostOf(url);
    const path = (() => {
      try {
        return new URL(url).pathname.toLowerCase();
      } catch {
        return "";
      }
    })();
    // A path segment that starts with one of their handles: github.com/simonveprek/fragms, linkedin.com/posts/simonveprek_...
    return (siteHost !== null && host === siteHost) || handles.some((h) => h.length > 2 && path.split("/").some((seg) => seg === h || seg.startsWith(`${h}_`)));
  };
  const mentions = items
    .filter((i) => i.kind === "mention" && i.url && !theirOwn(i.url))
    .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""))
    .map((m) => ({
      title: detail(m, "title") ?? m.url!,
      url: m.url!,
      source: detail(m, "source") ?? hostOf(m.url!) ?? "",
      date: m.posted_at,
      summary: detail(m, "summary"),
    }));
  const found = items.find((i) => i.platform === "web" && i.kind === "profile");
  const facts = ((found?.details?.facts as { fact: string; url: string }[]) ?? []).map((f) => ({
    text: f.fact,
    url: f.url,
    source: hostOf(f.url) ?? "",
  }));
  return mentions.length || facts.length ? { mentions: mentions.slice(0, 12), facts: facts.slice(0, 10) } : null;
}

/** What they build in public: their repositories, the languages they write, and how active they are. */
function buildCode(items: DossierItem[]): Dossier["code"] {
  const repos = items.filter((i) => i.kind === "repo");
  const actions = items.filter((i) => i.kind === "activity").length;
  if (!repos.length && !actions) return null;
  const languages = counted(repos.map((r) => detail(r, "language")).filter((l): l is string => Boolean(l)));
  return {
    repos: [...repos]
      .sort((a, b) => (b.metrics.stars ?? 0) - (a.metrics.stars ?? 0) || (b.posted_at ?? "").localeCompare(a.posted_at ?? ""))
      .slice(0, 6)
      .map((r) => ({
        name: detail(r, "name") ?? r.text ?? "",
        description: detail(r, "description"),
        language: detail(r, "language"),
        stars: r.metrics.stars ?? 0,
        url: r.url,
        lastWorked: r.posted_at,
      })),
    languages: top(languages, 8).map(([label, count]) => ({ label, count })),
    actions,
  };
}

const GRADES: { min: number; grade: Dossier["assessment"]["grade"]; line: string }[] = [
  { min: 85, grade: "S", line: "Fully legible. Every account linked, every habit on record." },
  { min: 70, grade: "A", line: "Highly legible. Little is left to find." },
  { min: 55, grade: "B", line: "Legible, with gaps a watcher would want closed." },
  { min: 40, grade: "C", line: "Partly legible. Worth a closer look." },
  { min: 25, grade: "D", line: "Barely legible. Flagged for attention." },
  { min: 0, grade: "F", line: "Opaque. To the system, opacity is a finding." },
];

/** The class: how much of a person the system can see, from identity, routine, record, reach and the web. */
function assess(x: {
  accounts: number;
  known: number;
  routine: number;
  reach: number;
  posts: number;
  years: number;
  mentions: number;
}): Dossier["assessment"] {
  const clamp = (n: number) => Math.round(Math.max(0, Math.min(100, n)));
  const factors = [
    { label: "Identity", value: clamp(x.accounts * 14 + x.known * 7) },
    { label: "Routine", value: clamp((x.routine / 0.5) * 100) },
    { label: "Record", value: clamp((Math.log10(x.posts + 1) / 2.5) * 70 + (x.years / 8) * 30) },
    { label: "Reach", value: clamp((Math.log10(x.reach + 1) / 4) * 100) },
    { label: "Named elsewhere", value: clamp(x.mentions * 25) },
  ];
  const weights = [0.3, 0.2, 0.2, 0.15, 0.15];
  const score = clamp(factors.reduce((sum, f, i) => sum + f.value * weights[i], 0));
  const { grade, line } = GRADES.find((g) => score >= g.min)!;
  return { grade, score, line, factors };
}

export function buildDossier({ jobId, subjectName, items, persona, now, followed = {}, photoReading }: DossierInput): Dossier {
  // Only things they wrote are posts. Pages, repositories and bare activity are not, though activity has a time.
  const posts = items.filter((i) => i.kind === "post" || i.kind === "comment");
  const actions = items.filter((i) => i.kind === "activity");
  const profiles = items.filter((i) => i.kind === "profile");
  // When they are online counts every public action with a time, like a push to GitHub at 2 am.
  const dated = [...posts, ...actions].filter((p) => p.posted_at).map((p) => ({ ...p, at: new Date(p.posted_at!) }));
  dated.sort((a, b) => a.at.getTime() - b.at.getTime());

  // The subject's own handles, so they are not counted as people in their circle.
  const own = new Set(
    [...profiles, ...posts].map((i) => i.author?.toLowerCase().replace(/^@/, "")).filter(Boolean) as string[],
  );

  // Where they are. One row per account: people keep two Instagrams. The web search is a source, not a place.
  const platforms = [...new Set(items.map((i) => i.platform))].filter((p) => p !== "web");
  const presence = platforms
    .flatMap((platform) => {
      const accounts = profiles.filter((p) => p.platform === platform);
      const unit = UNIT[platform] ?? "posts";
      const site = platform === "website" ? sitePages(items)[0]?.url : null;
      return (accounts.length ? accounts : [undefined]).map((profile) => {
        // With two accounts on a platform, each counts what its own handle posted.
        const mine = (i: DossierItem) =>
          i.platform === platform && (accounts.length < 2 || i.author?.toLowerCase() === profile?.author?.toLowerCase());
        const theirs = dated.filter(mine);
        const handle = site ? hostOf(site) : (profile?.author ?? theirs[0]?.author ?? null);
        return {
          platform,
          label: LABELS.get(platform) ?? platform,
          handle,
          url: profile?.url ?? null,
          followers: profile?.metrics.followers ?? null,
          posts: posts.filter(mine).length,
          count: { value: items.filter((i) => mine(i) && i.kind === COUNTED[unit]).length, unit },
          lastSeen: theirs.at(-1)?.posted_at ?? null,
          private: profile?.details?.private === true,
          via: followed[`${platform}:${handle?.toLowerCase().replace(/^@/, "")}`] ?? followed[platform] ?? null,
        };
      });
    })
    .sort((a, b) => b.posts - a.posts);

  // When they are online.
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const p of dated) grid[(p.at.getUTCDay() + 6) % 7][p.at.getUTCHours()]++;
  let peak: Dossier["routine"]["peak"] = null;
  grid.forEach((row, day) =>
    row.forEach((count, hour) => {
      if (count > 0 && (!peak || count > peak.count)) peak = { day, hour, count };
    }),
  );
  const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((sum, row) => sum + row[h], 0));
  const busiestHours = byHour
    .map((count, hour) => ({ count, hour }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((h) => h.hour);

  // How much, over time.
  const months = new Map<string, number>();
  for (const p of dated) {
    const key = `${p.at.getUTCFullYear()}-${String(p.at.getUTCMonth() + 1).padStart(2, "0")}`;
    months.set(key, (months.get(key) ?? 0) + 1);
  }
  const activity: Dossier["activity"] = [];
  if (dated.length) {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const first = dated[0].at;
    let cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    const earliest = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 23, 1));
    if (cursor < earliest) cursor = earliest;
    while (cursor <= end) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
      activity.push({
        label: cursor.toLocaleString("en", { month: "short", year: "2-digit", timeZone: "UTC" }),
        value: months.get(key) ?? 0,
      });
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
  }

  // What they talk about, and who with.
  const texts = posts.map((p) => p.text ?? "");
  const tags = counted(texts.flatMap((t) => [...t.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)].map((m) => m[1].toLowerCase())));
  const mentions = counted(
    texts
      .flatMap((t) => [...t.matchAll(/(?:^|[^\w])@([A-Za-z0-9_.]{2,30})/g)].map((m) => m[1].replace(/\.$/, "").toLowerCase()))
      .filter((h) => !own.has(h)),
  );
  const topics = top(tags, 12).map(([label, count]) => ({ label: `#${label}`, count }));
  for (const interest of persona?.interests ?? []) {
    if (topics.length >= 14) break;
    if (!topics.some((t) => t.label.toLowerCase() === interest.toLowerCase())) topics.push({ label: interest, count: 0 });
  }

  // With no posts to quote, the way they describe themselves on their own site is still their own words.
  const pages = sitePages(items);
  const quotable = posts.length ? posts : pages.map((p) => ({ ...p, text: detail(p, "description") }));
  const quotes = quotable
    .filter((p) => (p.text ?? "").trim().length > 24)
    .map((p) => ({
      platform: LABELS.get(p.platform) ?? p.platform,
      text: (p.text ?? "").trim().slice(0, 280),
      postedAt: p.posted_at,
      url: p.url,
      engagement: engagement(p.metrics),
    }))
    .sort((a, b) => b.engagement - a.engagement)
    // People repost themselves. Show each thing they said once.
    .filter((q, i, all) => all.findIndex((o) => o.text.toLowerCase() === q.text.toLowerCase()) === i)
    .slice(0, 4);

  const firstSeen = dated[0]?.posted_at ?? null;
  const lastSeen = dated.at(-1)?.posted_at ?? null;
  const yearsVisible = firstSeen ? Math.max(0, (now.getTime() - new Date(firstSeen).getTime()) / (365.25 * DAY)) : 0;
  const reach = presence.reduce((sum, p) => sum + (p.followers ?? 0), 0);

  // Exposure, 0 to 100. How much a watcher has to work with, not anything about the person.
  const routineShare = dated.length ? busiestHours.reduce((s, h) => s + byHour[h], 0) / dated.length : 0;
  const factors = [
    {
      label: "Volume",
      detail: actions.length ? `${posts.length} posts, ${actions.length} actions` : `${posts.length} public posts`,
      value: Math.min(1, Math.log10(posts.length + actions.length + 1) / 3) * 35,
    },
    { label: "Breadth", detail: `${platforms.length} platforms`, value: Math.min(1, platforms.length / 5) * 25 },
    { label: "History", detail: `${yearsVisible.toFixed(1)} years of posts`, value: Math.min(1, yearsVisible / 8) * 20 },
    {
      label: "Routine",
      detail: `${Math.round(routineShare * 100)}% of posts in 3 hours of the day`,
      value: Math.min(1, routineShare / 0.5) * 20,
    },
  ];

  const profile = buildProfile(items, persona);
  const web = buildWeb(items);
  return {
    fileNumber: fileNumber(jobId),
    compiledAt: now.toISOString(),
    subject: {
      name: persona?.display_name || subjectName,
      oneLine: persona?.one_line_summary ?? null,
      summary: persona?.summary ?? null,
      photo: photoSource(items),
      website: findWebsite(items),
    },
    totals: { items: items.length, posts: posts.length, platforms: platforms.length, reach, firstSeen, lastSeen, yearsVisible },
    presence,
    routine: { grid, peak, busiestHours },
    activity,
    topics,
    circle: top(mentions, 8).map(([handle, count]) => ({ handle, count })),
    quotes,
    views: (persona?.opinions ?? []).slice(0, 5).map((o) => ({
      topic: o.topic,
      stance: o.stance,
      evidence: o.evidence,
      platform: LABELS.get(o.source_platform) ?? o.source_platform,
    })),
    exposure: {
      score: Math.round(factors.reduce((s, f) => s + f.value, 0)),
      factors: factors.map((f) => ({ ...f, value: Math.round(f.value) })),
    },
    profile,
    website: buildWebsite(items),
    code: buildCode(items),
    web,
    assessment: assess({
      accounts: presence.length,
      known: profile.known.length + profile.work.length,
      routine: routineShare,
      reach,
      posts: posts.length + actions.length,
      years: yearsVisible,
      mentions: web?.mentions.length ?? 0,
    }),
    photoReading: photoReading ?? null,
  };
}

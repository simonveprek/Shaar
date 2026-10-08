import { listConnectors } from "@/connectors";
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
};

export type DossierInput = {
  jobId: string;
  subjectName: string;
  items: DossierItem[];
  persona: PersonaProfile | null;
  /** When the file is compiled. Passed in so the result is reproducible. */
  now: Date;
};

export type Dossier = {
  fileNumber: string;
  compiledAt: string;
  subject: { name: string; oneLine: string | null; summary: string | null };
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
    lastSeen: string | null;
  }[];
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

export function buildDossier({ jobId, subjectName, items, persona, now }: DossierInput): Dossier {
  const posts = items.filter((i) => i.kind !== "profile");
  const profiles = items.filter((i) => i.kind === "profile");
  const dated = posts.filter((p) => p.posted_at).map((p) => ({ ...p, at: new Date(p.posted_at!) }));
  dated.sort((a, b) => a.at.getTime() - b.at.getTime());

  // The subject's own handles, so they are not counted as people in their circle.
  const own = new Set(
    [...profiles, ...posts].map((i) => i.author?.toLowerCase().replace(/^@/, "")).filter(Boolean) as string[],
  );

  // Where they are.
  const platforms = [...new Set(items.map((i) => i.platform))];
  const presence = platforms
    .map((platform) => {
      const profile = profiles.find((p) => p.platform === platform);
      const theirs = dated.filter((p) => p.platform === platform);
      return {
        platform,
        label: LABELS.get(platform) ?? platform,
        handle: profile?.author ?? theirs[0]?.author ?? null,
        url: profile?.url ?? null,
        followers: profile?.metrics.followers ?? null,
        posts: posts.filter((p) => p.platform === platform).length,
        lastSeen: theirs.at(-1)?.posted_at ?? null,
      };
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

  const quotes = posts
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
    { label: "Volume", detail: `${posts.length} public posts`, value: Math.min(1, Math.log10(posts.length + 1) / 3) * 35 },
    { label: "Breadth", detail: `${platforms.length} platforms`, value: Math.min(1, platforms.length / 5) * 25 },
    { label: "History", detail: `${yearsVisible.toFixed(1)} years of posts`, value: Math.min(1, yearsVisible / 8) * 20 },
    {
      label: "Routine",
      detail: `${Math.round(routineShare * 100)}% of posts in 3 hours of the day`,
      value: Math.min(1, routineShare / 0.5) * 20,
    },
  ];

  return {
    fileNumber: fileNumber(jobId),
    compiledAt: now.toISOString(),
    subject: { name: persona?.display_name || subjectName, oneLine: persona?.one_line_summary ?? null, summary: persona?.summary ?? null },
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
  };
}

import type { DossierInput, DossierItem } from "./dossier";
import type { PersonaProfile } from "./persona";

/*
 * A fictional subject for the sample file at /dossier/sample. Every name,
 * handle and post here is invented. Generated from a fixed seed, so the file
 * looks the same on every load.
 */

function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = new Date("2026-10-08T12:00:00Z");

const LINES = [
  "Morning run along the river before the city wakes up #running",
  "Third roll through the old Kiev 88 and it finally behaves #filmphotography",
  "Nobody talks about how good concrete looks in the rain #brutalism",
  "Coffee with @lena.k, talked about the studio move for two hours #coffee",
  "New prints going up at @studio_nord on Friday, come by",
  "Tram 22 at 7am is the most honest place in this city",
  "Spent the weekend shooting the housing blocks in the east #brutalism #filmphotography",
  "If your app needs an account to read a menu I am leaving #design",
  "Long run done, legs gone, worth it #running",
  "@tomas_r you were right about the 50mm, I take it all back",
  "Free public transport would fix half of what is wrong here",
  "Remote work did more for my sleep than any app ever did",
  "Darkroom night with @kofi.dev, the smell never leaves your hands #filmphotography",
  "Grey again. Good light for faces though",
  "Booked the train to Vienna for the print fair #travel",
  "Why does every new building look like a render of itself #design #brutalism",
]
;
const PLATFORMS = [
  { platform: "x", weight: 0.42, author: "maravell" },
  { platform: "instagram", weight: 0.3, author: "mara.vell" },
  { platform: "reddit", weight: 0.18, author: "vell_m" },
  { platform: "linkedin", weight: 0.1, author: "mara-vell" },
];

/** Evenings after work and late weekend mornings, the way a real routine shows up in timestamps. */
function postingTime(rand: () => number, day: Date): Date {
  const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
  const r = rand();
  const hour = weekend
    ? r < 0.6
      ? 9 + Math.floor(rand() * 3)
      : 17 + Math.floor(rand() * 5)
    : r < 0.2
      ? 6 + Math.floor(rand() * 2)
      : r < 0.35
        ? 12
        : 19 + Math.floor(rand() * 4);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, Math.floor(rand() * 60)));
}

export function sampleDossierInput(): DossierInput {
  const rand = seeded(417);
  const items: DossierItem[] = [];

  const followers: Record<string, number> = { x: 2340, instagram: 4120, reddit: 0, linkedin: 610 };
  for (const p of PLATFORMS) {
    items.push({
      platform: p.platform,
      kind: "profile",
      author: p.author,
      text: "Photographer. Concrete, film, early trains. Prague.",
      posted_at: null,
      url: null,
      metrics: followers[p.platform] ? { followers: followers[p.platform] } : {},
    });
  }

  // About three years of posts, busier lately.
  const start = Date.UTC(2023, 8, 1);
  for (let t = start; t < NOW.getTime(); t += 24 * 60 * 60 * 1000) {
    const progress = (t - start) / (NOW.getTime() - start);
    if (rand() > 0.12 + 0.18 * progress) continue;
    const pick = rand();
    let acc = 0;
    const where = PLATFORMS.find((p) => (acc += p.weight) >= pick) ?? PLATFORMS[0];
    const at = postingTime(rand, new Date(t));
    const text = LINES[Math.floor(rand() * LINES.length)];
    items.push({
      platform: where.platform,
      kind: "post",
      author: where.author,
      text,
      posted_at: at.toISOString(),
      url: null,
      metrics: { likes: Math.floor(rand() * 180), comments: Math.floor(rand() * 14) },
    });
  }

  const persona = {
    display_name: "Mara Vell",
    one_line_summary: "Film photographer in Prague who shoots concrete, runs at dawn and posts most evenings.",
    summary:
      "Mara photographs post-war housing and city infrastructure, mostly on film. She runs most mornings, works from home and posts in the evening after work. Her circle is small and local, mostly other photographers and a print studio.",
    interests: ["Film photography", "Brutalist architecture", "Running", "Public transport", "Print fairs"],
    opinions: [
      {
        topic: "Public transport",
        stance: "Thinks it should be free",
        evidence: "Free public transport would fix half of what is wrong here",
        source_platform: "x",
      },
      {
        topic: "Remote work",
        stance: "Strongly for it",
        evidence: "Remote work did more for my sleep than any app ever did",
        source_platform: "x",
      },
      {
        topic: "New architecture",
        stance: "Finds most of it hollow",
        evidence: "Why does every new building look like a render of itself",
        source_platform: "instagram",
      },
    ],
  } as unknown as PersonaProfile;

  return { jobId: "sample-mara-vell", subjectName: "Mara Vell", items, persona, now: NOW };
}

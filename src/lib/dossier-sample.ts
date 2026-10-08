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

  // Her own site, and what LinkedIn states about her work. Invented, like everything here.
  items.push(
    {
      platform: "website",
      kind: "page",
      author: "Mara Vell, photographer",
      text: "Mara Vell, photographer\n\nFilm photographs of post-war housing, tram depots and the people who live with concrete. Prints, commissions and the occasional workshop.",
      posted_at: null,
      url: "https://mara-vell.example/",
      metrics: {},
      details: {
        description: "Film photographs of post-war housing, tram depots and the people who live with concrete.",
        jobTitle: "Photographer",
        worksFor: "Studio Nord",
        location: "Prague, CZ",
        skills: ["Medium format film", "Darkroom printing", "Architecture", "Portraits"],
        projects: [
          { name: "Panel", url: "https://mara-vell.example/panel", description: "Three years of housing blocks on the east side, shot on a Kiev 88." },
          { name: "Depot", url: "https://mara-vell.example/depot", description: "Night shifts at the tram depot, with the people who keep it running." },
          { name: "Dawn runs", url: "https://mara-vell.example/dawn", description: "The city before it wakes up, one roll a week." },
        ],
        sameAs: [],
      },
    },
    {
      platform: "website",
      kind: "page",
      author: "Prints and commissions",
      text: "Prints and commissions\n\nEvery print is made by hand in my darkroom in Žižkov. Editions of twenty, signed. Commissions for architects and housing cooperatives.",
      posted_at: null,
      url: "https://mara-vell.example/prints",
      metrics: {},
    },
  );
  items.find((i) => i.platform === "linkedin")!.details = {
    headline: "Photographer at Studio Nord",
    location: "Prague, Czechia",
    work: [
      { role: "Photographer", company: "Studio Nord", from: "Mar 2022", to: "Present" },
      { role: "Photo editor", company: "Městský list", from: "Jan 2018", to: "Feb 2022" },
    ],
    education: [{ school: "FAMU Prague", degree: "Photography", period: "2013 to 2017" }],
  };

  // A second Instagram, for film only, and what a web search found. Invented too.
  items.push(
    {
      platform: "instagram",
      kind: "profile",
      author: "mara.film",
      text: "Kiev 88 only. Prague after dark.",
      posted_at: null,
      url: null,
      metrics: { followers: 380 },
    },
    {
      platform: "web",
      kind: "profile",
      author: null,
      text: null,
      posted_at: null,
      url: null,
      metrics: {},
      details: {
        facts: [
          { fact: "Showed the Panel series at a Prague gallery in 2025", url: "https://galerie.example/panel" },
          { fact: "Teaches a darkroom workshop twice a year", url: "https://studionord.example/workshops" },
          { fact: "Was shortlisted for a city photography award in 2024", url: "https://prague-photo.example/2024" },
        ],
      },
    },
    ...[
      ["Panel, photographs of the east side estates", "galerie.example", "2025-03-14", "Gallery page for her solo show of medium format photographs of housing blocks."],
      ["Darkroom workshop with Mara Vell", "studionord.example", "2026-05-02", "Studio Nord lists her as the teacher of its spring darkroom workshop."],
      ["Shortlist 2024", "prague-photo.example", "2024-11-20", "Names her among twelve shortlisted photographers for the city award."],
      ["The people who keep the trams running", "citypaper.example", "2023-09-08", "A city paper feature built around her Depot series, with an interview."],
    ].map(([title, source, date, summary]) => ({
      platform: "web",
      kind: "mention",
      author: source,
      text: `${title}\n\n${summary}`,
      posted_at: `${date}T09:00:00.000Z`,
      url: `https://${source}/${title.toLowerCase().replace(/[^a-z]+/g, "-")}`,
      metrics: {},
      details: { title, source, summary },
    })),
  );

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
    demographics: { age_range: "30 to 35", location: "Prague", occupation: "Photographer", languages: ["Czech", "English"] },
    notable_facts: [
      { fact: "Runs along the river most mornings before work", source_platform: "x", confidence: "high" },
      { fact: "Prints in her own darkroom in Žižkov", source_platform: "website", confidence: "high" },
      { fact: "Shoots mostly on a Kiev 88 medium format camera", source_platform: "instagram", confidence: "medium" },
      { fact: "Planning to show prints at a fair in Vienna", source_platform: "x", confidence: "medium" },
    ],
    timeline: [
      { date: "2017", event: "Graduated in photography from FAMU" },
      { date: "2018", event: "Started as a photo editor at a city paper" },
      { date: "2022", event: "Joined Studio Nord as a photographer" },
      { date: "2023", event: "Began the Panel series on the east side housing blocks" },
      { date: "2026", event: "Booked a train to the Vienna print fair" },
    ],
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

  return {
    jobId: "sample-mara-vell",
    subjectName: "Mara Vell",
    items,
    persona,
    now: NOW,
    followed: { "linkedin:mara-vell": "their website", "instagram:mara.film": "a web search" },
  };
}

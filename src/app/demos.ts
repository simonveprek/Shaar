import type { Candidate } from "@/lib/discovery";

/*
 * Staged runs of the whole flow, with no API calls: the name types itself in, the search plays out with these
 * accounts, and the file opens from a fixture. /demo is Mara Vell, who is fictional. /demo/simon is Šimon Vepřek
 * from his own public record, with a staged photo and a second Instagram found by the handle lookup.
 */

export type DemoScript = {
  name: string;
  /** How long the staged search takes, in ms. */
  searchMs: number;
  candidates: Candidate[];
  /** How many Google results each site gave back. */
  scanned: Record<string, number>;
  /** Where the confirmed accounts go: the demo's collecting screen and file. */
  fileHref: string;
};

/** Fictional. One of the accounts found is a look-alike who is not her, to show why the visitor has to confirm. */
export const MARA: DemoScript = {
  name: "Mara Vell",
  searchMs: 5200,
  candidates: [
  {
    id: "x:maravell", platform: "x", label: "X (Twitter)", handle: "maravell", url: "https://x.com/maravell",
    title: "Mara Vell (@maravell) / X", snippet: "Photographer. Concrete, film, early trains. Prague. 2,340 followers.", match: 1,
  },
  {
    id: "instagram:mara.vell", platform: "instagram", label: "Instagram", handle: "mara.vell", url: "https://instagram.com/mara.vell",
    title: "Mara Vell (@mara.vell) • Instagram photos and videos", snippet: "4,120 followers. Film photography, housing blocks, the river at dawn.", match: 1,
  },
  {
    id: "linkedin:mara-vell", platform: "linkedin", label: "LinkedIn", handle: "mara-vell", url: "https://linkedin.com/in/mara-vell",
    title: "Mara Vell, Photographer, Prague", snippet: "Freelance architectural photographer. Prints shown at Studio Nord.", match: 1,
  },
  {
    id: "reddit:vell_m", platform: "reddit", label: "Reddit", handle: "vell_m", url: "https://reddit.com/user/vell_m",
    title: "u/vell_m (Mara Vell)", snippet: "Posts in r/AnalogCommunity, r/brutalism and r/Prague.", match: 1,
  },
  {
    id: "website:mara-vell.example", platform: "website", label: "Website", handle: "mara-vell.example", url: "https://mara-vell.example",
    title: "Mara Vell, photographs of concrete and film", snippet: "Portfolio, prints and contact. Prague.", match: 1,
  },
  {
    id: "facebook:maravella.bakes", platform: "facebook", label: "Facebook", handle: "maravella.bakes", url: "https://facebook.com/maravella.bakes",
    title: "Mara Vella Bakes | Sliema, Malta", snippet: "Family bakery in Sliema since 1998. Pastizzi every morning.", match: 0.5,
  },
],
  scanned: {
  instagram: 10, tiktok: 4, x: 9, linkedin: 8, youtube: 3, facebook: 10, reddit: 6, threads: 2, pinterest: 5, github: 4,
},
  fileHref: "/demo/file",
};

/** Šimon Vepřek, from what his own search found: Google, the Instagram handle lookup and the web search. */
export const SIMON: DemoScript = {
  name: "Šimon Vepřek",
  searchMs: 6400,
  candidates: [
    {
      id: "website:simonveprek.cz", platform: "website", label: "Website", handle: "simonveprek.cz", url: "https://simonveprek.cz",
      title: "Šimon Vepřek, fullstack developer in Prague", snippet: "Fullstack developer with six years of experience. Currently at Etnetera Core, previously ZLKL and GC System.", match: 1,
    },
    {
      id: "linkedin:simonveprek", platform: "linkedin", label: "LinkedIn", handle: "simonveprek", url: "https://www.linkedin.com/in/simonveprek",
      title: "Šimon Vepřek, Fullstack Developer at Etnetera Core", snippet: "Found by a web search. Prague. 627 followers. Builds with agentic workflows.", match: 0.95,
    },
    {
      id: "instagram:simonveprek", platform: "instagram", label: "Instagram", handle: "simonveprek", url: "https://www.instagram.com/simonveprek",
      title: "Simon Veprek (@simonveprek)", snippet: "Private account · 99 followers · I feel like we will meet.. 🌍 17/197", match: 1,
    },
    {
      id: "instagram:simon.veprek", platform: "instagram", label: "Instagram", handle: "simon.veprek", url: "https://www.instagram.com/simon.veprek",
      title: "Simon Veprek (@simon.veprek)", snippet: "Found by the handle lookup. Tag along on my journey. Tech & Lifestyle · @smirky", match: 1,
    },
    {
      id: "github:simonveprek", platform: "github", label: "GitHub", handle: "simonveprek", url: "https://github.com/simonveprek",
      title: "simonveprek (Šimon Vepřek)", snippet: "Fullstack Dev @ Etnetera Core. Building smirky.dev. Working on Mac apps. 12 repositories.", match: 1,
    },
  ],
  scanned: { instagram: 5, tiktok: 0, x: 0, linkedin: 3, youtube: 1, facebook: 2, reddit: 0, threads: 0, pinterest: 0, github: 1 },
  fileHref: "/demo/simon/file",
};

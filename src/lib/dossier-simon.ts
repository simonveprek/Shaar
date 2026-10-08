import record from "../../fixtures/dossiers/simon-veprek.json";
import type { Dossier, DossierInput, DossierItem } from "./dossier";
import type { PersonaProfile } from "./persona";

/*
 * Šimon Vepřek's file for /demo/simon. The items and persona are a snapshot of a real run on his public
 * record (his website, GitHub, LinkedIn, private Instagram and a ChatGPT web search). Staged on top: the
 * photo, his second Instagram as the handle lookup found it, and a reading of the photo, which real files do
 * not make yet.
 */

const NOW = new Date("2026-10-09T00:30:00Z");

/** The portrait the demo shows, from public/demo. */
export const SIMON_PHOTO = "/demo/simon-veprek.jpg";

const PHOTO_READING: NonNullable<Dossier["photoReading"]> = [
  { label: "Where", value: "Paris, at the foot of the Eiffel Tower. The landmark fills the frame behind him.", relevance: 94 },
  { label: "Travel", value: "Abroad, and often. His Instagram bio counts 17 of 197 countries.", relevance: 88 },
  { label: "When", value: "A summer evening at golden hour, with the tower lights already on.", relevance: 71 },
  { label: "Habit", value: "Selfies at landmarks, held at arm's length. Expect more like it on the account he keeps private.", relevance: 63 },
  { label: "Worn", value: "A white linen shirt, travelling light.", relevance: 38 },
];

export function simonDossierInput(): DossierInput {
  const items: DossierItem[] = [
    ...(record.items as unknown as DossierItem[]),
    {
      platform: "instagram",
      kind: "profile",
      author: "simon.veprek",
      text: "Tag along on my journey.\n[📝] Tech & Lifestyle\n[💼] @smirky",
      posted_at: null,
      url: "https://www.instagram.com/simon.veprek",
      metrics: { followers: 1 },
      details: { private: false, name: "Simon Veprek" },
    },
  ];
  return {
    jobId: "demo-simon-veprek",
    subjectName: record.subjectName,
    items,
    persona: record.persona as unknown as PersonaProfile,
    now: NOW,
    followed: {
      "linkedin:simonveprek": "their website",
      "github:simonveprek": "their website",
      "instagram:simon.veprek": "a handle lookup",
    },
    photoReading: PHOTO_READING,
  };
}

import type { Metadata } from "next";
import { buildDossier } from "@/lib/dossier";
import { SIMON_PHOTO, simonDossierInput } from "@/lib/dossier-simon";
import { DemoFile, type DemoStep } from "../../file/demo-file";

export const metadata: Metadata = { title: { absolute: "Shaar demo" }, robots: { index: false } };

/** His sources as his real run found them: the site first, then what it led to, then the web search. */
const STEPS: DemoStep[] = [
  { platform: "website", items: 2, at: 1100 },
  { platform: "instagram", items: 2, at: 1900 },
  { platform: "github", items: 23, at: 3000, via: "their website" },
  { platform: "linkedin", items: 30, at: 4600, via: "their website" },
  { platform: "web", items: 3, at: 6800 },
];

export default function SimonDemoFilePage() {
  const dossier = buildDossier(simonDossierInput());
  dossier.subject.photo = SIMON_PHOTO;
  return (
    <DemoFile
      dossier={dossier}
      steps={STEPS}
      interviewHref="/demo/simon/interview"
      caption="Demo · his public record, staged photo"
    />
  );
}

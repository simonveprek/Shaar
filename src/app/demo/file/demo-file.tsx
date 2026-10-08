"use client";

import { useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import type { Dossier } from "@/lib/dossier";
import { Collecting, type Source } from "../../dossier/[id]/collecting";
import { DossierView } from "../../dossier/dossier-view";

/*
 * The demo's last stage. The same collecting screen a real file shows, ticking through the fictional
 * subject's sources one by one, then her file. Nothing is fetched.
 */

export type DemoStep = { platform: string; items: number; at: number; via?: string };

/** Mara Vell's sources, one by one. */
export const MARA_STEPS: DemoStep[] = [
  { platform: "website", items: 2, at: 1000 },
  { platform: "linkedin", items: 18, at: 2000, via: "their website" },
  { platform: "instagram", items: 74, at: 2900 },
  { platform: "reddit", items: 37, at: 3700 },
  { platform: "x", items: 108, at: 4600 },
  { platform: "web", items: 5, at: 6000 },
];
/** After the last source, time for its records to drip in and settle before the file opens. */
const SETTLE_MS = 3200;

export function DemoFile({
  dossier,
  steps = MARA_STEPS,
  interviewHref = "/demo/interview",
  caption,
}: {
  dossier: Dossier;
  /** What the file says it is, when it is not the fictional sample. */
  caption?: string;
  steps?: DemoStep[];
  interviewHref?: string;
}) {
  const OPEN_AT = Math.max(...steps.map((s) => s.at)) + SETTLE_MS;
  const reduce = useReducedMotion() ?? false;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const id = setInterval(() => {
      const t = performance.now() - start;
      setElapsed(t);
      if (t > OPEN_AT) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [OPEN_AT]);

  if (elapsed > OPEN_AT) return <DossierView dossier={dossier} sample={caption ?? true} interview={{ href: interviewHref, emphasis: true }} />;

  const sources: Source[] = steps.map((s) => ({
    platform: s.platform,
    status: elapsed >= s.at ? "done" : "collecting",
    items: elapsed >= s.at ? s.items : 0,
    // Records are found steadily until the source is done, like a live dataset filling up.
    found: Math.round(s.items * Math.min(1, elapsed / s.at)),
    via: s.via ?? null,
  }));
  return (
    <Collecting
      name={dossier.subject.name}
      sources={sources}
      failed={false}
      problem=""
      canOpen={false}
      reduce={reduce}
      onOpen={() => {}}
    />
  );
}

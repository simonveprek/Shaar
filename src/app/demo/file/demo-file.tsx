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

const STEPS: { platform: string; items: number; at: number }[] = [
  { platform: "linkedin", items: 18, at: 1200 },
  { platform: "instagram", items: 72, at: 2100 },
  { platform: "reddit", items: 37, at: 2900 },
  { platform: "x", items: 108, at: 3800 },
];
/** Leaves time for the last source's records to drip in and settle before the file opens. */
const OPEN_AT = 6200;

export function DemoFile({ dossier }: { dossier: Dossier }) {
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
  }, []);

  if (elapsed > OPEN_AT) return <DossierView dossier={dossier} sample interview={{ href: "/demo/interview", emphasis: true }} />;

  const sources: Source[] = STEPS.map((s) => ({
    platform: s.platform,
    status: elapsed >= s.at ? "done" : "collecting",
    items: elapsed >= s.at ? s.items : 0,
    // Records are found steadily until the source is done, like a live dataset filling up.
    found: Math.round(s.items * Math.min(1, elapsed / s.at)),
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

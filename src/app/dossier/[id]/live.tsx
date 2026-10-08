"use client";

import { useParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { EASE } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import type { Dossier } from "@/lib/dossier";
import { DossierView } from "../dossier-view";
import { Collecting, type Source } from "./collecting";

/*
 * A file being put together. While sources are collecting it shows them
 * filling in, record by record; once every source is done (or the visitor
 * opens it early) the file itself, which keeps filling in as the persona is
 * written.
 */

type Payload = {
  dossier: Dossier;
  jobStatus: "scraping" | "analyzing" | "ready" | "failed";
  sources: Source[];
  purpose: string | null;
  persona: { id: string; status: "generating" | "ready" | "failed" } | null;
};

const POLL_MS = 4000;

/** After the last source settles, how long the finished collection holds before the file opens. */
const HOLD_MS = 1600;

export function LiveDossier() {
  const { id } = useParams<{ id: string }>();
  const reduce = useReducedMotion() ?? false;
  const [data, setData] = useState<Payload | null>(null);
  const [problem, setProblem] = useState("");

  // Ask again every few seconds until the file is complete. Each ask also moves the collection forward.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await api<Payload>(`/api/research/${id}/dossier`);
        if (stop) return;
        setData(next);
        if (next.jobStatus === "ready" || next.jobStatus === "failed") return;
      } catch (err) {
        if (stop) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 401)) {
          setProblem("This file does not exist, or it is not yours");
          return;
        }
      }
      timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  const items = data?.dossier.totals.items ?? 0;
  const failed = data?.jobStatus === "failed";
  // A file that is already past collecting opens straight away. Otherwise the collection plays out first.
  const [opened, setOpened] = useState(false);
  const open = useCallback(() => setOpened(true), []);
  const collecting = data?.jobStatus === "scraping";
  const seen = data !== null && (opened || (!collecting && items > 0));

  // Every source has settled: hold on the finished collection for a beat, then open the file.
  useEffect(() => {
    if (opened || collecting || items === 0 || failed) return;
    const id = setTimeout(open, reduce ? 0 : HOLD_MS);
    return () => clearTimeout(id);
  }, [opened, collecting, items, failed, reduce, open]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {seen && data ? (
        <motion.div
          key="file"
          initial={reduce ? false : { opacity: 0, filter: "blur(8px)" }}
          animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.25, ease: EASE } }}
        >
          <DossierView
            dossier={data.dossier}
            status={data.jobStatus === "scraping" ? "Still collecting" : data.jobStatus === "analyzing" ? "Reading them" : undefined}
            interview={
              data.persona?.status === "ready"
                ? { href: `/interview/${data.persona.id}`, emphasis: data.purpose === "Interrogate" }
                : data.jobStatus === "scraping" || data.jobStatus === "analyzing"
                  ? { note: "Interrogation opens once they have been read" }
                  : undefined
            }
          />
        </motion.div>
      ) : (
        <Collecting
          key="collecting"
          name={data?.dossier.subject.name ?? ""}
          sources={data?.sources ?? []}
          failed={failed}
          problem={problem}
          canOpen={items > 0}
          reduce={reduce}
          onOpen={open}
        />
      )}
    </AnimatePresence>
  );
}

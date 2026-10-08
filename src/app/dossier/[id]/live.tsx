"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { Aura, type AuraColors } from "@/components/fragms";
import { Logo } from "@/components/logo";
import { cx, EASE } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import type { Dossier } from "@/lib/dossier";
import { DossierView } from "../dossier-view";

/*
 * A file being put together. Until the first records arrive it shows what is
 * being collected; then the file itself, which keeps filling in as sources
 * finish and the persona is written.
 */

export type Source = { platform: string; status: "collecting" | "done" | "failed"; items: number };
type Payload = { dossier: Dossier; jobStatus: "scraping" | "analyzing" | "ready" | "failed"; sources: Source[] };

const CAPTION = "text-[11px] font-medium tracking-[0.22em] text-muted uppercase";
const ASH: AuraColors = ["#c8c8cc", "#5c5c63", "#9a9aa1", "#3a3a40"];
const POLL_MS = 4000;

const LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  facebook: "Facebook",
  reddit: "Reddit",
  threads: "Threads",
  pinterest: "Pinterest",
};

export function LiveDossier() {
  const { id } = useParams<{ id: string }>();
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

  if (data && data.dossier.totals.items > 0) {
    const status =
      data.jobStatus === "scraping" ? "Still collecting" : data.jobStatus === "analyzing" ? "Reading them" : undefined;
    return <DossierView dossier={data.dossier} status={status} />;
  }

  const failed = data?.jobStatus === "failed";
  return (
    <Collecting
      name={data?.dossier.subject.name}
      sources={problem ? [] : (data?.sources ?? [])}
      message={problem || (failed ? "Nothing could be collected" : "Collecting public records")}
      busy={!problem && !failed}
      showBack={Boolean(problem || failed)}
    />
  );
}

/** While a file is being put together: the name, what is being collected, and the light under the gate. */
export function Collecting({
  name,
  sources,
  message,
  busy,
  showBack = false,
}: {
  name?: string;
  sources: Source[];
  message: string;
  busy: boolean;
  showBack?: boolean;
}) {
  const reduce = useReducedMotion() ?? false;
  return (
    <main className="dark relative grid min-h-svh place-items-center overflow-x-clip bg-background px-6 text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[15%] bottom-0 -left-[15%] h-[60svh] [mask-image:linear-gradient(to_top,black_0%,black_15%,transparent_70%)]"
      >
        <Aura palette={ASH} level={0.32} intensity={1.5} speed={reduce ? 0 : 1.1} radius={0} className="h-full w-full" />
      </div>

      <Link href="/" aria-label="Shaar" className="absolute top-6 left-6 sm:top-8 sm:left-8">
        <Logo className="h-7 w-auto" />
      </Link>
      <p className={cx("absolute top-6 right-6 flex h-7 items-center sm:top-8 sm:right-8", CAPTION)}>Beware the Spectator</p>

      <motion.div
        className="relative flex flex-col items-center text-center"
        initial={reduce ? false : { opacity: 0, filter: "blur(8px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.9, ease: EASE }}
      >
        <h1 className="text-[clamp(1.5rem,5vw,3.5rem)] leading-none font-medium tracking-[-0.04em]">{name ?? "\u00a0"}</h1>
        <p className={cx("mt-7", CAPTION, busy && "shimmer")}>{message}</p>

        {sources.length > 0 && (
          <ul className="mt-10 flex flex-col gap-2.5">
            {sources.map((s) => (
              <li key={s.platform} className="flex items-center justify-center gap-3 text-label">
                <span
                  className={cx(
                    "size-1.5 rounded-full transition-colors duration-250",
                    s.status === "done" ? "bg-foreground" : s.status === "failed" ? "bg-control" : "animate-pulse bg-muted",
                  )}
                />
                <span className={s.status === "failed" ? "text-muted line-through" : ""}>{LABEL[s.platform] ?? s.platform}</span>
                <span className="text-muted tabular-nums">
                  {s.status === "done" ? `${s.items} records` : s.status === "failed" ? "unavailable" : "collecting"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {showBack && (
          <Link href="/" className={cx(CAPTION, "mt-8 underline decoration-underline underline-offset-[6px] transition-colors duration-150 hover:text-foreground")}>
            Someone else
          </Link>
        )}
      </motion.div>
    </main>
  );
}

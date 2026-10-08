"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CornerDownLeftIcon } from "@hugeicons/core-free-icons";
import { Aura, type AuraColors } from "@/components/fragms";
import { Logo } from "@/components/logo";
import { cx, EASE, Icon, Kbd } from "@/components/ui";

/*
 * The file being put together. One quiet instrument: a line per source, and a
 * cell for every public record Apify finds. Records drip in one by one rather
 * than in blocks, a cursor waits where the next one will land, and each arrival
 * stirs the light under the gate. When a source finishes its cells settle into
 * full ink. Nothing sweeps, nothing moves once it has landed.
 */

export type Source = {
  platform: string;
  status: "waiting" | "collecting" | "done" | "failed";
  /** Records ingested into the file. */
  items: number;
  /** Records found so far, counted live from the actor's dataset. */
  found: number;
  /** Set when Shaar found this account itself, like "their website". */
  via?: string | null;
};

const CAPTION = "text-[11px] font-medium tracking-[0.22em] text-muted uppercase";
const ASH: AuraColors = ["#c8c8cc", "#5c5c63", "#9a9aa1", "#3a3a40"];

/** More than this and a row would only be texture. The count beside it stays exact. */
const MAX_CELLS = 60;

/** How long a batch of new records takes to drip in. About one poll, so the flow never stops between polls. */
const DRIP_MS = 3600;

/** How hard each landed record stirs the light, and how fast it settles. */
const STIR = { record: 0.014, max: 0.2, settle: 1.6, resting: 0.26 };

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
  github: "GitHub",
  website: "Website",
  web: "The web",
};

/** Two slow waves out of phase, so the resting light never quite repeats. 0 to 1. */
const think = (t: number) => 0.5 + 0.5 * (0.6 * Math.sin(t * 1.4) + 0.4 * Math.sin(t * 2.6 + 1.1));

export function Collecting({
  name,
  sources,
  failed,
  problem,
  canOpen,
  reduce,
  onOpen,
}: {
  name: string;
  sources: Source[];
  failed: boolean;
  problem: string;
  /** Some records are in the file, so it can be opened before every source is done. */
  canOpen: boolean;
  reduce: boolean;
  onOpen: () => void;
}) {
  const energy = useRef({ value: 0, at: 0 });
  const stir = () => {
    energy.current.value = Math.min(STIR.max, energy.current.value + STIR.record);
  };

  // Read every frame by the glow: a slow resting breath, plus whatever the last records stirred up.
  const level = () => {
    if (reduce) return STIR.resting;
    const now = performance.now();
    const state = energy.current;
    const dt = state.at ? Math.min(0.1, (now - state.at) / 1000) : 0;
    state.at = now;
    state.value *= Math.exp(-STIR.settle * dt);
    return STIR.resting * (0.75 + 0.5 * think(now / 1000)) + state.value;
  };

  const settled = sources.length > 0 && sources.every((s) => s.status === "done" || s.status === "failed");
  const caption = problem || (failed ? "Nothing could be collected" : settled ? "Collected" : "Collecting public records");

  useEffect(() => {
    if (!canOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Enter" && onOpen();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canOpen, onOpen]);

  return (
    <motion.main
      className="dark relative grid min-h-svh place-items-center overflow-x-clip bg-background px-6 py-24 text-foreground selection:bg-foreground selection:text-background"
      exit={{ opacity: 0, filter: "blur(8px)", transition: { duration: 0.15, ease: EASE } }}
    >
      {/* The light under the gate. Only its bottom edge glows, and it answers every record that lands. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[15%] bottom-0 -left-[15%] h-[60svh] [mask-image:linear-gradient(to_top,black_0%,black_15%,transparent_70%)]"
      >
        <Aura palette={ASH} level={level} intensity={1.5} speed={reduce ? 0 : 1.1} radius={0} className="h-full w-full" />
      </div>

      <Link href="/" aria-label="Shaar" className="absolute top-6 left-6 sm:top-8 sm:left-8">
        <Logo className="h-7 w-auto" />
      </Link>
      <p className={cx("absolute top-6 right-6 flex h-7 items-center sm:top-8 sm:right-8", CAPTION)}>Beware the Spectator</p>

      <div className="relative flex w-full max-w-[440px] flex-col items-center text-center">
        <motion.h1
          className="max-w-full truncate text-[clamp(1.5rem,5vw,3.5rem)] leading-none font-medium tracking-[-0.04em]"
          initial={reduce ? false : { opacity: 0, filter: "blur(8px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.9, ease: EASE }}
        >
          {name || " "}
        </motion.h1>

        <div className="relative mt-7 h-4">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={caption}
              className={cx("whitespace-nowrap", CAPTION, !problem && !failed && !settled && "shimmer")}
              initial={reduce ? false : { opacity: 0, filter: "blur(6px)" }}
              animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.6, ease: EASE, delay: reduce ? 0 : 0.35 } }}
              exit={{ opacity: 0, filter: "blur(8px)", transition: { duration: 0.15, ease: EASE } }}
            >
              {caption}
            </motion.p>
          </AnimatePresence>
        </div>

        {sources.length > 0 && !problem && (
          <motion.ul
            aria-label="Sources"
            className="mt-12 flex w-full flex-col gap-5 text-left"
            initial={reduce ? false : "hidden"}
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.5 } } }}
          >
            {sources.map((s) => (
              <SourceRow key={s.platform} source={s} reduce={reduce} onRecord={stir} />
            ))}
          </motion.ul>
        )}

        {/* Opens the file with what is in so far. Everything still collecting keeps filling it in. */}
        <div className="mt-10 h-11">
          <AnimatePresence>
            {canOpen && !failed && (
              <motion.button
                key="open"
                type="button"
                onClick={onOpen}
                className="group flex cursor-pointer items-center gap-2.5 p-2 whitespace-nowrap"
                initial={reduce ? false : { opacity: 0, filter: "blur(6px)" }}
                animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.25, ease: EASE } }}
                exit={{ opacity: 0, filter: "blur(8px)", transition: { duration: 0.15, ease: EASE } }}
              >
                <Kbd className="h-7 min-w-7 rounded-item px-2 transition-colors duration-150 group-hover:bg-control-hover group-hover:text-foreground">
                  <Icon icon={CornerDownLeftIcon} size={14} />
                </Kbd>
                <span className={cx(CAPTION, "transition-colors duration-150 group-hover:text-foreground")}>
                  {settled ? "Enter to open the file" : "Enter to open it now"}
                </span>
              </motion.button>
            )}
          </AnimatePresence>
          {(problem || failed) && (
            <Link
              href="/"
              className={cx(CAPTION, "underline decoration-underline underline-offset-[6px] transition-colors duration-150 hover:text-foreground")}
            >
              Someone else
            </Link>
          )}
        </div>
      </div>
    </motion.main>
  );
}

/** One source: its name, its count, and a cell for every record found, with the cursor where the next will land. */
function SourceRow({ source, reduce, onRecord }: { source: Source; reduce: boolean; onRecord: () => void }) {
  const shown = useDrip(source.found, reduce, onRecord);
  const cells = Math.min(shown, MAX_CELLS);
  const done = source.status === "done";
  const failed = source.status === "failed";
  const waiting = source.status === "waiting";
  const note = failed
    ? "Unavailable"
    : done && !source.found
      ? "Nothing public"
      : waiting && !shown
        ? "Waiting"
        : shown;

  return (
    <motion.li
      variants={{
        hidden: { opacity: 0, y: 8, filter: "blur(6px)" },
        show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
      }}
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <span className="flex min-w-0 items-baseline gap-3">
          <span className={cx(CAPTION, done && "text-foreground", "transition-colors duration-250 ease-smooth")}>
            {LABEL[source.platform] ?? source.platform}
          </span>
          {source.via && <span className="truncate text-caption text-muted">Found through {source.via}</span>}
        </span>
        <span className={cx("text-caption tabular-nums", typeof note === "string" ? "text-muted" : "text-foreground")}>{note}</span>
      </div>
      <div
        role="img"
        aria-label={`${LABEL[source.platform] ?? source.platform}, ${failed ? "unavailable" : `${shown} records`}`}
        className="flex min-h-1.5 flex-wrap gap-[3px]"
      >
        {Array.from({ length: cells }, (_, i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-[2px] bg-foreground"
            initial={reduce ? false : { opacity: 0, scale: 0.3, filter: "blur(3px)" }}
            animate={{
              opacity: done ? 1 : 0.42,
              scale: 1,
              filter: "blur(0px)",
              // Settling into full ink runs along the row, a few milliseconds a cell, once the source is done.
              transition: done
                ? { duration: 0.5, ease: EASE, delay: reduce ? 0 : i * 0.012 }
                : { duration: 0.5, ease: EASE },
            }}
          />
        ))}
        {!done && !failed && <Cursor waiting={waiting} reduce={reduce} />}
      </div>
    </motion.li>
  );
}

/** Where the next record lands. It blinks like the cursor under the question on the landing; dim while waiting. */
function Cursor({ waiting, reduce }: { waiting: boolean; reduce: boolean }) {
  if (waiting || reduce) return <span className={cx("size-1.5 rounded-[2px] bg-foreground", waiting ? "opacity-20" : "opacity-60")} />;
  return (
    <motion.span
      className="size-1.5 rounded-[2px] bg-foreground"
      animate={{ opacity: [0, 0.8, 0.8, 0, 0] }}
      transition={{ duration: 1.1, times: [0, 0.01, 0.5, 0.51, 1], repeat: Infinity }}
    />
  );
}

/**
 * Follows a count that jumps every poll, one record at a time, so a batch drips in over about one poll
 * instead of landing all at once. Calls onStep for every record. With reduced motion it jumps.
 */
function useDrip(target: number, reduce: boolean, onStep: () => void) {
  const [shown, setShown] = useState(reduce ? target : 0);
  const count = useRef(shown);
  const step = useRef(onStep);
  useEffect(() => {
    step.current = onStep;
  });

  useEffect(() => {
    if (reduce || target < count.current) {
      // Counts can shrink a little once a dataset is cleaned up on ingest; follow without animating.
      count.current = target;
      setShown(target);
      return;
    }
    if (target === count.current) return;
    const every = Math.max(28, Math.min(160, DRIP_MS / (target - count.current)));
    const id = setInterval(() => {
      if (count.current >= target) return clearInterval(id);
      count.current += 1;
      setShown(count.current);
      step.current();
    }, every);
    return () => clearInterval(id);
  }, [target, reduce]);

  return shown;
}

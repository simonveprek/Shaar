"use client";

import {
  animate,
  AnimatePresence,
  motion,
  useAnimationFrame,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cx, EASE } from "@/components/ui";
import { PROFILE_SITES } from "@/connectors/profile-url";
import type { Candidate } from "@/lib/discovery";

/*
 * The search, cut like a trailer. Every shot is something the agent really does.
 *
 *   ask     the name drops out of the heading and becomes the query, in quotes
 *   spread  nine sites burst out from behind it into an orbit, a line back to each
 *   search  the orbit turns and pulses run out along the lines, nine Google searches at once
 *   read    the answers come home, every result a dot flying in, the count running up
 *   sieve   the orbit brakes, sites with nothing fly off into the dark, the rest give up their accounts
 *   line    the orbit is gone and the accounts fly into one row under the query
 *   done    the query lifts away and each account opens into its card. The cards in landing.tsx
 *           share the accounts' layoutIds, so the row morphs straight into them.
 *
 * Search holds until Google has answered. Everything after it plays on its own.
 */

export type Found = {
  candidates: Candidate[];
  /** Google results read per platform. Null for searches made before this was counted. */
  scanned: Record<string, number> | null;
};

export type Phase = "ask" | "spread" | "search" | "read" | "sieve" | "line" | "done";

export const SITES = PROFILE_SITES;

const CAPTION = "text-[11px] font-medium tracking-[0.22em] text-muted uppercase";

const SHORT: Record<string, string> = {
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

/** How long each shot holds, in ms. Search holds at least this long, then until the answers are in. */
const HOLD: Record<Phase, number> = { ask: 900, spread: 1150, search: 1800, read: 2900, sieve: 1700, line: 1900, done: 450 };
const HOLD_REDUCED: Record<Phase, number> = { ask: 0, spread: 0, search: 0, read: 0, sieve: 0, line: 1400, done: 0 };
const NEXT: Record<Exclude<Phase, "done">, Phase> = {
  ask: "spread",
  spread: "search",
  search: "read",
  read: "sieve",
  sieve: "line",
  line: "done",
};

/** How fast the orbit turns in each shot, in radians a second. It brakes to a stop for the sieve. */
const SPIN: Partial<Record<Phase, number>> = { search: 0.3, read: 1.25 };

/** Things that fly: a little give at the end, like a camera settling. */
export const FLY = { type: "spring", stiffness: 120, damping: 18, mass: 0.9 } as const;
const POP = { type: "spring", stiffness: 280, damping: 17 } as const;

/** Dots per site while the answers come home. More would only be texture; the count stays exact. */
const DOTS = 8;

/** When, into the sieve, the orbit has stopped and the accounts pop out. */
const POP_AT = 750;

/** How hard each moment stirs the light under the gate. */
const STIR = { site: 0.05, read: 0.06, pop: 0.16, line: 0.08 };

export function Searching({
  name,
  found,
  reduce,
  onStir,
  onPhase,
  onDone,
}: {
  name: string;
  /** What the search found. Null while Google is still answering. */
  found: Found | null;
  reduce: boolean;
  onStir: (amount: number) => void;
  onPhase: (phase: Phase) => void;
  /** The last shot has played. */
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>(reduce ? "search" : "ask");
  // Read through a ref, so timers always call the latest handlers.
  const on = useRef({ onStir, onPhase, onDone });
  useEffect(() => {
    on.current = { onStir, onPhase, onDone };
  });
  useEffect(() => on.current.onPhase(phase), [phase]);

  // The cut list. Search waits for the answers; every other shot holds for its time.
  const shotAt = useRef(0);
  useEffect(() => {
    shotAt.current = performance.now();
  }, [phase]);
  useEffect(() => {
    const hold = (reduce ? HOLD_REDUCED : HOLD)[phase];
    if (phase === "done") {
      const id = setTimeout(() => on.current.onDone(), hold);
      return () => clearTimeout(id);
    }
    if (phase === "search" && !found) return;
    let next = NEXT[phase];
    if (reduce && phase === "search") next = "line";
    // Without counts there are no dots to fly home, so reading is quicker.
    const wait = phase === "read" && !found?.scanned ? 1400 : hold;
    const id = setTimeout(() => setPhase(next), Math.max(0, shotAt.current + wait - performance.now()));
    return () => clearTimeout(id);
  }, [phase, found, reduce]);

  // The orbit. One angle shared by every site, turned by a speed that eases between shots.
  const spin = useMotionValue(0);
  const speed = useMotionValue(0);
  useAnimationFrame((_, delta) => {
    const s = speed.get();
    if (s) spin.set(spin.get() + (s * Math.min(delta, 50)) / 1000);
  });
  useEffect(() => {
    if (reduce) return;
    const braking = phase === "sieve";
    const run = animate(speed, SPIN[phase] ?? 0, { duration: braking ? 0.7 : 1, ease: braking ? EASE : "easeInOut" });
    return () => run.stop();
  }, [phase, reduce, speed]);

  // The orbit fits the space: wide on a desk, tall on a phone, where there is height to spare.
  const box = useRef<HTMLDivElement>(null);
  const rx = useMotionValue(220);
  const ry = useMotionValue(128);
  const [frame, setFrame] = useState({ height: 360, width: 640, narrow: false });
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const fit = () => {
      const width = node.offsetWidth;
      const narrow = width < 480;
      const x = Math.max(90, Math.min(width / 2 - (narrow ? 48 : 58), 240));
      const y = narrow ? Math.min(175, x * 1.65) : Math.min(x, 128);
      rx.set(x);
      ry.set(y);
      setFrame({ height: Math.round(2 * y + 100), width, narrow });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [rx, ry]);

  // Where each site sits on the orbit right now.
  const at = (i: number) => {
    const theta = angleOf(i) + spin.get();
    return { x: rx.get() * Math.cos(theta), y: ry.get() * Math.sin(theta) };
  };

  // Once the orbit has stopped, the accounts pop out of the sites they were found on.
  const [anchors, setAnchors] = useState<Record<string, { x: number; y: number }> | null>(null);
  useEffect(() => {
    if (phase !== "sieve" || !found) return;
    const id = setTimeout(() => {
      // Kept inside the stage: an account is wider than the site it came from.
      const limit = frame.width / 2 - (frame.narrow ? 64 : 110);
      const spots: Record<string, { x: number; y: number }> = {};
      SITES.forEach((site, i) => {
        if (!found.candidates.some((c) => c.platform === site.platform)) return;
        const spot = at(i);
        spots[site.platform] = { x: Math.max(-limit, Math.min(limit, spot.x)), y: spot.y };
      });
      setAnchors(spots);
      if (Object.keys(spots).length) on.current.onStir(STIR.pop);
    }, POP_AT);
    return () => clearTimeout(id);
    // at() reads motion values, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, found]);

  // The light answers the big moments.
  useEffect(() => {
    if (reduce) return;
    const stir = (amount: number, ms: number) => setTimeout(() => on.current.onStir(amount), ms);
    const timers =
      phase === "spread"
        ? SITES.map((_, i) => stir(STIR.site, i * 60))
        : phase === "read"
          ? SITES.map((_, i) => stir(STIR.read, 300 + i * 160))
          : phase === "line"
            ? [stir(STIR.line, 200)]
            : [];
    return () => timers.forEach(clearTimeout);
  }, [phase, reduce]);

  const orbit = phase !== "line" && phase !== "done";
  const candidates = found?.candidates ?? [];
  const matched = new Set(candidates.map((c) => c.platform));
  const total = found?.scanned ? Object.values(found.scanned).reduce((sum, n) => sum + n, 0) : null;

  return (
    <div
      ref={box}
      className="relative mt-12 w-full max-w-[640px]"
      style={orbit ? { height: frame.height } : undefined}
      aria-live="polite"
    >
      {orbit ? (
        <>
          {SITES.map((site, i) => (
            <Orbiter
              key={site.platform}
              index={i}
              label={SHORT[site.platform] ?? site.platform}
              phase={phase}
              spin={spin}
              rx={rx}
              ry={ry}
              results={found?.scanned?.[site.platform] ?? (matched.has(site.platform) ? 4 : 2)}
              matched={matched.has(site.platform)}
              covered={Boolean(anchors?.[site.platform])}
              narrow={frame.narrow}
              reduce={reduce}
            />
          ))}

          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Query name={name} phase={phase} total={total} kept={candidates.length} enter={!reduce} reduce={reduce} />
          </div>

          {anchors && (
            <div className="pointer-events-none absolute inset-0">
              {Object.entries(anchors).map(([platform, spot]) => (
                <div
                  key={platform}
                  className="absolute top-1/2 left-1/2 flex size-0 flex-col items-center justify-center gap-1.5"
                  style={{ transform: `translate(${spot.x}px, ${spot.y}px)` }}
                >
                  {candidates
                    .filter((c) => c.platform === platform)
                    .map((c) => (
                      <Chip key={c.id} candidate={c} pop compact={frame.narrow} reduce={reduce} />
                    ))}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-9">
          <Query name={name} phase={phase} total={total} kept={candidates.length} enter={false} reduce={reduce} />
          {candidates.length > 0 && (
            <div className="flex max-w-[600px] flex-wrap justify-center gap-2.5">
              {candidates.map((c) => (
                <Chip key={c.id} candidate={c} reduce={reduce} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Where a site starts on the orbit: the first at the top, the rest round the clock. */
const angleOf = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / SITES.length;

/**
 * The query, in quotes, with a line under it that counts what the agent is doing:
 * how many searches went out, how many results came back, how many match.
 */
function Query({
  name,
  phase,
  total,
  kept,
  enter,
  reduce,
}: {
  name: string;
  phase: Phase;
  total: number | null;
  kept: number;
  /** Drops out of the heading on its first appearance. Its later self arrives by layoutId instead. */
  enter: boolean;
  reduce: boolean;
}) {
  const count =
    phase === "ask" ? null : phase === "spread" || phase === "search" ? "sent" : phase === "read" ? "read" : "kept";
  return (
    <motion.div
      layoutId="search-query"
      className="flex flex-col items-center gap-3"
      initial={enter ? { opacity: 0, y: -150, scale: 0.6, filter: "blur(10px)" } : false}
      animate={
        phase === "done"
          ? { opacity: 0, y: -28, scale: 1, filter: "blur(8px)" }
          : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }
      }
      transition={{ ...FLY, delay: enter ? 0.15 : 0, opacity: { duration: 0.35, ease: EASE }, filter: { duration: 0.35, ease: EASE }, layout: FLY }}
    >
      <span className="flex h-10 max-w-[80vw] items-center rounded-full border border-border bg-card px-5 shadow-card">
        <span className="truncate text-[15px] font-medium tracking-[-0.01em]">“{name}”</span>
      </span>
      <span className="grid h-4 text-caption text-muted">
        <AnimatePresence initial={false} mode="popLayout">
          {count && (
            <motion.span
              key={count}
              className="col-start-1 row-start-1 whitespace-nowrap"
              initial={reduce ? false : { opacity: 0, y: 6, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6, filter: "blur(4px)", transition: { duration: 0.15, ease: EASE } }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              {count === "sent" ? (
                <>
                  <Count to={SITES.length} duration={0.9} reduce={reduce} /> searches at once
                </>
              ) : count === "read" ? (
                total === null ? (
                  "Reading the results"
                ) : (
                  <>
                    <Count to={total} duration={2.6} reduce={reduce} /> results read
                  </>
                )
              ) : kept ? (
                <>
                  <span className="text-foreground tabular-nums">{kept}</span> match the name
                </>
              ) : (
                "None match the name"
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.div>
  );
}

/**
 * One site on the orbit: its label, the line back to the query, and whatever
 * travels along that line. It bursts out from behind the query, turns with the
 * orbit, and if nothing was found there it flies off into the dark.
 */
function Orbiter({
  index,
  label,
  phase,
  spin,
  rx,
  ry,
  results,
  matched,
  covered,
  narrow,
  reduce,
}: {
  index: number;
  label: string;
  phase: Phase;
  spin: MotionValue<number>;
  rx: MotionValue<number>;
  ry: MotionValue<number>;
  /** How many results came back from this site. */
  results: number;
  matched: boolean;
  /** Its accounts have popped out on top of it. */
  covered: boolean;
  /** A phone: smaller labels, so nine fit round the orbit. */
  narrow: boolean;
  reduce: boolean;
}) {
  const reach = useMotionValue(reduce ? 1 : 0);
  const theta = angleOf(index);
  const x = useTransform(() => reach.get() * rx.get() * Math.cos(theta + spin.get()));
  const y = useTransform(() => reach.get() * ry.get() * Math.sin(theta + spin.get()));
  const length = useTransform(() => Math.hypot(x.get(), y.get()));
  const angle = useTransform(() => (Math.atan2(y.get(), x.get()) * 180) / Math.PI);

  const gone = (phase === "sieve" && !matched) || (reduce && phase !== "search" && !matched);
  const lit = phase === "sieve" && matched;
  // Sites with nothing leave one after another, in the order they sit on the orbit.
  const leaveDelay = index * 0.07;

  useEffect(() => {
    if (reduce) return;
    if (phase === "spread") {
      const run = animate(reach, 1, { ...FLY, delay: index * 0.06 });
      return () => run.stop();
    }
    if (gone) {
      const run = animate(reach, 1.8, { duration: 0.8, ease: [0.5, 0, 0.75, 0], delay: leaveDelay });
      return () => run.stop();
    }
  }, [phase, gone, reduce, index, leaveDelay, reach]);

  return (
    <>
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 h-px origin-left bg-foreground"
        style={{ width: length, rotate: angle }}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: phase === "ask" || gone ? 0 : lit ? 0.45 : phase === "read" ? 0.24 : 0.14 }}
        transition={{ duration: gone ? 0.4 : 0.6, ease: EASE, delay: gone ? leaveDelay : 0 }}
      />

      {phase === "search" && !reduce && <Pulse x={x} y={y} index={index} />}
      {phase === "read" &&
        !reduce &&
        Array.from({ length: Math.min(results, DOTS) }, (_, j) => (
          <Homing key={j} x={x} y={y} delay={0.1 + index * 0.09 + j * 0.17} />
        ))}

      <motion.div className="pointer-events-none absolute top-1/2 left-1/2 flex size-0 items-center justify-center" style={{ x, y }}>
        <motion.span
          className={cx(
            "flex shrink-0 items-center rounded-full border bg-control font-medium whitespace-nowrap uppercase transition-colors duration-250 ease-smooth",
            narrow ? "h-6 px-2.5 text-[9px] tracking-[0.14em]" : "h-7 px-3 text-[10px] tracking-[0.18em]",
            lit ? "border-foreground/40 text-foreground" : "border-border text-muted",
          )}
          initial={reduce ? false : { opacity: 0, scale: 0.4 }}
          animate={
            phase === "ask"
              ? { opacity: 0, scale: 0.4, filter: "blur(0px)" }
              : gone
                ? { opacity: 0, scale: 0.6, filter: "blur(6px)" }
                : covered
                  ? { opacity: 0, scale: 0.8, filter: "blur(0px)" }
                  : { opacity: 1, scale: 1, filter: "blur(0px)" }
          }
          transition={
            gone
              ? { duration: 0.6, ease: EASE, delay: leaveDelay + 0.15 }
              : phase === "spread"
                ? { ...POP, delay: index * 0.06 }
                : { duration: 0.3, ease: EASE }
          }
        >
          {label}
        </motion.span>
      </motion.div>
    </>
  );
}

/** A search going out: a dot running from the query to the site, again and again. */
function Pulse({ x, y, index }: { x: MotionValue<number>; y: MotionValue<number>; index: number }) {
  const t = useMotionValue(0);
  useEffect(() => {
    const run = animate(t, [0, 1], {
      duration: 0.85,
      ease: [0.4, 0, 0.2, 1],
      repeat: Infinity,
      repeatDelay: 0.8 + (index % 4) * 0.22,
      delay: index * 0.12,
    });
    return () => run.stop();
  }, [t, index]);
  const px = useTransform(() => x.get() * t.get());
  const py = useTransform(() => y.get() * t.get());
  const opacity = useTransform(t, [0, 0.15, 0.85, 1], [0, 1, 1, 0]);
  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 left-1/2 -mt-[2px] -ml-[2px] size-1 rounded-full bg-foreground"
      style={{ x: px, y: py, opacity }}
    />
  );
}

/** A result coming home: a dot flying from the site into the query, faster as it nears. */
function Homing({ x, y, delay }: { x: MotionValue<number>; y: MotionValue<number>; delay: number }) {
  const t = useMotionValue(1);
  useEffect(() => {
    const run = animate(t, 0, { duration: 0.75, delay, ease: [0.55, 0, 1, 0.45] });
    return () => run.stop();
  }, [t, delay]);
  const px = useTransform(() => x.get() * t.get());
  const py = useTransform(() => y.get() * t.get());
  const opacity = useTransform(t, [1, 0.94, 0.15, 0], [0, 0.95, 0.95, 0]);
  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 left-1/2 -mt-[1.5px] -ml-[1.5px] size-[3px] rounded-full bg-foreground"
      style={{ x: px, y: py, opacity }}
    />
  );
}

/**
 * An account the search turned up. It pops out of its site on the orbit, flies
 * into the row, and then opens into its card: the card in landing.tsx carries
 * the same layoutIds for the frame, the site and the handle.
 */
function Chip({
  candidate,
  pop = false,
  compact = false,
  reduce,
}: {
  candidate: Candidate;
  pop?: boolean;
  /** Only the handle, while it is still on a phone's crowded orbit. The site joins it in the row. */
  compact?: boolean;
  reduce: boolean;
}) {
  return (
    <motion.span
      layoutId={`found-${candidate.id}`}
      className="flex h-9 shrink-0 items-center gap-2.5 rounded-full border border-border bg-card pr-4 pl-3.5 whitespace-nowrap shadow-card"
      initial={pop && !reduce ? { opacity: 0, scale: 0.3 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...POP, layout: FLY }}
    >
      {!compact && (
        <motion.span
          layoutId={`found-label-${candidate.id}`}
          className={CAPTION}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.2, layout: FLY }}
        >
          {candidate.label}
        </motion.span>
      )}
      <motion.span
        layoutId={`found-handle-${candidate.id}`}
        transition={{ layout: FLY }}
        className={cx("text-[14px] font-medium tracking-[-0.01em]", candidate.match < 1 && "text-muted")}
      >
        @{candidate.handle}
      </motion.span>
    </motion.span>
  );
}

/** A number that counts up to where it lands. */
function Count({ to, duration, reduce }: { to: number; duration: number; reduce: boolean }) {
  const [shown, setShown] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) return;
    const run = animate(0, to, { duration, ease: [0.3, 0, 0.2, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => run.stop();
  }, [to, duration, reduce]);
  return <span className="text-foreground tabular-nums">{shown}</span>;
}

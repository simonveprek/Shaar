"use client";

import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from "framer-motion";
import { Fragment, useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { Aura, type AuraColors } from "@/components/fragms";
import { Logo } from "@/components/logo";
import { cx, EASE } from "@/components/ui";

/*
 * Shaar. The gate. Black, one question, and light coming from under the
 * door. Something trails the pointer across a grid it only lets you see
 * where it looks. Beware the Spectator.
 *
 * Timeline on arrival, in seconds:
 *   0.0  the light under the gate rises
 *   0.5  the mark comes into focus
 *   0.8  the question rises word by word
 *   1.6  the motto
 * On a name: the field dissolves, a scan sweeps the grid, the light flares
 * and the name locks in letter by letter.
 */

/** Cold greys, never pure white, so the light reads as a screen left on in an empty room. */
const ASH: AuraColors = ["#c8c8cc", "#5c5c63", "#9a9aa1", "#3a3a40"];

const QUESTION = "Who are we looking for?";
const RESTING = 0.22;
const AT = { light: 0, mark: 0.5, question: 0.8, motto: 1.6 };

/** How quickly the Spectator's gaze catches the pointer. Lower trails further behind. */
const GAZE = 4.5;

const GRID =
  "[background-image:linear-gradient(to_right,color-mix(in_oklab,var(--foreground)_14%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--foreground)_14%,transparent)_1px,transparent_1px)] [background-size:56px_56px] [background-position:center_center]";

const TYPE = "text-[clamp(1.5rem,5vw,3.5rem)] leading-none font-medium tracking-[-0.04em]";

const dissolve = { opacity: 0, filter: "blur(8px)", transition: { duration: 0.15, ease: EASE } };

export function Landing() {
  const reduce = useReducedMotion() ?? false;
  const [name, setName] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [scan, setScan] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const mountedAt = useRef<number | null>(null);
  const sentAt = useRef(-Infinity);
  // The question rises word by word once. Coming back after a cleared field, it only fades in.
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    mountedAt.current = performance.now();
    const id = setTimeout(() => setArrived(true), (AT.question + 1.2) * 1000);
    return () => clearTimeout(id);
  }, []);

  // The Spectator's gaze. Eases toward the pointer every frame, so it always arrives a beat late.
  useEffect(() => {
    const node = grid.current;
    if (!node) return;
    let frame = 0;
    let last = performance.now();
    let gaze: { x: number; y: number } | null = null;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const target = pointer.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!target) return;
      if (!gaze || reduce) gaze = { ...target };
      const k = 1 - Math.exp(-GAZE * dt);
      gaze.x += (target.x - gaze.x) * k;
      gaze.y += (target.y - gaze.y) * k;
      node.style.setProperty("--x", `${gaze.x.toFixed(1)}px`);
      node.style.setProperty("--y", `${gaze.y.toFixed(1)}px`);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduce]);

  // Read every frame by the glow. Rises on arrival, rests, and flares once after a name.
  const level = () => {
    const now = performance.now();
    const since = mountedAt.current === null ? 0 : (now - mountedAt.current) / 1000;
    const rise = reduce ? RESTING : RESTING * (1 - Math.pow(1 - Math.min(1, since / 1.8), 3));
    return Math.max(rise, 0.65 - (now - sentAt.current) / 3200);
  };

  const look = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    pointer.current = { x: event.clientX, y: event.clientY };
    if (grid.current) grid.current.dataset.on = "";
  };
  const lookAway = () => {
    if (grid.current) delete grid.current.dataset.on;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const subject = name.trim();
    if (!subject) return;
    sentAt.current = performance.now();
    setScan((n) => n + 1);
    setSent(subject);
  };

  const reset = () => {
    setSent(null);
    setName("");
  };

  // Entrances. With reduced motion everything is simply there.
  const enter = (delay: number, from: TargetAndTransition = { opacity: 0, filter: "blur(8px)" }) =>
    reduce
      ? { initial: false as const }
      : { initial: from, animate: { opacity: 1, filter: "blur(0px)", y: 0 }, transition: { duration: 1.1, ease: EASE, delay } };

  return (
    <main
      className="dark relative grid min-h-svh place-items-center overflow-hidden bg-background px-6 text-foreground selection:bg-foreground selection:text-background"
      onKeyDown={(event) => event.key === "Escape" && sent && reset()}
      onPointerMove={look}
      onPointerLeave={lookAway}
    >
      {/* The grid, seen only where the Spectator looks. */}
      <div
        ref={grid}
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 ease-smooth data-[on]:opacity-100 data-[on]:duration-250",
          GRID,
          "[mask-image:radial-gradient(240px_circle_at_var(--x,50%)_var(--y,50%),black,transparent)]",
        )}
      />

      {/* The scan. One sweep down the screen when a name goes in, lighting the grid as it passes. */}
      <AnimatePresence>
        {scan > 0 && sent && !reduce && (
          <motion.div
            key={scan}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[34svh]"
            // Percent of the band's own height (a third of the screen). Framer cannot animate svh.
            initial={{ y: "-100%", opacity: 1 }}
            animate={{ y: "300%" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: [0.65, 0, 0.35, 1] }}
          >
            <div className={cx("absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent,black)]", GRID)} />
            <div className="absolute inset-x-0 bottom-0 h-px bg-foreground/60 shadow-[0_0_24px_4px_color-mix(in_oklab,var(--foreground)_25%,transparent)]" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* The light under the gate. A band wider than the screen, so only its bottom edge glows. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[15%] bottom-0 -left-[15%] h-[60svh] [mask-image:linear-gradient(to_top,black_0%,black_15%,transparent_70%)]"
        {...(reduce
          ? {}
          : {
              initial: { opacity: 0, y: "10%" },
              animate: { opacity: 1, y: 0 },
              transition: { duration: 1.8, ease: EASE, delay: AT.light },
            })}
      >
        <Aura palette={ASH} level={level} intensity={1.4} speed={sent ? 0.35 : 0.08} radius={0} className="h-full w-full" />
      </motion.div>

      <motion.div className="absolute top-6 left-6 sm:top-8 sm:left-8" {...enter(AT.mark, { opacity: 0, filter: "blur(10px)", y: 6 })}>
        <Logo className="h-7 w-auto" />
      </motion.div>

      <motion.p
        className="absolute top-6 right-6 flex h-7 items-center font-mono text-[10.5px] tracking-[0.28em] text-muted uppercase sm:top-8 sm:right-8"
        {...enter(AT.motto)}
      >
        Beware the Spectator
      </motion.p>

      <AnimatePresence mode="wait" initial={false}>
        {sent ? (
          <motion.div key="subject" exit={dissolve} className="relative">
            <Subject name={sent} reduce={reduce} onReset={reset} />
          </motion.div>
        ) : (
          <motion.form
            key="ask"
            onSubmit={submit}
            exit={dissolve}
            className="relative grid w-full max-w-[920px] place-items-center"
          >
            <label htmlFor="subject" className="sr-only">
              {QUESTION}
            </label>
            <input
              id="subject"
              name="subject"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cx(
                "col-start-1 row-start-1 w-full bg-transparent text-center outline-none focus-visible:outline-none",
                TYPE,
                name ? "caret-foreground" : "caret-transparent",
              )}
            />
            <AnimatePresence>{!name && <Question key="question" first={!arrived} reduce={reduce} />}</AnimatePresence>
          </motion.form>
        )}
      </AnimatePresence>
    </main>
  );
}

/** The question, drawn over the empty field. Rises word by word on arrival, dissolves on the first key. */
function Question({ first, reduce }: { first: boolean; reduce: boolean }) {
  const words = QUESTION.split(" ");
  const rise = first && !reduce;
  return (
    <motion.p
      aria-hidden="true"
      className={cx("pointer-events-none col-start-1 row-start-1 text-center text-foreground/20", TYPE)}
      initial={rise || reduce ? false : { opacity: 0, filter: "blur(8px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.25, ease: EASE } }}
      exit={dissolve}
    >
      {words.map((word, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="inline-block overflow-hidden pb-[0.12em] align-bottom">
            <motion.span
              className="inline-block"
              initial={rise ? { y: "110%", rotate: 4 } : false}
              animate={{ y: "0%", rotate: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: AT.question + i * 0.07 }}
            >
              {word}
            </motion.span>
          </span>
        </Fragment>
      ))}
      {/* A cursor after the question, so the empty field still asks to be typed in. */}
      <motion.span
        className="ml-[0.08em] inline-block h-[0.82em] w-[0.06em] translate-y-[0.06em] bg-foreground/55"
        initial={reduce ? false : { opacity: 0 }}
        animate={reduce ? { opacity: 1 } : { opacity: [0, 1, 1, 0, 0] }}
        transition={
          reduce
            ? undefined
            : { duration: 1.1, times: [0, 0.01, 0.5, 0.51, 1], repeat: Infinity, delay: rise ? AT.question + 0.9 : 0 }
        }
      />
    </motion.p>
  );
}

/** The name, locking in letter by letter behind the scan, then settling into a slow shimmer. */
function Subject({ name, reduce, onReset }: { name: string; reduce: boolean; onReset: () => void }) {
  const [settled, setSettled] = useState(reduce);
  const letters = Array.from(name);
  return (
    <button
      type="button"
      onClick={onReset}
      title="Someone else"
      aria-label={name}
      className={cx("max-w-[16ch] cursor-pointer text-center break-words", TYPE, settled && "shimmer")}
    >
      {settled
        ? name
        : letters.map((letter, i) => (
            <span key={i} aria-hidden="true" className="inline-block overflow-hidden pb-[0.12em] align-bottom">
              <motion.span
                className="inline-block whitespace-pre"
                initial={{ y: "110%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                transition={{ duration: 0.8, ease: EASE, delay: 0.35 + i * 0.03 }}
                onAnimationComplete={i === letters.length - 1 ? () => setSettled(true) : undefined}
              >
                {letter}
              </motion.span>
            </span>
          ))}
    </button>
  );
}

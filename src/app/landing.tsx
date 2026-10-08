"use client";

import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from "framer-motion";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { ArrowRight01Icon, CornerDownLeftIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Aura, type AuraColors } from "@/components/fragms";
import { GATE, Logo } from "@/components/logo";
import { Card, CardBody, CardStage, cx, EASE, Icon, Kbd } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import type { Candidate, DiscoveryRow } from "@/lib/discovery";

/*
 * Shaar. The gate. Black, one thing at a time, and light coming from under
 * the door. Something trails the pointer across a grid it only lets you see
 * where it looks. Beware the Spectator.
 *
 * The opening, on every load, in seconds. Any key or click skips it.
 *   0.00  the light under the gate rises
 *   0.15  the gate draws itself as a hairline
 *   1.45  it fills in, the line falls away
 *   2.10  the motto
 *   3.30  gate and motto take their corners, the question rises
 *
 * Then: who are we looking for. The name is confirmed where it was typed and
 * the light answers. Three cards ask what to do with them. Shaar searches the
 * open web for their accounts, the visitor confirms which are really them,
 * and the file opens.
 */

/** Cold greys, never pure white, so the light reads as a screen left on in an empty room. */
const ASH: AuraColors = ["#c8c8cc", "#5c5c63", "#9a9aa1", "#3a3a40"];

const QUESTION = "Who are we looking for?";

const PURPOSES = [
  { id: "gather", title: "Gather intelligence", line: "Everything they have made public, in one file." },
  { id: "read", title: "Read them", line: "How they think, what they believe, how they talk." },
  { id: "interrogate", title: "Interrogate", line: "Question a simulation built from their posts." },
] as const;
type Purpose = (typeof PURPOSES)[number]["id"];

const OPENING = { draw: 0.15, fill: 1.45, motto: 2.1, hold: 3.3 };

/** After a name is confirmed, how long before the cards ask what it is for. */
const CARDS_AFTER = 1.5;

const RESTING = 0.22;

/** How hard each keystroke and each bit of pointer travel stirs the light, and how fast it settles. */
const STIR = { key: 0.14, card: 0.08, choose: 0.3, pointer: 0.00035, max: 0.45, settle: 2.2 };

/** Three slow waves out of phase, so the light swells and ebbs without ever repeating. 0 to 1. */
const think = (t: number) =>
  0.5 + 0.5 * (0.5 * Math.sin(t * 0.9) + 0.3 * Math.sin(t * 1.7 + 1.3) + 0.2 * Math.sin(t * 2.9 + 0.4));

/** How quickly the Spectator's gaze catches the pointer. Lower trails further behind. */
const GAZE = 4.5;

const GRID =
  "[background-image:linear-gradient(to_right,color-mix(in_oklab,var(--foreground)_14%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--foreground)_14%,transparent)_1px,transparent_1px)] [background-size:56px_56px] [background-position:center_center]";

const TYPE = "text-[clamp(1.5rem,5vw,3.5rem)] leading-none font-medium tracking-[-0.04em]";
const CAPTION = "text-[11px] font-medium tracking-[0.22em] text-muted uppercase";

const dissolve = { opacity: 0, filter: "blur(8px)", transition: { duration: 0.15, ease: EASE } };

type Stage = "opening" | "name" | "confirmed" | "purpose" | "searching" | "candidates" | "starting" | "failed";

/** Stages where the light thinks harder, because something is being looked for. */
const WATCHING: Stage[] = ["confirmed", "purpose", "searching", "candidates", "starting"];

/** How often to ask whether the search has finished. */
const POLL_MS = 2500;

export function Landing() {
  const reduce = useReducedMotion() ?? false;
  const [stage, setStage] = useState<Stage>("opening");
  // The opening played, so the gate and motto travel to their corners instead of fading in.
  const opened = !reduce;
  const [subject, setSubject] = useState("");
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const router = useRouter();
  // Bumped on every reset, so a search from an earlier name never lands on a later one.
  const generation = useRef(0);

  const grid = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const mountedAt = useRef<number | null>(null);
  const confirmedAt = useRef(-Infinity);
  // What the visitor is doing to the light right now. Rises on input, settles on its own.
  const stir = useRef({ energy: 0, at: 0, last: null as { x: number; y: number } | null });
  const stirBy = (amount: number) => {
    stir.current.energy = Math.min(STIR.max, stir.current.energy + amount);
  };

  // The opening plays on every load. With reduced motion it is skipped straight away.
  useEffect(() => {
    mountedAt.current = performance.now();
    const id = setTimeout(() => setStage((s) => (s === "opening" ? "name" : s)), reduce ? 0 : OPENING.hold * 1000);
    return () => clearTimeout(id);
  }, [reduce]);

  // A beat after the name is confirmed, the cards ask what it is for.
  useEffect(() => {
    if (stage !== "confirmed") return;
    const id = setTimeout(() => setStage("purpose"), reduce ? 0 : CARDS_AFTER * 1000);
    return () => clearTimeout(id);
  }, [stage, reduce]);

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

  // Read every frame by the glow. Rises on arrival, then thinks: it drifts on its own, stirs when you
  // type or move, thinks harder once a name is confirmed, and flares once at the confirmation.
  const level = () => {
    const now = performance.now();
    const since = mountedAt.current === null ? 0 : (now - mountedAt.current) / 1000;
    const rise = reduce ? 1 : 1 - Math.pow(1 - Math.min(1, since / 1.8), 3);
    const flare = 0.65 - (now - confirmedAt.current) / 3200;
    if (reduce) return Math.max(RESTING, flare);

    const state = stir.current;
    const dt = state.at ? Math.min(0.1, (now - state.at) / 1000) : 0;
    state.at = now;
    state.energy *= Math.exp(-STIR.settle * dt);

    const searching = WATCHING.includes(stage);
    const t = now / 1000;
    const mind = searching ? think(t * 1.6) : think(t);
    const drift = RESTING * (0.7 + 0.6 * mind) + (searching ? 0.1 * mind : 0);
    return Math.max(rise * drift + state.energy, flare);
  };

  const look = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    pointer.current = { x: event.clientX, y: event.clientY };
    // Faster movement stirs the light more.
    const last = stir.current.last;
    if (last) stirBy(Math.hypot(event.clientX - last.x, event.clientY - last.y) * STIR.pointer);
    stir.current.last = { x: event.clientX, y: event.clientY };
    if (grid.current) grid.current.dataset.on = "";
  };
  const lookAway = () => {
    stir.current.last = null;
    if (grid.current) delete grid.current.dataset.on;
  };

  const skipOpening = () => setStage((s) => (s === "opening" ? "name" : s));

  const answer = (value: string) => {
    setSubject(value);
    setStage("confirmed");
  };

  const fail = (err: unknown) => {
    setProblem(err instanceof ApiError ? err.message : "Something went wrong");
    setStage("failed");
  };

  // Search the open web for the name's accounts, then wait for the visitor to say which are really them.
  const search = async (purposeId: Purpose) => {
    const mine = ++generation.current;
    setStage("searching");
    try {
      const title = PURPOSES.find((p) => p.id === purposeId)?.title;
      let { discovery } = await api<{ discovery: DiscoveryRow }>("/api/discover", {
        method: "POST",
        body: JSON.stringify({ name: subject, purpose: title }),
      });
      while (discovery.status === "searching") {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (generation.current !== mine) return;
        ({ discovery } = await api<{ discovery: DiscoveryRow }>(`/api/discover/${discovery.id}`));
      }
      if (generation.current !== mine) return;
      if (discovery.status === "failed") throw new ApiError(502, "The search did not finish. Try again.");
      if (!discovery.candidates.length) throw new ApiError(404, "Nothing public under this name");
      setCandidates(discovery.candidates);
      setPicked([]);
      setStage("candidates");
    } catch (err) {
      if (generation.current === mine) fail(err);
    }
  };

  const choose = (id: Purpose) => {
    if (stage !== "purpose") return;
    setPurpose(id);
    stirBy(STIR.choose);
    // A beat with the choice lit, then the search starts.
    setTimeout(() => search(id), reduce ? 0 : 700);
  };

  const togglePick = (id: string) => {
    stirBy(STIR.card);
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  };

  // The confirmed accounts become the research job, and the file opens.
  const open = async () => {
    if (stage !== "candidates" || !picked.length) return;
    const mine = generation.current;
    setStage("starting");
    stirBy(STIR.choose);
    try {
      const chosen = candidates.filter((c) => picked.includes(c.id));
      const title = PURPOSES.find((p) => p.id === purpose)?.title ?? "Gather intelligence";
      const { job } = await api<{ job: { id: string } }>("/api/research", {
        method: "POST",
        body: JSON.stringify({
          subjectName: subject,
          notes: `Purpose: ${title}.`,
          targets: chosen.map((c) => ({ platform: c.platform, target: c.url })),
        }),
      });
      if (generation.current === mine) router.push(`/dossier/${job.id}`);
    } catch (err) {
      if (generation.current === mine) fail(err);
    }
  };

  const reset = () => {
    generation.current++;
    setSubject("");
    setPurpose(null);
    setCandidates([]);
    setPicked([]);
    setProblem("");
    setStage("name");
  };

  // Keys work wherever focus is. Once the field is gone, focus sits on the page, not inside it.
  // Read through a ref, so the listener always sees the latest stage and handlers.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (event: KeyboardEvent) => {
      if (stage === "opening") return skipOpening();
      if (event.key === "Escape" && stage !== "name") return reset();
      if (event.key === "Enter" && stage === "candidates") return void open();
      const card = PURPOSES[Number(event.key) - 1];
      if (stage === "purpose" && card) choose(card.id);
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The gate and motto in their corners. After the opening they travel there; otherwise they fade in.
  const corner = (delay: number, from: TargetAndTransition) =>
    opened || reduce
      ? { transition: { layout: { duration: 1.1, ease: EASE } } }
      : { initial: from, animate: { opacity: 1, filter: "blur(0px)", y: 0 }, transition: { duration: 1.1, ease: EASE, delay } };

  return (
    <main
      className="dark relative grid min-h-svh place-items-center overflow-x-clip bg-background px-6 py-20 sm:py-24 text-foreground selection:bg-foreground selection:text-background"
      onPointerDown={() => stage === "opening" && skipOpening()}
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

      {/* The light under the gate. A band wider than the screen, so only its bottom edge glows. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[15%] bottom-0 -left-[15%] h-[60svh] [mask-image:linear-gradient(to_top,black_0%,black_15%,transparent_70%)]"
        {...(reduce
          ? {}
          : { initial: { opacity: 0, y: "10%" }, animate: { opacity: 1, y: 0 }, transition: { duration: 1.8, ease: EASE } })}
      >
        <Aura
          palette={ASH}
          level={level}
          intensity={1.5}
          speed={reduce ? 0 : WATCHING.includes(stage) ? 1.1 : 0.6}
          radius={0}
          className="h-full w-full"
        />
      </motion.div>

      {stage === "opening" && (
        // The title. The gate draws itself in the middle, the motto under it. Both travel to their corners after.
        <div className="relative flex flex-col items-center gap-8" role="img" aria-label="Shaar. Beware the Spectator.">
          <motion.div layoutId="mark" className="text-foreground">
            <DrawnGate className="h-20 w-auto sm:h-24" />
          </motion.div>
          <motion.p
            layoutId="motto"
            className={CAPTION}
            initial={{ opacity: 0, filter: "blur(6px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.9, ease: EASE, delay: OPENING.motto }}
          >
            Beware the Spectator
          </motion.p>
        </div>
      )}

      {stage !== "opening" && (
        <>
          <motion.div
            layoutId="mark"
            className="absolute top-6 left-6 sm:top-8 sm:left-8"
            {...corner(0.5, { opacity: 0, filter: "blur(10px)", y: 6 })}
          >
            <Logo className="h-7 w-auto" />
          </motion.div>
          <motion.p
            layoutId="motto"
            className={cx("absolute top-6 right-6 flex h-7 items-center sm:top-8 sm:right-8", CAPTION)}
            {...corner(1.6, { opacity: 0, filter: "blur(8px)" })}
          >
            Beware the Spectator
          </motion.p>

          <div className="relative flex w-full max-w-[920px] flex-col items-center">
            {stage === "name" ? (
              <Ask key="name" delay={opened ? 0.7 : 0.8} reduce={reduce} onType={() => stirBy(STIR.key)} onAnswer={answer} />
            ) : (
              <>
                {/* The name never leaves. It was confirmed where it was typed and only glides up for the cards. */}
                <motion.div layout="position" transition={{ duration: 0.9, ease: EASE }} className="flex max-w-full flex-col items-center">
                  <Subject name={subject} reduce={reduce} onConfirmed={() => (confirmedAt.current = performance.now())} onReset={reset} />
                  <Caption
                    text={
                      stage === "confirmed"
                        ? "Confirmed"
                        : stage === "purpose"
                          ? "What do we do with them"
                          : stage === "searching"
                            ? "Searching public records"
                            : stage === "candidates"
                              ? "Is this them"
                              : stage === "starting"
                                ? "Opening the file"
                                : problem
                    }
                    live={stage === "searching" || stage === "starting"}
                    reduce={reduce}
                  />
                </motion.div>

                <AnimatePresence mode="wait">
                  {stage === "purpose" && (
                    <Cards key="purpose" reduce={reduce} chosen={purpose} onChoose={choose} onHover={() => stirBy(STIR.card)} />
                  )}
                  {(stage === "candidates" || stage === "starting") && (
                    <Candidates
                      key="candidates"
                      reduce={reduce}
                      candidates={candidates}
                      picked={picked}
                      busy={stage === "starting"}
                      onToggle={togglePick}
                      onOpen={open}
                    />
                  )}
                  {stage === "failed" && (
                    <motion.button
                      key="again"
                      type="button"
                      onClick={reset}
                      className={cx(CAPTION, "mt-8 cursor-pointer underline decoration-underline underline-offset-[6px] transition-colors duration-150 hover:text-foreground")}
                      initial={reduce ? false : { opacity: 0, filter: "blur(6px)" }}
                      animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.4, ease: EASE } }}
                      exit={dissolve}
                    >
                      Someone else
                    </motion.button>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}

/** The gate drawing itself. A hairline traces every arch, then the shape fills and the line falls away. */
function DrawnGate({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={GATE.viewBox} className={className} aria-hidden="true">
      <motion.path
        d={GATE.d}
        fill="currentColor"
        fillRule="evenodd"
        stroke="currentColor"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0, fillOpacity: 0, strokeOpacity: 0.85 }}
        animate={{ pathLength: 1, fillOpacity: 1, strokeOpacity: 0 }}
        transition={{
          pathLength: { duration: 1.6, ease: [0.65, 0, 0.35, 1], delay: OPENING.draw },
          fillOpacity: { duration: 0.9, ease: EASE, delay: OPENING.fill },
          strokeOpacity: { duration: 0.6, ease: EASE, delay: OPENING.fill + 0.45 },
        }}
      />
    </svg>
  );
}

/**
 * The question and its field. The question rises word by word when it first
 * appears, dissolves on the first key, and the return key shows once there is
 * an answer. On Enter the answer locks where it was typed.
 */
function Ask({
  delay,
  reduce,
  onType,
  onAnswer,
}: {
  delay: number;
  reduce: boolean;
  onType: () => void;
  onAnswer: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  // The question rises word by word once. Coming back after a cleared field, it only fades in.
  const [risen, setRisen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRisen(true), (delay + 1.2) * 1000);
    return () => clearTimeout(timer);
  }, [delay]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const answer = value.trim();
    if (answer) onAnswer(answer);
  };

  return (
    <form onSubmit={submit} className="relative grid w-full place-items-center">
      <label htmlFor="subject" className="sr-only">
        {QUESTION}
      </label>
      <input
        id="subject"
        name="subject"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onType();
        }}
        className={cx(
          "col-start-1 row-start-1 w-full bg-transparent text-center outline-none focus-visible:outline-none",
          TYPE,
          value ? "caret-foreground" : "caret-transparent",
        )}
      />
      <AnimatePresence>{!value && <Question key="question" first={!risen} delay={delay} reduce={reduce} />}</AnimatePresence>
      {/* The return key, so it is clear the name is sent with Enter. Also a tap target on phones. */}
      <AnimatePresence>
        {value.trim() && (
          <motion.button
            key="enter"
            type="submit"
            aria-label="Enter to confirm"
            className="group absolute top-full left-1/2 mt-5 flex -translate-x-1/2 cursor-pointer items-center gap-2.5 p-2 whitespace-nowrap"
            initial={reduce ? false : { opacity: 0, filter: "blur(6px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.25, ease: EASE } }}
            exit={dissolve}
          >
            <Kbd className="h-7 min-w-7 rounded-item px-2 transition-colors duration-150 group-hover:bg-control-hover group-hover:text-foreground">
              <Icon icon={CornerDownLeftIcon} size={14} />
            </Kbd>
            <span className={cx(CAPTION, "transition-colors duration-150 group-hover:text-foreground")}>Enter to confirm</span>
          </motion.button>
        )}
      </AnimatePresence>
    </form>
  );
}

/** The question, drawn over the empty field. Rises word by word on arrival, dissolves on the first key. */
function Question({ first, delay, reduce }: { first: boolean; delay: number; reduce: boolean }) {
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
              transition={{ duration: 0.9, ease: EASE, delay: delay + i * 0.07 }}
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
            : { duration: 1.1, times: [0, 0.01, 0.5, 0.51, 1], repeat: Infinity, delay: rise ? delay + 0.9 : 0 }
        }
      />
    </motion.p>
  );
}

/**
 * The name, confirmed where it was typed. It does not move or change. After a
 * beat the light answers and a slow shimmer starts.
 */
function Subject({
  name,
  reduce,
  onConfirmed,
  onReset,
}: {
  name: string;
  reduce: boolean;
  onConfirmed: () => void;
  onReset: () => void;
}) {
  const [confirmed, setConfirmed] = useState(reduce);
  useEffect(() => {
    if (reduce) {
      onConfirmed();
      return;
    }
    const id = setTimeout(() => {
      setConfirmed(true);
      onConfirmed();
    }, 350);
    return () => clearTimeout(id);
    // Once, when the name arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      type="button"
      onClick={onReset}
      title="Someone else"
      aria-label={`${name}, confirmed`}
      className="max-w-full cursor-pointer"
    >
      {/* Same type and centring as the field, so the swap from input to text cannot be seen. */}
      <span aria-hidden="true" className={cx("block truncate text-center", TYPE, confirmed && "shimmer")}>
        {name}
      </span>
    </button>
  );
}

/** The one line under the name. It reads Confirmed, then turns into the question the cards answer. */
function Caption({ text, live = false, reduce }: { text: string; live?: boolean; reduce: boolean }) {
  return (
    <div className="relative mt-7 h-4">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={text}
          className={cx("whitespace-nowrap", CAPTION, live && "shimmer")}
          initial={reduce ? false : { opacity: 0, filter: "blur(6px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={dissolve}
          transition={{ duration: 0.6, ease: EASE, delay: text === "Confirmed" && !reduce ? 0.35 : 0 }}
        >
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

/** Three ways to use Shaar, as Fragms cards: a frame, a stage that shows the idea, and its name underneath. */
function Cards({
  reduce,
  chosen,
  onChoose,
  onHover,
}: {
  reduce: boolean;
  chosen: Purpose | null;
  onChoose: (id: Purpose) => void;
  onHover: () => void;
}) {
  const [hovered, setHovered] = useState<Purpose | null>(null);
  return (
    <motion.div
      role="radiogroup"
      aria-label="What is this for"
      className="mt-10 grid w-full max-w-[880px] gap-3 sm:grid-cols-3 sm:gap-4"
      initial={reduce ? false : "hidden"}
      animate="show"
      exit={dissolve}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.25 } } }}
    >
      {PURPOSES.map((card) => {
        const active = chosen === card.id;
        const dimmed = chosen !== null && !active;
        const live = !reduce && (active || hovered === card.id);
        return (
          <motion.button
            key={card.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChoose(card.id)}
            onPointerEnter={() => {
              setHovered(card.id);
              onHover();
            }}
            onPointerLeave={() => setHovered(null)}
            variants={{
              hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
              show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
            }}
            className="cursor-pointer rounded-card text-left"
          >
            <Card
              className={cx(
                "h-full transition-[background-color,border-color,opacity,transform] duration-150 ease-out hover:bg-card-hover active:scale-[0.99]",
                active && "border-foreground/30 bg-card-hover",
                // The entrance animation owns the button's opacity, so the fade back lives on the card itself.
                dimmed && "opacity-45 hover:opacity-85",
              )}
            >
              <CardStage className="h-20 sm:h-auto sm:aspect-[4/3]">
                <Motif id={card.id} live={live} />
              </CardStage>
              <CardBody
                title={card.title}
                description={card.line}
                action={
                  <Icon
                    icon={active ? Tick02Icon : ArrowRight01Icon}
                    size={16}
                    className={cx(
                      "mr-1 shrink-0 transition-[color,transform] duration-250 ease-smooth",
                      active ? "text-foreground" : "text-muted group-hover/card:translate-x-0.5",
                    )}
                  />
                }
              />
            </Card>
          </motion.button>
        );
      })}
    </motion.div>
  );
}

/** What each card's stage shows. Still at rest, alive while hovered or chosen. Monochrome, like the rest. */
function Motif({ id, live }: { id: Purpose; live: boolean }) {
  if (id === "interrogate") {
    // A voice. Thin bars that start to speak.
    const bars = [0.35, 0.6, 0.45, 0.8, 0.55, 1, 0.7, 0.4, 0.85, 0.5, 0.65, 0.3];
    return (
      <div className="flex h-12 items-center gap-[5px]" aria-hidden="true">
        {bars.map((h, i) => (
          <motion.span
            key={i}
            className="h-full w-[3px] origin-center rounded-full bg-foreground/45"
            initial={false}
            animate={live ? { scaleY: [h * 0.5, h, h * 0.35, h * 0.8, h * 0.5] } : { scaleY: h * 0.5 }}
            transition={
              live
                ? { duration: 1.2 + (i % 4) * 0.15, repeat: Infinity, ease: "easeInOut", delay: i * 0.04 }
                : { duration: 0.4, ease: EASE }
            }
          />
        ))}
      </div>
    );
  }
  if (id === "gather") {
    // The Spectator looking. A fine grid and a focus ring that tightens on its subject.
    return (
      <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
        <div
          className="absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,color-mix(in_oklab,var(--foreground)_10%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--foreground)_10%,transparent)_1px,transparent_1px)] [background-position:center_center] [background-size:18px_18px] [mask-image:radial-gradient(closest-side,black,transparent)]"
        />
        <motion.span
          className="relative size-14 rounded-full border border-foreground/40"
          initial={false}
          animate={live ? { scale: [1.25, 0.9, 1], opacity: 1 } : { scale: 1.25, opacity: 0.6 }}
          transition={{ duration: 0.9, ease: EASE }}
        />
        <span className="absolute size-1.5 rounded-full bg-foreground/70" />
      </div>
    );
  }
  // Reading what they post. Lines of text, a highlight reading down through them.
  const lines = ["78%", "92%", "60%", "86%", "70%"];
  return (
    <div className="flex w-[62%] flex-col gap-2.5" aria-hidden="true">
      {lines.map((w, i) => (
        <motion.span
          key={i}
          className="h-1.5 rounded-full bg-foreground"
          style={{ width: w }}
          initial={false}
          animate={live ? { opacity: [0.14, 0.6, 0.14, 0.14] } : { opacity: 0.14 }}
          transition={live ? { duration: 2, repeat: Infinity, delay: i * 0.4, times: [0, 0.2, 0.4, 1] } : { duration: 0.3 }}
        />
      ))}
    </div>
  );
}

/**
 * The accounts the search found, as Fragms cards. The visitor chooses every one
 * that is really this person; nothing is collected until they confirm.
 */
function Candidates({
  reduce,
  candidates,
  picked,
  busy,
  onToggle,
  onOpen,
}: {
  reduce: boolean;
  candidates: Candidate[];
  picked: string[];
  busy: boolean;
  onToggle: (id: string) => void;
  onOpen: () => void;
}) {
  return (
    <motion.div
      className="mt-10 flex w-full max-w-[880px] flex-col items-center"
      initial={reduce ? false : "hidden"}
      animate="show"
      exit={dissolve}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } } }}
    >
      <div role="group" aria-label="Accounts found" className="grid w-full gap-3 sm:grid-cols-3 sm:gap-4">
        {candidates.map((c) => {
          const on = picked.includes(c.id);
          return (
            <motion.button
              key={c.id}
              type="button"
              aria-pressed={on}
              disabled={busy}
              onClick={() => onToggle(c.id)}
              variants={{
                hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
                show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
              }}
              className="cursor-pointer rounded-card text-left disabled:cursor-default"
            >
              <Card
                className={cx(
                  "h-full transition-[background-color,border-color,opacity,transform] duration-150 ease-out hover:bg-card-hover active:scale-[0.99]",
                  on && "border-foreground/30 bg-card-hover",
                  busy && !on && "opacity-40",
                )}
              >
                <CardStage className="h-20 flex-col gap-1">
                  <span className={CAPTION}>{c.label}</span>
                  <span className="max-w-[90%] truncate text-[17px] font-medium tracking-[-0.01em]">@{c.handle}</span>
                </CardStage>
                <CardBody
                  title={<span className="line-clamp-1">{c.title || c.label}</span>}
                  description={<span className="line-clamp-2">{c.snippet || c.url}</span>}
                  action={
                    <Icon
                      icon={on ? Tick02Icon : ArrowRight01Icon}
                      size={16}
                      className={cx("mr-1 shrink-0 transition-colors duration-250", on ? "text-foreground" : "text-muted")}
                    />
                  }
                />
              </Card>
            </motion.button>
          );
        })}
      </div>

      {/* Enter opens the file with the chosen accounts. Shown once at least one is chosen. */}
      <div className="mt-6 h-11">
        <AnimatePresence>
          {picked.length > 0 && !busy && (
            <motion.button
              key="open"
              type="button"
              onClick={onOpen}
              className="group flex cursor-pointer items-center gap-2.5 p-2 whitespace-nowrap"
              initial={reduce ? false : { opacity: 0, filter: "blur(6px)" }}
              animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.25, ease: EASE } }}
              exit={dissolve}
            >
              <Kbd className="h-7 min-w-7 rounded-item px-2 transition-colors duration-150 group-hover:bg-control-hover group-hover:text-foreground">
                <Icon icon={CornerDownLeftIcon} size={14} />
              </Kbd>
              <span className={cx(CAPTION, "transition-colors duration-150 group-hover:text-foreground")}>
                Enter to open the file
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

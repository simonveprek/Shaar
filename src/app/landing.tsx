"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Aura, type AuraColors } from "@/components/fragms";
import { cx } from "@/components/ui";

/*
 * The front door. One field for a name over a cold glow that rises from the
 * bottom edge. The glow breathes at rest, swells while you type and flares
 * when you send.
 */

/** Cold greys, from bone to ash. Monochrome, and never pure white, so the light reads as a screen left on in an empty room. */
const ASH: AuraColors = ["#c8c8cc", "#5c5c63", "#9a9aa1", "#3a3a40"];

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function Landing() {
  const [name, setName] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // When the last key was pressed and when the name was sent, read every frame by the glow.
  const pulse = useRef({ key: -Infinity, sent: -Infinity, focused: false });
  const now = useClock();

  const level = () => {
    const t = performance.now();
    const typing = Math.max(0, 0.45 - (t - pulse.current.key) / 1400);
    const flare = Math.max(0, 0.65 - (t - pulse.current.sent) / 3200);
    const resting = pulse.current.focused ? 0.3 : 0.2;
    return Math.max(resting, typing, flare);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const subject = name.trim();
    if (!subject) return;
    pulse.current.sent = performance.now();
    setSent(subject);
    input.current?.blur();
  };

  const reset = () => {
    setSent(null);
    setName("");
    requestAnimationFrame(() => input.current?.focus());
  };

  return (
    <main className="dark relative flex min-h-svh flex-col overflow-hidden bg-background text-foreground selection:bg-foreground selection:text-background">
      {/* A vignette under everything, so the edges sink but the glow stays bright. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_at_50%_40%,transparent_35%,black_100%)]"
      />

      {/* The glow. A band wider than the screen, so only its bottom edge shows; the mask fades its top away.
          Aura positions itself, so it sits in a wrapper that does the placing. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[15%] bottom-0 -left-[15%] h-[62svh] [mask-image:linear-gradient(to_top,black_0%,black_18%,transparent_72%)]"
      >
        <Aura palette={ASH} level={level} intensity={1.4} speed={0.35} radius={0} className="h-full w-full" />
      </div>

      {/* Scan lines over the glow, faint enough to feel rather than see. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:repeating-linear-gradient(to_bottom,white_0px,white_1px,transparent_1px,transparent_3px)]"
      />

      <header className="relative z-10 flex items-center justify-between px-5 pt-5 font-mono text-[11px] tracking-[0.22em] text-muted uppercase sm:px-8 sm:pt-7">
        <span className="text-foreground">Projstalker</span>
        <span className="tabular-nums" suppressHydrationWarning>
          {now ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` : "00:00:00"}
        </span>
      </header>

      <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 pb-[18svh]">
        <p className="mb-8 font-mono text-[11px] tracking-[0.32em] text-muted uppercase">
          {sent ? "Subject" : "Who are you looking for"}
        </p>

        {sent ? (
          <div className="flex flex-col items-center text-center">
            <h1 className="shimmer max-w-[16ch] text-[clamp(2.25rem,7vw,5rem)] leading-[1] font-medium tracking-[-0.04em] break-words">
              {sent}
            </h1>
            <p className="mt-6 font-mono text-[11px] tracking-[0.32em] text-muted uppercase">Searching public records</p>
            <button
              type="button"
              onClick={reset}
              className="mt-10 cursor-pointer font-mono text-[11px] tracking-[0.22em] text-muted uppercase underline decoration-underline underline-offset-[6px] transition-colors duration-150 hover:text-foreground"
            >
              Someone else
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="w-full max-w-[640px]">
            <label htmlFor="subject" className="sr-only">
              Full name
            </label>
            <input
              ref={input}
              id="subject"
              name="subject"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                pulse.current.key = performance.now();
              }}
              onFocus={() => (pulse.current.focused = true)}
              onBlur={() => (pulse.current.focused = false)}
              placeholder="Full name"
              className={cx(
                "w-full border-b border-line-strong bg-transparent pb-4 text-center text-[clamp(1.75rem,5.5vw,3.5rem)] leading-tight font-medium tracking-[-0.03em] outline-none",
                "placeholder:text-muted/40 caret-foreground transition-colors duration-250 ease-smooth focus:border-foreground/40",
                "focus-visible:outline-none",
              )}
            />
            <p
              className={cx(
                "mt-5 text-center font-mono text-[11px] tracking-[0.22em] text-muted uppercase transition-opacity duration-250 ease-smooth",
                name.trim() ? "opacity-100" : "opacity-0",
              )}
            >
              Press enter
            </p>
          </form>
        )}
      </section>

      <footer className="relative z-10 flex items-center justify-between px-5 pb-5 font-mono text-[10px] tracking-[0.22em] text-muted/70 uppercase sm:px-8 sm:pb-7">
        <span>Public data only</span>
        <a href="/docs" className="transition-colors duration-150 hover:text-foreground">
          API
        </a>
      </footer>
    </main>
  );
}

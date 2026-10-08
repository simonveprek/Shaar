"use client";

import { useRef, useState, type FormEvent, type PointerEvent } from "react";
import { Aura, type AuraColors } from "@/components/fragms";
import { Logo } from "@/components/logo";
import { cx } from "@/components/ui";

/*
 * The front door. Black, one field for a name, and a cold glow along the
 * bottom edge. The glow holds still until a name is sent, then flares once
 * and settles.
 */

/** Cold greys, never pure white, so the light reads as a screen left on in an empty room. */
const ASH: AuraColors = ["#c8c8cc", "#5c5c63", "#9a9aa1", "#3a3a40"];

const RESTING = 0.22;

export function Landing() {
  const [name, setName] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const sentAt = useRef(-Infinity);

  // The grid shows only around the pointer. Its position is written straight to CSS, so moving never re-renders.
  const reveal = (event: PointerEvent<HTMLElement>) => {
    const node = grid.current;
    if (!node || event.pointerType !== "mouse") return;
    node.style.setProperty("--x", `${event.clientX}px`);
    node.style.setProperty("--y", `${event.clientY}px`);
    node.dataset.on = "";
  };
  const hide = () => {
    if (grid.current) delete grid.current.dataset.on;
  };

  // Read every frame by the glow. Still at rest, one flare after sending.
  const level = () => Math.max(RESTING, 0.65 - (performance.now() - sentAt.current) / 3200);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const subject = name.trim();
    if (!subject) return;
    sentAt.current = performance.now();
    setSent(subject);
  };

  const reset = () => {
    setSent(null);
    setName("");
    requestAnimationFrame(() => input.current?.focus());
  };

  return (
    <main
      className="dark relative grid min-h-svh place-items-center overflow-hidden bg-background px-6 text-foreground selection:bg-foreground selection:text-background"
      onKeyDown={(event) => event.key === "Escape" && sent && reset()}
      onPointerMove={reveal}
      onPointerLeave={hide}
    >
      {/* A grid that is only there where the pointer is, fading out over a few cells. */}
      <div
        ref={grid}
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 ease-smooth data-[on]:opacity-100 data-[on]:duration-250",
          "[background-image:linear-gradient(to_right,color-mix(in_oklab,var(--foreground)_14%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--foreground)_14%,transparent)_1px,transparent_1px)]",
          "[background-size:56px_56px] [background-position:center_center]",
          "[mask-image:radial-gradient(240px_circle_at_var(--x,50%)_var(--y,50%),black,transparent)]",
        )}
      />

      {/* A band wider than the screen, so only its bottom edge glows. The mask fades its top away. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[15%] bottom-0 -left-[15%] h-[60svh] [mask-image:linear-gradient(to_top,black_0%,black_15%,transparent_70%)]"
      >
        <Aura palette={ASH} level={level} intensity={1.4} speed={sent ? 0.35 : 0.08} radius={0} className="h-full w-full" />
      </div>

      <Logo className="absolute top-6 left-6 h-7 w-auto text-foreground sm:top-8 sm:left-8" />

      {sent ? (
        <button
          type="button"
          onClick={reset}
          title="Someone else"
          className="shimmer relative max-w-[16ch] cursor-pointer text-center text-[clamp(1.5rem,5vw,3.5rem)] leading-none font-medium tracking-[-0.04em] break-words"
        >
          {sent}
        </button>
      ) : (
        <form onSubmit={submit} className="relative w-full max-w-[920px]">
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
            onChange={(e) => setName(e.target.value)}
            placeholder="Who are we looking for?"
            className="w-full bg-transparent text-center text-[clamp(1.5rem,5vw,3.5rem)] leading-none font-medium tracking-[-0.04em] caret-foreground outline-none placeholder:text-foreground/15 focus-visible:outline-none"
          />
        </form>
      )}
    </main>
  );
}

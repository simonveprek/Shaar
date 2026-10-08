"use client";

import { useRef, useState, type FormEvent } from "react";
import { Aura, type AuraColors } from "@/components/fragms";

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
  const sentAt = useRef(-Infinity);

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
    >
      {/* A band wider than the screen, so only its bottom edge glows. The mask fades its top away. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[15%] bottom-0 -left-[15%] h-[60svh] [mask-image:linear-gradient(to_top,black_0%,black_15%,transparent_70%)]"
      >
        <Aura palette={ASH} level={level} intensity={1.4} speed={sent ? 0.35 : 0.08} radius={0} className="h-full w-full" />
      </div>

      {sent ? (
        <button
          type="button"
          onClick={reset}
          title="Someone else"
          className="shimmer relative max-w-[16ch] cursor-pointer text-center text-[clamp(2rem,6vw,4.5rem)] leading-none font-medium tracking-[-0.04em] break-words"
        >
          {sent}
        </button>
      ) : (
        <form onSubmit={submit} className="relative w-full max-w-[640px]">
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
            placeholder="Name"
            className="w-full bg-transparent text-center text-[clamp(2rem,6vw,4.5rem)] leading-none font-medium tracking-[-0.04em] caret-foreground outline-none placeholder:text-foreground/15 focus-visible:outline-none"
          />
        </form>
      )}
    </main>
  );
}

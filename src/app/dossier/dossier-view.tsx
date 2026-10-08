"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { List, Row, Stat, Status } from "@/components/bits";
import { Logo } from "@/components/logo";
import { Badge, cx, EASE, Item, LineChart, Panel, Reveal } from "@/components/ui";
import type { Dossier } from "@/lib/dossier";

/*
 * The file, as a watcher would read it. Monochrome, quiet, and every number
 * comes from public posts. It shows how exposed someone is, never a verdict.
 */

const CAPTION = "text-[11px] font-medium tracking-[0.22em] text-muted uppercase";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const month = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" }) : "never";
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Counts up to a number once, on the kit's curve. */
function useCount(target: number, decimals = 0) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1400);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduce]);
  return value.toFixed(decimals);
}

function Section({
  title,
  note,
  className,
  children,
}: {
  title: string;
  note?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Item className={cx("min-w-0", className)}>
      <Panel className="h-full sm:p-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-[15px] font-medium">{title}</h2>
          {note && <p className="text-caption text-muted">{note}</p>}
        </div>
        {children}
      </Panel>
    </Item>
  );
}

export function DossierView({
  dossier,
  sample = false,
  status,
}: {
  dossier: Dossier;
  sample?: boolean;
  /** A line in the header while the file is still being put together. */
  status?: ReactNode;
}) {
  const { totals, exposure } = dossier;
  const posts = useCount(totals.posts);
  const platforms = useCount(totals.platforms);
  const years = useCount(totals.yearsVisible, 1);
  const score = useCount(exposure.score);

  return (
    <main className="dark min-h-svh bg-background text-foreground selection:bg-foreground selection:text-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-3 px-5 sm:px-8">
          <Link href="/" aria-label="Shaar" className="flex items-center gap-2.5 text-[15px] font-medium">
            <Logo className="h-5 w-auto" />
            Shaar
          </Link>
          <div className="ml-auto flex items-center gap-3">
            {status && <span className={cx(CAPTION, "shimmer hidden sm:inline")}>{status}</span>}
            <span className={cx(CAPTION, "hidden sm:inline")}>File {dossier.fileNumber}</span>
            <Status tone="strong">Simulation</Status>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1180px] px-5 pt-10 pb-24 sm:px-8 sm:pt-14">
        <Reveal>
          <Item>
            <p className={CAPTION}>{sample ? "Sample file · fictional subject" : `Subject file ${dossier.fileNumber}`}</p>
          </Item>
          <Item>
            <h1 className="mt-4 text-title">{dossier.subject.name}</h1>
          </Item>
          {dossier.subject.oneLine && (
            <Item>
              <p className="mt-3 max-w-[62ch] text-body text-muted">{dossier.subject.oneLine}</p>
            </Item>
          )}
          <Item>
            <p className="mt-5 text-label text-muted">
              Put together from {totals.items} public items across {totals.platforms} platforms. First seen{" "}
              {month(totals.firstSeen)}, last seen {month(totals.lastSeen)}.
            </p>
          </Item>
        </Reveal>

        <Reveal className="mt-10 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 lg:grid-cols-4 lg:gap-4">
          <Item>
            <Stat label="Public posts" value={posts} hint={`${compact(totals.reach)} people can see them`} />
          </Item>
          <Item>
            <Stat label="Platforms" value={platforms} hint="Accounts linked to one name" />
          </Item>
          <Item>
            <Stat label="Years on record" value={years} hint={`Since ${month(totals.firstSeen)}`} />
          </Item>
          <Item>
            <Stat label="Exposure" value={`${score}`} hint="Out of 100">
              <Bar value={exposure.score} max={100} />
            </Stat>
          </Item>
        </Reveal>

        <Reveal className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:mt-4 lg:grid-cols-3 lg:gap-4">
          <Section
            title="When they are online"
            note={
              dossier.routine.peak
                ? `Most often ${DAYS[dossier.routine.peak.day]} around ${hour(dossier.routine.peak.hour)} UTC`
                : undefined
            }
            className="lg:col-span-2"
          >
            <Routine grid={dossier.routine.grid} />
          </Section>

          <Section title="What makes them visible" note="What a watcher has to work with">
            <div className="flex flex-col gap-4">
              {exposure.factors.map((f) => (
                <div key={f.label}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <p className="text-label">{f.label}</p>
                    <p className="text-caption text-muted tabular-nums">{f.detail}</p>
                  </div>
                  <Bar value={f.value} max={f.label === "Volume" ? 35 : f.label === "Breadth" ? 25 : 20} />
                </div>
              ))}
            </div>
          </Section>

          <Section title="How much they post" note="Posts a month" className="lg:col-span-2">
            {dossier.activity.length > 1 ? (
              <LineChart label="Posts a month" data={dossier.activity} height={200} area format="number" />
            ) : (
              <p className="text-label text-muted">Not enough dated posts yet.</p>
            )}
          </Section>

          <Section title="Seen on">
            <List inset>
              {dossier.presence.map((p) => (
                <Row key={p.platform} className="justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-label font-medium">{p.label}</p>
                    <p className="truncate text-caption text-muted">{p.handle ? `@${p.handle.replace(/^@/, "")}` : "No handle"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-label tabular-nums">{p.posts} posts</p>
                    <p className="text-caption text-muted tabular-nums">
                      {p.followers ? `${compact(p.followers)} followers` : `Last ${month(p.lastSeen)}`}
                    </p>
                  </div>
                </Row>
              ))}
            </List>
          </Section>

          <Section title="In their own words" note="Their most seen posts" className="lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              {dossier.quotes.map((q, i) => (
                <figure key={i} className="flex flex-col justify-between gap-4 rounded-field border border-border bg-well p-4">
                  <blockquote className="text-[15px] leading-relaxed">{q.text}</blockquote>
                  <figcaption className="flex items-center justify-between gap-3 text-caption text-muted">
                    <span>
                      {q.platform} · {day(q.postedAt)}
                    </span>
                    <span className="tabular-nums">{compact(q.engagement)} reactions</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </Section>

          <Section title="Their circle" note="Who they mention most">
            {dossier.circle.length ? (
              <div className="flex flex-col gap-3.5">
                {dossier.circle.map((c) => (
                  <div key={c.handle}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <p className="truncate text-label">@{c.handle}</p>
                      <p className="text-caption text-muted tabular-nums">{c.count}</p>
                    </div>
                    <Bar value={c.count} max={dossier.circle[0].count} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-label text-muted">They do not mention anyone by name.</p>
            )}
          </Section>

          <Section title="What they said they think" note="In their own posts" className="lg:col-span-2">
            {dossier.views.length ? (
              <List inset>
                {dossier.views.map((v) => (
                  <Row key={v.topic} className="flex-col items-start gap-1 px-4 py-3.5">
                    <p className="text-label">
                      <span className="font-medium">{v.topic}</span> <span className="text-muted">· {v.stance}</span>
                    </p>
                    <p className="text-caption text-muted">
                      “{v.evidence}” on {v.platform}
                    </p>
                  </Row>
                ))}
              </List>
            ) : (
              <p className="text-label text-muted">No clear views in their posts.</p>
            )}
          </Section>

          <Section title="What they talk about">
            <div className="flex flex-wrap gap-2">
              {dossier.topics.map((t) => (
                <Badge key={t.label} size="md">
                  {t.label}
                  {t.count > 0 && <span className="ml-1.5 opacity-60 tabular-nums">{t.count}</span>}
                </Badge>
              ))}
            </div>
          </Section>
        </Reveal>

        <Reveal className="mt-16">
          <Item>
            <p className="mx-auto max-w-[60ch] text-center text-label text-muted">
              This file is a simulation. It was put together only from public posts, the way anyone watching could.
              Nothing in it is private, and nothing in it is a judgement of the person.
            </p>
          </Item>
        </Reveal>
      </div>
    </main>
  );
}

/**
 * A plain ink bar for comparing amounts. The kit's Meter turns red near full, which reads as a warning;
 * here the longest bar is simply the most, so it stays monochrome.
 */
function Bar({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-control">
      <motion.div
        className="h-full rounded-full bg-foreground"
        initial={{ width: 0 }}
        whileInView={{ width: `${ratio > 0 ? Math.max(ratio * 100, 2) : 0}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.9, ease: EASE }}
      />
    </div>
  );
}

/** Posts by weekday and hour. Each cell darkens with how often they post then; it fills in on a slow diagonal. */
function Routine({ grid }: { grid: number[][] }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[480px] grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[3px]">
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <span className="self-center text-caption text-muted">{DAYS[d]}</span>
            {row.map((count, h) => (
              <motion.span
                key={h}
                title={`${DAYS[d]} ${hour(h)} UTC, ${count} posts`}
                className={cx("aspect-square rounded-[3px]", count ? "bg-foreground" : "bg-control")}
                initial={reduce ? false : { opacity: 0 }}
                whileInView={{ opacity: count ? 0.12 + 0.88 * (count / max) : 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, ease: EASE, delay: reduce ? 0 : (d + h) * 0.015 }}
              />
            ))}
          </div>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="pt-1 text-center text-[10px] text-muted tabular-nums">
            {h % 6 === 0 ? h : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

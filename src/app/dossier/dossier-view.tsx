"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { List, Row, Stat, Status } from "@/components/bits";
import { Logo } from "@/components/logo";
import { Badge, Button, cx, EASE, Item, LineChart, Panel, Reveal } from "@/components/ui";
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
  iso
    ? new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : "";
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** The first three sentences. Past those, the persona's summary turns to notes on what its data lacked. */
const lede = (text: string) =>
  text
    // A sentence ends at a stop followed by a space and a capital, so Next.js and 3.5 stay whole.
    .split(/(?<=[.!?])\s+(?=\p{Lu})/u)
    .slice(0, 3)
    .join(" ");

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
  interview,
}: {
  dossier: Dossier;
  /** A demo file: true for the fictional sample, or a caption saying what is staged. */
  sample?: boolean | string;
  /** A line in the header while the file is still being put together. */
  status?: ReactNode;
  /** The way into a simulated interview with their persona: a link once it is ready, or a note until then. */
  interview?: { href?: string; note?: string; emphasis?: boolean };
}) {
  const { totals, exposure } = dossier;
  const posts = useCount(totals.posts);
  const accounts = useCount(dossier.presence.length);
  const years = useCount(totals.yearsVisible, 1);

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
        <Reveal className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
          <>
            <Item className="shrink-0">
              <Portrait name={dossier.subject.name} photo={dossier.subject.photo} />
            </Item>
            <div className="min-w-0 flex-1">
              <Item>
                <p className={CAPTION}>
                  {typeof sample === "string"
                    ? sample
                    : sample
                      ? "Sample file · fictional subject"
                      : `Subject file ${dossier.fileNumber}`}
                </p>
              </Item>
              <Item>
                <h1 className="mt-4 text-title">{dossier.subject.name}</h1>
              </Item>
              {dossier.profile.known.length > 0 && (
                <Item>
                  <p className="mt-3 text-[15px]">
                    {dossier.profile.known
                      .filter((k) => k.label !== "Speaks" && k.label !== "Age")
                      .map((k) => k.value)
                      .join(" · ")}
                  </p>
                </Item>
              )}
              {(dossier.subject.summary || dossier.subject.oneLine) && (
                <Item>
                  <p className="mt-3 max-w-[68ch] text-body text-muted">
                    {lede(dossier.subject.summary ?? dossier.subject.oneLine ?? "")}
                  </p>
                </Item>
              )}
              <Item>
                <p className="mt-5 text-label text-muted">
                  Put together from {totals.items} public items across {totals.platforms} platforms. First seen{" "}
                  {month(totals.firstSeen)}, last seen {month(totals.lastSeen)}.
                </p>
              </Item>
              {(dossier.subject.website || interview) && (
                <Item>
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    {interview?.href ? (
                      <Button href={interview.href} variant={interview.emphasis ? "primary" : "secondary"}>
                        Interrogate them
                      </Button>
                    ) : interview?.note ? (
                      <span className={cx(CAPTION, "shimmer")}>{interview.note}</span>
                    ) : null}
                    {dossier.subject.website && (
                      <a
                        href={dossier.subject.website.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-label text-muted underline decoration-underline underline-offset-4 transition-colors duration-150 hover:text-foreground"
                      >
                        {dossier.subject.website.host} ↗
                      </a>
                    )}
                  </div>
                </Item>
              )}
            </div>
          </>
        </Reveal>

        <Reveal className="mt-10 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 lg:grid-cols-4 lg:gap-4">
          <Item>
            <Stat label="Public posts" value={posts} hint={`${compact(totals.reach)} people can see them`} />
          </Item>
          <Item>
            <Stat label="Accounts" value={accounts} hint={`On ${totals.platforms} platforms, linked to one name`} />
          </Item>
          <Item>
            <Stat label="Years on record" value={years} hint={`Since ${month(totals.firstSeen)}`} />
          </Item>
          <Item>
            <Stat
              label="Citizen class"
              value={<span className="text-signal">{dossier.assessment.grade}</span>}
              hint={`${dossier.assessment.score} of 100, assigned by the system`}
            />
          </Item>
        </Reveal>

        <PhotoReading reading={dossier.photoReading} photo={dossier.subject.photo} name={dossier.subject.name} />

        <Profile dossier={dossier} />

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
                <Row key={`${p.platform}:${p.handle}`} className="justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-label font-medium">{p.label}</p>
                    <p className="truncate text-caption text-muted">
                      {p.platform === "website" ? p.handle : p.handle ? `@${p.handle.replace(/^@/, "")}` : "No handle"}
                    </p>
                    {p.via && <p className="truncate text-caption text-muted">Found through {p.via}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-label tabular-nums">
                      {p.private ? "Private" : `${p.count.value} ${p.count.unit}`}
                    </p>
                    {(p.followers || p.lastSeen) && (
                      <p className="text-caption text-muted tabular-nums">
                        {p.followers ? `${compact(p.followers)} followers` : `Last ${month(p.lastSeen)}`}
                      </p>
                    )}
                  </div>
                </Row>
              ))}
            </List>
          </Section>

          <Section
            title="In their own words"
            note={totals.posts ? "Their most seen posts" : "How they describe themselves"}
            className="lg:col-span-2"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {dossier.quotes.map((q, i) => (
                <figure
                  key={i}
                  className="flex flex-col justify-between gap-4 rounded-field border border-border bg-well p-4"
                >
                  <blockquote className="text-[15px] leading-relaxed">{q.text}</blockquote>
                  <figcaption className="flex items-center justify-between gap-3 text-caption text-muted">
                    <span>{[q.platform, day(q.postedAt)].filter(Boolean).join(" · ")}</span>
                    {q.engagement > 0 && <span className="tabular-nums">{compact(q.engagement)} reactions</span>}
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
              This file is a simulation. It was put together only from what they made public, the way anyone watching
              could. Nothing in it is private, and nothing in it is a judgement of the person.
            </p>
          </Item>
        </Reveal>
      </div>
    </main>
  );
}

const SURE = { high: "Sure", medium: "Fairly sure", low: "Unsure" } as const;

/** A small spaced caption over a group inside a section. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={cx(CAPTION, "mb-3")}>{title}</p>
      {children}
    </div>
  );
}

/**
 * Who they are, what their website says and what they build. Each block shows only when a source had something,
 * and a block alone on its row takes the full width.
 */
function Profile({ dossier }: { dossier: Dossier }) {
  const { profile, website, code, web } = dossier;
  const hasWho = profile.known.length + profile.work.length + profile.education.length + profile.facts.length > 0;
  const hasStory = profile.timeline.length > 0;
  const skills = website?.skills ?? [];
  const languages = code?.languages ?? [];
  const hasTools = skills.length + languages.length > 0;
  if (!hasWho && !hasStory && !website && !code && !web) return null;

  return (
    <>
      {(hasWho || hasStory) && (
        <Reveal className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:mt-4 lg:grid-cols-3 lg:gap-4">
          {hasWho && (
            <Section
              title="Who they are"
              note="What their profiles state, then what was read"
              className={hasStory ? "lg:col-span-2" : "lg:col-span-3"}
            >
              <div className="flex flex-col gap-7">
                {profile.known.length > 0 && (
                  <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 sm:grid-cols-2">
                    {profile.known.map((k) => (
                      <div key={k.label} className="min-w-0">
                        <dt className="text-caption text-muted">{k.label}</dt>
                        <dd className="mt-0.5 text-[15px]">{k.value}</dd>
                        <dd className="text-caption text-muted">{k.source}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {(profile.work.length > 0 || profile.education.length > 0) && (
                  <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-2">
                    {profile.work.length > 0 && (
                      <Group title="Work">
                        <List inset>
                          {profile.work.map((w, i) => (
                            <Row key={i} className="flex-col items-start gap-0.5 px-4 py-3">
                              <p className="text-label">{[w.role, w.company].filter(Boolean).join(" at ")}</p>
                              {w.when && <p className="text-caption text-muted">{w.when}</p>}
                            </Row>
                          ))}
                        </List>
                      </Group>
                    )}
                    {profile.education.length > 0 && (
                      <Group title="Studied">
                        <List inset>
                          {profile.education.map((e, i) => (
                            <Row key={i} className="flex-col items-start gap-0.5 px-4 py-3">
                              <p className="text-label">{e.school}</p>
                              <p className="text-caption text-muted">
                                {[e.degree, e.when].filter(Boolean).join(" · ")}
                              </p>
                            </Row>
                          ))}
                        </List>
                      </Group>
                    )}
                  </div>
                )}
                {profile.facts.length > 0 && (
                  <Group title="Read from everything public">
                    <List inset>
                      {profile.facts.map((f, i) => (
                        <Row key={i} className="flex-col items-start gap-0.5 px-4 py-3">
                          <p className="text-label">{f.text}</p>
                          <p className="text-caption text-muted">
                            {f.platform} · {SURE[f.confidence]}
                          </p>
                        </Row>
                      ))}
                    </List>
                  </Group>
                )}
              </div>
            </Section>
          )}
          {hasStory && (
            <Section
              title="Their story"
              note="As their public record tells it"
              className={hasWho ? undefined : "lg:col-span-3"}
            >
              <ol className="flex flex-col gap-4 border-l border-border pl-4">
                {profile.timeline.map((t, i) => (
                  <li key={i} className="min-w-0">
                    <p className="text-caption text-muted tabular-nums">{t.date}</p>
                    <p className="mt-0.5 text-label">{t.event}</p>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </Reveal>
      )}

      {(website || hasTools) && (
        <Reveal className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:mt-4 lg:grid-cols-3 lg:gap-4">
          {website && (
            <Section
              title="Their website"
              note={
                <a
                  href={website.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline decoration-underline underline-offset-4 transition-colors duration-150 hover:text-foreground"
                >
                  {website.host} ↗
                </a>
              }
              className={hasTools ? "lg:col-span-2" : "lg:col-span-3"}
            >
              <div className="flex flex-col gap-7">
                {website.description && (
                  <p className="max-w-[62ch] text-[15px] leading-relaxed">{website.description}</p>
                )}
                {website.projects.length > 0 && (
                  <Group title="What they made">
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                      {website.projects.map((p) => (
                        <a
                          key={p.name}
                          href={p.url ?? website.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex min-w-0 flex-col gap-1 rounded-field border border-border bg-well p-4 transition-colors duration-150 hover:border-foreground/30"
                        >
                          <span className="text-label font-medium">{p.name}</span>
                          {p.description && <span className="text-caption text-muted">{p.description}</span>}
                        </a>
                      ))}
                    </div>
                  </Group>
                )}
                <Group title={`Pages read · ${website.pages.length}`}>
                  <List inset>
                    {website.pages.map((p) => (
                      <Row key={p.url} className="flex-col items-start gap-0.5 px-4 py-3">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="max-w-full truncate text-label hover:underline"
                        >
                          {p.title}
                        </a>
                        {p.excerpt && <p className="line-clamp-2 text-caption text-muted">{p.excerpt}</p>}
                      </Row>
                    ))}
                  </List>
                </Group>
              </div>
            </Section>
          )}
          {hasTools && (
            <Section title="What they work with" className={website ? undefined : "lg:col-span-3"}>
              <div className="flex flex-col gap-6">
                {skills.length > 0 && (
                  <Group title="Skills they list">
                    <div className="flex flex-wrap gap-2">
                      {skills.map((s) => (
                        <Badge key={s} size="md">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </Group>
                )}
                {languages.length > 0 && (
                  <Group title="Languages in their code">
                    <div className="flex flex-col gap-3.5">
                      {languages.map((l) => (
                        <div key={l.label}>
                          <div className="mb-1.5 flex items-baseline justify-between gap-3">
                            <p className="text-label">{l.label}</p>
                            <p className="text-caption text-muted tabular-nums">{l.count}</p>
                          </div>
                          <Bar value={l.count} max={languages[0].count} />
                        </div>
                      ))}
                    </div>
                  </Group>
                )}
              </div>
            </Section>
          )}
        </Reveal>
      )}

      {web && (
        <Reveal className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:mt-4 lg:grid-cols-3 lg:gap-4">
          {web.mentions.length > 0 && (
            <Section
              title="On the web"
              note={`${web.mentions.length} pages that name them`}
              className={web.facts.length ? "lg:col-span-2" : "lg:col-span-3"}
            >
              <List inset>
                {web.mentions.map((m) => (
                  <Row key={m.url} className="flex-col items-start gap-1 px-4 py-3.5">
                    <p className="text-caption text-muted">{[m.source, day(m.date)].filter(Boolean).join(" · ")}</p>
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="max-w-full text-label font-medium hover:underline"
                    >
                      {m.title}
                    </a>
                    {m.summary && <p className="text-caption text-muted">{m.summary}</p>}
                  </Row>
                ))}
              </List>
            </Section>
          )}
          {web.facts.length > 0 && (
            <Section
              title="What the web says"
              note="Each with its source"
              className={web.mentions.length ? undefined : "lg:col-span-3"}
            >
              <ul className="flex flex-col gap-4">
                {web.facts.map((f, i) => (
                  <li key={i} className="min-w-0">
                    <p className="text-label">{f.text}</p>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-caption text-muted underline decoration-underline underline-offset-4 hover:text-foreground"
                    >
                      {f.source}
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </Reveal>
      )}

      {code && code.repos.length > 0 && (
        <Reveal className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:mt-4 lg:gap-4">
          <Section
            title="What they build"
            note={code.actions ? `${code.actions} public actions on GitHub lately` : "On GitHub"}
          >
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {code.repos.map((r) => (
                <a
                  key={r.name}
                  href={r.url ?? undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex min-w-0 flex-col justify-between gap-4 rounded-field border border-border bg-well p-4 transition-colors duration-150 hover:border-foreground/30"
                >
                  <div className="min-w-0">
                    <p className="truncate text-label font-medium">{r.name}</p>
                    {r.description && <p className="mt-1 line-clamp-3 text-caption text-muted">{r.description}</p>}
                  </div>
                  <p className="text-caption text-muted tabular-nums">
                    {[
                      r.language,
                      r.stars ? `${r.stars} stars` : null,
                      r.lastWorked ? `Worked on ${month(r.lastWorked)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </a>
              ))}
            </div>
          </Section>
        </Reveal>
      )}
    </>
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

/**
 * Their face, in monochrome like the rest of the file. Without a public photo, their initials in a circle
 * where the photo would be.
 */
function Portrait({ name, photo }: { name: string; photo: string | null }) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="relative size-24 overflow-hidden rounded-full border border-border bg-well sm:size-28">
      {photo && !broken ? (
        // A plain img: the source is our own route, and it is one small image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt={`${name}, public profile picture`}
          onError={() => setBroken(true)}
          className="size-full object-cover grayscale contrast-[1.05]"
        />
      ) : (
        <span aria-hidden="true" className="grid size-full place-items-center text-heading text-muted">
          {initials}
        </span>
      )}
    </div>
  );
}

/** What their photo gives away, beside the photo. */
function PhotoReading({
  reading,
  photo,
  name,
}: {
  reading: Dossier["photoReading"];
  photo: string | null;
  name: string;
}) {
  if (!reading?.length) return null;
  return (
    <Reveal className="mt-3 lg:mt-4">
      <Section title="What the photo gives away" note="Read from one public picture">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-[160px_minmax(0,1fr)]">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={`${name}, the photo being read`}
              className="aspect-[3/4] w-full max-w-[160px] rounded-field object-cover grayscale contrast-[1.05]"
            />
          )}
          <List inset>
            {reading.map((r) => (
              <Row key={r.label} className="items-baseline justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-caption text-muted">{r.label}</p>
                  <p className="text-label">{r.value}</p>
                </div>
                <span className="text-label text-signal tabular-nums">{r.relevance}</span>
              </Row>
            ))}
          </List>
        </div>
      </Section>
    </Reveal>
  );
}

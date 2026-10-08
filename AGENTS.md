# Shaar: instructions for agents

The product is called **Shaar** (tagline: Beware the Spectator; the repo is still `projstalker`). It is a social media deep research app: it scrapes a person's public profiles (Apify), builds a
persona of them (OpenAI), and lets users hold a simulated voice interview with it (ElevenLabs).
This repo is the **backend** (Next.js API routes on Netlify, data in Supabase).

**Before working on or calling the backend, read [`be.md`](be.md).** It explains the request lifecycle,
every API route and its response shape, the data model, and rules you must keep. In particular:
nothing may block a request for long (Netlify's 60 s limit), state transitions must stay idempotent,
and every query made with the secret key must be scoped to the user.

## UI: the Fragms design language

Every screen in Projstalker, here and in the frontend, uses **Fragms Personal**, Šimon's design system.
This repo carries a copy of it. The `/docs` page is the reference for how it should look.

| What | Where |
| --- | --- |
| The kit (Button, Panel, Card, Badge, CodeBlock, Table, Dialog, Drawer, Menu, Tabs, Toast and ~60 more) | `src/components/ui`, import from `@/components/ui` |
| Fragms AI pieces | `src/components/fragms` |
| Page pieces (PageHeader, Section, List, Row, FormField, Empty, Stat) | `src/components/bits.tsx` |
| Tokens for light and dark, type scale, motion | `src/app/globals.css` |
| The theme (null keeps the Fragms defaults) | `theme` in `src/app.config.ts` |
| Theme, accent and toasts wiring | `src/components/providers.tsx`, used in `src/app/layout.tsx` |

Rules:

- Build only with the kit, `bits.tsx` and the Fragms pieces. No other component library, no one-off CSS
  files, no CSS modules. Style with Tailwind using the kit's tokens.
- Tokens, not colours: `bg-background`, `bg-card`, `bg-well`, `bg-control`, `border-border`, `text-muted`,
  `rounded-panel`, `rounded-field`, `rounded-item`, `text-label`, `text-caption`, `text-heading`,
  `text-title`. Surfaces nest card, then well, then control. Use danger and success only for state.
  Main actions use `bg-primary` with `text-primary-ink`. `bg-accent` or `text-accent` marks the brand.
- Change the look in `theme` in `src/app.config.ts` (made with the Themes tool on the Fragms Personal
  site), never by hard coding colours.
- Motion opens in 250ms and closes in 150ms on `cubic-bezier(0.22, 1, 0.36, 1)` (`ease-smooth`).
  Respect reduced motion.
- Everything must work at 375px wide. Check phone width for every screen you touch.
- Copy is short and plain. No em dashes, no colons or dashes in sentences, no buzzwords.
- No monospace type in the product UI. Small labels use the sans in spaced uppercase. Mono is only for code samples, like on `/docs`.
- Treat `src/components/ui` and `src/components/fragms` as a vendored copy of Fragms Personal. Don't
  reshape a kit component for one screen; compose it, or wrap it in your own component. If the kit itself
  needs a fix, make it, and say so in the commit so it can go back upstream.

Which Fragms pieces fit Projstalker:

| Screen | Use |
| --- | --- |
| Live voice interview | `Aura` with `useMic` and `useSpeech` for the speaking orb |
| Research chat (`POST /api/ai/chat`) | `Composer` |
| Evidence behind persona facts (scraped posts) | `Sources`, `Cite` |
| How sure a persona fact is | `Confidence` takes a `value` from 0 to 1. Map the persona's high, medium, low to 0.9, 0.6, 0.3 |
| Job progress (scraping, analyzing, ready) | `Trail` or `Plan` |
| Empty states | `Empty` from `bits.tsx`, with a Point |

**Setting up the frontend app** with the same look: copy `src/components/ui`, `src/components/fragms`,
`src/components/character.tsx`, `src/components/bits.tsx`, `src/components/providers.tsx`,
`src/app.config.ts`, `src/app/globals.css` and `postcss.config.mjs` from this repo. Then mirror
`src/app/layout.tsx` (Geist fonts, `themeCss(theme)`, `<Providers>`), and install `framer-motion`,
`@hugeicons/react`, `@hugeicons/core-free-icons`, `next-themes`, `tailwindcss@4` and
`@tailwindcss/postcss`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

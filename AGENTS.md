# Projstalker: instructions for agents

Projstalker is a social media deep research app: it scrapes a person's public profiles (Apify), builds a
persona of them (OpenAI), and lets users hold a simulated voice interview with it (ElevenLabs).
This repo is the **backend** (Next.js API routes on Netlify, data in Supabase).

**Before working on or calling the backend, read [`be.md`](be.md).** It explains the request lifecycle,
every API route and its response shape, the data model, and rules you must keep. In particular:
nothing may block a request for long (Netlify's 60 s limit), state transitions must stay idempotent,
and every query made with the secret key must be scoped to the user.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

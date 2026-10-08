# Apify Integration Guide

Context: this project is a **social media deep-research app**. Given a person's name, we use **Apify** to scrape public social media data (profiles, posts, etc.), then analyze it.

**Input schemas change often. Verify on the Actor's page before depending on specifics** (several Actor pages had internally inconsistent numbers; flagged below).

---

## 1. Core concepts

| Concept | What it is |
|---|---|
| **Actor** | A serverless program on Apify that does a job (e.g. "Instagram Profile Scraper"). Identified by ID or `username/actor-name` (in REST URLs use `username~actor-name`). |
| **Run** | One execution of an Actor with an input. Has a `status`, and default storages. |
| **Dataset** | Append-only table of JSON items. This is where scraped results land (`run.defaultDatasetId`). |
| **Key-value store** | Blob/record storage (screenshots, `OUTPUT`, downloaded media). `run.defaultKeyValueStoreId`. |
| **Task** | Saved Actor + saved input config. |
| **Schedule / Webhook** | Trigger runs on a cron / get an HTTP POST when run events occur. |
| **Apify Store** | Marketplace of public Actors (ours will mostly come from here, written by third parties). |
| **MCP server** | `https://mcp.apify.com`. Lets LLM agents discover and run Actors as tools. |

Typical flow: **start run with input → wait for SUCCEEDED → read dataset items**.

Run statuses: `READY`, `RUNNING`, `SUCCEEDED`, `FAILED`, `TIMING-OUT`, `TIMED-OUT`, `ABORTING`, `ABORTED`.

---

## 2. Authentication

- Get a token: Apify Console → Settings → API & Integrations.
- **Preferred**: `Authorization: Bearer <APIFY_TOKEN>` header.
- Alternative (less safe, ends up in logs): `?token=<APIFY_TOKEN>`.
- Store as env var `APIFY_TOKEN`. **Never** put it in client-side/browser code, commit it, or log it. All Apify calls must go through our backend.
- Prefer a **scoped token** (limited to the resources/permissions needed) over an unscoped one, and give it an expiry for third-party/temporary use.
- Token rotation: old token stays valid ~24h after rotation.

---

## 3. REST API v2

Base URL: `https://api.apify.com/v2` (`/v2/acts/` is a deprecated alias of `/v2/actors/`).

### 3.1 Start a run (async, recommended)

```
POST /v2/actors/{actorId}/runs
```
- `actorId` = Actor ID or `username~actor-name` (e.g. `apify~instagram-profile-scraper`).
- Body = the Actor's input JSON (`Content-Type: application/json`). The shape is defined by each Actor's input schema.
- Returns **201** with `{ "data": { id, status, defaultDatasetId, defaultKeyValueStoreId, usageTotalUsd, ... } }`.

Query parameters (all optional):

| Param | Meaning |
|---|---|
| `timeout` | Run timeout in seconds (default: Actor's setting) |
| `memory` | MB, power of 2, min 128 |
| `maxItems` | Cap on items **charged** for pay-per-result Actors (does not limit output of other models) |
| `maxTotalChargeUsd` | **Hard spend cap for the run**, any pricing model. Use this on every run. |
| `restartOnError` | Restart on failure |
| `build` | Build tag/number (default `latest`) |
| `waitForFinish` | Server-side wait, 0–60 s |
| `webhooks` | Base64-encoded JSON array of ad-hoc webhooks (see §6) |

### 3.2 Poll a run

```
GET /v2/actor-runs/{runId}?waitForFinish=60
```
`waitForFinish` (max 60) makes it long-poll: cheaper than tight polling. Loop until status is terminal (`SUCCEEDED`, `FAILED`, `TIMED-OUT`, `ABORTED`).

### 3.3 Read results

```
GET /v2/datasets/{datasetId}/items
```
Params: `format` (`json` default, `jsonl`, `csv`, `xlsx`, `xml`, `html`, `rss`), `limit`, `offset`, `desc`, `clean`, `fields`, `omit`, `flatten`, `unwind`, `skipEmpty`, `skipHidden`.
Pagination info comes in response headers: `X-Apify-Pagination-{Offset,Limit,Count,Total,Desc}`.
Tip: use `omit`/`fields` to drop heavy fields (e.g. Instagram `relatedProfiles`, `latestPosts`) when you don't need them.

### 3.4 Synchronous shortcut

```
POST /v2/actors/{actorId}/run-sync-get-dataset-items
```
Same query params as 3.1 plus dataset formatting params. Runs the Actor and returns dataset items in one HTTP response (status **201**).
- **Hard 300 s cap**: returns **408** if the run takes longer. Also, if the connection drops you lose all info about the run. Fine for quick single-profile lookups; use async (3.1–3.3) for anything bigger or slower.
- Variant `run-sync` exists that returns the key-value store `OUTPUT` record instead (not verified in detail).

### 3.5 Other useful endpoints

| Endpoint | Use |
|---|---|
| `POST /v2/actor-runs/{runId}/abort` | Stop a run (documented in Apify API reference; not fetched during this research) |
| `GET /v2/store?search=...&sortBy=popularity&limit=...` | Search the Apify Store programmatically. Params: `search`, `sortBy` (`relevance`/`popularity`/`newest`/`lastUpdate`), `category`, `pricingModel` (`FREE`/`FLAT_PRICE_PER_MONTH`/`PRICE_PER_DATASET_ITEM`/`PAY_PER_EVENT`), `username`, `limit` (max 1000), `offset`, `responseFormat=agent` (compact) |
| `GET /v2/key-value-stores/{id}/records/{key}` | Read a KV record (e.g. downloaded media) |

### 3.6 Errors, rate limits, retries

- Error body: `{"error": {"type": "...", "message": "..."}}`. Common: `401 token-not-provided`, `402` (usage limit / insufficient credit), `404 record-not-found`, `429 rate-limit-exceeded`.
- Rate limits: 250,000 req/min global per user; default **60 req/s per resource**; 400 req/s for run-Actor/run-task/push-dataset-items; 200 req/s for KV store records.
- On **429**: retry with exponential backoff (start 500 ms, randomize, double each retry). **The official clients do this automatically**; prefer them over raw HTTP.
- Platform limits (Free plan): 16 GB total memory across running jobs, 25 concurrent runs (Starter 32, Scale 128, Business 256), 500 Actors/5000 tasks/100 schedules/100 webhooks.

---

## 4. Official client libraries (preferred)

They include retries/backoff and typed responses.

### JavaScript / TypeScript (`apify-client`, Node 16+)

```bash
npm i apify-client
```
```ts
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

// call() starts the Actor AND waits for it to finish
const run = await client.actor('apify/instagram-profile-scraper').call(
  { usernames: ['natgeo'] },
  { maxTotalChargeUsd: 0.5, timeout: 120 } // run options (verify option names against the client typings)
);

const { items } = await client.dataset(run.defaultDatasetId).listItems();
```
Use `.start(input)` instead of `.call()` for fire-and-forget; then `client.run(runId).waitForFinish()`.

### Python (`apify-client`, Python 3.11+)

```bash
pip install apify-client
```
```python
import os
from apify_client import ApifyClient          # or ApifyClientAsync (await every call)

client = ApifyClient(os.environ["APIFY_TOKEN"])
run = client.actor("apify/instagram-profile-scraper").call(run_input={"usernames": ["natgeo"]})
if run is None:
    raise RuntimeError("Actor run failed")
items = client.dataset(run.default_dataset_id).list_items()   # returns object with .items
```
Note the Python client uses snake_case attributes (`default_dataset_id`); JS uses camelCase.

### Raw HTTP example (curl)

```bash
curl -X POST "https://api.apify.com/v2/actors/apify~instagram-profile-scraper/run-sync-get-dataset-items?maxTotalChargeUsd=0.5" \
  -H "Authorization: Bearer $APIFY_TOKEN" -H "Content-Type: application/json" \
  -d '{"usernames":["natgeo"]}'
```

---

## 5. Actors relevant to our use case

Input is **a person's name**, but most platform scrapers take a **username / URL**, not a name. So the pipeline needs a discovery step first:

```
name ──► [DISCOVERY] ──► candidate profile URLs/handles per platform
                              │  (verify/disambiguate: bio, location, photo, mutuals, user confirmation)
                              ▼
                      [PER-PLATFORM SCRAPERS] ──► datasets ──► normalize ──► analysis/LLM
```

### 5.1 Discovery (name → profiles)

| Actor | Notes |
|---|---|
| `apify/google-search-scraper` | Query like `"Jane Doe" site:instagram.com` (the Actor has `queries`, `site`, `countryCode`, `maxPagesPerQuery`; output `organicResults[]` with `title/url/description`). ~$1.80/1k result pages. Most flexible/reliable discovery route. |
| Social Links Search (`burbn/social-links-search`) | Search by name/keyword across Facebook, Instagram, X, LinkedIn, GitHub, TikTok, YouTube, Pinterest, Snapchat. Relevance-ranked. |
| Social Media Finder (`tri_angle/social-media-finder`) | Names/nicknames across ~13 platforms; pay-per-result. |
| Username OSINT: Sherlock / Maigret (`netmilk/sherlock`, `apivault_labs/maigret-username-osint`, etc.) | Given a **handle**, checks hundreds+ of sites for existence. Good for expanding one confirmed handle to other platforms. |

Name searches return loose matches. **Always require a verification/disambiguation step** (compare bio, location, linked accounts, or ask the user to confirm) before attributing data to a person. Community Actors vary in quality: check ratings, last-updated, and run on a tiny test first.

### 5.2 Per-platform scrapers

| Platform | Actor | Key input | Notes |
|---|---|---|---|
| Instagram | `apify/instagram-profile-scraper` | `usernames` (array; usernames, URLs, or IDs) | Public profiles only. Returns bio, follower/following/post counts, verified/business flags, `externalUrl`, `relatedProfiles`, `latestPosts` (latest ~12). Pay-per-event, ~$1.60–2.60 per 1k profiles (page contradicts itself; check). Output can be large. Separate Actors for posts/reels/comments. |
| TikTok | `clockworks/tiktok-profile-scraper` | `profiles` (usernames), `resultsPerPage`, `profileSorting`, date filters | Output is **per post**, with `authorMeta` (profile info) embedded. Error items carry `errorCode` (`PROFILE_PRIVATE`, `NOT_FOUND`, `PROFILE_EMPTY`). Price stated as both $1/1k and $5/1k; verify. "Popular" sort capped at ~400–500 videos. |
| Facebook | `apify/facebook-pages-scraper` | `startUrls: [{url}]` | Built for **Pages**, not personal profiles (docs conflict on profile support, so assume personal profiles don't work). Contact info, likes/followers, category. Price inconsistent ($5.40–12 per 1k). Separate Actors for posts/comments. |
| X / Twitter | `apidojo/twitter-user-scraper` | `twitterHandles`, `startUrls`, `searchTerms`, `getFollowers`, `getFollowing`, `maxItems` | Has a user keyword search (`searchTerms`) which can double as discovery. Minimum 5 input objects per run (pad with duplicates); free plan limited to 10 items/run. Protected accounts impossible. Pay-per-event (~$0.004/profile URL). A separate tweet scraper is needed for posts. |
| YouTube | `streamers/youtube-channel-scraper` | `startUrls` (channel URLs), `maxResults`, `maxResultsShorts`, `oldestPostDate` | ~$0.50 per 1k videos. Set limits to 0 to get channel info only. Needs residential proxies when run on platform (included in Starter plan per page). No likes/comments (separate Actors). |
| Reddit | `trudax/reddit-scraper-lite` | `searches`, `startUrls`, `searchPosts/Comments/Users…`, `sort`, `maxItems` | Can search by username/keyword. ~$3.40 per 1k results. Search/list results cap ~1000 items. |
| LinkedIn | no first-party/official Apify Actor was verified. Community Actors exist (e.g. "LinkedIn Profile Finder by Name & Company (No Cookies)" by `neuralverge`) | name + company | Highest legal/ToS risk and most fragile; treat as optional/best-effort and evaluate Actors individually. Avoid Actors that require your own LinkedIn cookies/account. |

> The slugs above came from Actor store pages at research time. Before hardcoding, call `GET /v2/store?search=...` or open the Actor page to confirm it still exists, its input schema, and price. The Actor's **Input** tab / `input schema` is the source of truth for field names.

### 5.3 Choosing and vetting an Actor (checklist)
1. Prefer Actors by `apify/` (official) or high-usage, recently updated, highly rated authors.
2. Check pricing model (§7) and compute worst-case cost for our input size.
3. Run a tiny test (1 item, `maxTotalChargeUsd` ~0.1) and inspect the output schema.
4. Pin by Actor name; consider pinning `build` for stability in production.
5. Handle Actor output that contains **error items** in the dataset (an Actor can `SUCCEED` yet include error rows).

---

## 6. Webhooks (for async pipelines)

Instead of polling, ask Apify to POST to our backend when a run finishes.

Events: `ACTOR.RUN.CREATED`, `ACTOR.RUN.SUCCEEDED`, `ACTOR.RUN.FAILED`, `ACTOR.RUN.ABORTED`, `ACTOR.RUN.TIMED_OUT`, `ACTOR.RUN.RESURRECTED` (plus `ACTOR.BUILD.*`).

**Ad-hoc webhook per run**: add `webhooks` query param to the run endpoint = base64 of a JSON array:
```json
[{
  "eventTypes": ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED"],
  "requestUrl": "https://our.app/api/apify/webhook",
  "payloadTemplate": "{\"resource\": {{resource}}}"
}]
```
`{{resource}}` is the run object (has `defaultDatasetId`). Other template variables exist but weren't verified in this research; check docs. Webhook endpoint must be publicly reachable (use a tunnel such as ngrok during local dev), should verify/ignore unexpected callers (e.g. embed a secret in the URL), and be idempotent. Fetch the dataset by `defaultDatasetId` from the payload. For a hackathon, `waitForFinish` long-polling is simpler.

---

## 7. Pricing and cost control

Apify pricing models for Store Actors:
- **Pay per event (PPE)**: you pay per defined event (result, profile, actor-start...). Most common now. Usually includes platform usage.
- **Pay per usage**: you pay only compute/storage/proxy. Hard to predict.
- **Rental**: monthly fee, being retired (fully retired Oct 1, 2026).

Cost control rules for all agents writing Apify code:
1. **Always set `maxTotalChargeUsd`** on runs; Actor stops gracefully at the cap and you aren't charged beyond it.
2. Always bound result counts (`maxItems`, `resultsPerPage`, `maxResults`, `limit` etc. as the Actor defines).
3. Develop against tiny inputs. The Free plan includes monthly credits (~$5 cited on Actor pages) which is enough for development/demos.
4. Don't re-scrape the same profile repeatedly: cache datasets/results in our own DB keyed by platform+handle with a timestamp.
5. Respect concurrency (X scraper recommends 1–2 concurrent runs). Fan out per platform, not per item.
6. `402` response = out of credit/usage limit. Surface it clearly in the app.

---

## 8. Apify MCP server (optional, for LLM-agent tool use)

- Hosted: `https://mcp.apify.com` (Streamable HTTP). Auth: OAuth, or `Authorization: Bearer <APIFY_TOKEN>`. Local stdio: `npx @apify/actors-mcp-server` with `APIFY_TOKEN` env.
- Default tools: `search-actors`, `fetch-actor-details`, `call-actor`, `apify/rag-web-browser`, `apify/web-fetch`, `search-apify-docs`, `fetch-apify-docs`, `report-problem`. Opt-in: run management, storage, tasks, schedules.
- `call-actor` returns run status and storage IDs, **not the output**. Use `get-dataset-items` to fetch results.
- Restrict to specific Actors with a `tools` URL param, e.g. `https://mcp.apify.com?tools=actors,docs` or `...?tools=apify/instagram-profile-scraper,clockworks/tiktok-profile-scraper`. For production list tools explicitly.
- Limit: 30 req/s per user.
- Useful for: letting a coding agent (like Claude Code) explore Actors while developing; or letting an in-app research agent pick Actors dynamically. For deterministic production flows, a plain REST/client call is more predictable.

---

## 9. Recommended architecture for this app

1. **Backend wrapper** `apifyService` with: `runActor(actorId, input, {maxTotalChargeUsd, timeout})` → `{runId}`; `waitForRun(runId)`; `getItems(datasetId, {limit, offset})`. Use `apify-client`.
2. **Platform adapters**: one per platform (`instagram`, `tiktok`, `x`, `youtube`, `reddit`, `facebook`, `linkedin?`) that (a) builds Actor input from a handle/URL, (b) normalizes the Actor's output to our own schema (the schemas differ and change; isolate this). Keep Actor IDs in config, not scattered in code.
3. **Pipeline**: discovery → candidate list → (user confirms/auto-score identity match) → parallel per-platform scrapes → store raw + normalized results → LLM synthesis.
4. **Resilience**: run timeouts, treat `FAILED/TIMED-OUT` per platform as partial results (don't fail the whole report), skip error items, retry only on transient errors.
5. **Progress UX**: runs take seconds to minutes; use async runs + status endpoint (or webhook) and stream per-platform progress to the UI.
6. Secrets in env (`APIFY_TOKEN`); no token in frontend.

---

## 10. Legal / ethical notes (important)

- Apify Actors only access **publicly available** data; private/protected accounts are not scrapeable and Actors don't claim to extract private data. Results may still contain **personal data** (GDPR/CCPA apply when researching individuals).
- Platform ToS (especially LinkedIn, Instagram, Facebook, X) restrict scraping; legality varies by jurisdiction. The user running the app is responsible for lawful purpose.
- Name-to-profile matching can attribute data to the **wrong person**. Show confidence and sources; never present unverified matches as fact.
- Consider: user-facing disclaimer, data retention limits, not scraping minors' profiles, no use for harassment/stalking.

---

## 11. Known uncertainties / TODO to verify
- Exact option names when passing run options in `apify-client` `.call()` (check TypeScript typings / client docs).
- Whether each recommended Actor is still maintained and its current price (pages had conflicting numbers for Instagram, TikTok and Facebook).
- Webhook payload template variables beyond `{{resource}}`.
- Best LinkedIn option, if we decide to support it at all.
- Abort-run and `run-sync` endpoints weren't fetched; confirm in the API reference.

## References
- API v2 overview: https://docs.apify.com/api/v2
- Run Actor: https://docs.apify.com/api/v2/act-runs-post
- Run sync + get dataset items: https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post
- Get run: https://docs.apify.com/api/v2/actor-run-get
- Dataset items: https://docs.apify.com/api/v2/dataset-items-get
- Store listing API: https://docs.apify.com/api/v2/store-get
- JS client: https://docs.apify.com/api/client/js/docs
- Python client: https://docs.apify.com/api/client/python/docs
- Webhooks: https://docs.apify.com/platform/integrations/webhooks (events, ad-hoc subpages)
- MCP server: https://docs.apify.com/platform/integrations/mcp
- Platform limits: https://docs.apify.com/platform/limits
- Store pricing models: https://docs.apify.com/platform/actors/running/actors-in-store
- Actor pages: apify.com/apify/instagram-profile-scraper, apify.com/clockworks/tiktok-profile-scraper, apify.com/apify/facebook-pages-scraper, apify.com/apidojo/twitter-user-scraper, apify.com/streamers/youtube-channel-scraper, apify.com/trudax/reddit-scraper-lite, apify.com/apify/google-search-scraper

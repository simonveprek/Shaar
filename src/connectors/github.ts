import { envVar } from "@/lib/env";
import type { Connector } from "./types";
import { date, handleFrom, item, linksFrom, metrics, profileId, str } from "./util";

/*
 * GitHub, read straight from its public API instead of through Apify: the profile and its README, the
 * repositories they made, and their public activity of the last 90 days. Activity has no words, only times,
 * and those times say when someone is awake and working. Four requests per person. Without GITHUB_TOKEN the
 * API allows 60 an hour from one address, which is plenty locally.
 */

const API = "https://api.github.com";

async function getJson(path: string): Promise<unknown> {
  const token = envVar("GITHUB_TOKEN");
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) throw new Error("No GitHub account with that name");
  if (res.status === 403 || res.status === 429) throw new Error("GitHub rate limit reached, set GITHUB_TOKEN to raise it");
  if (!res.ok) throw new Error(`GitHub ${path} failed (${res.status})`);
  return res.json();
}

/** Their profile README, from the repository named like the account. Most people have none. */
async function profileReadme(login: string): Promise<string | null> {
  const res = await fetch(`https://raw.githubusercontent.com/${login}/${login}/HEAD/README.md`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return res?.ok ? (await res.text()).slice(0, 4000) : null;
}

/** What a public event was, in a few plain words. */
function describe(type: string, repo: string, payload: Record<string, unknown>): string {
  const action = typeof payload.action === "string" ? payload.action : "";
  switch (type) {
    case "PushEvent":
      return `Pushed to ${repo}`;
    case "CreateEvent":
      return payload.ref_type === "repository" ? `Created ${repo}` : `Created a ${payload.ref_type ?? "branch"} in ${repo}`;
    case "WatchEvent":
      return `Starred ${repo}`;
    case "ForkEvent":
      return `Forked ${repo}`;
    case "IssuesEvent":
      return `${action || "Updated"} an issue in ${repo}`;
    case "IssueCommentEvent":
      return `Commented on an issue in ${repo}`;
    case "PullRequestEvent":
      return `${action || "Updated"} a pull request in ${repo}`;
    case "PullRequestReviewEvent":
    case "PullRequestReviewCommentEvent":
      return `Reviewed a pull request in ${repo}`;
    case "ReleaseEvent":
      return `Released ${repo}`;
    default:
      return `${type.replace(/Event$/, "")} in ${repo}`;
  }
}

export const github: Connector = {
  platform: "github",
  label: "GitHub",
  targetHint: "GitHub username or profile URL",
  notes: "Read from GitHub's public API. Set GITHUB_TOKEN for more than 60 requests an hour.",
  actors: [
    {
      actorId: "github/public-api",
      role: "profile",
      buildInput: (target) => ({ username: handleFrom(target) }),
      maxItems: () => 200,
      fetch: async (input) => {
        const login = String(input.username);
        const user = (await getJson(`/users/${encodeURIComponent(login)}`)) as Record<string, unknown>;
        const name = String(user.login);
        const [repos, events, readme] = await Promise.all([
          getJson(`/users/${name}/repos?type=owner&sort=pushed&per_page=30`).catch(() => []),
          getJson(`/users/${name}/events/public?per_page=100`).catch(() => []),
          profileReadme(name),
        ]);
        // `source` says which request an item came from. Not `type`: GitHub uses that field itself.
        return [
          { ...user, readme, source: "user" },
          ...(repos as Record<string, unknown>[]).map((r) => ({ ...r, source: "repo" })),
          ...(events as Record<string, unknown>[]).map((e) => ({ ...e, source: "event" })),
        ];
      },
      normalize: (raw) => {
        switch (raw.source) {
          case "user": {
            const login = str(raw, "login");
            const bio = str(raw, "bio");
            const twitter = str(raw, "twitter_username");
            return [
              item({
                kind: "profile",
                externalId: profileId(login),
                url: str(raw, "html_url"),
                author: login,
                text: [str(raw, "name"), bio, str(raw, "readme")].filter(Boolean).join("\n\n") || null,
                metrics: metrics(raw, { followers: ["followers"], following: ["following"], repos: ["public_repos"] }),
                media: str(raw, "avatar_url") ? [str(raw, "avatar_url")!] : [],
                links: [
                  ...linksFrom(raw, "blog"),
                  ...(twitter ? [`https://x.com/${twitter}`] : []),
                  ...[...(bio ?? "").matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]),
                ],
                details: {
                  name: str(raw, "name"),
                  company: str(raw, "company")?.replace(/^@/, "") ?? null,
                  location: str(raw, "location"),
                  since: date(raw, "created_at"),
                },
              }),
            ];
          }
          case "repo": {
            if (raw.fork) return [];
            const name = str(raw, "name");
            if (!name) return [];
            const description = str(raw, "description");
            const topics = Array.isArray(raw.topics) ? (raw.topics as string[]) : [];
            return [
              item({
                kind: "repo",
                externalId: `repo:${str(raw, "full_name") ?? name}`,
                url: str(raw, "html_url"),
                author: str(raw, "owner.login"),
                text: [name, description].filter(Boolean).join(": "),
                // When they last worked on it.
                postedAt: date(raw, "pushed_at", "updated_at"),
                metrics: metrics(raw, { stars: ["stargazers_count"], forks: ["forks_count"] }),
                links: linksFrom(raw, "homepage"),
                details: {
                  name,
                  description,
                  language: str(raw, "language"),
                  topics,
                  homepage: str(raw, "homepage"),
                  createdAt: date(raw, "created_at"),
                },
              }),
            ];
          }
          case "event": {
            const id = str(raw, "id");
            const repo = str(raw, "repo.name");
            if (!id || !repo) return [];
            return [
              item({
                kind: "activity",
                externalId: `event:${id}`,
                url: `https://github.com/${repo}`,
                author: str(raw, "actor.login"),
                text: describe(String(raw.type ?? ""), repo, (raw.payload ?? {}) as Record<string, unknown>),
                postedAt: date(raw, "created_at"),
              }),
            ];
          }
          default:
            return [];
        }
      },
    },
  ],
};

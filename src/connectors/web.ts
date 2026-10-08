import { pollWebSearch, startWebSearch } from "@/lib/web-search";
import type { Connector } from "./types";
import { date, item, str } from "./util";

/*
 * The open web, searched by ChatGPT (see src/lib/web-search.ts). Every job gets this source when OpenAI is set
 * up, with the confirmed profiles as context so namesakes stay out. It brings pages about the person (articles,
 * events, team pages) as mentions, facts those pages state, and accounts the person owns. Accounts it is sure of
 * are followed like links on their own site (see src/lib/follow.ts).
 */

export const web: Connector = {
  platform: "web",
  label: "The web",
  targetHint: "Their name",
  notes: "Searched with ChatGPT. Needs OPENAI_API_KEY.",
  actors: [
    {
      actorId: "openai/web-search",
      role: "profile",
      buildInput: (target, { context }) => ({ name: target, context: context ?? [] }),
      maxItems: () => 60,
      background: {
        start: (input) => startWebSearch(String(input.name), (input.context as string[]) ?? []),
        poll: async (id) => {
          const poll = await pollWebSearch(id);
          if (poll.state !== "done") return poll;
          const { accounts, mentions, facts } = poll.found;
          return {
            state: "done",
            // `entry` says what each item is. Not `source`: a mention has a field of that name.
            items: [
              { entry: "found", accounts, facts },
              ...mentions.map((m) => ({ ...m, entry: "mention" })),
            ],
          };
        },
      },
      normalize: (raw) => {
        if (raw.entry === "found") {
          const accounts = (raw.accounts ?? []) as { url: string; platform: string; why: string; confidence: string }[];
          const facts = (raw.facts ?? []) as { fact: string; url: string }[];
          return [
            item({
              kind: "profile",
              externalId: "web:found",
              text: facts.map((f) => f.fact).join("\n") || null,
              // Accounts it is sure of count as declared, like a site's own list of its owner's profiles.
              links: accounts.filter((a) => a.confidence !== "low").map((a) => a.url),
              details: {
                sameAs: accounts.filter((a) => a.confidence === "high").map((a) => a.url),
                accounts,
                facts,
              },
            }),
          ];
        }
        const url = str(raw, "url");
        if (raw.entry !== "mention" || !url) return [];
        return [
          item({
            kind: "mention",
            externalId: url,
            url,
            author: str(raw, "source"),
            text: [str(raw, "title"), str(raw, "summary")].filter(Boolean).join("\n\n"),
            postedAt: date(raw, "date"),
            details: { title: str(raw, "title"), source: str(raw, "source"), summary: str(raw, "summary") },
          }),
        ];
      },
    },
  ],
};

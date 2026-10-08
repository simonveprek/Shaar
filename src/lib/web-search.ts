import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { envVar } from "./env";
import { openai } from "./openai";

/*
 * Searching the open web with ChatGPT: an OpenAI model with the web_search tool, in background mode so no
 * request waits for it (a search takes about half a minute). Discovery uses it to find accounts a name search
 * on Google misses; a research job uses it as a source of its own, for pages about the person and what they state.
 */

export const WebFound = z.object({
  accounts: z.array(
    z.object({
      url: z.string().describe("The profile or site URL exactly as found."),
      platform: z.string(),
      why: z.string().describe("One short sentence on why this account is this person's."),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  mentions: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      source: z.string().describe("The site, like a newspaper, an event or a company."),
      date: z.string().nullable().describe("ISO date when the page gives one."),
      summary: z.string().describe("One or two sentences on what the page says about them."),
    }),
  ),
  facts: z.array(
    z.object({
      fact: z.string().describe("Something public about them, stated plainly."),
      url: z.string().describe("Where it is stated."),
    }),
  ),
});
export type WebFound = z.infer<typeof WebFound>;

const INSTRUCTIONS = `You research one specific person on the public web, the way an investigator building a file would.
Search widely and more than once: their name with and without diacritics, their known handles, their employer,
their city, their projects.

Find:
- accounts: every public account and site they own, on any network, including second accounts and alternate
  handles (like name.surname next to namesurname). Only accounts that are clearly this person.
- mentions: pages on other people's sites about them or naming them: articles, interviews, talks, events,
  hackathons, company pages, team pages, school pages, awards, podcasts, posts by others. Never their own
  profiles, their own website, their own repositories or their own posts.
- facts: things public pages state about them (role, employer, school, city, projects, events, achievements).

Rules:
- Only this exact person. Use the context to tell them apart from namesakes, and leave out anything doubtful.
- Never include private information: home address, phone, personal email, family members, health, finances.
- Give URLs exactly as found. Do not invent pages.`;

/** Starts a web search for the person. `context` is what is already known, like confirmed profile URLs. */
export async function startWebSearch(name: string, context: string[] = [], focus = ""): Promise<string> {
  const response = await openai().responses.create({
    model: envVar("OPENAI_SEARCH_MODEL") || envVar("OPENAI_CHAT_MODEL"),
    background: true,
    store: true,
    tools: [{ type: "web_search" }],
    instructions: INSTRUCTIONS,
    input: [`Person: ${name}`, context.length ? `Known about them:\n${context.join("\n")}` : "", focus].filter(Boolean).join("\n\n"),
    text: { format: zodTextFormat(WebFound, "web_found") },
  });
  return response.id;
}

export type WebPoll = { state: "pending" } | { state: "done"; found: WebFound } | { state: "failed"; error: string };

export async function pollWebSearch(id: string): Promise<WebPoll> {
  const response = await openai().responses.retrieve(id);
  if (response.status === "queued" || response.status === "in_progress") return { state: "pending" };
  if (response.status !== "completed") {
    return { state: "failed", error: response.error?.message ?? `Web search ${response.status}` };
  }
  let parsed;
  try {
    parsed = WebFound.safeParse(JSON.parse(response.output_text));
  } catch {
    return { state: "failed", error: "Web search returned something that is not JSON" };
  }
  if (!parsed.success) return { state: "failed", error: "Web search returned results in the wrong shape" };
  // Only real web links survive. The model is told not to invent pages; this keeps out the ones it does.
  const web = (url: string) => /^https?:\/\/[^\s]+\.[^\s]+/.test(url);
  return {
    state: "done",
    found: {
      accounts: parsed.data.accounts.filter((a) => web(a.url)),
      mentions: parsed.data.mentions.filter((m) => web(m.url)),
      facts: parsed.data.facts.filter((f) => web(f.url)),
    },
  };
}

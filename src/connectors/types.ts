/**
 * profile: an account's bio. post and comment: things they wrote. page: a page of their own website.
 * repo: a code repository they made. activity: a public action with a time and no words of theirs, like a push.
 * mention: a page elsewhere on the web about them, like an article or an event they spoke at.
 */
export type ItemKind = "profile" | "post" | "comment" | "page" | "repo" | "activity" | "mention";

/** Platform-independent shape stored in `scraped_items`; the raw Apify item is kept alongside it. */
export type NormalizedItem = {
  kind: ItemKind;
  externalId: string;
  url: string | null;
  author: string | null;
  text: string | null;
  postedAt: string | null;
  metrics: Record<string, number>;
  media: string[];
  /** Links the person published, like the website in their bio. Profiles only. */
  links?: string[];
  /** Structured facts the source states outright, like a job title or a private account. Shown in the file. */
  details?: Record<string, unknown>;
};

export type ConnectorOptions = {
  /** Upper bound on posts to fetch for this target. */
  maxPosts: number;
  /** What is already known about the person, like their confirmed profiles, to tell them from namesakes. */
  context?: string[];
};

/** Where a background source is. Items are raw, like an Apify dataset's. */
export type BackgroundPoll =
  | { state: "pending" }
  | { state: "done"; items: Record<string, unknown>[] }
  | { state: "failed"; error: string };

/** One Apify Actor a connector runs. Each becomes its own row in `connector_runs`. */
export type ActorSpec = {
  /** Apify Actor in `username/name` form. */
  actorId: string;
  /** What this actor contributes. */
  role: "profile" | "posts";
  /** Turns a user-entered handle or URL into the actor's input. */
  buildInput(target: string, opts: ConnectorOptions): Record<string, unknown>;
  /** Maps one raw dataset item to zero or more normalized items. */
  normalize(raw: Record<string, unknown>): NormalizedItem[];
  /** Max dataset items to ingest from one run. */
  maxItems(opts: ConnectorOptions): number;
  /** Memory for the Apify run in MB, when the actor's default is far more than it needs. */
  memoryMbytes?: number;
  /**
   * Fetches the raw items itself instead of running an Apify actor, for sources with a free public API.
   * It must finish in a few seconds: it runs inside the request that starts it.
   */
  fetch?(input: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  /**
   * Runs as a long background job somewhere other than Apify, like an OpenAI web search. `start` returns its
   * id, stored as the run's apify_run_id, and `poll` is called on every advance until it is done.
   */
  background?: { start(input: Record<string, unknown>): Promise<string>; poll(id: string): Promise<BackgroundPoll> };
};

export type Connector = {
  platform: string;
  label: string;
  /** Shown in the frontend form, e.g. "Instagram username or profile URL". */
  targetHint: string;
  /** Caveats worth surfacing in the UI (plan requirements, profile types that don't work). */
  notes?: string;
  actors: ActorSpec[];
};

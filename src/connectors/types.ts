export type ItemKind = "profile" | "post" | "comment" | "page";

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
};

export type ConnectorOptions = {
  /** Upper bound on posts to fetch for this target. */
  maxPosts: number;
};

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

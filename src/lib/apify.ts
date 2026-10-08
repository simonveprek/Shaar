import { ApifyClient } from "apify-client";
import { env } from "./env";

let client: ApifyClient | undefined;

export function apify(): ApifyClient {
  client ??= new ApifyClient({ token: env().APIFY_TOKEN });
  return client;
}

export const TERMINAL_RUN_STATUSES = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"] as const;

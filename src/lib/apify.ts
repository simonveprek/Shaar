import { ApifyClient } from "apify-client";
import { need } from "./env";

let client: ApifyClient | undefined;

export function apify(): ApifyClient {
  client ??= new ApifyClient({ token: need("APIFY_TOKEN", "Apify") });
  return client;
}

export const TERMINAL_RUN_STATUSES = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"] as const;

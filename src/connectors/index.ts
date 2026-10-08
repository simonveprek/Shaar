import { HttpError } from "@/lib/http";
import type { ActorSpec, Connector } from "./types";
import { instagram } from "./instagram";
import { tiktok } from "./tiktok";
import { x } from "./x";
import { linkedin } from "./linkedin";
import { youtube } from "./youtube";
import { facebook } from "./facebook";
import { reddit } from "./reddit";
import { threads } from "./threads";
import { pinterest } from "./pinterest";
import { website } from "./website";

const connectors: Connector[] = [instagram, tiktok, x, linkedin, youtube, facebook, reddit, threads, pinterest, website];

const byPlatform = new Map(connectors.map((c) => [c.platform, c]));

export function getConnector(platform: string): Connector {
  const connector = byPlatform.get(platform);
  if (!connector) {
    throw new HttpError(400, `Unknown platform "${platform}"`, { available: [...byPlatform.keys()] });
  }
  return connector;
}

/** The actor spec that produced a run, used to normalize its dataset. */
export function getActor(platform: string, actorId: string): ActorSpec {
  const actor = getConnector(platform).actors.find((a) => a.actorId === actorId);
  if (!actor) throw new Error(`Actor ${actorId} is no longer part of the ${platform} connector`);
  return actor;
}

export function describeConnector(c: Connector) {
  return {
    platform: c.platform,
    label: c.label,
    targetHint: c.targetHint,
    notes: c.notes ?? null,
    actors: c.actors.map((a) => ({ actorId: a.actorId, role: a.role })),
  };
}

export function listConnectors() {
  return connectors.map(describeConnector);
}

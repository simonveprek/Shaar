import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { agentSystemPrompt, buildDigest, PersonaProfile } from "../src/lib/persona";

const mara = PersonaProfile.parse(JSON.parse(readFileSync("fixtures/personas/mara-vell.json", "utf8")).profile);

describe("the voice agent's prompt", () => {
  it("has the persona speak as the person, in the first person, and admit it is a simulation", () => {
    const prompt = agentSystemPrompt(mara);
    assert.match(prompt, /^# You are Mara Vell/);
    assert.match(prompt, /in the first person/);
    assert.match(prompt, /AI simulation of Mara Vell/);
    assert.match(prompt, /Never claim to be the real person/);
  });
});

describe("the digest the persona is read from", () => {
  it("puts every kind of source in its own section", () => {
    const digest = buildDigest("Jane Doe", null, [
      { platform: "instagram", kind: "profile", author: "jane", text: "hi", posted_at: null, url: null, metrics: {}, details: { private: true } },
      { platform: "website", kind: "page", author: "Jane", text: "Type designer in Brno", posted_at: null, url: "https://j.design/", metrics: {} },
      { platform: "github", kind: "repo", author: "jane", text: "grotesk: A sans", posted_at: "2026-10-01T00:00:00Z", url: null, metrics: { stars: 2 }, details: { language: "Python" } },
      { platform: "github", kind: "activity", author: "jane", text: "Pushed to jane/grotesk", posted_at: "2026-10-02T00:00:00Z", url: null, metrics: {} },
      { platform: "web", kind: "mention", author: "Event", text: "Talk", posted_at: null, url: "https://event.example", metrics: {} },
      { platform: "x", kind: "post", author: "jane", text: "Kerning is a moral issue", posted_at: "2026-10-03T00:00:00Z", url: null, metrics: {} },
    ]);
    for (const heading of ["## Profiles", "## Their own website", "## Found on the open web", "## Code they published", "## Public activity", "## Posts"]) {
      assert.ok(digest.includes(heading), heading);
    }
    assert.match(digest, /Stated: \{"private":true\}/);
    assert.match(digest, /Kerning is a moral issue/);
  });
});

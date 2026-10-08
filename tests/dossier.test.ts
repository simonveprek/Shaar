import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDossier, type DossierItem } from "../src/lib/dossier";
import { sampleDossierInput } from "../src/lib/dossier-sample";
import { simonDossierInput } from "../src/lib/dossier-simon";

const NOW = new Date("2026-10-09T00:00:00Z");
const item = (fields: Partial<DossierItem> & Pick<DossierItem, "platform" | "kind">): DossierItem => ({
  author: null, text: null, posted_at: null, url: null, metrics: {}, ...fields,
});

describe("buildDossier", () => {
  it("builds the fictional sample file", () => {
    const d = buildDossier(sampleDossierInput());
    assert.equal(d.subject.name, "Mara Vell");
    assert.ok(d.totals.posts > 100);
    assert.ok(["S", "A", "B", "C", "D", "F"].includes(d.assessment.grade));
    assert.ok(d.assessment.score >= 0 && d.assessment.score <= 100);
    assert.equal(d.web?.mentions.length, 4);
    // Two Instagram accounts are two rows.
    assert.equal(d.presence.filter((p) => p.platform === "instagram").length, 2);
  });

  it("builds Šimon's demo file from its snapshot", () => {
    const d = buildDossier(simonDossierInput());
    assert.equal(d.subject.name, "Šimon Vepřek");
    assert.ok(d.profile.known.some((k) => k.label === "Works at" && k.value === "Etnetera Core"));
    assert.ok(d.code && d.code.repos.length > 0);
    assert.ok(d.photoReading && d.photoReading.length > 0);
    assert.equal(d.presence.find((p) => p.handle === "simon.veprek")?.via, "a handle lookup");
  });

  it("states facts from their own sources before what the persona read", () => {
    const d = buildDossier({
      jobId: "t", subjectName: "Jane Doe", persona: null, now: NOW,
      items: [
        item({ platform: "website", kind: "page", url: "https://janedoe.design/", details: { jobTitle: "Type designer", location: "Brno" } }),
        item({ platform: "github", kind: "profile", author: "janedoe", details: { company: "Studio Nord", location: "Prague" } }),
      ],
    });
    assert.deepEqual(d.profile.known.map((k) => [k.label, k.value, k.source]), [
      ["Works as", "Type designer", "Their website"],
      ["Works at", "Studio Nord", "GitHub"],
      ["Lives in", "Brno", "Their website"],
    ]);
  });

  it("does not count their own pages as mentions", () => {
    const d = buildDossier({
      jobId: "t", subjectName: "Jane Doe", persona: null, now: NOW,
      items: [
        item({ platform: "github", kind: "profile", author: "janedoe" }),
        item({ platform: "website", kind: "page", url: "https://janedoe.design/" }),
        item({ platform: "web", kind: "mention", url: "https://github.com/janedoe/grotesk", details: { title: "repo" } }),
        item({ platform: "web", kind: "mention", url: "https://janedoe.design/about", details: { title: "own site" } }),
        item({ platform: "web", kind: "mention", url: "https://news.example/janedoe-wins", details: { title: "She won" } }),
      ],
    });
    assert.deepEqual(d.web?.mentions.map((m) => m.title), ["She won"]);
  });

  it("shows a private account as private, and counts pages and repos for sites and GitHub", () => {
    const d = buildDossier({
      jobId: "t", subjectName: "Jane Doe", persona: null, now: NOW,
      items: [
        item({ platform: "instagram", kind: "profile", author: "jane", details: { private: true } }),
        item({ platform: "website", kind: "page", url: "https://janedoe.design/" }),
        item({ platform: "website", kind: "page", url: "https://janedoe.design/work" }),
        item({ platform: "github", kind: "repo", url: "https://github.com/janedoe/a", details: { name: "a" } }),
      ],
    });
    const by = Object.fromEntries(d.presence.map((p) => [p.platform, p]));
    assert.equal(by.instagram.private, true);
    assert.deepEqual(by.website.count, { value: 2, unit: "pages" });
    assert.deepEqual(by.github.count, { value: 1, unit: "repos" });
  });

  it("counts timed public activity toward when they are online, not toward posts", () => {
    const d = buildDossier({
      jobId: "t", subjectName: "Jane Doe", persona: null, now: NOW,
      items: [item({ platform: "github", kind: "activity", posted_at: "2026-10-07T23:00:00Z", text: "Pushed" })],
    });
    assert.equal(d.totals.posts, 0);
    assert.deepEqual(d.routine.peak, { day: 2, hour: 23, count: 1 });
  });

  it("files a blank as class F", () => {
    const d = buildDossier({ jobId: "t", subjectName: "Nobody", persona: null, now: NOW, items: [] });
    assert.equal(d.assessment.grade, "F");
  });
});

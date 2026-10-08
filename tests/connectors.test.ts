import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { github } from "../src/connectors/github";
import { instagram } from "../src/connectors/instagram";
import { linkedin } from "../src/connectors/linkedin";
import { web } from "../src/connectors/web";
import { siteDetails, website } from "../src/connectors/website";

describe("website", () => {
  const raw = {
    url: "https://janedoe.design/",
    text: "Jane Doe designs type in Brno.",
    markdown: "Find me on [GitHub](https://github.com/janedoe) and [home](https://janedoe.design/).",
    metadata: {
      title: "Jane Doe, type designer",
      description: "Type designer in Brno.",
      jsonLd: [
        {
          "@graph": [
            {
              "@type": "Person",
              jobTitle: "Type designer",
              worksFor: { name: "Studio Nord" },
              address: { addressLocality: "Brno", addressCountry: "CZ" },
              knowsAbout: ["Type", "Lettering"],
              sameAs: ["https://instagram.com/jane.letters"],
            },
            { "@type": "CreativeWork", name: "Grotesk One", url: "https://janedoe.design/grotesk", description: "A sans." },
          ],
        },
      ],
    },
  };

  it("reads who they are from JSON-LD", () => {
    const d = siteDetails(raw);
    assert.equal(d.jobTitle, "Type designer");
    assert.equal(d.worksFor, "Studio Nord");
    assert.equal(d.location, "Brno, CZ");
    assert.deepEqual(d.skills, ["Type", "Lettering"]);
    assert.deepEqual(d.projects.map((p) => p.name), ["Grotesk One"]);
    assert.deepEqual(d.sameAs, ["https://instagram.com/jane.letters"]);
  });

  it("keeps their declared profiles and footer links, not links back to itself", () => {
    const [page] = website.actors[0].normalize(raw);
    assert.equal(page.kind, "page");
    assert.deepEqual(page.links, ["https://instagram.com/jane.letters", "https://github.com/janedoe"]);
  });

  it("runs the crawler small", () => {
    const input = website.actors[0].buildInput("janedoe.design", { maxPosts: 30 });
    assert.deepEqual(input.startUrls, [{ url: "https://janedoe.design/" }]);
    assert.equal(website.actors[0].memoryMbytes, 1024);
  });
});

describe("github", () => {
  const normalize = github.actors[0].normalize;

  it("reads the profile with its links and stated facts", () => {
    const [p] = normalize({
      source: "user", login: "janedoe", name: "Jane Doe", bio: "Building https://tool.dev", blog: "janedoe.design",
      twitter_username: "jd", company: "@studio", location: "Brno", followers: 3, public_repos: 5,
      avatar_url: "https://avatars.example/1", html_url: "https://github.com/janedoe", created_at: "2021-03-24T09:55:03Z", readme: null,
    });
    assert.equal(p.kind, "profile");
    assert.deepEqual(p.links, ["https://janedoe.design", "https://x.com/jd", "https://tool.dev"]);
    assert.equal(p.details?.company, "studio");
    assert.equal(p.metrics.repos, 5);
  });

  it("keeps repositories they made, not forks", () => {
    assert.equal(normalize({ source: "repo", name: "fork", fork: true }).length, 0);
    const [r] = normalize({ source: "repo", name: "grotesk", full_name: "janedoe/grotesk", description: "A sans", language: "Python", stargazers_count: 7, pushed_at: "2026-10-01T00:00:00Z" });
    assert.equal(r.kind, "repo");
    assert.equal(r.text, "grotesk: A sans");
    assert.equal(r.metrics.stars, 7);
  });

  it("turns public events into timed activity", () => {
    const [e] = normalize({ source: "event", id: "1", type: "PushEvent", repo: { name: "janedoe/grotesk" }, created_at: "2026-10-08T20:58:40Z", payload: {} });
    assert.equal(e.kind, "activity");
    assert.equal(e.text, "Pushed to janedoe/grotesk");
    assert.equal(e.postedAt, "2026-10-08T20:58:40.000Z");
  });
});

describe("profiles", () => {
  it("marks a private Instagram", () => {
    const [p] = instagram.actors[0].normalize({ username: "jane", private: true, fullName: "Jane Doe", biography: "hi" });
    assert.equal(p.details?.private, true);
  });

  it("keeps LinkedIn work history and schooling", () => {
    const [p] = linkedin.actors[0].normalize({
      publicIdentifier: "janedoe",
      headline: "Designer",
      location: { linkedinText: "Brno" },
      experience: [{ position: "Designer", companyName: "Studio Nord", startDate: { text: "Mar 2022" }, endDate: { text: "Present" } }],
      education: [{ schoolName: "VUT", degree: "Design", period: "2016 - 2020" }],
    });
    const d = p.details as { work: { company: string }[]; education: { school: string }[]; location: string };
    assert.equal(d.work[0].company, "Studio Nord");
    assert.equal(d.education[0].school, "VUT");
    assert.equal(d.location, "Brno");
  });
});

describe("web search", () => {
  const normalize = web.actors[0].normalize;

  it("keeps a mention's own source field", () => {
    const [m] = normalize({ entry: "mention", url: "https://event.example/talk", title: "Talk", source: "Event", date: "2026-06-24", summary: "She spoke." });
    assert.equal(m.kind, "mention");
    assert.equal(m.author, "Event");
  });

  it("follows only the accounts it is reasonably sure of, and declares only the sure ones", () => {
    const [p] = normalize({
      entry: "found",
      accounts: [
        { url: "https://instagram.com/a", platform: "Instagram", why: "", confidence: "high" },
        { url: "https://x.com/b", platform: "X", why: "", confidence: "medium" },
        { url: "https://x.com/c", platform: "X", why: "", confidence: "low" },
      ],
      facts: [{ fact: "Works at Studio Nord", url: "https://studio.example" }],
    });
    assert.deepEqual(p.links, ["https://instagram.com/a", "https://x.com/b"]);
    assert.deepEqual(p.details?.sameAs, ["https://instagram.com/a"]);
  });
});

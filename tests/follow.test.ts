import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linksToFollow, MAX_FOLLOWS } from "../src/lib/follow";

const page = (links: string[], sameAs: string[] = []) => ({ platform: "website", kind: "page", links, details: { sameAs } });
const bio = (platform: string, links: string[]) => ({ platform, kind: "profile", links, details: {} });
const webFound = (links: string[], sure: string[]) => ({ platform: "web", kind: "profile", links, details: { sameAs: sure } });
const run = (platform: string, target: string, followed_from: string | null = null) => ({ platform, target, followed_from });

describe("linksToFollow", () => {
  it("follows what their site declares as theirs, even when the handle is not their name", () => {
    const f = linksToFollow("Michael Ptáček", [run("website", "https://michaelptacek.com")], [
      page(["https://instagram.com/michal.718"], ["https://instagram.com/michal.718"]),
    ]);
    assert.deepEqual(f.map((x) => x.platform), ["instagram"]);
  });

  it("does not follow a plain link on their site to someone else", () => {
    const f = linksToFollow("Simon Veprek", [run("website", "https://simonveprek.cz")], [
      page(["https://instagram.com/ondrejsoldan", "https://x.com/simonveprek"]),
    ]);
    assert.deepEqual(f.map((x) => x.target), ["https://x.com/simonveprek"]);
  });

  it("counts a repository link as its owner's account", () => {
    const f = linksToFollow("Simon Veprek", [], [page(["https://github.com/simonveprek/NotchPal"], ["https://github.com/simonveprek/NotchPal"])]);
    assert.deepEqual(f, [{ platform: "github", target: "https://github.com/simonveprek", from: "their website" }]);
  });

  it("never reads the same account twice, whatever form the link takes", () => {
    const f = linksToFollow("Michael Ptáček", [run("linkedin", "https://linkedin.com/in/ptacekmichael")], [
      page(["https://www.linkedin.com/in/ptacekmichael/"], ["https://www.linkedin.com/in/ptacekmichael/"]),
    ]);
    assert.deepEqual(f, []);
  });

  it("adds a second account on a platform only with strong evidence", () => {
    const sure = ["https://www.instagram.com/simon.veprek"];
    assert.deepEqual(linksToFollow("Simon Veprek", [run("instagram", "https://www.instagram.com/simonveprek")], [webFound(sure, sure)]), [
      { platform: "instagram", target: "https://www.instagram.com/simon.veprek", from: "a web search" },
    ]);
    // A bio can point at a friend's account.
    assert.deepEqual(linksToFollow("Jane Doe", [run("instagram", "janedoe")], [bio("tiktok", ["https://instagram.com/studio_nord"])]), []);
    assert.equal(linksToFollow("Jane Doe", [run("instagram", "janedoe")], [bio("tiktok", ["https://instagram.com/jane.doe.film"])]).length, 1);
  });

  it("never adds a third account on a platform", () => {
    const sure = ["https://instagram.com/jane.three"];
    assert.deepEqual(linksToFollow("Jane Doe", [run("instagram", "janedoe"), run("instagram", "jane.doe")], [webFound(sure, sure)]), []);
  });

  it("needs the name for a web search result it is not sure of", () => {
    assert.deepEqual(linksToFollow("Jane Doe", [], [webFound(["https://x.com/someoneelse"], [])]), []);
    assert.equal(linksToFollow("Jane Doe", [], [webFound(["https://x.com/janedoe"], [])])[0].from, "a web search");
  });

  it("takes a website only from a bio or a sure web search", () => {
    assert.deepEqual(linksToFollow("Jane Doe", [], [bio("instagram", ["https://linktr.ee/janed"])]).map((x) => x.target), ["https://linktr.ee"]);
    assert.deepEqual(linksToFollow("Jane Doe", [], [page(["https://someclient.com"])]), []);
    assert.deepEqual(linksToFollow("Jane Doe", [], [webFound(["https://janedoe.design"], ["https://janedoe.design"])]).map((x) => x.platform), ["website"]);
    assert.deepEqual(linksToFollow("Jane Doe", [run("website", "jane.com")], [bio("github", ["https://smirky.dev"])]), []);
    assert.deepEqual(linksToFollow("Jane Doe", [], [bio("x", ["https://www.youtube.com/watch?v=1"])]), []);
  });

  it("reads bios first, then the web search, then pages, up to a cap", () => {
    const f = linksToFollow("Jane Doe", [], [
      page(["https://x.com/janedoe_site"], ["https://x.com/janedoe_site"]),
      webFound(["https://tiktok.com/@janedoe"], ["https://tiktok.com/@janedoe"]),
      bio("instagram", ["https://x.com/janedoe_bio"]),
    ]);
    assert.deepEqual(f.map((x) => x.target), ["https://x.com/janedoe_bio", "https://tiktok.com/@janedoe", "https://x.com/janedoe_site"]);
    const many = ["x.com/janedoe", "tiktok.com/@janedoe", "youtube.com/@janedoe", "threads.net/@janedoe", "pinterest.com/janedoe", "github.com/janedoe", "reddit.com/user/janedoe", "facebook.com/janedoe"].map(
      (u) => `https://${u}`,
    );
    assert.equal(linksToFollow("Jane Doe", [run("x", "a", "their website")], [page(many, many)]).length, MAX_FOLLOWS - 1);
  });

  it("gives racing pollers the same answer", () => {
    const src = [page(["https://github.com/janedoe", "https://x.com/janedoe"], ["https://github.com/janedoe"])];
    assert.deepEqual(linksToFollow("Jane Doe", [], src), linksToFollow("Jane Doe", [], src));
  });
});

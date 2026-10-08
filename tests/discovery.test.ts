import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProfileUrl } from "../src/connectors/profile-url";
import { handleVariants, matchScore, ownSite } from "../src/lib/discovery";

describe("parseProfileUrl", () => {
  it("recognises profiles on every platform", () => {
    const cases: [string, string, string][] = [
      ["https://www.instagram.com/simonveprek/", "instagram", "simonveprek"],
      ["https://www.tiktok.com/@jane", "tiktok", "@jane"],
      ["https://twitter.com/jane", "x", "jane"],
      ["https://cz.linkedin.com/in/simonveprek", "linkedin", "simonveprek"],
      ["https://www.youtube.com/@jane", "youtube", "@jane"],
      ["https://www.facebook.com/profile.php?id=123", "facebook", "123"],
      ["https://www.reddit.com/user/vell_m/", "reddit", "vell_m"],
      ["https://www.threads.net/@jane", "threads", "@jane"],
      ["https://www.pinterest.com/jane/", "pinterest", "jane"],
      ["https://github.com/simonveprek", "github", "simonveprek"],
    ];
    for (const [url, platform, handle] of cases) {
      const ref = parseProfileUrl(url);
      assert.equal(ref?.platform, platform, url);
      assert.equal(ref?.handle.replace(/^@/, ""), handle.replace(/^@/, ""), url);
    }
  });

  it("rejects posts, searches and site pages", () => {
    for (const url of [
      "https://www.instagram.com/p/abc123/",
      "https://x.com/search?q=jane",
      "https://www.reddit.com/user/vell_m/comments/abc/",
      "https://github.com/features",
      "https://github.com/simonveprek/NotchPal",
      "https://example.com/jane",
      "not a url",
    ]) {
      assert.equal(parseProfileUrl(url), null, url);
    }
  });
});

describe("matching a name", () => {
  it("scores how much of the name a title or handle carries", () => {
    assert.equal(matchScore("Šimon Vepřek", "Simon Veprek (@simonveprek)", "simonveprek"), 1);
    assert.equal(matchScore("Jane Doe", "Jane Smith", "jsmith"), 0.5);
    assert.equal(matchScore("Jane Doe", "Someone else", "other"), 0);
  });

  it("spots a person's own site from its domain", () => {
    assert.deepEqual(ownSite("Michael Ptáček", "https://michaelptacek.com/about"), { host: "michaelptacek.com", origin: "https://michaelptacek.com" });
    assert.ok(ownSite("Šimon Vepřek", "https://www.simonveprek.cz/"));
    assert.equal(ownSite("Jane Doe", "https://www.linkedin.com/in/janedoe"), null);
    assert.equal(ownSite("Jane Doe", "https://example.com"), null);
  });

  it("builds the Instagram handles a name would pick", () => {
    const v = handleVariants("Šimon Vepřek");
    for (const h of ["simonveprek", "simon.veprek", "simon_veprek", "veprek.simon"]) assert.ok(v.includes(h), h);
    assert.ok(v.every((h) => /^[a-z0-9._]{3,30}$/.test(h)));
    assert.deepEqual(handleVariants("Cher"), []);
  });
});

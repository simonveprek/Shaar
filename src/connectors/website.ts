import type { Connector } from "./types";
import { item, str } from "./util";

/*
 * The person's own website, read with apify/website-content-crawler: the home page and a few pages linked
 * from it, as plain text. It feeds the persona with how they describe themselves, in their own words.
 */

const homepage = (target: string) => {
  const url = new URL(/^https?:\/\//i.test(target.trim()) ? target.trim() : `https://${target.trim()}`);
  return `${url.origin}/`;
};

export const website: Connector = {
  platform: "website",
  label: "Website",
  targetHint: "Their website, like jane.com",
  notes: "Reads up to 5 pages of the site as text.",
  actors: [
    {
      actorId: "apify/website-content-crawler",
      role: "profile",
      buildInput: (target) => ({
        startUrls: [{ url: homepage(target) }],
        crawlerType: "cheerio",
        maxCrawlPages: 5,
        maxCrawlDepth: 1,
        maxResults: 5,
        saveMarkdown: false,
        removeCookieWarnings: true,
        proxyConfiguration: { useApifyProxy: true },
      }),
      maxItems: () => 5,
      normalize: (raw) => {
        const url = str(raw, "url", "crawl.loadedUrl");
        const text = str(raw, "text");
        if (!url || !text) return [];
        const title = str(raw, "metadata.title");
        return [
          item({
            kind: "page",
            externalId: url,
            url,
            author: title,
            text: [title, str(raw, "metadata.description"), text].filter(Boolean).join("\n\n").slice(0, 6000),
          }),
        ];
      },
    },
  ],
};

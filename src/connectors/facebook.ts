import type { Connector } from "./types";
import { date, isUrl, item, joinText, linksFrom, mediaUrls, metrics, profileId, str, cleanHandle } from "./util";

const pageUrl = (target: string) =>
  isUrl(target) ? target.trim() : `https://www.facebook.com/${cleanHandle(target)}/`;

export const facebook: Connector = {
  platform: "facebook",
  label: "Facebook",
  targetHint: "Facebook page URL or page name",
  notes: "Works for public pages. Personal profiles return little or nothing.",
  actors: [
    {
      actorId: "apify/facebook-pages-scraper",
      role: "profile",
      buildInput: (target) => ({ startUrls: [{ url: pageUrl(target) }] }),
      maxItems: () => 1,
      normalize: (raw) => {
        const id = str(raw, "pageId", "pageName", "facebookUrl");
        if (!id || raw.error) return [];
        const categories = Array.isArray(raw.categories) ? `Categories: ${raw.categories.join(", ")}` : null;
        const info = Array.isArray(raw.info) ? raw.info.filter((x) => typeof x === "string").join(" ") : null;
        return [
          item({
            kind: "profile",
            externalId: profileId(id),
            url: str(raw, "pageUrl", "facebookUrl"),
            author: str(raw, "title", "pageName"),
            text: joinText(str(raw, "intro"), info, categories),
            metrics: metrics(raw, { likes: ["likes"], followers: ["followers"] }),
            media: mediaUrls(raw, "profilePictureUrl"),
            links: linksFrom(raw, "website", "websites"),
          }),
        ];
      },
    },
    {
      actorId: "apify/facebook-posts-scraper",
      role: "posts",
      buildInput: (target, { maxPosts }) => ({ startUrls: [{ url: pageUrl(target) }], resultsLimit: maxPosts }),
      maxItems: ({ maxPosts }) => maxPosts,
      normalize: (raw) => {
        const id = str(raw, "postId", "url");
        if (!id || raw.error) return [];
        return [
          item({
            kind: "post",
            externalId: id,
            url: str(raw, "url"),
            author: str(raw, "user.name", "pageName"),
            text: str(raw, "text"),
            postedAt: date(raw, "time", "timestamp"),
            metrics: metrics(raw, {
              likes: ["likes"],
              comments: ["comments"],
              shares: ["shares"],
              views: ["viewsCount"],
            }),
            media: mediaUrls(raw, "media"),
          }),
        ];
      },
    },
  ],
};

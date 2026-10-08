import type { Connector, NormalizedItem } from "./types";
import { date, handleFrom, item, mediaUrls, metrics, profileId, str } from "./util";

export const tiktok: Connector = {
  platform: "tiktok",
  label: "TikTok",
  targetHint: "TikTok username or profile URL",
  actors: [
    {
      actorId: "clockworks/tiktok-profile-scraper",
      role: "posts",
      buildInput: (target, { maxPosts }) => ({
        profiles: [handleFrom(target).replace(/^@/, "")],
        resultsPerPage: maxPosts,
        profileSorting: "latest",
        profileScrapeSections: ["videos"],
        excludePinnedPosts: false,
      }),
      maxItems: ({ maxPosts }) => maxPosts,
      // Each video carries the author's profile in `authorMeta`; emit it too (deduped by id on insert).
      normalize: (raw) => {
        if (raw.error) return [];
        const out: NormalizedItem[] = [];
        const handle = str(raw, "authorMeta.name");
        if (handle) {
          out.push(
            item({
              kind: "profile",
              externalId: profileId(handle),
              url: `https://www.tiktok.com/@${handle}`,
              author: handle,
              text: str(raw, "authorMeta.signature"),
              metrics: metrics(raw, {
                followers: ["authorMeta.fans"],
                following: ["authorMeta.following"],
                likes: ["authorMeta.heart"],
                posts: ["authorMeta.video"],
              }),
              media: mediaUrls(raw, "authorMeta.avatar"),
            }),
          );
        }
        const id = str(raw, "id");
        if (id) {
          out.push(
            item({
              kind: "post",
              externalId: id,
              url: str(raw, "webVideoUrl"),
              author: handle,
              text: str(raw, "text"),
              postedAt: date(raw, "createTimeISO", "createTime"),
              metrics: metrics(raw, {
                likes: ["diggCount"],
                comments: ["commentCount"],
                shares: ["shareCount"],
                views: ["playCount"],
                saves: ["collectCount"],
              }),
              media: mediaUrls(raw, "videoMeta.coverUrl"),
            }),
          );
        }
        return out;
      },
    },
  ],
};

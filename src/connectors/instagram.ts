import type { Connector } from "./types";
import { date, handleFrom, item, linksFrom, mediaUrls, metrics, profileId, str } from "./util";

const profileUrl = (target: string) => `https://www.instagram.com/${handleFrom(target)}/`;

export const instagram: Connector = {
  platform: "instagram",
  label: "Instagram",
  targetHint: "Instagram username or profile URL",
  notes: "Private accounts only return basic profile info.",
  actors: [
    {
      actorId: "apify/instagram-profile-scraper",
      role: "profile",
      buildInput: (target) => ({ usernames: [handleFrom(target)] }),
      maxItems: () => 1,
      normalize: (raw) => {
        if (raw.error) return [];
        const username = str(raw, "username");
        return [
          item({
            kind: "profile",
            externalId: profileId(username),
            url: str(raw, "url"),
            author: username,
            text: str(raw, "biography"),
            metrics: metrics(raw, {
              followers: ["followersCount"],
              following: ["followsCount"],
              posts: ["postsCount"],
            }),
            media: mediaUrls(raw, "profilePicUrlHD", "profilePicUrl"),
            links: linksFrom(raw, "externalUrl", "externalUrls"),
          }),
        ];
      },
    },
    {
      actorId: "apify/instagram-scraper",
      role: "posts",
      buildInput: (target, { maxPosts }) => ({
        directUrls: [profileUrl(target)],
        resultsType: "posts",
        resultsLimit: maxPosts,
      }),
      maxItems: ({ maxPosts }) => maxPosts,
      normalize: (raw) => {
        const id = str(raw, "id", "shortCode");
        if (!id || raw.error) return [];
        const m = metrics(raw, { likes: ["likesCount"], comments: ["commentsCount"], views: ["videoViewCount"] });
        if (m.likes === -1) delete m.likes; // hidden like counts come back as -1
        return [
          item({
            kind: "post",
            externalId: id,
            url: str(raw, "url"),
            author: str(raw, "ownerUsername"),
            text: str(raw, "caption"),
            postedAt: date(raw, "timestamp"),
            metrics: m,
            media: mediaUrls(raw, "displayUrl", "images"),
          }),
        ];
      },
    },
  ],
};

import type { Connector } from "./types";
import { date, handleFrom, item, joinText, metrics, profileId, str } from "./util";

const userUrl = (target: string) => {
  // Accept u/name, /user/name, full URLs, or a bare name.
  const name = handleFrom(target.replace(/^\/?u(ser)?\//i, ""), "/user");
  return `https://www.reddit.com/user/${name}/`;
};

export const reddit: Connector = {
  platform: "reddit",
  label: "Reddit",
  targetHint: "Reddit username (u/name) or profile URL",
  actors: [
    {
      actorId: "trudax/reddit-scraper-lite",
      role: "posts",
      buildInput: (target, { maxPosts }) => ({
        startUrls: [{ url: userUrl(target) }],
        maxPostCount: maxPosts,
        maxItems: maxPosts * 2 + 1,
        skipComments: true,
        skipCommunity: true,
        // Without media links the actor uses a fast RSS mode that omits votes and comment counts.
        includeMediaLinks: true,
      }),
      maxItems: ({ maxPosts }) => maxPosts * 2 + 1,
      normalize: (raw) => {
        switch (raw.dataType) {
          case "user": {
            const username = str(raw, "username");
            return [
              item({
                kind: "profile",
                externalId: profileId(username),
                url: str(raw, "url"),
                author: username,
                text: str(raw, "description"),
                postedAt: date(raw, "createdAt"),
                metrics: metrics(raw, { postKarma: ["postKarma"], commentKarma: ["commentKarma"] }),
              }),
            ];
          }
          case "post":
          case "comment": {
            const id = str(raw, "id");
            if (!id) return [];
            const community = str(raw, "communityName");
            return [
              item({
                kind: raw.dataType === "post" ? "post" : "comment",
                externalId: id,
                url: str(raw, "url"),
                author: str(raw, "username"),
                text: joinText(community ? `[${community}] ${str(raw, "title") ?? ""}`.trim() : str(raw, "title"), str(raw, "body")),
                postedAt: date(raw, "createdAt"),
                metrics: metrics(raw, { upvotes: ["upVotes"], comments: ["numberOfComments"] }),
              }),
            ];
          }
          default:
            return [];
        }
      },
    },
  ],
};

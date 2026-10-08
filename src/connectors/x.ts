import type { Connector } from "./types";
import { date, handleFrom, item, mediaUrls, metrics, profileId, str } from "./util";

// x.com/<handle> and twitter.com/<handle> both work with handleFrom.
const handle = (target: string) => handleFrom(target);

export const x: Connector = {
  platform: "x",
  label: "X (Twitter)",
  targetHint: "X handle or profile URL",
  notes: "Requires a paid Apify plan: on the free plan these actors only run in a limited demo mode.",
  actors: [
    {
      actorId: "apidojo/twitter-user-scraper",
      role: "profile",
      // Follower/following/retweeter extraction defaults to on and is billed separately; turn it off.
      buildInput: (target) => ({
        twitterHandles: [handle(target)],
        getFollowers: false,
        getFollowing: false,
        getRetweeters: false,
        maxItems: 1,
      }),
      maxItems: () => 1,
      normalize: (raw) => {
        if (raw.type !== "user") return [];
        const username = str(raw, "userName");
        return [
          item({
            kind: "profile",
            externalId: profileId(username),
            url: str(raw, "url"),
            author: username,
            text: str(raw, "description"),
            postedAt: date(raw, "createdAt"),
            metrics: metrics(raw, { followers: ["followers"], following: ["following"], posts: ["statusesCount"] }),
            media: mediaUrls(raw, "profilePicture"),
          }),
        ];
      },
    },
    {
      actorId: "apidojo/twitter-scraper-lite",
      role: "posts",
      buildInput: (target, { maxPosts }) => ({
        searchTerms: [`from:${handle(target)}`],
        sort: "Latest",
        maxItems: maxPosts,
      }),
      maxItems: ({ maxPosts }) => maxPosts,
      normalize: (raw) => {
        const id = str(raw, "id");
        if (raw.type !== "tweet" || !id) return [];
        return [
          item({
            kind: raw.isReply ? "comment" : "post",
            externalId: id,
            url: str(raw, "url", "twitterUrl"),
            author: str(raw, "author.userName"),
            text: str(raw, "text", "fullText"),
            postedAt: date(raw, "createdAt"),
            metrics: metrics(raw, {
              likes: ["likeCount"],
              reposts: ["retweetCount"],
              replies: ["replyCount"],
              quotes: ["quoteCount"],
              bookmarks: ["bookmarkCount"],
              views: ["viewCount"],
            }),
          }),
        ];
      },
    },
  ],
};

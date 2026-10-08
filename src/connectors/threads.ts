import type { Connector, NormalizedItem } from "./types";
import { date, handleFrom, item, metrics, profileId, str } from "./util";

export const threads: Connector = {
  platform: "threads",
  label: "Threads",
  targetHint: "Threads username or profile URL",
  actors: [
    {
      actorId: "futurizerush/meta-threads-scraper",
      role: "posts",
      buildInput: (target, { maxPosts }) => ({
        mode: "user",
        usernames: [handleFrom(target).replace(/^@/, "")],
        max_posts: Math.max(10, maxPosts), // actor minimum is 10
      }),
      maxItems: ({ maxPosts }) => Math.max(10, maxPosts),
      // Every post row carries the author's profile fields; emit them as the profile item too.
      normalize: (raw) => {
        if (raw.record_type !== "post") return [];
        const out: NormalizedItem[] = [];
        const username = str(raw, "username");
        if (username) {
          out.push(
            item({
              kind: "profile",
              externalId: profileId(username),
              url: str(raw, "profile_url"),
              author: username,
              text: str(raw, "bio"),
              metrics: metrics(raw, { followers: ["followers_count"] }),
            }),
          );
        }
        const id = str(raw, "post_code", "post_url");
        if (id) {
          out.push(
            item({
              kind: "post",
              externalId: id,
              url: str(raw, "post_url"),
              author: username,
              text: str(raw, "text_content"),
              postedAt: date(raw, "created_at", "created_at_timestamp"),
              metrics: metrics(raw, {
                likes: ["like_count"],
                replies: ["reply_count"],
                reposts: ["repost_count"],
                quotes: ["quote_count"],
                views: ["view_count"],
              }),
            }),
          );
        }
        return out;
      },
    },
  ],
};

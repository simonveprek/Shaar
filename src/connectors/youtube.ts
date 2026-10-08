import type { Connector, NormalizedItem } from "./types";
import { date, handleFrom, isUrl, item, joinText, mediaUrls, metrics, profileId, str } from "./util";

const channelUrl = (target: string) => (isUrl(target) ? target.trim() : `https://www.youtube.com/@${handleFrom(target)}`);

export const youtube: Connector = {
  platform: "youtube",
  label: "YouTube",
  targetHint: "YouTube channel URL or @handle",
  actors: [
    {
      actorId: "streamers/youtube-scraper",
      role: "posts",
      buildInput: (target, { maxPosts }) => ({
        startUrls: [{ url: channelUrl(target) }],
        maxResults: maxPosts,
        maxResultsShorts: 0,
        maxResultStreams: 0,
        sortVideosBy: "NEWEST",
      }),
      maxItems: ({ maxPosts }) => maxPosts,
      // Channel info is flattened onto every video item; emit it as the profile too.
      normalize: (raw) => {
        if (raw.error) return [];
        const out: NormalizedItem[] = [];
        const channel = str(raw, "channelUsername", "channelId", "channelName");
        if (channel) {
          out.push(
            item({
              kind: "profile",
              externalId: profileId(channel),
              url: str(raw, "channelUrl"),
              author: str(raw, "channelName") ?? channel,
              text: str(raw, "channelDescription"),
              metrics: metrics(raw, {
                followers: ["numberOfSubscribers"],
                posts: ["channelTotalVideos"],
                views: ["channelTotalViews"],
              }),
            }),
          );
        }
        const id = str(raw, "id");
        if (id) {
          out.push(
            item({
              kind: "post",
              externalId: id,
              url: str(raw, "url"),
              author: str(raw, "channelName"),
              text: joinText(str(raw, "title"), str(raw, "text")),
              postedAt: date(raw, "date"), // can be relative ("10 months ago"), in which case it stays null
              metrics: metrics(raw, { views: ["viewCount"], likes: ["likes"], comments: ["commentsCount"] }),
              media: mediaUrls(raw, "thumbnailUrl"),
            }),
          );
        }
        return out;
      },
    },
  ],
};

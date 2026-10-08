import type { Connector, NormalizedItem } from "./types";
import { date, handleFrom, item, joinText, mediaUrls, metrics, profileId, str } from "./util";

const profileUrl = (target: string) => `https://www.pinterest.com/${handleFrom(target)}/`;

export const pinterest: Connector = {
  platform: "pinterest",
  label: "Pinterest",
  targetHint: "Pinterest username or profile URL",
  actors: [
    {
      actorId: "automation-lab/pinterest-scraper",
      role: "posts",
      buildInput: (target, { maxPosts }) => ({ profileUrls: [profileUrl(target)], maxPins: maxPosts }),
      maxItems: ({ maxPosts }) => maxPosts,
      // Profile fields are flattened onto every pin.
      normalize: (raw) => {
        const out: NormalizedItem[] = [];
        const username = str(raw, "profileUsername");
        if (username) {
          out.push(
            item({
              kind: "profile",
              externalId: profileId(username),
              url: `https://www.pinterest.com/${username}/`,
              author: str(raw, "profileName") ?? username,
              metrics: metrics(raw, { followers: ["profileFollowers"], posts: ["profilePinCount"] }),
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
              author: str(raw, "pinnerUsername"),
              text: joinText(str(raw, "title"), str(raw, "description"), str(raw, "boardName") ? `Board: ${str(raw, "boardName")}` : null),
              postedAt: date(raw, "createdAt"),
              metrics: metrics(raw, { saves: ["saves"] }),
              media: mediaUrls(raw, "imageUrl"),
            }),
          );
        }
        return out;
      },
    },
  ],
};

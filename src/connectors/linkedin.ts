import type { Connector } from "./types";
import { date, handleFrom, item, joinText, mediaUrls, metrics, profileId, str } from "./util";

const profileUrl = (target: string) => `https://www.linkedin.com/in/${handleFrom(target, "/in")}/`;

export const linkedin: Connector = {
  platform: "linkedin",
  label: "LinkedIn",
  targetHint: "LinkedIn profile URL (linkedin.com/in/...) or public identifier",
  actors: [
    {
      actorId: "harvestapi/linkedin-profile-scraper",
      role: "profile",
      buildInput: (target) => ({
        profileScraperMode: "Profile details no email ($4 per 1k)",
        queries: [profileUrl(target)],
      }),
      maxItems: () => 1,
      normalize: (raw) => {
        const username = str(raw, "publicIdentifier");
        if (!username) return [];
        const positions = Array.isArray(raw.experience)
          ? (raw.experience as Record<string, unknown>[])
              .slice(0, 8)
              .map((e) => [str(e, "position", "title"), str(e, "companyName")].filter(Boolean).join(" at "))
              .filter(Boolean)
              .join("; ")
          : null;
        return [
          item({
            kind: "profile",
            externalId: profileId(username),
            url: str(raw, "linkedinUrl"),
            author: username,
            text: joinText(str(raw, "headline"), str(raw, "about"), positions ? `Experience: ${positions}` : null),
            metrics: metrics(raw, { followers: ["followerCount"], connections: ["connectionsCount"] }),
            media: mediaUrls(raw, "photo"),
            details: linkedinDetails(raw),
          }),
        ];
      },
    },
    {
      actorId: "harvestapi/linkedin-profile-posts",
      role: "posts",
      buildInput: (target, { maxPosts }) => ({ targetUrls: [profileUrl(target)], maxPosts }),
      maxItems: ({ maxPosts }) => maxPosts,
      normalize: (raw) => {
        const id = str(raw, "id");
        if (raw.type !== "post" || !id) return [];
        return [
          item({
            kind: "post",
            externalId: id,
            url: str(raw, "linkedinUrl"),
            author: str(raw, "author.publicIdentifier", "author.name"),
            text: str(raw, "content"),
            postedAt: date(raw, "postedAt.date", "postedAt.timestamp"),
            metrics: metrics(raw, {
              likes: ["engagement.likes"],
              comments: ["engagement.comments"],
              shares: ["engagement.shares"],
            }),
            media: mediaUrls(raw, "postImages"),
          }),
        ];
      },
    },
  ],
};

type Raw = Record<string, unknown>;
const list = (raw: Raw, ...keys: string[]) =>
  (keys.map((k) => raw[k]).find((v) => Array.isArray(v) && v.length) ?? []) as Raw[];

/** Where they work and studied, with dates, as LinkedIn states it. */
function linkedinDetails(raw: Raw) {
  return {
    headline: str(raw, "headline"),
    location: str(raw, "location.linkedinText", "location.parsed.text"),
    work: list(raw, "experience", "currentPosition")
      .slice(0, 8)
      .map((e) => ({
        role: str(e, "position", "title"),
        company: str(e, "companyName"),
        from: str(e, "startDate.text"),
        to: str(e, "endDate.text"),
      }))
      .filter((e) => e.role || e.company),
    education: list(raw, "education", "profileTopEducation")
      .slice(0, 4)
      .map((e) => ({
        school: str(e, "schoolName", "title"),
        degree: [str(e, "degree"), str(e, "fieldOfStudy")].filter(Boolean).join(", ") || null,
        period: str(e, "period") ?? ([str(e, "startDate.text"), str(e, "endDate.text")].filter(Boolean).join(" to ") || null),
      }))
      .filter((e) => e.school),
  };
}

/*
 * Recognises a profile link on each platform we have a connector for, and
 * turns it into { platform, handle }. Links to single posts, searches, tags and
 * the like are not profiles and return null.
 */

export type ProfileRef = { platform: string; handle: string; url: string };

/** One web search per platform. Shaar searches each with the name in quotes. */
export const PROFILE_SITES: { platform: string; site: string }[] = [
  { platform: "instagram", site: "instagram.com" },
  { platform: "tiktok", site: "tiktok.com" },
  { platform: "x", site: "x.com" },
  { platform: "linkedin", site: "linkedin.com/in" },
  { platform: "youtube", site: "youtube.com" },
  { platform: "facebook", site: "facebook.com" },
  { platform: "reddit", site: "reddit.com/user" },
  { platform: "threads", site: "threads.net" },
  { platform: "pinterest", site: "pinterest.com" },
];

const RESERVED: Record<string, Set<string>> = {
  instagram: new Set(["p", "reel", "reels", "explore", "stories", "tv", "accounts", "about", "developer", "legal"]),
  x: new Set(["i", "home", "search", "explore", "hashtag", "intent", "share", "settings", "login", "signup", "tos", "privacy"]),
  facebook: new Set(["groups", "events", "watch", "photo", "photos", "story.php", "photo.php", "permalink.php", "pages", "marketplace", "login", "share", "sharer", "hashtag", "help", "public"]),
  pinterest: new Set(["pin", "search", "ideas", "today", "categories", "business", "about"]),
};

const clean = (s: string) => decodeURIComponent(s).replace(/^@/, "").trim();

export function parseProfileUrl(raw: string): ProfileRef | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|mobile|[a-z]{2}(-[a-z]{2})?)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0] ?? "";
  const make = (platform: string, handle: string): ProfileRef | null => {
    const h = clean(handle);
    if (!h || h.length > 80 || /[\s?#]/.test(h)) return null;
    return { platform, handle: h, url: url.origin + url.pathname.replace(/\/$/, "") };
  };

  switch (host) {
    case "instagram.com":
      return parts.length === 1 && !RESERVED.instagram.has(first) ? make("instagram", first) : null;
    case "tiktok.com":
      return first.startsWith("@") && parts.length === 1 ? make("tiktok", first) : null;
    case "x.com":
    case "twitter.com":
      return parts.length === 1 && !RESERVED.x.has(first.toLowerCase()) ? make("x", first) : null;
    case "linkedin.com":
      return first === "in" && parts[1] ? make("linkedin", parts[1]) : null;
    case "youtube.com":
      if (first.startsWith("@")) return make("youtube", first);
      if (["c", "channel", "user"].includes(first) && parts[1]) return make("youtube", parts[1]);
      return null;
    case "facebook.com":
      if (first === "profile.php" && url.searchParams.get("id")) return make("facebook", url.searchParams.get("id")!);
      return parts.length === 1 && !RESERVED.facebook.has(first.toLowerCase()) ? make("facebook", first) : null;
    case "reddit.com":
      return (first === "user" || first === "u") && parts[1] ? make("reddit", parts[1]) : null;
    case "threads.net":
    case "threads.com":
      return first.startsWith("@") && parts.length === 1 ? make("threads", first) : null;
    case "pinterest.com":
      return parts.length === 1 && !RESERVED.pinterest.has(first) ? make("pinterest", first) : null;
    default:
      return null;
  }
}

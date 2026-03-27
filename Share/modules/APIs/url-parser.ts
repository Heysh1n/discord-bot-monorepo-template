import type { ParsedUrl } from "./types.js";

/**
 * Парсит URL медиа-контента и возвращает платформу, тип и ID.
 * Возвращает null если URL не распознан.
 */
export function parseMediaUrl(rawUrl: string): ParsedUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  const host = url.host.toLowerCase();

  if (host.includes("twitch.tv")) return parseTwitch(url);
  if (host.includes("youtube.com") || host.includes("youtu.be")) return parseYouTube(url);

  return null;
}

// ═══════════════════════════════════════════════════════════
// TWITCH
// ═══════════════════════════════════════════════════════════

function parseTwitch(url: URL): ParsedUrl | null {
  const path = url.pathname;
  let match: RegExpMatchArray | null;

  // /username/clip/clipId
  match = path.match(/^\/([\w]+)\/clip\/([\w-]+)$/);
  if (match) {
    return { platform: "twitch", type: "clip", id: match[2], username: match[1] };
  }

  // /videos/123456
  match = path.match(/^\/videos\/(\d+)$/);
  if (match) {
    return { platform: "twitch", type: "video", id: match[1] };
  }

  // /username (stream page)
  match = path.match(/^\/([\w]+)$/);
  if (match) {
    return { platform: "twitch", type: "stream", id: match[1], username: match[1] };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// YOUTUBE
// ═══════════════════════════════════════════════════════════

function parseYouTube(url: URL): ParsedUrl | null {
  const path = url.pathname;
  let match: RegExpMatchArray | null;

  // youtu.be/VIDEO_ID
  if (url.host.includes("youtu.be")) {
    match = path.match(/^\/([\w_-]+)/);
    if (match) return { platform: "youtube", type: "video", id: match[1] };
    return null;
  }

  // /watch?v=VIDEO_ID
  if (path === "/watch") {
    const videoId = url.searchParams.get("v");
    if (videoId) return { platform: "youtube", type: "video", id: videoId };
  }

  // /live/VIDEO_ID
  match = path.match(/^\/live\/([\w_-]+)$/);
  if (match) return { platform: "youtube", type: "stream", id: match[1] };

  // /shorts/VIDEO_ID
  match = path.match(/^\/shorts\/([\w_-]+)$/);
  if (match) return { platform: "youtube", type: "short", id: match[1] };

  // /embed/VIDEO_ID
  match = path.match(/^\/embed\/([\w_-]+)$/);
  if (match) return { platform: "youtube", type: "video", id: match[1] };

  return null;
}
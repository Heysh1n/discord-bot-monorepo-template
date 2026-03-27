// Share/modules/APIs/ApisGet.service.ts
// ═══════════════════════════════════════════════════════════
// Главный резолвер: URL → MediaInfo.
// Парсит ссылку, определяет платформу, запрашивает API,
// возвращает унифицированный объект MediaInfo.
// ═══════════════════════════════════════════════════════════

import type { MediaInfo, ParsedUrl } from "./types.js";
import { parseMediaUrl } from "./url-parser.js";
import { TwitchAPI } from "./twitch.api.js";
import { YouTubeAPI } from "./youtube.api.js";

// ─── Реэкспорт для удобства импорта ──────────────────────
export type { MediaInfo, ParsedUrl } from "./types.js";
export type { MediaPlatform, MediaContentType } from "./types.js";
export { parseMediaUrl } from "./url-parser.js";
export { TwitchAPI } from "./twitch.api.js";
export { YouTubeAPI } from "./youtube.api.js";

// ═══════════════════════════════════════════════════════════
// MAIN RESOLVER
// ═══════════════════════════════════════════════════════════

/**
 * Получает полную информацию о медиа-контенте по URL.
 * Возвращает null если URL не распознан или API недоступен.
 */
export async function getMediaInfo(rawUrl: string): Promise<MediaInfo | null> {
  const parsed = parseMediaUrl(rawUrl);
  if (!parsed) return null;

  try {
    if (parsed.platform === "twitch") return await resolveTwitch(parsed, rawUrl);
    if (parsed.platform === "youtube") return await resolveYouTube(parsed, rawUrl);
    return null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// TWITCH RESOLVER
// ═══════════════════════════════════════════════════════════

async function resolveTwitch(
  parsed: ParsedUrl,
  rawUrl: string,
): Promise<MediaInfo | null> {
  switch (parsed.type) {
    // ─── /username (стрим) ──────────────────────────────
    case "stream": {
      const [stream, user] = await Promise.all([
        TwitchAPI.getStream(parsed.id),
        TwitchAPI.getUser(parsed.id),
      ]);

      if (!user) return null;

      return {
        platform: "twitch",
        type: "stream",
        url: rawUrl,
        title: stream?.title ?? user.display_name,
        channelId: user.login,
        channelName: user.display_name,
        channelUrl: `https://www.twitch.tv/${user.login}`,
        channelAvatar: user.profile_image_url,
        thumbnail: stream
          ? stream.thumbnail_url
              .replace("{width}", "440")
              .replace("{height}", "248")
          : null,
        isLive: !!stream,
        viewerCount: stream?.viewer_count ?? null,
        gameName: stream?.game_name ?? null,
      };
    }

    // ─── /username/clip/clipId ──────────────────────────
    case "clip": {
      const [clip, user] = await Promise.all([
        TwitchAPI.getClip(parsed.id),
        parsed.username
          ? TwitchAPI.getUser(parsed.username)
          : Promise.resolve(null),
      ]);

      if (!clip) return null;

      return {
        platform: "twitch",
        type: "clip",
        url: rawUrl,
        title: clip.title,
        channelId: parsed.username ?? "",
        channelName: clip.broadcaster_name ?? user?.display_name ?? "",
        channelUrl: user
          ? `https://www.twitch.tv/${user.login}`
          : "",
        channelAvatar: user?.profile_image_url ?? null,
        thumbnail: clip.thumbnail_url,
        isLive: false,
        viewerCount: null,
        gameName: null,
      };
    }

    // ─── /videos/videoId ────────────────────────────────
    case "video": {
      const video = await TwitchAPI.getVideo(parsed.id);
      if (!video) return null;

      const user = await TwitchAPI.getUser(video.user_login);

      return {
        platform: "twitch",
        type: "video",
        url: rawUrl,
        title: video.title,
        channelId: video.user_login,
        channelName: video.user_name ?? user?.display_name ?? "",
        channelUrl: `https://www.twitch.tv/${video.user_login}`,
        channelAvatar: user?.profile_image_url ?? null,
        thumbnail: video.thumbnail_url
          .replace("%{width}", "440")
          .replace("%{height}", "248"),
        isLive: false,
        viewerCount: null,
        gameName: null,
      };
    }

    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════
// YOUTUBE RESOLVER
// ═══════════════════════════════════════════════════════════

async function resolveYouTube(
  parsed: ParsedUrl,
  rawUrl: string,
): Promise<MediaInfo | null> {
  const video = await YouTubeAPI.getVideo(parsed.id);
  if (!video) return null;

  const channel = await YouTubeAPI.getChannel(video.snippet.channelId);

  const isLive = video.snippet.liveBroadcastContent === "live";

  // Если контент live — перезаписываем тип
  let type = parsed.type;
  if (isLive || video.snippet.liveBroadcastContent === "upcoming") {
    type = "stream";
  }

  const channelUrl = channel?.snippet.customUrl
    ? `https://youtube.com/${channel.snippet.customUrl}`
    : `https://youtube.com/channel/${video.snippet.channelId}`;

  return {
    platform: "youtube",
    type,
    url: rawUrl,
    title: video.snippet.title,
    channelId: video.snippet.channelId,
    channelName: channel?.snippet.title ?? video.snippet.channelTitle,
    channelUrl,
    channelAvatar: channel?.snippet.thumbnails.medium?.url ?? null,
    thumbnail:
      video.snippet.thumbnails.maxres?.url ??
      video.snippet.thumbnails.standard?.url ??
      video.snippet.thumbnails.high?.url ??
      null,
    isLive,
    viewerCount: null,
    gameName: null,
  };
}
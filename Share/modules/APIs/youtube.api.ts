// Share/modules/APIs/youtube.api.ts

interface YTThumbnail {
  url: string;
  width?: number;
  height?: number;
}

interface YTThumbnails {
  default: YTThumbnail;
  medium: YTThumbnail;
  high: YTThumbnail;
  standard?: YTThumbnail;
  maxres?: YTThumbnail;
}

export interface YouTubeVideo {
  id: string;
  snippet: {
    title: string;
    channelId: string;
    channelTitle: string;
    thumbnails: YTThumbnails;
    liveBroadcastContent: "none" | "live" | "upcoming";
    publishedAt: string;
  };
}

export interface YouTubeChannel {
  id: string;
  snippet: {
    title: string;
    customUrl?: string;
    thumbnails: {
      default: YTThumbnail;
      medium: YTThumbnail;
      high: YTThumbnail;
    };
  };
}

export interface YouTubePlaylistItem {
  snippet: {
    resourceId: { videoId: string };
    title: string;
    publishedAt: string;
  };
}

// ═══════════════════════════════════════════════════════════
// API CLASS
// ═══════════════════════════════════════════════════════════

export class YouTubeAPI {
  private static get apiKey(): string {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new Error("YOUTUBE_API_KEY не задан в .env");
    return key;
  }

  // ─── Базовый запрос ─────────────────────────────────────

  private static async request<T>(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<T[]> {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    url.searchParams.set("key", this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString());

    // 404 — ресурс не существует (приватный плейлист, удалённый канал)
    if (res.status === 404) return [];

    // 403 — квота исчерпана или ключ невалиден
    if (res.status === 403) {
      throw new Error(`YouTube API: квота исчерпана или ключ невалиден (403)`);
    }

    if (!res.ok) throw new Error(`YouTube API ${endpoint}: ${res.status}`);

    const json = (await res.json()) as { items?: T[] };
    return json.items ?? [];
  }

  // ─── Публичные методы ───────────────────────────────────

  static async getVideo(videoId: string): Promise<YouTubeVideo | null> {
    const items = await this.request<YouTubeVideo>("videos", {
      part: "snippet",
      id: videoId,
    });
    return items[0] ?? null;
  }

  static async getChannel(channelId: string): Promise<YouTubeChannel | null> {
    const items = await this.request<YouTubeChannel>("channels", {
      part: "snippet",
      id: channelId,
    });
    return items[0] ?? null;
  }

  static async getChannelByHandle(handle: string): Promise<YouTubeChannel | null> {
    const clean = handle.startsWith("@") ? handle : `@${handle}`;
    const items = await this.request<YouTubeChannel>("channels", {
      part: "snippet",
      forHandle: clean,
    });
    return items[0] ?? null;
  }

  /**
   * Последний ролик с канала.
   * Конвертирует UC → UU (uploads playlist).
   * Возвращает null если плейлист приватный или не существует.
   */
  static async getLatestUpload(channelId: string): Promise<YouTubePlaylistItem | null> {
    // Только UC-формат поддерживает конвертацию
    if (!channelId.startsWith("UC")) {
      return null;
    }

    const uploadsId = "UU" + channelId.slice(2);
    const items = await this.request<YouTubePlaylistItem>("playlistItems", {
      part: "snippet",
      playlistId: uploadsId,
      maxResults: "1",
    });
    return items[0] ?? null;
  }

  /**
   * Резолвит username / handle / channelId → UC-формат.
   */
  static async resolveChannelId(input: string): Promise<string | null> {
    // Уже UC-формат
    if (input.startsWith("UC") && input.length === 24) return input;

    // @handle или handle
    const byHandle = await this.getChannelByHandle(input).catch(() => null);
    if (byHandle) return byHandle.id;

    // Legacy username
    const byUser = await this.request<YouTubeChannel>("channels", {
      part: "snippet",
      forUsername: input,
    }).catch(() => []);
    if (byUser[0]) return byUser[0].id;

    return null;
  }

  static isConfigured(): boolean {
    return !!process.env.YOUTUBE_API_KEY;
  }
}
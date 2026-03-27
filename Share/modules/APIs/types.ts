// Share/modules/APIs/types.ts
// ═══════════════════════════════════════════════════════════
// Общие типы для работы с медиа-платформами
// Используется всеми ботами через @share/modules/APIs/
// ═══════════════════════════════════════════════════════════

export type MediaPlatform = "youtube" | "twitch";
export type MediaContentType = "stream" | "video" | "short" | "clip";

/**
 * Результат парсинга URL — определяет платформу, тип и ID.
 * Не содержит данных из API — только из самого URL.
 */
export interface ParsedUrl {
  platform: MediaPlatform;
  type: MediaContentType;
  id: string;
  username?: string;
}

/**
 * Полная информация о медиа-контенте.
 * Заполняется после запроса к API платформы.
 */
export interface MediaInfo {
  platform: MediaPlatform;
  type: MediaContentType;
  url: string;
  title: string;
  channelId: string;
  channelName: string;
  channelUrl: string;
  channelAvatar: string | null;
  thumbnail: string | null;
  isLive: boolean;
  viewerCount: number | null;
  gameName: string | null;
}
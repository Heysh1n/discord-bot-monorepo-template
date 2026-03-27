// Share/modules/APIs/twitch.api.ts
// ═══════════════════════════════════════════════════════════
// Twitch Helix API — универсальный клиент.
// Автоматически получает и кэширует OAuth-токен (client_credentials).
//
// ENV: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
// ═══════════════════════════════════════════════════════════

// ─── Типы ────────────────────────────────────────────────

export interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface TwitchClip {
  id: string;
  title: string;
  thumbnail_url: string;
  broadcaster_name: string;
}

export interface TwitchVideo {
  id: string;
  title: string;
  thumbnail_url: string;
  user_login: string;
  user_name: string;
}

// ─── Кэш токена ──────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

// ═══════════════════════════════════════════════════════════
// API CLASS
// ═══════════════════════════════════════════════════════════

export class TwitchAPI {
  private static tokenCache: TokenCache | null = null;

  /**
   * Флаг: авторизация провалилась.
   * Не спамим запросами если ключи невалидны.
   */
  private static authFailed = false;
  private static authFailedLoggedAt = 0;

  // ─── Env ────────────────────────────────────────────────

  private static get clientId(): string {
    const id = process.env.TWITCH_CLIENT_ID;
    if (!id) throw new Error("TWITCH_CLIENT_ID не задан в .env");
    return id;
  }

  private static get clientSecret(): string {
    const secret = process.env.TWITCH_CLIENT_SECRET;
    if (!secret) throw new Error("TWITCH_CLIENT_SECRET не задан в .env");
    return secret;
  }

  // ─── Авторизация ────────────────────────────────────────

  private static async getToken(): Promise<string> {
    // Если авторизация уже провалилась — не спамим
    if (this.authFailed) {
      throw new Error("Twitch авторизация невалидна. Обновите ключи в .env");
    }

    // Кэш живой
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
    });

    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body,
    });

    if (!res.ok) {
      // 401/403 = ключи невалидны, ставим флаг
      if (res.status === 401 || res.status === 403) {
        this.authFailed = true;
      }
      throw new Error(`Twitch OAuth error: ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.tokenCache = {
      accessToken: data.access_token,
      // Обновляем за 60 сек до истечения
      expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
    };

    // Успех = сброс флага (вдруг ключи обновили)
    this.authFailed = false;

    return this.tokenCache.accessToken;
  }

  // ─── Базовый запрос ─────────────────────────────────────

  private static async request<T>(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<T[]> {
    const token = await this.getToken();
    const url = new URL(`https://api.twitch.tv/helix/${endpoint}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), {
      headers: {
        "Client-Id": this.clientId,
        Authorization: `Bearer ${token}`,
      },
    });

    // 401 = токен протух, сбросим кэш и попробуем ещё раз
    if (res.status === 401) {
      this.tokenCache = null;
      const freshToken = await this.getToken();

      const retry = await fetch(url.toString(), {
        headers: {
          "Client-Id": this.clientId,
          Authorization: `Bearer ${freshToken}`,
        },
      });

      if (!retry.ok) throw new Error(`Twitch API ${endpoint}: ${retry.status}`);
      const json = (await retry.json()) as { data: T[] };
      return json.data ?? [];
    }

    if (!res.ok) throw new Error(`Twitch API ${endpoint}: ${res.status}`);
    const json = (await res.json()) as { data: T[] };
    return json.data ?? [];
  }

  // ─── Публичные методы ───────────────────────────────────

  /** Получить активный стрим. null = оффлайн. */
  static async getStream(username: string): Promise<TwitchStream | null> {
    const data = await this.request<TwitchStream>("streams", {
      user_login: username,
      type: "live",
    });
    return data[0] ?? null;
  }

  static async getUser(login: string): Promise<TwitchUser | null> {
    const data = await this.request<TwitchUser>("users", { login });
    return data[0] ?? null;
  }

  static async getClip(clipId: string): Promise<TwitchClip | null> {
    const data = await this.request<TwitchClip>("clips", { id: clipId });
    return data[0] ?? null;
  }

  static async getVideo(videoId: string): Promise<TwitchVideo | null> {
    const data = await this.request<TwitchVideo>("videos", { id: videoId });
    return data[0] ?? null;
  }

  /** Проверка: env переменные заданы. */
  static isConfigured(): boolean {
    return !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
  }

  /** Проверка: авторизация работает. */
  static get isAuthValid(): boolean {
    return !this.authFailed;
  }

  /** Сбросить флаг ошибки авторизации (после обновления ключей). */
  static resetAuth(): void {
    this.authFailed = false;
    this.tokenCache = null;
  }
}
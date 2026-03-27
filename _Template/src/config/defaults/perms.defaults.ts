// ДЕФОЛТНЫЕ ЗНАЧЕНИЯ — PERMISSIONS CONFIG
// ⚠️ НЕ РЕДАКТИРУЙ ЭТОТ ФАЙЛ — Редактируй cfg.perms.yaml
// ═══════════════════════════════════════════════════════════

import type { AccessLevelName } from "../types/config.types.js";

// ТИПЫ ПЕРМИШЕНОВ
export interface PermissionRule {
  channels: string[];
  roles: string[];
  users: string[];
  categories: string[];
  strict: boolean;
  accessLevel?: AccessLevelName;
  excludeRoles?: string[];
  excludeUsers?: string[];
  excludeLevels?: AccessLevelName[];
}

export interface PermsConfigData {
  /** Порядок иерархии (от высшего к низшему) */
  hierarchyOrder: AccessLevelName[];
  /** Уровни с "старшим" статусом */
  seniorLevels: AccessLevelName[];
  /** Предустановленные группы доступа */
  accessGroups: Record<string, PermissionRule>;
}

// ДЕФОЛТЫ
const wc = (): string[] => ["*"];
export const permsDefaults: PermsConfigData = {
  hierarchyOrder: [
    "owner",
    "management",
    "representative",
    "staff",
    "workers",
  ],

  seniorLevels: ["owner", "management"],

  accessGroups: {
    owner: {
      channels: wc(),
      roles: wc(),
      users: wc(),
      categories: wc(),
      strict: false,
      accessLevel: "owner",
    },

    management: {
      channels: wc(),
      roles: wc(),
      users: wc(),
      categories: wc(),
      strict: false,
      accessLevel: "management",
    },
    // 

    representative: {
      channels: wc(),
      roles: wc(),
      users: wc(),
      categories: wc(),
      strict: false,
      accessLevel: "representative",
    },
    
    staff: {
      channels: wc(),
      roles: wc(),
      users: wc(),
      categories: wc(),
      strict: false,
      accessLevel: "staff",
    },

    workers: {
      channels: wc(),
      roles: wc(),
      users: wc(),
      categories: wc(),
      strict: false,
      accessLevel: "workers",
    },
  },
};
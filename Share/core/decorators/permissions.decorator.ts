// Share/core/decorators/permissions.decorator.ts
// ═══════════════════════════════════════════════════════════
// СИСТЕМА ПРАВ И ИЕРАРХИИ
//
// Для сервисов:
//   getMemberAccessLevel, hasMinimumLevel, isStaff,
//   isSenior, compareHierarchy, canManage
//
// Для команд (декоратор):
//   @UseGuard("staff")
//   @UseGuard({ accessLevel: "staff", channels: [...] })
// ═══════════════════════════════════════════════════════════

import {
  ChatInputCommandInteraction,
  CommandInteraction,
  EmbedBuilder,
  GuildMember,
  TextChannel,
} from 'discord.js';
import { defaultColours } from '../../constants.js';
import { logInfo, logWarn } from '../functions/logSave.function.js';

// ═══════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════

export interface GuardRule {
  channels?: string[];
  roles?: string[];
  users?: string[];
  categories?: string[];
  strict?: boolean;
  accessLevel?: string;
  excludeRoles?: string[];
  excludeUsers?: string[];
  excludeLevels?: string[];
}

export interface PermissionCheckResult {
  allowed: boolean;
  message?: string;
}

export interface PermissionResolver {
  getAccessLevels(): Record<string, readonly string[]>;
  getHierarchyOrder(): string[];
  getDeveloperIds?(): string[];
  getSeniorLevels?(): string[];
  getAccessGroups?(): Record<string, GuardRule>;
}

export type GuardOptions = string | GuardRule;

// ═══════════════════════════════════════════════════════════
// СОСТОЯНИЕ (заполняется через initPermissions)
// ═══════════════════════════════════════════════════════════

let resolver: PermissionResolver | null = null;
let levelLabels: Record<string, string> = {};

// ═══════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ — вызывается ИЗ БОТА, не здесь
// ═══════════════════════════════════════════════════════════

export function initPermissions(r: PermissionResolver): void {
  resolver = r;
  logInfo('PERMS', '✅ Permission resolver инициализирован');
}

export function setLevelLabels(labels: Record<string, string>): void {
  levelLabels = { ...labels };
}

function getResolver(): PermissionResolver {
  if (!resolver)
    throw new Error('[Permissions] Resolver не инициализирован! Вызовите initPermissions()');
  return resolver;
}

// ═══════════════════════════════════════════════════════════
// ПУБЛИЧНЫЕ УТИЛИТЫ ИЕРАРХИИ
// ═══════════════════════════════════════════════════════════

/**
 * Получить наивысший уровень доступа участника
 * @returns "owner" | "management" | "staff" | ... | null
 */
export function getMemberAccessLevel(member: GuildMember): string | null {
  const r = getResolver();
  const levels = r.getAccessLevels();
  for (const level of r.getHierarchyOrder()) {
    const roleIds = levels[level] ?? [];
    if (roleIds.some((id) => member.roles.cache.has(id))) return level;
  }
  return null;
}

/**
 * Индекс уровня в иерархии (0 = самый высокий)
 */
function getLevelIndex(level: string): number {
  const order = getResolver().getHierarchyOrder();
  const idx = order.indexOf(level);
  return idx === -1 ? order.length : idx;
}

/**
 * Проверить, имеет ли участник минимальный уровень
 */
export function hasMinimumLevel(member: GuildMember, requiredLevel: string): boolean {
  const memberLevel = getMemberAccessLevel(member);
  if (!memberLevel) return false;
  return getLevelIndex(memberLevel) <= getLevelIndex(requiredLevel);
}

/**
 * Есть ли у участника ЛЮБОЙ уровень в иерархии
 */
export function isStaff(member: GuildMember): boolean {
  return getMemberAccessLevel(member) !== null;
}

/**
 * Является ли участник "старшим" (использует seniorLevels из конфига)
 */
export function isSenior(member: GuildMember): boolean {
  const r = getResolver();
  const seniorLevels = r.getSeniorLevels?.() ?? [];
  if (seniorLevels.length === 0) return false;

  const level = getMemberAccessLevel(member);
  return level !== null && seniorLevels.includes(level);
}

/**
 * Сравнить двух участников по иерархии
 * @returns < 0 → a ВЫШЕ b, > 0 → a НИЖЕ b, 0 → равны, null → кто-то не в иерархии
 */
export function compareHierarchy(a: GuildMember, b: GuildMember): number {
  const levelA = getMemberAccessLevel(a);
  const levelB = getMemberAccessLevel(b);

  if (!levelA && !levelB) return 0;
  if (!levelA) return 1;
  if (!levelB) return -1;

  return getLevelIndex(levelA) - getLevelIndex(levelB);
}

/**
 * Может ли member управлять target (строго выше по иерархии)
 */
export function canManage(member: GuildMember, target: GuildMember): boolean {
  if (member.id === target.id) return false;

  const memberLevel = getMemberAccessLevel(member);
  if (memberLevel === null) return false;

  const targetLevel = getMemberAccessLevel(target);
  if (targetLevel === null) return true;

  return getLevelIndex(memberLevel) < getLevelIndex(targetLevel);
}

// ═══════════════════════════════════════════════════════════
// ПРИВАТНЫЕ ХЕЛПЕРЫ
// ═══════════════════════════════════════════════════════════

function getLevelLabel(level: string): string {
  return levelLabels[level] || level;
}

function isExcluded(
  member: GuildMember,
  excludeRoles?: string[],
  excludeUsers?: string[],
  excludeLevels?: string[]
): boolean {
  if (excludeUsers?.includes(member.id)) return true;
  if (excludeRoles?.some((roleId) => member.roles.cache.has(roleId))) return true;
  if (excludeLevels) {
    const level = getMemberAccessLevel(member);
    if (level && excludeLevels.includes(level)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// DENY HELPER
// ═══════════════════════════════════════════════════════════

async function denyInteraction(interaction: CommandInteraction, description: string): Promise<any> {
  const errorColor = defaultColours?.errorEmbed ?? 0xff6b6b;

  const embed = new EmbedBuilder()
    .setTitle('❌ Ошибка доступа')
    .setDescription(description)
    .setColor(errorColor)
    .setTimestamp();

  const replyOptions: any = {
    embeds: [embed],
    flags: 64,
  };

  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(replyOptions);
    }
    return await interaction.reply(replyOptions);
  } catch (error: any) {
    if (error.code !== 10062) logWarn('PERMS', `Не удалось отправить deny: ${error}`);
  }
}

// ═══════════════════════════════════════════════════════════
// ПОЛНАЯ ПРОВЕРКА
// ═══════════════════════════════════════════════════════════

function checkFullPermission(
  interaction: CommandInteraction,
  rule: GuardRule
): PermissionCheckResult {
  const member = interaction.member as GuildMember;
  const res = getResolver();

  // ── 1. Разработчики — абсолютный доступ ──
  if (res.getDeveloperIds?.().includes(interaction.user.id)) {
    return { allowed: true };
  }

  // ── 2. Исключения (чёрный список) ──
  if (isExcluded(member, rule.excludeRoles, rule.excludeUsers, rule.excludeLevels)) {
    return { allowed: false, message: 'У вас нет доступа к этой команде.' };
  }

  // ── 3. Каналы ──
  const channels = rule.channels ?? ['*'];
  if (!channels.includes('*')) {
    if (!channels.includes(interaction.channelId)) {
      const mentions = channels.map((id) => `<#${id}>`).join(', ');
      return {
        allowed: false,
        message: `Эта команда доступна только в каналах: ${mentions}`,
      };
    }
  }

  // ── 4. Категории ──
  const categories = rule.categories ?? ['*'];
  if (!categories.includes('*')) {
    const channel = interaction.channel;
    const parentId = channel && 'parentId' in channel ? (channel as TextChannel).parentId : null;

    if (!parentId || !categories.includes(parentId)) {
      return {
        allowed: false,
        message: 'Эта команда недоступна в данной категории каналов.',
      };
    }
  }

  // ── 5. Права: strict vs non-strict ──
  if (rule.strict) {
    return checkStrictPermissions(member, interaction.user.id, rule);
  }
  return checkDefaultPermissions(member, interaction.user.id, rule);
}

/**
 * strict: true — ВСЕ условия должны пройти (AND)
 */
function checkStrictPermissions(
  member: GuildMember,
  userId: string,
  rule: GuardRule
): PermissionCheckResult {
  if (rule.accessLevel) {
    if (!hasMinimumLevel(member, rule.accessLevel)) {
      return {
        allowed: false,
        message: `Эта команда доступна только **${getLevelLabel(rule.accessLevel)}** и выше.`,
      };
    }
  }

  const roles = rule.roles;
  if (roles && !roles.includes('*')) {
    if (!member.roles.cache.some((r) => roles.includes(r.id))) {
      return {
        allowed: false,
        message: 'Вы не можете использовать команду из-за недостатка прав.',
      };
    }
  }

  const users = rule.users;
  if (users && !users.includes('*')) {
    if (!users.includes(userId)) {
      return { allowed: false, message: 'У вас недостаточно прав!' };
    }
  }

  return { allowed: true };
}

/**
 * strict: false (default) — accessLevel заменяет roles
 */
function checkDefaultPermissions(
  member: GuildMember,
  userId: string,
  rule: GuardRule
): PermissionCheckResult {
  let hasAccess = false;
  const roles = rule.roles ?? [];
  const hasPermsRoles = roles.length > 0 && !roles.includes('*');

  if (hasPermsRoles) {
    // Приоритет: проверяем roles из cfg.perms.yaml
    if (member.roles.cache.some((r) => roles.includes(r.id))) {
      hasAccess = true;
    }
  } else if (rule.accessLevel) {
    // Fallback: roles пустые или ["*"] → проверяем уровень через cfg.main.yaml
    if (hasMinimumLevel(member, rule.accessLevel)) {
      hasAccess = true;
    }
  } else {
    // Нет ни roles ни accessLevel → пропускаем
    hasAccess = true;
  }

  if (!hasAccess) {
    const label = rule.accessLevel ? getLevelLabel(rule.accessLevel) : 'указанным ролям';
    return {
      allowed: false,
      message: `Эта команда доступна только **${label}** и выше.`,
    };
  }

  // Проверка users
  const users = rule.users ?? ['*'];
  if (!users.includes('*') && !users.includes(userId)) {
    return { allowed: false, message: 'У вас недостаточно прав!' };
  }

  return { allowed: true };
}

// ═══════════════════════════════════════════════════════════
// ДЕКОРАТОР @UseGuard
// ═══════════════════════════════════════════════════════════

export function UseGuard(options: GuardOptions) {
  return function <T extends (...args: any[]) => any>(
    target: T,
    context: ClassMethodDecoratorContext<any, T>
  ): T {
    const wrapper = async function (this: any, ...args: any[]) {
      const interaction = args[0] as ChatInputCommandInteraction;

      if (!resolver) {
        logWarn('PERMS', '⚠️ Resolver не инициализирован, пропускаю проверку');
        return await target.apply(this, args);
      }

      if (!interaction.guild || !interaction.member) {
        return await target.apply(this, args);
      }

      let rule: GuardRule;
      if (typeof options === 'string') {
        const groups = resolver.getAccessGroups?.();
        rule = groups?.[options] ?? { accessLevel: options };
      } else {
        // Если передан объект С accessLevel — мержим с perms.yaml
        if (options.accessLevel) {
          const groups = resolver.getAccessGroups?.();
          const permsRule = groups?.[options.accessLevel];
          if (permsRule) {
            // perms.yaml — база, переданный объект — оверрайды
            rule = { ...permsRule, ...options };
          } else {
            rule = options;
          }
        } else {
          rule = options;
        }
      }

      const result = checkFullPermission(interaction, rule);

      if (!result.allowed) {
        return await denyInteraction(interaction, result.message!);
      }

      return await target.apply(this, args);
    } as T;

    return wrapper;
  };
}

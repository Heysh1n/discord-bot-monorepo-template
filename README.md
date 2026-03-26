# Syndicate-Bots

> Monorepo ecosystem for Discord bots built with **discord.js v14**, **TypeScript**, and a shared core library.

---

## Architecture Overview

```
Syndicate-Bots/
├── Share/                  # Shared core library (used by ALL bots)
│   ├── base.ts             # Global types & discord.js augmentation
│   ├── constants.ts        # Paths, tokens, colors, time units
│   ├── core/               # Framework internals
│   │   ├── database/       # DB abstractions (LocalJSON, PostgreSQL, MongoDB sync)
│   │   ├── decorators/     # @UseGuard, @logger
│   │   ├── functions/      # Logging, error handling
│   │   └── structure/      # Abstract classes for commands, components, events
│   └── modules/            # Reusable modules
│       ├── APIs/           # External API integrations (TikTok, Twitch, YouTube)
│       ├── activity/       # Voice & message activity tracking
│       ├── configs/        # YAML config system (read, validate, hot-reload)
│       └── utils/          # Helpers (channels, buttons, etc.)
│
├── _Template/              # Bot template — clone this to create a new bot
│   ├── data/
│   │   ├── configs/        # YAML config files (auto-generated from defaults)
│   │   ├── logs/           # Runtime logs + archive (.gz)
│   │   ├── activity/       # Activity tracking data
│   │   ├── cache/          # Local cache
│   │   └── database/       # Local JSON databases
│   └── src/
│       ├── config/         # Bot-specific config (defaults, types, transforms)
│       ├── events/         # Discord events + collectors + services
│       ├── interactions/   # Slash commands & components (buttons, modals, menus)
│       └── models/         # Database models (extend LocalDBBase)
│
└── [YourBot]/              # Your bot (same structure as _Template)
```

---

## Key Systems

### 1. Path System (`BotPaths`)

Every bot resolves its paths through `BotPaths`, initialized once in `index.ts`:

```ts
import { initBotPaths } from "@share/constants.js";
const paths = initBotPaths("MyBot"); // Sets up all paths for this bot
```

Available paths: `root`, `data`, `configs`, `logs`, `archive`, `crashes`, `cache`, `localDB`, `activity`, `src`.

### 2. Config System (YAML + Hot-Reload)

Three config files per bot:

| File | Purpose |
|------|---------|
| `cfg.main.yaml` | Server IDs, roles, channels, timings, database settings |
| `cfg.logs.yaml` | Logging levels, categories, error handler, presets |
| `cfg.perms.yaml` | Permission hierarchy, access groups |

**Flow:** Defaults (TS) → Generate YAML (if missing) → Read YAML → Merge with defaults → Validate → Proxy export.

All config exports are **lazy proxies** — they don't read until first property access, solving the init-order problem.

```ts
import { ServerData, RolesData, logsSettings } from "./config/config";
// These are proxies — safe to import before initBotPaths()
// Actual read happens on first access: ServerData.guild.id
```

**Env substitution** in YAML: `${VAR_NAME:default_value}`

### 3. Permission System (Hierarchical)

Defined in `cfg.perms.yaml`. Order matters (index 0 = highest):

```yaml
hierarchyOrder: [owner, management, representative, staff, workers]
seniorLevels: [owner, management]
```

Roles are mapped to levels in `cfg.main.yaml` → `server.roles`.

**Usage in commands:**

```ts
// Decorator — blocks execution if member doesn't meet the level
@UseGuard("management")
async execute(interaction) { ... }

// Programmatic check
import { hasMinimumLevel, canManage, getMemberAccessLevel } from "@share/core/decorators/permissions.decorator";

if (hasMinimumLevel(member, "staff")) { /* ... */ }
if (canManage(executor, target)) { /* executor is strictly above target */ }
```

### 4. Database (Local JSON)

Extend `LocalDBBase<T>` and implement 3 methods:

```ts
class MyDB extends LocalDBBase<MyData> {
  constructor() {
    super("MY_DB", { fileName: "my-data.json", directory: "" });
  }
  protected validateItem(data: unknown): data is MyData { /* type guard */ }
  protected repairItem(data: Partial<MyData>, id: string): MyData { /* fix broken */ }
  protected createDefault(id: string): MyData { /* new record */ }
}
```

Built-in: CRUD, `find()`, `topBy()`, debounced save, backup on corruption, deep merge updates.

### 5. Database (PostgreSQL)

Extend `PostgresModel<T>`:

```ts
class UsersModel extends PostgresModel<User> {
  constructor() { super("USERS", "users", "id"); }
  protected fromRow(row): User { /* DB row → object */ }
  protected toRow(data): Record<string, unknown> { /* object → DB row */ }
}
```

Built-in: `findById`, `findAll`, `insert`, `update`, `upsert`, `deleteById`, `count`, `exists`, `transaction`.

### 6. Activity Tracking

Tracks voice time and messages per user per guild. Singleton:

```ts
// In ready.ts:
ActivityManager.init({ ignoreBots: true, minSessionSec: 60 });
ActivityManager.getInstance().start();

// In voiceStateUpdate.ts:
ActivityManager.getInstance().handleVoiceStateUpdate(oldState, newState);

// In messageCreate.ts:
ActivityManager.getInstance().handleMessage(message);

// Query:
const totalVoice = manager.getTotalVoiceTime(guildId, userId); // seconds
const totalMsgs = manager.getTotalMessages(guildId, userId);
```

### 7. Dynamic Button Builder

Buttons are defined with optional visibility conditions. The builder filters by permissions and auto-chunks into rows of 5:

```ts
import { ButtonManager, DynamicButton } from "@share/modules/utils/button.manager";

const buttons: DynamicButton[] = [
  {
    id: "mute",
    builder: new ButtonBuilder().setCustomId("mute").setLabel("Mute").setStyle(ButtonStyle.Secondary),
    condition: (member) => hasMinimumLevel(member, "staff"),
  },
  {
    id: "ban",
    builder: new ButtonBuilder().setCustomId("ban").setLabel("Ban").setStyle(ButtonStyle.Danger),
    condition: (member) => hasMinimumLevel(member, "management"),
  },
];

const rows = ButtonManager.buildRows(buttons, interaction.member as GuildMember);
await interaction.reply({ components: rows });
// Staff sees 1 button (mute). Management sees 2 (mute + ban). Auto-arranged.
```

### 8. Logging

Works without initialization (console only). Call `initLogSave()` to enable file logging with rotation and archiving.

```ts
import { logInfo, logError, logWarn, logSuccess, logDebug } from "@share/core/functions/logSave.function";

logInfo("TAG", "message");        // White
logError("TAG", "message");       // Red
logWarn("TAG", "message");        // Yellow
logSuccess("TAG", "message");     // Green
logDebug("TAG", "message");       // Magenta
```

Categories can be toggled in `cfg.logs.yaml` → `categories`. Levels: `DEBUG < INFO < WARN < ERROR < SILENT`.

### 9. Error Handler

Global error catcher that logs to console, saves crash files, and sends embeds to a Discord channel:

```ts
// In index.ts (before client.login):
setupGlobalErrorHandler(() => ({ botName: "MyBot", errorChannelId: "...", ... }));

// In ready.ts:
setErrorHandlerClient(client);
```

Ignores common Discord API errors (rate limits, unknown interactions, etc.) via configurable patterns.

---

## Creating a New Bot

1. Copy `_Template/` → `MyBot/`
2. Update `tsconfig.json` paths
3. In `index.ts`, change: `initBotPaths("MyBot")`
4. Set `TOKEN` in `.env`
5. Edit YAML configs in `MyBot/data/configs/`
6. Add commands in `MyBot/src/interactions/`
7. Add models in `MyBot/src/models/`

---

## File Naming Conventions

| Pattern | Location | Example |
|---------|----------|---------|
| `*.command.ts` | `src/interactions/` | `ping.command.ts` |
| `*.components.ts` | `src/interactions/` | `confirm.components.ts` |
| `*.service.ts` | `src/interactions/` or `src/events/services/` | `ping.service.ts` |
| `*.embeds.ts` | `src/interactions/` | `dev.embeds.ts` |
| `*.event.ts` | `src/events/client/` | `ready.event.ts` |
| `*.model.ts` | `src/models/` | `staff.model.ts` |
| `*.defaults.ts` | `src/config/defaults/` | `main.defaults.ts` |

---

## Boot Sequence

```
index.ts
  1. dotenv.config()
  2. initBotPaths("BotName")        ← paths ready
  3. getConfigManagerInstance()      ← configs loaded (lazy)
  4. initLogSave(logsSettings)      ← file logging on
  5. setupGlobalErrorHandler(...)   ← crash protection
  6. new Client(...) + collections
  7. EventCollector.collect()       ← loads *.event.ts
  8. client.login(token)

ready.event.ts (fires after login)
  1. setupErrorHandler()            ← binds client to error handler
  2. setupActivityManager()         ← voice/message tracking
  3. registerCommands()             ← loads *.command.ts + *.component.ts, registers slash commands
  4. initPermissions(...)           ← permission resolver ready
  5. setBotStatus()                 ← presence
  6. initShutdown(client)           ← graceful shutdown handlers
```

---

## Import Aliases

Defined in `tsconfig.json`:

```json
{
  "@share/*": ["Share/*"],
  "@config/*": ["_Template/src/config/*"]
}
```

Usage: `import { logInfo } from "@share/core/functions/logSave.function"`

---

## Tech Stack


- **Runtime:** 

    ![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)  

- **Language:** 

    ![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)

- **Discord:** 
    
    ![DiscordJS](https://img.shields.io/badge/Discord.js-5865F2?style=for-the-badge&logo=discord.js&logoColor=white)  

- **Config:** 
    
    ![YAML](https://img.shields.io/badge/yaml-F19326?style=for-the-badge&logo=yaml&logoColor=white)

- **Local DB:**

    ![JSON](https://img.shields.io/badge/json-080808?style=for-the-badge&logo=json&logoColor=white)

- **SQL DB:**
- 
    ![PostgreSQL](https://img.shields.io/badge/postgresql-007CF7?style=for-the-badge&logo=postgresql&logoColor=white)


- **Sync DB:**

    ![PRISMA](https://img.shields.io/badge/PRISMA-0A3A53?style=for-the-badge&logo=PRISMA&logoColor=white)  

- **Logging:**

    ![CUSTOM](https://img.shields.io/badge/CUSTOM-F4C?style=for-the-badge&logo=CUSTOM&logoColor=white)  

Made with ❤️ by Heysh1n





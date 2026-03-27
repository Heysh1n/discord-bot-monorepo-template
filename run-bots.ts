#!/usr/bin/env node
import { spawn } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";

const [,, action = "dev", botName] = process.argv;

const rootDir = process.cwd();
const availableBots = readdirSync(rootDir).filter(dir => {
  const fullPath = path.join(rootDir, dir);
  return statSync(fullPath).isDirectory() 
      && !['node_modules', 'Share', '.git', 'dist'].includes(dir)
      && existsSync(path.join(fullPath, 'tsconfig.json'));
});

if (!botName || !availableBots.includes(botName)) {
  console.error("\x1b[31m✖ Укажи правильного бота!\x1b[0m");
  console.log("\x1b[33mПример: npm run watch _Template\x1b[0m");
  console.log(`\n\x1b[36mДоступные боты:\x1b[0m ${availableBots.length > 0 ? availableBots.join(", ") : "Не найдено ни одной валидной папки бота"}`);
  process.exit(1);
}

const botDir = path.join(rootDir, botName);
const botTsconfig = path.join(botDir, "tsconfig.json");
const botSrc = existsSync(path.join(botDir, "src", "index.ts")) 
    ? path.join(botDir, "src", "index.ts") 
    : path.join(botDir, "index.ts");

if (!existsSync(botSrc)) {
  console.error(`\x1b[31m✖ Точка входа (index.ts) не найдена для "${botName}"!\x1b[0m`);
  process.exit(1);
}

console.log(`\x1b[36m🚀 Запуск режима [${action}] для бота: ${botName}\x1b[0m\n`);

let command = "npx";
let args: string[] = [];
let extraEnv: Record<string, string> = {};

switch (action) {
  case "dev":
    args = ["tsx", botSrc];
    break;

  case "watch":
    args = ["tsx", "watch", botSrc];
    break;

  // ── BUILD: tsc + tsc-alias для перезаписи path-алиасов ──
  case "build": {
    const child = spawn("npx", ["tsc", "-p", botTsconfig], {
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        console.error("\x1b[31m✖ tsc завершился с ошибкой\x1b[0m");
        process.exit(code ?? 1);
      }

      console.log("\x1b[36m🔄 Перезапись path-алиасов (tsc-alias)...\x1b[0m");
      const alias = spawn("npx", ["tsc-alias", "-p", botTsconfig], {
        stdio: "inherit",
        shell: true,
      });

      alias.on("exit", (aliasCode) => {
        if (aliasCode === 0) {
          console.log("\x1b[32m✔ Сборка завершена успешно\x1b[0m");
        } else {
          console.error("\x1b[31m✖ tsc-alias завершился с ошибкой\x1b[0m");
        }
        process.exit(aliasCode ?? 0);
      });
    });

    // build обрабатывает exit сам — выходим из switch/скрипта
    break;
  }

  // ── PROD: node с tsconfig-paths (запасной вариант если не делали build) ──
  case "start":
  case "prod": {
    command = "node";
    const entryJs = path.join(rootDir, "dist", botName, "src", "index.js");

    if (!existsSync(entryJs)) {
      console.error(`\x1b[31m✖ Скомпилированный файл не найден: ${entryJs}\x1b[0m`);
      console.log("\x1b[33mСначала выполни: npm run build " + botName + "\x1b[0m");
      process.exit(1);
    }

    args = [
      "-r", "tsconfig-paths/register",
      entryJs,
    ];

    // tsconfig-paths нужно знать, где лежит tsconfig
    extraEnv = {
      TS_NODE_PROJECT: botTsconfig,
    };
    break;
  }

  default:
    console.error(`\x1b[31m✖ Неизвестная команда: ${action}\x1b[0m`);
    process.exit(1);
}

// Для build мы уже spawned выше — не дублируем
if (action !== "build") {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      ...extraEnv,
      NODE_ENV: action === "dev" || action === "watch" ? "development" : "production",
    },
  });

  child.on("exit", code => process.exit(code ?? 0));
}
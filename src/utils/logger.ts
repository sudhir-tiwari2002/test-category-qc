import chalk from "chalk";

type Level = "info" | "warn" | "error" | "ok" | "step";

function ts(): string {
  return new Date().toISOString().split("T")[1].replace("Z", "");
}

export const log = {
  info: (msg: string) => console.log(chalk.gray(`[${ts()}]`), msg),
  step: (msg: string) => console.log(chalk.cyan(`[${ts()}] ▸`), chalk.cyan(msg)),
  ok: (msg: string) => console.log(chalk.green(`[${ts()}] ✓`), msg),
  warn: (msg: string) => console.log(chalk.yellow(`[${ts()}] ⚠`), msg),
  error: (msg: string) => console.error(chalk.red(`[${ts()}] ✗`), msg),
  raw: (msg: string) => console.log(msg),
};

export function lvl(level: Level, msg: string): void {
  log[level === "info" ? "info" : level === "warn" ? "warn" : level === "error" ? "error" : level === "ok" ? "ok" : "step"](msg);
}

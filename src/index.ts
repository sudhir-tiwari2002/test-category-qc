import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { attachToChrome } from "./browser.js";
import { runQcSession, smokeCheckSelectors } from "./runner.js";
import { writeExcelReport } from "./report/excelReporter.js";
import { writeHtmlReport } from "./report/htmlReporter.js";
import type { Language } from "./types.js";
import { log } from "./utils/logger.js";

const program = new Command();
program
  .name("qc")
  .description("Automated QC for a PhysicsWallah admin test category preview (Hindi + English).")
  .option("--cdp-port <n>", "Chrome remote debugging port", String(process.env.CDP_PORT ?? "9333"))
  .option("--category-url <url>", "Tab URL to attach to (substring match)", process.env.CATEGORY_URL)
  .option("--languages <list>", "Comma separated languages (en,hi)", process.env.LANGUAGES ?? "en,hi")
  .option("--output-dir <dir>", "Where to write the report", process.env.OUTPUT_DIR ?? "./reports")
  .option("--max-questions <n>", "Cap question count per language (0 = all)", String(process.env.MAX_QUESTIONS ?? "0"))
  .option("--slow-mo-ms <n>", "Slow Playwright actions by N ms", String(process.env.SLOW_MO_MS ?? "0"))
  .option("--skip-smoke", "Skip the selector smoke test (only after calibration is stable)")
  .option("--no-ocr", "Disable OCR on solution images (faster, but image-only solutions become WARN instead of FAIL)")
  .parse(process.argv);

const opts = program.opts<{
  cdpPort: string;
  categoryUrl?: string;
  languages: string;
  outputDir: string;
  maxQuestions: string;
  slowMoMs: string;
  skipSmoke?: boolean;
  ocr?: boolean;
}>();

const languages = opts.languages.split(",").map((l) => l.trim().toLowerCase()) as Language[];
const outputDir = path.resolve(opts.outputDir);
const cdpPort = Number(opts.cdpPort);
const maxQuestions = Number(opts.maxQuestions);
const slowMoMs = Number(opts.slowMoMs);

await fs.mkdir(outputDir, { recursive: true });

const session = await attachToChrome({ cdpPort, categoryUrl: opts.categoryUrl, slowMoMs });

try {
  if (!opts.skipSmoke) {
    log.step("Running selector smoke test on the current preview page...");
    await smokeCheckSelectors(session.page);
    log.ok("Selector smoke test passed.");
  }

  const reports = await runQcSession(session.page, {
    languages,
    outputDir,
    maxQuestions: maxQuestions || undefined,
    enableOcr: opts.ocr !== false,
  });

  const xlsxPath = await writeExcelReport(reports, outputDir);
  const htmlPath = await writeHtmlReport(reports, outputDir);
  log.ok(`Excel report: ${xlsxPath}`);
  log.ok(`HTML report:  ${htmlPath}`);

  const totalFail = reports.filter((r) => r.failed).length;
  log.info(`Done. ${reports.length} question-passes, ${totalFail} with at least one failure.`);
} finally {
  await session.disconnect();
}

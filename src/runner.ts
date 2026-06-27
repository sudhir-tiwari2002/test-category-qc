import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { selectors } from "../config/selectors.js";
import { processAllQuestionCards, scrollToTop, switchLanguage } from "./navigate.js";
import { extractFromCard } from "./extract/previewExtractor.js";
import { runAllChecks } from "./checks/index.js";
import type { Language, QuestionReport, QuestionSnapshot } from "./types.js";
import { log } from "./utils/logger.js";
import { disposeOcr } from "./utils/ocr.js";

export interface RunOptions {
  languages: Language[];
  outputDir: string;
  maxQuestions?: number;
  enableOcr: boolean;
}

/**
 * QC one full pass:
 *   for each language:
 *     switch language → scroll top → walk every card → extract → run checks → snap
 *
 * We snapshot the EN pass into `englishById` so the HI pass can use it for
 * "is the Hindi just a copy of English?" detection.
 */
export async function runQcSession(page: Page, opts: RunOptions): Promise<QuestionReport[]> {
  const englishById = new Map<string, QuestionSnapshot>();
  const reports: QuestionReport[] = [];

  for (const lang of opts.languages) {
    log.step(`──── Language pass: ${lang.toUpperCase()} ────`);
    await switchLanguage(page, lang);
    await scrollToTop(page);
    await page.waitForTimeout(500);

    await processAllQuestionCards(
      page,
      async ({ id, card }, index) => {
        try {
          const snapshot = await extractFromCard(page, card, id, lang, { enableOcr: opts.enableOcr });
          if (lang === "en") englishById.set(id, snapshot);

          const screenshotPath = path.join(opts.outputDir, "shots", `${safeFs(id)}-${lang}.png`);
          await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
          await card
            .screenshot({ path: screenshotPath, animations: "disabled" })
            .catch(() => undefined);

          const checks = await runAllChecks({
            snapshot,
            card,
            page,
            language: lang,
            englishSnapshot: englishById.get(id),
          });

          const failed = checks.some((c) => c.status === "fail");
          const correctLabel = snapshot.options.find((o) => o.isCorrect)?.label;
          reports.push({
            questionId: id,
            language: lang,
            index,
            checks,
            screenshotPath,
            failed,
            solutionPreview: snapshot.solutionText.replace(/\s+/g, " ").slice(0, 600),
            correctLabel,
          });

          (failed ? log.error : log.ok)(
            `Q#${index} [${id}] ${lang} — ${checks.filter((c) => c.status === "fail").length} fail(s)`,
          );
        } catch (err) {
          log.error(`Q#${index} [${id}] crashed: ${(err as Error).message}`);
          reports.push({
            questionId: id,
            language: lang,
            index,
            failed: true,
            checks: [
              {
                id: "missing_field",
                status: "fail",
                message: `Extraction crash: ${(err as Error).message}`,
              },
            ],
          });
        }
      },
      { maxQuestions: opts.maxQuestions },
    );
  }

  await disposeOcr();
  return reports;
}

/** Cheap smoke check before doing any real work. */
export async function smokeCheckSelectors(page: Page): Promise<void> {
  const checks: Array<[string, string]> = [
    ["preview.questionCard", selectors.preview.questionCard],
    ["preview.optionItem", selectors.preview.optionItem],
    ["preview.solutionBody", selectors.preview.solutionBody],
  ];
  const failed: string[] = [];
  for (const [name, sel] of checks) {
    const count = await page.locator(sel).count();
    if (count === 0) failed.push(`${name} (selector="${sel}")`);
  }
  if (failed.length) {
    throw new Error(
      `Selector smoke check failed for:\n  - ${failed.join("\n  - ")}\n` +
        `Open config/selectors.ts, inspect the preview page in DevTools, and update the selectors.`,
    );
  }
}

function safeFs(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
}

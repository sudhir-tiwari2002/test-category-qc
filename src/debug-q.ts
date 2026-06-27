/**
 * Debug helper: dump everything the extractor sees for one or more question
 * numbers in one language. Helps diagnose OCR / selector mismatches.
 *
 *   npx tsx src/debug-q.ts --questions 5,17,18 --language hi
 */
import { Command } from "commander";
import "dotenv/config";
import { attachToChrome } from "./browser.js";
import { extractFromCard } from "./extract/previewExtractor.js";
import { processAllQuestionCards, switchLanguage } from "./navigate.js";
import type { Language } from "./types.js";
import { log } from "./utils/logger.js";
import { disposeOcr, ocrImageUrls } from "./utils/ocr.js";

interface CliOpts {
  cdpPort: string;
  questions: string;
  language: string;
}

async function main() {
  const cli = new Command()
    .option("--cdp-port <port>", "Chrome CDP port", process.env.CDP_PORT || "9333")
    .allowUnknownOption()
    .option("--questions <list>", "Comma list of Q numbers", "5,17,18")
    .option("--language <lang>", "Language code (en or hi)", "hi")
    .parse(process.argv);

  const opts = cli.opts<CliOpts>();
  const targets = new Set(opts.questions.split(",").map((s) => s.trim()));
  const language = opts.language as Language;

  const { context, page } = await attachToChrome({ cdpPort: Number(opts.cdpPort) });
  try {
    await switchLanguage(page, language);

    await processAllQuestionCards(page, async ({ card, id }) => {
      if (!targets.has(id)) return;
      log.step(`=== Q${id} (${language}) ===`);
      const snap = await extractFromCard(page, card, id, language, { enableOcr: true });

      console.log("questionText:", snap.questionText.slice(0, 200));
      console.log("options:");
      for (const o of snap.options) {
        console.log(
          `  [${o.index}] label=${JSON.stringify(o.label)} correct=${o.isCorrect} text=${o.text.slice(0, 80)}`,
        );
      }
      console.log("correctIndices:", snap.correctIndices);
      console.log("solutionImageUrls:", snap.solutionImageUrls);
      console.log("solutionText (post-strip, first 800 chars):");
      console.log(snap.solutionText.slice(0, 800));
      console.log("---");

      if (snap.solutionImageUrls.length) {
        log.step(`raw OCR of solution images for Q${id}`);
        for (const url of snap.solutionImageUrls) {
          const raw = await ocrImageUrls([url], page);
          console.log("  url:", url);
          console.log("  OCR:", raw.slice(0, 400));
        }
      }
      console.log();
    });
  } finally {
    await disposeOcr();
    await context.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

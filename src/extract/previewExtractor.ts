import type { Locator, Page } from "playwright";
import { selectors } from "../../config/selectors.js";
import type { Language, Option, QuestionSnapshot } from "../types.js";
import { log } from "../utils/logger.js";
import { ocrImageUrls } from "../utils/ocr.js";
import { waitForImages } from "../utils/overflow.js";

const FALLBACK_LABELS = ["A", "B", "C", "D", "E", "F"];

const PLACEHOLDER_NOTICE_RE = /\b(?:video\s+)?solution\s+not\s+available\s+for\s+\S+/gi;

export interface ExtractOptions {
  /** When true, OCR is run on solution images that lack meaningful DOM text. */
  enableOcr: boolean;
}

/**
 * Extract a single question card. Caller has already scrolled it into view.
 * Returns the snapshot plus the card Locator (handy for downstream overflow
 * checks + screenshotting).
 */
export async function extractFromCard(
  page: Page,
  card: Locator,
  id: string,
  language: Language,
  opts: ExtractOptions = { enableOcr: true },
): Promise<QuestionSnapshot> {
  await waitForImages(page, card, 4000).catch(() => undefined);

  if (selectors.preview.solutionToggle) {
    const toggle = card.locator(selectors.preview.solutionToggle).first();
    if ((await toggle.count()) > 0 && (await toggle.isVisible().catch(() => false))) {
      await toggle.click().catch(() => undefined);
      await page.waitForTimeout(200);
    }
  }

  const questionText = stripLabel(
    await safeText(card.locator(selectors.preview.questionBody).first()),
    /^(?:question|प्रश्न|प्रशन)\s*[:.\-]?\s*/i,
  );

  // DOM-side: strip ONLY the literal "Solution" / "Answer" header that the
  // PW preview UI renders as a sibling text node. Do NOT strip "उत्तर" or
  // "व्याख्या" — when those words appear they're content (the author's
  // explicit answer declaration), and the QC checks rely on seeing them.
  const SOLUTION_HEADER_RE = /^(?:solution|answer|समाधान|हल)\s*[:.\-]?\s*/i;
  const questionImageUrls = await imagesIn(card.locator(selectors.preview.questionBody).first());

  const options: Option[] = [];
  const optionEls = card.locator(selectors.preview.optionItem);
  const count = await optionEls.count();
  for (let i = 0; i < count; i++) {
    const opt = optionEls.nth(i);

    let label = "";
    if (selectors.preview.optionLabel) {
      const labelLoc = opt.locator(selectors.preview.optionLabel).first();
      if ((await labelLoc.count()) > 0) {
        label = (await safeText(labelLoc)).replace(/[\s.\u0964)\]]+$/, "").trim();
      }
    }
    if (!label) label = FALLBACK_LABELS[i] ?? String(i + 1);

    const text = await safeText(opt.locator(selectors.preview.optionText).first(), opt);
    const imageUrls = await imagesIn(opt);
    const isCorrect = await isOptionCorrect(opt);

    options.push({ index: i, label, text, imageUrls, isCorrect });
  }

  const solutionLoc = card.locator(selectors.preview.solutionBody).first();
  const rawSolutionText = await safeText(solutionLoc);
  const domSolutionText = stripPlaceholderNotice(stripLabel(rawSolutionText, SOLUTION_HEADER_RE));
  const solutionImageUrls = await imagesIn(solutionLoc);

  // PW renders many solutions as PNG screenshots. When the DOM text is empty
  // or a "Video Solution not available" notice, OCR the image(s) so the
  // downstream checks can read what's actually shown to the student.
  //
  // CRITICAL: do NOT stripLabel the OCR text — it would remove the very
  // "उत्तर:" / "Answer:" prefix the answer-naming check is looking for.
  let solutionText = domSolutionText;
  if (opts.enableOcr && !isMeaningful(domSolutionText) && solutionImageUrls.length > 0) {
    const ocrText = stripPlaceholderNotice(await ocrImageUrls(solutionImageUrls, page));
    if (ocrText) solutionText = ocrText;
  } else if (opts.enableOcr && solutionImageUrls.length > 0 && !looksLikeAnswerStatement(domSolutionText)) {
    const ocrText = stripPlaceholderNotice(await ocrImageUrls(solutionImageUrls, page));
    if (ocrText) solutionText = `${domSolutionText}\n${ocrText}`.trim();
  }

  return {
    id,
    language,
    questionText,
    questionImageUrls,
    options,
    correctIndices: options.filter((o) => o.isCorrect).map((o) => o.index),
    solutionText,
    solutionImageUrls,
  };
}

async function isOptionCorrect(opt: Locator): Promise<boolean> {
  const direct = await opt.locator(selectors.preview.correctOptionMarker).count();
  if (direct > 0) return true;
  return opt
    .evaluate((el, markerSel: string) => {
      const e = el as HTMLElement;
      const cls = (e.className || "").toString().toLowerCase();
      if (cls.includes("correct") || cls.includes("right") || cls.includes("is-answer")) return true;
      if (e.getAttribute("data-correct") === "true") return true;
      if (e.matches(markerSel)) return true;
      return false;
    }, selectors.preview.correctOptionMarker)
    .catch(() => false);
}

function stripLabel(text: string, labelRe: RegExp): string {
  return text.replace(labelRe, "").trim();
}

/** Remove "Video Solution not available for English/Hindi/..." notices. */
function stripPlaceholderNotice(text: string): string {
  return text.replace(PLACEHOLDER_NOTICE_RE, "").replace(/\s+/g, " ").trim();
}

function isMeaningful(text: string): boolean {
  return text.replace(/\s+/g, "").length >= 8;
}

/** Cheap heuristic: text mentions "answer" / "उत्तर" / "विकल्प" / "Option X" / "(X)". */
function looksLikeAnswerStatement(text: string): boolean {
  if (!isMeaningful(text)) return false;
  return /\b(answer|option|ans)\b|उत्तर|विकल्प|समाधान|\([A-Da-d1-4]\)/i.test(text);
}

async function safeText(loc: Locator, fallback?: Locator): Promise<string> {
  try {
    if ((await loc.count()) > 0) {
      const t = (await loc.first().innerText({ timeout: 2500 })) || "";
      const trimmed = t.trim();
      if (trimmed) return trimmed;
    }
    if (fallback) {
      const t = (await fallback.innerText({ timeout: 2500 })) || "";
      return t.trim();
    }
  } catch (err) {
    log.warn(`safeText failed: ${(err as Error).message}`);
  }
  return "";
}

async function imagesIn(loc: Locator): Promise<string[]> {
  if ((await loc.count()) === 0) return [];
  return loc.first().evaluate((el) =>
    Array.from((el as Element).querySelectorAll("img"))
      .map((img) => (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src)
      .filter(Boolean),
  );
}

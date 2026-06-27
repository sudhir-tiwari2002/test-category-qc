import type { Page, Locator } from "playwright";
import { selectors } from "../config/selectors.js";
import type { Language } from "./types.js";
import { log } from "./utils/logger.js";

/**
 * Switch language on the preview page. Handles three patterns:
 *
 *  1. Angular Material <mat-select>: options live in a CDK overlay appended to
 *     <body>, NOT inside the mat-select itself. We click to open, then click the
 *     <mat-option> with matching text inside the overlay panel.
 *  2. Generic switcher: clicks `[data-lang=<lang>]` inside the switcher.
 *  3. Visible-text fallback: "Hindi"/"हिंदी" / "English".
 */
export async function switchLanguage(page: Page, language: Language): Promise<void> {
  const sw = selectors.page.languageSwitcher;
  const opt = selectors.page.languageOption;
  if (!sw || !opt) {
    log.warn("No language switcher configured — staying on current language.");
    return;
  }

  const switcher = page.locator(sw).first();
  if ((await switcher.count()) === 0) {
    log.warn(`Language switcher "${sw}" not found on page.`);
    return;
  }

  const labels = language === "hi" ? ["Hindi", "हिंदी", "हिन्दी", "हिं"] : ["English", "अंग्रेज़ी", "Eng"];

  const currentText = (await switcher.innerText().catch(() => ""))?.trim();
  if (currentText && labels.some((l) => currentText.toLowerCase().includes(l.toLowerCase()))) {
    log.ok(`Already on "${currentText}" — skipping language switch.`);
    return;
  }

  await switcher.click({ trial: false }).catch(() => undefined);
  await page.waitForTimeout(250);

  // Angular Material overlay: options appear in body > .cdk-overlay-container
  const overlayOption = page
    .locator(".cdk-overlay-container mat-option, .cdk-overlay-container [role='option']")
    .filter({ hasText: new RegExp(labels.join("|"), "i") })
    .first();

  if ((await overlayOption.count()) > 0) {
    await overlayOption.click();
    log.ok(`Switched language to "${language}" (mat-select overlay → "${labels[0]}").`);
    await page.waitForTimeout(900); // let the question list re-render
    return;
  }

  // Generic data-attr fallback
  const dataSel = `${opt}[data-lang="${language}"], ${opt}[data-language="${language}"]`;
  const dataMatch = page.locator(dataSel).first();
  if ((await dataMatch.count()) > 0) {
    await dataMatch.click();
    log.ok(`Switched language to "${language}" (data-lang attr).`);
    await page.waitForTimeout(900);
    return;
  }

  // Visible-text fallback (in case the overlay isn't `.cdk-overlay-container`)
  for (const label of labels) {
    const m = page.locator(`${opt}:has-text("${label}")`).first();
    if ((await m.count()) > 0) {
      await m.click();
      log.ok(`Switched language to "${language}" (visible text "${label}").`);
      await page.waitForTimeout(900);
      return;
    }
  }

  log.warn(`Could not find a language option for "${language}". Pressing Escape to close switcher.`);
  await page.keyboard.press("Escape").catch(() => undefined);
}

/** Scroll the configured scroll container (or window) to the very top. */
export async function scrollToTop(page: Page): Promise<void> {
  const sel = selectors.page.scrollContainer;
  if (!sel) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    return;
  }
  await page.locator(sel).first().evaluate((el) => ((el as HTMLElement).scrollTop = 0));
}

async function scrollDown(page: Page, by: number): Promise<void> {
  const sel = selectors.page.scrollContainer;
  if (!sel) {
    await page.evaluate((d) => window.scrollBy({ top: d, behavior: "instant" as ScrollBehavior }), by);
    return;
  }
  await page.locator(sel).first().evaluate((el, d) => {
    (el as HTMLElement).scrollTop += d;
  }, by);
}

async function getScrollHeight(page: Page): Promise<number> {
  const sel = selectors.page.scrollContainer;
  if (!sel) return page.evaluate(() => document.documentElement.scrollHeight);
  return page.locator(sel).first().evaluate((el) => (el as HTMLElement).scrollHeight);
}

async function getScrollTop(page: Page): Promise<number> {
  const sel = selectors.page.scrollContainer;
  if (!sel) return page.evaluate(() => window.scrollY);
  return page.locator(sel).first().evaluate((el) => (el as HTMLElement).scrollTop);
}

export interface VisibleCard {
  /** Stable id (data attr) or a fallback like `q-12`. */
  id: string;
  card: Locator;
}

async function getCardId(card: Locator, fallbackIndex: number): Promise<string> {
  const inner = card.locator(selectors.preview.questionCardId).first();
  if ((await inner.count()) > 0) {
    const raw = await inner
      .evaluate((el) => {
        const e = el as HTMLElement;
        return (
          e.getAttribute("data-question-id") ||
          e.getAttribute("data-id") ||
          (e.textContent || "").trim()
        );
      })
      .catch(() => null);
    if (raw && raw.length) {
      // PW renders the question number as "1.", "2.", etc. — strip the dot so the
      // EN and HI passes correlate on a clean id ("1", "2", ...).
      const clean = raw.replace(/[\s.\u0964]+$/, "").trim();
      if (clean.length) return clean;
    }
  }
  const own = await card
    .evaluate((el) => {
      const e = el as HTMLElement;
      return e.getAttribute("data-question-id") || e.getAttribute("data-id") || null;
    })
    .catch(() => null);
  if (own && own.length) return own;
  return `q-${fallbackIndex}`;
}

/**
 * Auto-scroll the preview page and yield each question card exactly once.
 *
 * Handles three layouts transparently:
 *   - everything rendered up-front (no scroll triggers needed),
 *   - infinite-scroll lazy lists (we keep scrolling until heights stabilize),
 *   - virtualized lists (we re-query the DOM after every scroll step).
 *
 * The caller's `handler` is awaited before we scroll further, so screenshots
 * stay clean.
 */
export async function processAllQuestionCards(
  page: Page,
  handler: (visible: VisibleCard, index: number) => Promise<void>,
  opts: { maxQuestions?: number; settleMs?: number; pageStepRatio?: number } = {},
): Promise<number> {
  const { maxQuestions = 0, settleMs = 400, pageStepRatio = 0.85 } = opts;

  await scrollToTop(page);
  await page.waitForTimeout(settleMs);

  const seen = new Set<string>();
  let nextIndex = 1;
  let consecutiveStable = 0;
  const STABLE_LIMIT = 3;

  // Sanity check
  const initialCount = await page.locator(selectors.preview.questionCard).count();
  if (initialCount === 0) {
    throw new Error(
      `No question cards found with selector "${selectors.preview.questionCard}". ` +
        `Open DevTools on the preview page and recalibrate config/selectors.ts.`,
    );
  }
  log.info(`Initial card count visible: ${initialCount}. Beginning enumeration...`);

  while (true) {
    const cardsLocator = page.locator(selectors.preview.questionCard);
    const count = await cardsLocator.count();

    let yieldedThisRound = 0;
    for (let i = 0; i < count; i++) {
      const card = cardsLocator.nth(i);
      const id = await getCardId(card, nextIndex);
      if (seen.has(id)) continue;

      seen.add(id);
      yieldedThisRound++;

      await card.scrollIntoViewIfNeeded().catch(() => undefined);
      await page.waitForTimeout(settleMs);
      await handler({ id, card }, nextIndex);
      nextIndex++;

      if (maxQuestions > 0 && seen.size >= maxQuestions) {
        log.info(`Reached --max-questions cap (${maxQuestions}). Stopping enumeration.`);
        return seen.size;
      }
    }

    // Try scrolling further to trigger lazy load / pull more virtual rows
    const heightBefore = await getScrollHeight(page);
    const topBefore = await getScrollTop(page);
    const viewport = page.viewportSize();
    const step = Math.floor((viewport?.height ?? 800) * pageStepRatio);
    await scrollDown(page, step);
    await page.waitForTimeout(settleMs);

    const heightAfter = await getScrollHeight(page);
    const topAfter = await getScrollTop(page);

    const grew = heightAfter > heightBefore;
    const moved = topAfter > topBefore;

    if (!grew && !moved && yieldedThisRound === 0) {
      consecutiveStable++;
      if (consecutiveStable >= STABLE_LIMIT) {
        log.info(`Reached end of scroll. Processed ${seen.size} unique question(s).`);
        return seen.size;
      }
    } else {
      consecutiveStable = 0;
    }
  }
}

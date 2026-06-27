/**
 * Auto-inspect the currently open preview tab in Sakshi's Chrome and dump
 * everything we need to fill in config/selectors.ts.
 *
 * Run with:  npm run inspect
 *
 * Outputs:
 *   reports/inspect-<timestamp>.json   — structured candidate selectors
 *   reports/inspect-<timestamp>.html   — saved HTML of the most likely "question" region
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { attachToChrome } from "./browser.js";
import { log } from "./utils/logger.js";

const cdpPort = Number(process.env.CDP_PORT ?? "9333");
const outputDir = path.resolve(process.env.OUTPUT_DIR ?? "./reports");

const session = await attachToChrome({ cdpPort });
const page = session.page;

try {
  log.info(`Inspecting: ${page.url()}`);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(800);

  const dump = await page.evaluate(() => {
    // Polyfill for tsx/esbuild's __name helper, which it injects around
    // function declarations even when serialized for the browser.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__name = (globalThis as any).__name || ((fn: unknown) => fn);

    /** ------------------------------------------------------------------- */
    /** Helpers                                                              */
    /** ------------------------------------------------------------------- */
    function describe(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
      const cls =
        typeof (el as HTMLElement).className === "string"
          ? (el as HTMLElement).className
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 4)
              .map((c) => `.${c}`)
              .join("")
          : "";
      const test = el.getAttribute("data-testid");
      return `${tag}${id}${cls}${test ? `[data-testid="${test}"]` : ""}`;
    }

    function uniqClassSelector(el: Element): string {
      const test = el.getAttribute("data-testid");
      if (test) return `[data-testid="${test}"]`;
      const cls =
        typeof (el as HTMLElement).className === "string"
          ? (el as HTMLElement).className.split(/\s+/).filter(Boolean)
          : [];
      const stable = cls.find((c) => !/^[a-z]+_[a-zA-Z0-9_-]+__[a-zA-Z0-9]{5,}$/.test(c)) ?? cls[0];
      return stable ? `${el.tagName.toLowerCase()}.${stable}` : el.tagName.toLowerCase();
    }

    function attrsOf(el: Element): Record<string, string> {
      const out: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) {
        if (/^(data-|aria-|role|id|name|type)/.test(a.name)) out[a.name] = a.value;
      }
      return out;
    }

    /** Walk the DOM and find candidates whose class/data-attr/id matches a keyword. */
    function findCandidatesByKeyword(keywords: RegExp): Array<{
      selector: string;
      describe: string;
      count: number;
      sample: string;
      attrs: Record<string, string>;
    }> {
      const seen = new Map<
        string,
        { selector: string; describe: string; els: Element[]; attrs: Record<string, string> }
      >();
      const all = document.querySelectorAll("*");
      for (const el of Array.from(all)) {
        const tokens: string[] = [];
        if ((el as HTMLElement).id) tokens.push((el as HTMLElement).id);
        if (typeof (el as HTMLElement).className === "string") {
          tokens.push((el as HTMLElement).className);
        }
        for (const a of Array.from(el.attributes)) {
          if (a.name.startsWith("data-") || a.name === "role" || a.name === "aria-label") {
            tokens.push(a.value);
          }
        }
        const blob = tokens.join(" ");
        if (!keywords.test(blob)) continue;

        const sel = uniqClassSelector(el);
        if (!seen.has(sel)) {
          seen.set(sel, {
            selector: sel,
            describe: describe(el),
            els: [el],
            attrs: attrsOf(el),
          });
        } else {
          seen.get(sel)!.els.push(el);
        }
      }
      return Array.from(seen.values())
        .map((v) => ({
          selector: v.selector,
          describe: v.describe,
          count: v.els.length,
          attrs: v.attrs,
          sample: (v.els[0].textContent || "").trim().replace(/\s+/g, " ").slice(0, 140),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }

    /** Find the largest scrollable region (probably contains the question list). */
    function findScrollables(): Array<{ selector: string; describe: string; scrollHeight: number; clientHeight: number }> {
      const out: Array<{ selector: string; describe: string; scrollHeight: number; clientHeight: number }> = [];
      const all = document.querySelectorAll("*");
      for (const el of Array.from(all)) {
        const e = el as HTMLElement;
        const cs = window.getComputedStyle(e);
        const oy = cs.overflowY;
        if ((oy === "auto" || oy === "scroll") && e.scrollHeight > e.clientHeight + 50) {
          out.push({
            selector: uniqClassSelector(e),
            describe: describe(e),
            scrollHeight: e.scrollHeight,
            clientHeight: e.clientHeight,
          });
        }
      }
      return out.sort((a, b) => b.scrollHeight - a.scrollHeight).slice(0, 5);
    }

    /** Find lists of repeating sibling structures — these are usually question cards. */
    function findRepeatingGroups(): Array<{
      parentSelector: string;
      childSelector: string;
      childTag: string;
      count: number;
      sampleHTML: string;
    }> {
      const groups: Array<{
        parentSelector: string;
        childSelector: string;
        childTag: string;
        count: number;
        sampleHTML: string;
      }> = [];
      const seen = new Set<string>();
      const all = document.querySelectorAll("*");
      for (const parent of Array.from(all)) {
        const kids = Array.from(parent.children);
        if (kids.length < 2) continue;
        const tagCount = new Map<string, Element[]>();
        for (const k of kids) {
          const sig =
            k.tagName +
            "|" +
            (typeof (k as HTMLElement).className === "string"
              ? (k as HTMLElement).className.split(/\s+/).filter(Boolean).slice(0, 2).join(".")
              : "");
          if (!tagCount.has(sig)) tagCount.set(sig, []);
          tagCount.get(sig)!.push(k);
        }
        for (const [, group] of tagCount.entries()) {
          if (group.length < 3) continue;
          const key = describe(parent) + " > " + describe(group[0]);
          if (seen.has(key)) continue;
          seen.add(key);
          groups.push({
            parentSelector: uniqClassSelector(parent),
            childSelector: uniqClassSelector(group[0]),
            childTag: group[0].tagName.toLowerCase(),
            count: group.length,
            sampleHTML: (group[0].outerHTML || "").slice(0, 600),
          });
        }
      }
      return groups
        .filter((g) => g.count >= 3)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }

    /** ------------------------------------------------------------------- */
    /** Run the probes                                                       */
    /** ------------------------------------------------------------------- */
    return {
      url: location.href,
      title: document.title,
      viewport: { w: innerWidth, h: innerHeight },
      questionCandidates: findCandidatesByKeyword(/question|qstn|qsn/i),
      optionCandidates: findCandidatesByKeyword(/\boption|opt\b|choice/i),
      solutionCandidates: findCandidatesByKeyword(/solution|answer|explan/i),
      correctCandidates: findCandidatesByKeyword(/correct|right|is-answer|selected/i),
      languageCandidates: findCandidatesByKeyword(/lang|english|hindi|हिन्दी|हिं/i),
      scrollables: findScrollables(),
      repeatingGroups: findRepeatingGroups(),
      bodyClasses:
        typeof document.body.className === "string" ? document.body.className.slice(0, 200) : "",
    };
  });

  await fs.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const jsonPath = path.join(outputDir, `inspect-${stamp}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(dump, null, 2), "utf8");

  const htmlPath = path.join(outputDir, `inspect-${stamp}.html`);
  const html = await page.content();
  await fs.writeFile(htmlPath, html, "utf8");

  log.ok(`JSON candidates written to: ${jsonPath}`);
  log.ok(`Full page HTML written to:  ${htmlPath}`);
  log.info(
    `Quick summary: ${dump.questionCandidates.length} question candidates, ${dump.optionCandidates.length} option candidates, ${dump.solutionCandidates.length} solution candidates, ${dump.repeatingGroups.length} repeating-group candidates.`,
  );
} finally {
  await session.disconnect();
}

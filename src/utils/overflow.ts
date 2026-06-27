import type { Page, Locator } from "playwright";

export interface OverflowFinding {
  selector: string;
  tag: string;
  reason: "horizontal-overflow" | "vertical-overflow" | "clipped" | "outside-parent";
  scrollWidth?: number;
  clientWidth?: number;
  scrollHeight?: number;
  clientHeight?: number;
  textSnippet?: string;
}

export interface ImageFinding {
  src: string;
  reason: "not-loaded" | "zero-natural-size";
  alt?: string;
}

/**
 * Runs inside the page to detect any descendant that:
 *  - scrolls horizontally (most common "cut off" symptom on mobile-like previews)
 *  - is taller than its scroll container
 *  - has `overflow: hidden` AND scrollWidth/scrollHeight beyond client size
 *  - has a bounding box that extends beyond its parent's box (image too wide)
 *
 * Returns OverflowFinding[].
 */
export async function detectOverflow(scope: Locator): Promise<OverflowFinding[]> {
  return scope.evaluate((root) => {
    const findings: OverflowFinding[] = [];
    const walker = document.createTreeWalker(root as Element, NodeFilter.SHOW_ELEMENT);
    let node: Node | null = walker.currentNode;

    const describe = (el: Element): string => {
      if (el.id) return `#${el.id}`;
      const cls = (el.className && typeof el.className === "string" ? el.className : "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(".");
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
    };

    while (node) {
      const el = node as HTMLElement;
      const style = window.getComputedStyle(el);
      const overflowX = style.overflowX;
      const overflowY = style.overflowY;

      const hClipped = (overflowX === "hidden" || overflowX === "clip") && el.scrollWidth - el.clientWidth > 1;
      const vClipped = (overflowY === "hidden" || overflowY === "clip") && el.scrollHeight - el.clientHeight > 1;

      if (hClipped) {
        findings.push({
          selector: describe(el),
          tag: el.tagName.toLowerCase(),
          reason: "horizontal-overflow",
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          textSnippet: (el.textContent || "").trim().slice(0, 80),
        });
      }
      if (vClipped) {
        findings.push({
          selector: describe(el),
          tag: el.tagName.toLowerCase(),
          reason: "vertical-overflow",
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          textSnippet: (el.textContent || "").trim().slice(0, 80),
        });
      }

      if (el.parentElement) {
        const childRect = el.getBoundingClientRect();
        const parentRect = el.parentElement.getBoundingClientRect();
        const slack = 1;
        const overflowsParent =
          childRect.right > parentRect.right + slack ||
          childRect.left < parentRect.left - slack;
        if (overflowsParent && (el.tagName === "IMG" || el.tagName === "TABLE" || el.tagName === "PRE")) {
          findings.push({
            selector: describe(el),
            tag: el.tagName.toLowerCase(),
            reason: "outside-parent",
          });
        }
      }

      node = walker.nextNode();
    }
    return findings;
  });
}

/** Reports broken images inside the scope. */
export async function detectBrokenImages(scope: Locator): Promise<ImageFinding[]> {
  return scope.evaluate((root) => {
    const findings: ImageFinding[] = [];
    const imgs = (root as Element).querySelectorAll("img");
    imgs.forEach((img) => {
      const ok = img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
      if (!ok) {
        findings.push({
          src: img.currentSrc || img.src,
          reason: img.complete ? "zero-natural-size" : "not-loaded",
          alt: img.alt || undefined,
        });
      }
    });
    return findings;
  });
}

/** Waits until every <img> in scope has finished loading (or `timeoutMs` elapses). */
export async function waitForImages(_page: Page, scope: Locator, timeoutMs = 5000): Promise<void> {
  await scope.evaluate((root, timeout) => {
    const imgs = Array.from((root as Element).querySelectorAll("img"));
    const pending = imgs.filter((i) => !i.complete);
    if (!pending.length) return;
    return Promise.race([
      Promise.all(
        pending.map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
        ),
      ).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeout)),
    ]);
  }, timeoutMs);
}

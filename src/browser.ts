import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { log } from "./utils/logger.js";

export interface AttachedSession {
  browser: Browser;
  context: BrowserContext;
  /** The page we will drive. Either the currently-active tab or the one matching `categoryUrl`. */
  page: Page;
  /** Close the CDP connection (does NOT close Chrome itself). */
  disconnect: () => Promise<void>;
}

export interface AttachOptions {
  cdpPort: number;
  /** If provided, prefer the tab whose URL contains this substring; otherwise use the active tab. */
  categoryUrl?: string;
  /** Number of ms to wait between Playwright actions (helps with laggy admin UIs). */
  slowMoMs?: number;
}

/**
 * Connect Playwright to an already-running Chrome that was launched with:
 *
 *   open -na "Google Chrome" --args \
 *     --remote-debugging-port=9222 \
 *     --user-data-dir="$HOME/Library/Application Support/Google/Chrome" \
 *     --profile-directory="Profile X"   # whichever profile Sakshi uses
 *
 * (See README for the full launcher command.)
 */
export async function attachToChrome(opts: AttachOptions): Promise<AttachedSession> {
  // Try IPv4 first, then IPv6, then "localhost". Node 18 on macOS resolves
  // "localhost" to ::1 first, but Chrome's debug server only listens on IPv4,
  // so the bare "localhost" path can fail with ECONNREFUSED ::1.
  const hosts = ["127.0.0.1", "[::1]", "localhost"];
  const errors: string[] = [];

  let browser: Browser | undefined;
  let usedUrl = "";
  for (const host of hosts) {
    const cdpUrl = `http://${host}:${opts.cdpPort}`;
    log.step(`Connecting to Chrome over CDP at ${cdpUrl} ...`);
    try {
      browser = await chromium.connectOverCDP(cdpUrl, { slowMo: opts.slowMoMs });
      usedUrl = cdpUrl;
      break;
    } catch (err) {
      errors.push(`  ${cdpUrl} → ${(err as Error).message.split("\n")[0]}`);
    }
  }

  if (!browser) {
    throw new Error(
      `Could not connect to Chrome on port ${opts.cdpPort}. Tried:\n${errors.join("\n")}\n\n` +
        `Most common causes (in order):\n` +
        `  1) Chrome's profile picker is still showing — pick a profile so a browser window is created.\n` +
        `     The debug server only starts once Chrome has an actual window.\n` +
        `  2) Chrome was launched without --remote-debugging-port=${opts.cdpPort}.\n` +
        `     Verify with:  ps -axo command | grep "Google Chrome" | grep remote-debugging\n` +
        `  3) Another process is squatting on the port. Check with:  lsof -nP -iTCP:${opts.cdpPort} -sTCP:LISTEN\n` +
        `  4) Chrome is using a different user-data-dir than the one you intended (the flag is silently\n` +
        `     ignored if another Chrome instance already owns that user-data-dir).`,
    );
  }
  log.ok(`Connected via ${usedUrl}`);

  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error("Chrome is connected but no browser contexts are open. Open at least one tab in Sakshi's profile.");
  }

  const context = contexts[0]; // default context = persistent profile
  const pages = context.pages();
  if (pages.length === 0) {
    throw new Error("No open tabs found in Sakshi's profile. Open the test category page first.");
  }

  let page: Page | undefined;
  if (opts.categoryUrl) {
    page = pages.find((p) => p.url().includes(opts.categoryUrl!));
    if (!page) {
      log.warn(`No tab matched "${opts.categoryUrl}". Falling back to the first open tab.`);
    }
  }
  if (!page) page = pages[0];

  await page.bringToFront();
  log.ok(`Attached. Using tab: ${page.url()}`);

  return {
    browser,
    context,
    page,
    disconnect: async () => {
      try {
        await browser.close(); // for CDP-connected, this only detaches; Chrome stays alive
      } catch {
        /* noop */
      }
    },
  };
}

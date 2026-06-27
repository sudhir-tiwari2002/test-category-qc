/**
 * On-demand OCR for solution / option images. PW renders each solution as a
 * PNG of the worked-out solution in Hindi or English, so the "is the correct
 * option named in the answer section?" check is impossible without reading the
 * text inside the image.
 *
 * Implementation notes:
 *   - One Tesseract worker is created lazily on first use and reused across
 *     the whole run. First boot downloads `eng` + `hin` traineddata (~15 MB
 *     total) which is cached on disk afterwards.
 *   - Results are cached by image URL — the same image won't be OCR'd twice
 *     even if the EN and HI passes both encounter it (they don't here, but
 *     same image URLs do repeat across re-runs of the same script invocation).
 *   - We use Playwright's request context (NOT raw fetch) so the image fetch
 *     reuses Chrome's auth cookies / CORS context.
 */
import type { Page } from "playwright";
import Tesseract from "tesseract.js";
import { log } from "./logger.js";

/**
 * Single eng+hin worker.
 *
 * We previously tried a second eng-only worker with a character whitelist to
 * recover Latin labels like "(b)" that the Hindi model misreads as Devanagari
 * digits — but on pure Devanagari images that worker hallucinates random
 * Latin letters, which caused false-passes. The Hindi model still reliably
 * reads structural words like "उत्तर" / "विकल्प" / "सही है", so the QC checks
 * detect the answer-declaration pattern instead of trusting one mangled letter.
 */
let workerPromise: Promise<Tesseract.Worker> | null = null;
const cache = new Map<string, string>();

function getWorker(): Promise<Tesseract.Worker> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    log.step("Initializing OCR worker (Tesseract.js, eng+hin)...");
    const t0 = Date.now();
    const worker = await Tesseract.createWorker(["eng", "hin"]);
    log.ok(`OCR worker ready (${Date.now() - t0} ms).`);
    return worker;
  })();
  return workerPromise;
}

async function ocrOneUrl(url: string, page: Page): Promise<string> {
  if (cache.has(url)) return cache.get(url)!;
  try {
    const resp = await page.request.get(url, { timeout: 15000 });
    if (!resp.ok()) {
      log.warn(`OCR fetch HTTP ${resp.status()} for ${url}`);
      cache.set(url, "");
      return "";
    }
    const buf = await resp.body();
    const worker = await getWorker();
    const result = await worker.recognize(buf);
    const text = (result.data.text || "").replace(/\s+/g, " ").trim();
    cache.set(url, text);
    return text;
  } catch (err) {
    log.warn(`OCR failed for ${url}: ${(err as Error).message}`);
    cache.set(url, "");
    return "";
  }
}

export async function ocrImageUrls(urls: string[], page: Page): Promise<string> {
  const out: string[] = [];
  for (const url of urls) {
    const t0 = Date.now();
    const text = await ocrOneUrl(url, page);
    if (text) {
      log.info(`OCR: ${url.split("/").pop()} → ${text.length} chars (${Date.now() - t0} ms)`);
      out.push(text);
    }
  }
  return out.join("\n\n");
}

export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate();
    log.ok(`OCR worker disposed (${cache.size} image(s) cached this run).`);
  } catch {
    /* noop */
  } finally {
    workerPromise = null;
  }
}

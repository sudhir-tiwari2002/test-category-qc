import type { Locator, Page } from "playwright";
import type { CheckResult, Language, Option, QuestionSnapshot } from "../types.js";
import { normalize } from "../utils/compare.js";
import { detectBrokenImages, detectOverflow } from "../utils/overflow.js";

export interface RunChecksInput {
  snapshot: QuestionSnapshot;
  card: Locator;
  page: Page;
  language: Language;
  /** EN snapshot for the same question, captured earlier in the run. Used for Hindi-presence cross-check. */
  englishSnapshot?: QuestionSnapshot;
}

export async function runAllChecks(input: RunChecksInput): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  out.push(checkCorrectAnswerMarked(input));
  out.push(checkCorrectOptionNamed(input));
  out.push(checkCorrectOptionExplained(input));
  out.push(checkMissingFields(input));
  out.push(...(await checkImages(input)));
  out.push(checkHindiPresence(input));
  return out;
}

/* ------------------------------------------------------------ */
/* 1. A correct option is actually flagged in the card           */
/* ------------------------------------------------------------ */
function checkCorrectAnswerMarked({ snapshot }: RunChecksInput): CheckResult {
  if (!snapshot.options.length) {
    return { id: "correct_answer_marked", status: "fail", message: "Card has no options at all." };
  }
  if (snapshot.correctIndices.length === 0) {
    return {
      id: "correct_answer_marked",
      status: "fail",
      message: "No option is marked correct in the preview card.",
    };
  }
  if (snapshot.correctIndices.length > snapshot.options.length) {
    return { id: "correct_answer_marked", status: "warn", message: "More 'correct' markers than options." };
  }
  return {
    id: "correct_answer_marked",
    status: "pass",
    message: `Option ${snapshot.correctIndices.map((i) => labelOf(snapshot.options[i])).join(", ")} is marked correct.`,
  };
}

/* --------------------------------------------------------------------------- */
/* 2. The solution names the correct option (e.g. "Option B" / "(B)" / "उत्तर 2") */
/* --------------------------------------------------------------------------- */
function checkCorrectOptionNamed(input: RunChecksInput): CheckResult {
  const { snapshot } = input;
  if (snapshot.correctIndices.length === 0) {
    return { id: "correct_option_named", status: "skip", message: "No correct option marked — can't verify naming." };
  }
  const solutionNorm = normalize(snapshot.solutionText);
  const hasImage = snapshot.solutionImageUrls.length > 0;

  // After the extractor runs OCR on image solutions, an empty/placeholder
  // solutionNorm means either: (a) OCR is disabled, or (b) OCR couldn't read
  // anything useful from the image. Either way we cannot positively verify.
  if (!solutionNorm) {
    return {
      id: "correct_option_named",
      status: hasImage ? "warn" : "fail",
      message: hasImage
        ? "Solution image yielded no readable text — verify visually in the HTML report."
        : "Answer/solution section is empty — cannot mention the correct option.",
    };
  }

  const missing: Array<{ optionIndex: number; label: string; numeric: string }> = [];
  for (const i of snapshot.correctIndices) {
    const opt = snapshot.options[i];
    const label = labelOf(opt);
    const numeric = String(i + 1);
    if (!solutionMentionsLabel(solutionNorm, label, numeric)) {
      missing.push({ optionIndex: i, label, numeric });
    }
  }
  if (!missing.length) {
    return {
      id: "correct_option_named",
      status: "pass",
      message: `Answer section names the correct option (${snapshot.correctIndices.map((i) => labelOf(snapshot.options[i])).join(", ")}).`,
    };
  }
  return {
    id: "correct_option_named",
    status: "fail",
    message: `Answer section does not explicitly name the correct option: ${missing.map((m) => m.label).join(", ")}.`,
    details: {
      missing,
      hint: "Expected something like 'Answer: " + missing[0].label + "', '(" + missing[0].label + ")', 'Option " + missing[0].label + "', 'उत्तर: " + missing[0].label + "', or 'विकल्प " + missing[0].label + " सही है'.",
      solutionPreview: solutionNorm.slice(0, 400),
    },
  };
}

/**
 * PW renders solutions as PNG screenshots and shows a "Video Solution not
 * available" notice as the only text. Treat these as placeholders so our
 * text-only checks don't false-positive on every image-based card.
 */
function isPlaceholderText(t: string): boolean {
  if (!t) return true;
  const lower = t.toLowerCase();
  if (lower === "solution" || lower === "answer") return true;
  // The extractor strips "Video Solution not available for X" notices, but if
  // anything slipped through (e.g. mixed with other short text), treat short
  // residual content as a placeholder.
  if (/\b(video\s+)?solution\s+not\s+available\b/.test(lower) && lower.replace(/\s+/g, "").length < 50) {
    return true;
  }
  return false;
}

function isMeaningfulSolution(t: string): boolean {
  return !!t && t.replace(/\s+/g, "").length >= 20 && !isPlaceholderText(t);
}

/**
 * Hindi/English patterns that prove the author *declared* a correct option
 * somewhere in the solution — even if OCR mangled the actual letter
 * ("(b)" → "(८)", "D" → "0", etc.). These structural words are read
 * accurately by the Tesseract Hindi model.
 */
const ANSWER_DECLARATION_PATTERNS: RegExp[] = [
  /उत्तर\s*[:.\-]/, // "उत्तर:" anywhere
  /विकल्प\s*\(?\s*\S{1,3}\s*\)?\s*सही\s*है/, // "विकल्प X सही है"
  /\bans(?:wer)?\s*[:.\-]\s*\S/i, // "Answer: X" / "Ans: X"
  /\boption\s+\S{1,3}\s+(?:is|are)\s+(?:the\s+)?correct/i, // "Option X is correct"
  /\bcorrect\s+(?:answer|option|choice)\s+is\b/i, // "Correct answer is ..."
  /^\s*\(?[A-Da-d1-4]\)?\s*[:.\-]/m, // line starts with "(B):" / "B:"
];

/**
 * Match the various ways PW (or any author) names the correct option.
 *   1. EXACT letter match — when OCR captured the letter cleanly
 *        Latin   : "B", "(B)", "(b)", "Option B", "Ans: B", "Answer: D"
 *        Hindi   : "उत्तर: B", "उत्तर:(b)", "विकल्प B", "विकल्प (B) सही है"
 *        Numeric : "Option 2", "(2)", Devanagari "२"
 *   2. ANSWER-DECLARATION fallback — when OCR mangled the letter but the
 *      structural words ("उत्तर:", "विकल्प X सही है", "Answer:") survive.
 *      This is sufficient evidence that the author *named* an option.
 */
function solutionMentionsLabel(solution: string, label: string, numeric: string): boolean {
  if (!solution) return false;
  const lower = solution.toLowerCase();
  const labelLower = label.toLowerCase();
  const labelEsc = labelLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const exactLetterPatterns: RegExp[] = [
    new RegExp(`\\boption\\s*[-:.]?\\s*${labelEsc}\\b`),
    new RegExp(`\\bopt\\s*[-:.]?\\s*${labelEsc}\\b`),
    new RegExp(`\\bans(?:wer)?\\s*[:.\\-]?\\s*\\(?\\s*${labelEsc}\\b`),
    new RegExp(`\\(\\s*${labelEsc}\\s*\\)`),
    new RegExp(`\\bचॉइस\\s*\\(?\\s*${labelEsc}`),
    new RegExp(`\\bविकल्प\\s*\\(?\\s*${labelEsc}`),
    new RegExp(`\\bउत्तर\\s*[:.\\-]?\\s*\\(?\\s*${labelEsc}`),
    new RegExp(`\\b${labelEsc}\\s*[).]`),
  ];
  if (exactLetterPatterns.some((re) => re.test(lower))) return true;

  if (numeric && numeric !== labelLower) {
    const numericPatterns: RegExp[] = [
      new RegExp(`\\boption\\s*[-:.]?\\s*${numeric}\\b`),
      new RegExp(`\\bans(?:wer)?\\s*[:.\\-]?\\s*${numeric}\\b`),
      new RegExp(`\\bविकल्प\\s*\\(?\\s*${numeric}\\b`),
      new RegExp(`\\bउत्तर\\s*[:.\\-]?\\s*${numeric}\\b`),
      new RegExp(`\\(\\s*${numeric}\\s*\\)`),
    ];
    if (numericPatterns.some((re) => re.test(lower))) return true;
    const devanagari = toDevanagariDigits(numeric);
    if (devanagari && solution.includes(devanagari)) return true;
  }

  if (ANSWER_DECLARATION_PATTERNS.some((re) => re.test(solution))) return true;
  return false;
}

function toDevanagariDigits(s: string): string {
  const map: Record<string, string> = { "0": "०", "1": "१", "2": "२", "3": "३", "4": "४", "5": "५", "6": "६", "7": "७", "8": "८", "9": "९" };
  return s.replace(/\d/g, (d) => map[d] ?? d);
}

/* ------------------------------------------------------------------------------- */
/* 3. The solution actually shows / explains the correct option (content overlap)   */
/* ------------------------------------------------------------------------------- */
function checkCorrectOptionExplained(input: RunChecksInput): CheckResult {
  const { snapshot } = input;
  if (snapshot.correctIndices.length === 0) {
    return { id: "correct_option_explained", status: "skip", message: "No correct option marked." };
  }
  const solNorm = normalize(snapshot.solutionText);
  const solIsPlaceholder = isPlaceholderText(solNorm);
  const solHasImages = snapshot.solutionImageUrls.length > 0;

  const failures: string[] = [];
  const warns: string[] = [];

  let optionsChecked = 0;
  for (const i of snapshot.correctIndices) {
    const opt = snapshot.options[i];
    const optText = normalize(opt.text);
    const hasOptImages = opt.imageUrls.length > 0;
    const isPlaceholderOptText = !optText || /^[a-zA-Z\d]\.?$/.test(optText);

    // PW: option containers often carry only a MathJax placeholder ("A"/"B"/...).
    // In that case the option's "content" lives inside the QUESTION image and we
    // can't programmatically diff text. correct_option_named already verifies the
    // solution explicitly references the letter, so skip the overlap check here.
    if (isPlaceholderOptText && !hasOptImages) {
      continue;
    }
    optionsChecked++;

    const solIsVisualOnly = (solIsPlaceholder || !solNorm) && solHasImages;

    if (!optText && hasOptImages) {
      if (!solHasImages && !isMeaningfulSolution(solNorm)) {
        failures.push(`Option ${labelOf(opt)} is an image, but the answer section has neither image nor explanation.`);
      } else if (solHasImages && !isMeaningfulSolution(solNorm)) {
        warns.push(`Option ${labelOf(opt)} is image-based; both option and solution are images — verify visually.`);
      }
      continue;
    }
    if (!optText) {
      failures.push(`Option ${labelOf(opt)} has no text/image to verify.`);
      continue;
    }
    if (!solNorm || solIsPlaceholder) {
      if (solHasImages) {
        warns.push(`Solution for option ${labelOf(opt)} is in an image that OCR couldn't read — verify visually.`);
      } else {
        failures.push(`Answer section is empty — cannot explain option ${labelOf(opt)}.`);
      }
      continue;
    }
    if (solIsVisualOnly) {
      warns.push(`Solution for option ${labelOf(opt)} is image-only — verify visually.`);
      continue;
    }

    if (containsPhrase(solNorm, optText)) continue;
    const overlap = significantWordOverlap(optText, solNorm);
    if (overlap >= 0.5) continue;

    failures.push(
      `Answer section does not appear to explain/display option ${labelOf(opt)} ` +
        `(word overlap ${(overlap * 100).toFixed(0)}%).`,
    );
  }

  if (failures.length === 0 && warns.length === 0 && optionsChecked === 0) {
    return {
      id: "correct_option_explained",
      status: "skip",
      message: "Options are placeholder labels — explanation coverage is handled by correct_option_named.",
    };
  }

  if (failures.length) {
    return { id: "correct_option_explained", status: "fail", message: failures[0], details: { failures, warns } };
  }
  if (warns.length) {
    return { id: "correct_option_explained", status: "warn", message: warns[0], details: warns };
  }
  return { id: "correct_option_explained", status: "pass", message: "Correct option content appears in the answer section." };
}

function containsPhrase(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (n.length < 3) return false;
  if (h.includes(n)) return true;
  if (n.length > 80) {
    return h.includes(n.slice(0, 80));
  }
  return false;
}

function significantWordOverlap(option: string, solution: string): number {
  const opt = tokenize(option);
  const sol = new Set(tokenize(solution));
  if (!opt.length) return 0;
  const hit = opt.filter((w) => sol.has(w)).length;
  return hit / opt.length;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

/* ------------------------------------------------------------ */
/* 4. Nothing is empty                                          */
/* ------------------------------------------------------------ */
function checkMissingFields({ snapshot }: RunChecksInput): CheckResult {
  const missing: string[] = [];
  if (!normalize(snapshot.questionText) && !snapshot.questionImageUrls.length) missing.push("question");
  if (!snapshot.options.length) missing.push("options");
  snapshot.options.forEach((o, i) => {
    if (!normalize(o.text) && !o.imageUrls.length) missing.push(`option[${labelOf(o) || i}]`);
  });
  if (!normalize(snapshot.solutionText) && !snapshot.solutionImageUrls.length) missing.push("solution");
  if (!missing.length) return { id: "missing_field", status: "pass", message: "No missing fields." };
  return { id: "missing_field", status: "fail", message: `${missing.length} empty field(s).`, details: missing };
}

/* ------------------------------------------------------------ */
/* 5/6. Images + overflow                                       */
/* ------------------------------------------------------------ */
async function checkImages({ snapshot, card }: RunChecksInput): Promise<CheckResult[]> {
  const out: CheckResult[] = [];

  const broken = await detectBrokenImages(card);
  const totalImages =
    snapshot.questionImageUrls.length +
    snapshot.solutionImageUrls.length +
    snapshot.options.reduce((n, o) => n + o.imageUrls.length, 0);

  if (broken.length) {
    out.push({ id: "image_loaded", status: "fail", message: `${broken.length} image(s) failed to load.`, details: broken });
  } else if (totalImages === 0) {
    out.push({ id: "image_loaded", status: "skip", message: "No images in this card." });
  } else {
    out.push({ id: "image_loaded", status: "pass", message: `All ${totalImages} image(s) loaded.` });
  }

  const overflow = await detectOverflow(card);
  if (overflow.length) {
    out.push({
      id: "image_cutoff",
      status: "fail",
      message: `${overflow.length} clipped / cut-off element(s) inside the card.`,
      details: overflow.slice(0, 10),
    });
  } else {
    out.push({ id: "image_cutoff", status: "pass", message: "Nothing appears cut off in this card." });
  }
  return out;
}

/* ------------------------------------------------------------ */
/* 7. Hindi presence (only meaningful on the Hindi pass)         */
/* ------------------------------------------------------------ */
function checkHindiPresence({ snapshot, englishSnapshot, language }: RunChecksInput): CheckResult {
  if (language !== "hi") {
    return { id: "hindi_present", status: "skip", message: "Hindi check only runs on the Hindi pass." };
  }

  const issues: string[] = [];
  const warns: string[] = [];

  if (!normalize(snapshot.questionText) && !snapshot.questionImageUrls.length) issues.push("question is empty");
  snapshot.options.forEach((o, i) => {
    if (!normalize(o.text) && !o.imageUrls.length) issues.push(`option ${labelOf(o) || i} is empty`);
  });
  if (!normalize(snapshot.solutionText) && !snapshot.solutionImageUrls.length) issues.push("solution is empty");

  // Devanagari requirement: only flag fields that have MEANINGFUL TEXT.
  // Image-only cards, or cards whose MathJax buffers contain only LaTeX
  // glyph names, shouldn't be punished.
  if (isMeaningfulText(snapshot.questionText) && !hasDevanagari(snapshot.questionText)) {
    issues.push("question has no Devanagari characters (likely English text on Hindi tab)");
  } else if (!isMeaningfulText(snapshot.questionText) && snapshot.questionImageUrls.length) {
    warns.push("question is image-based — Devanagari check skipped, verify visually");
  }

  const textOptions = snapshot.options.filter((o) => isMeaningfulText(o.text));
  if (textOptions.length > 0) {
    const hindiOptions = textOptions.filter((o) => hasDevanagari(o.text)).length;
    if (hindiOptions === 0) {
      issues.push("none of the text-based options contain Devanagari");
    }
  } else if (snapshot.options.some((o) => o.imageUrls.length)) {
    warns.push("options are image-based — Devanagari check skipped, verify visually");
  }

  if (isMeaningfulText(snapshot.solutionText) && !hasDevanagari(snapshot.solutionText) && !isPlaceholderText(normalize(snapshot.solutionText))) {
    issues.push("solution has no Devanagari characters");
  } else if (!isMeaningfulText(snapshot.solutionText) && snapshot.solutionImageUrls.length) {
    warns.push("solution is image-based — Devanagari check skipped, verify visually");
  }

  if (englishSnapshot) {
    if (englishSnapshot.options.length !== snapshot.options.length) {
      issues.push(`option count differs (en=${englishSnapshot.options.length} vs hi=${snapshot.options.length})`);
    }
    if (
      isMeaningfulText(englishSnapshot.questionText) &&
      normalize(englishSnapshot.questionText) === normalize(snapshot.questionText)
    ) {
      issues.push("Hindi question text is identical to English — appears untranslated");
    }
  }

  if (issues.length) {
    return { id: "hindi_present", status: "fail", message: `${issues.length} Hindi issue(s).`, details: { issues, warns } };
  }
  if (warns.length) {
    return { id: "hindi_present", status: "warn", message: warns[0], details: warns };
  }
  return { id: "hindi_present", status: "pass", message: "Hindi content is present and translated." };
}

/** "A", "B", "1", "2." etc. are MathJax placeholders, not real content. Require more than that. */
function isMeaningfulText(s: string | undefined | null): boolean {
  const n = normalize(s ?? "");
  if (!n) return false;
  if (n.length <= 2) return false;
  if (/^[a-z\d]\.?$/i.test(n)) return false;
  return true;
}

function hasDevanagari(s: string | undefined | null): boolean {
  if (!s) return false;
  return /[\u0900-\u097F]/.test(s);
}

function labelOf(opt: Option | undefined): string {
  if (!opt) return "?";
  return opt.label || String(opt.index + 1);
}

export type Language = "en" | "hi";

export interface Option {
  index: number;
  /** "A" / "B" / ... or "1" / "2" / ... — what the UI shows. Empty if not labeled. */
  label: string;
  text: string;
  isCorrect: boolean;
  imageUrls: string[];
}

export interface QuestionSnapshot {
  /** Stable id we use to correlate runs (admin question id, slug, or 1-based seen-order). */
  id: string;
  language: Language;
  questionText: string;
  questionImageUrls: string[];
  options: Option[];
  correctIndices: number[];
  /** Solution / explanation / "answer" section as one normalized string. */
  solutionText: string;
  solutionImageUrls: string[];
}

export type CheckId =
  | "correct_answer_marked"
  | "correct_option_named"
  | "correct_option_explained"
  | "image_loaded"
  | "image_cutoff"
  | "missing_field"
  | "hindi_present";

export interface CheckResult {
  id: CheckId;
  status: "pass" | "fail" | "warn" | "skip";
  message: string;
  details?: unknown;
}

export interface QuestionReport {
  questionId: string;
  language: Language;
  /** 1-based position in the category. */
  index: number;
  checks: CheckResult[];
  screenshotPath?: string;
  failed: boolean;
  /** First ~600 chars of the solution text (DOM + OCR) used by the checks.
   *  Shown in the HTML report so reviewers can verify the verdict. */
  solutionPreview?: string;
  /** The correct option's label, e.g. "B". */
  correctLabel?: string;
}

/**
 * Calibrated for PhysicsWallah admin-v2.penpencil.co preview dialog.
 * Stack: Angular + Angular Material + Fuse UI + Tailwind.
 *
 * IMPORTANT: Avoid `_ngcontent-vpj-cXXX` and `ng-tns-cXXX-YY` style attributes
 * — they change between Angular builds. Use semantic Tailwind / Material
 * classes instead.
 */

export interface SelectorMap {
  page: {
    scrollContainer: string | null;
    languageSwitcher?: string;
    languageOption?: string;
  };
  preview: {
    questionCard: string;
    questionCardId: string;
    questionBody: string;
    optionItem: string;
    optionText: string;
    optionLabel?: string;
    correctOptionMarker: string;
    solutionToggle?: string;
    solutionBody: string;
  };
}

export const selectors: SelectorMap = {
  page: {
    // The dialog's scrollable region (scrollHeight ~25k px on a 100-question category).
    scrollContainer: "div.h-screen.overflow-y-auto",
    // Angular Material dropdown. The actual options appear in a CDK overlay
    // appended to <body>, so opening + selecting is handled in navigate.ts.
    languageSwitcher: 'mat-select[placeholder="Select Language"]',
    languageOption: "mat-option",
  },
  preview: {
    questionCard: "app-preview-question",
    // Inside each card, the question number lives in this span (e.g. "1.", "2.").
    // We strip the trailing dot in the extractor and use the number as the id.
    questionCardId: "mat-card-title span",
    // <mat-card-subtitle> wraps the question's text/image (preceded by the literal
    // "Question" / "प्रश्न" label, which the extractor strips).
    questionBody: "mat-card-subtitle",
    // Each option is `<div class="rounded-lg ... border-grey-200 bg-white ...">`.
    // The correct one ALSO carries `.border-green-500` + `.bg-green-200`.
    // Scoping to a direct child of mat-card-content avoids matching solution wrappers.
    optionItem: "mat-card-content > div.border-grey-200",
    optionText: "mathjax.preview-question",
    // The "A.", "B.", ... label is the first <span> inside the option's flex row.
    optionLabel: "div.flex.gap-2 > span:first-child",
    // Present ONLY on the correct option in preview (green highlight).
    correctOptionMarker: ".border-green-500",
    // Solution is always rendered (no expand/collapse toggle).
    solutionToggle: undefined,
    solutionBody: "mat-card-content > div.bg-gray-100",
  },
};

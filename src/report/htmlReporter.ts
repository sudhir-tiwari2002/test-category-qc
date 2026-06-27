import fs from "node:fs/promises";
import path from "node:path";
import type { CheckResult, QuestionReport } from "../types.js";

export async function writeHtmlReport(reports: QuestionReport[], outDir: string): Promise<string> {
  const file = path.join(outDir, `qc-report-${stamp()}.html`);
  const html = renderHtml(reports);
  await fs.writeFile(file, html, "utf8");
  return file;
}

function renderHtml(reports: QuestionReport[]): string {
  const totals = summarize(reports);
  const failing = reports.filter((r) => r.failed);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Test Category QC Report</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; max-width: 1100px; }
    h1 { margin: 0 0 4px 0; }
    .meta { color: #666; margin-bottom: 24px; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 28px; }
    .tile { padding: 14px 18px; border-radius: 8px; background: #f4f5f7; }
    .tile .n { font-size: 26px; font-weight: 700; }
    .tile .l { color: #555; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .tile.pass .n { color: #008060; } .tile.fail .n { color: #b00020; } .tile.warn .n { color: #b07a00; }
    .q { border: 1px solid #e3e5e8; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .q h3 { margin: 0 0 6px 0; }
    .q .sub { color: #666; font-size: 12px; margin-bottom: 10px; }
    .check { padding: 8px 12px; border-radius: 6px; margin: 6px 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
    .check.pass { background: #e8f6f0; color: #014c34; }
    .check.fail { background: #fdecef; color: #6c0014; }
    .check.warn { background: #fff5dc; color: #5a3d00; }
    .check.skip { background: #eef0f3; color: #555; }
    .check pre { margin: 6px 0 0 0; white-space: pre-wrap; word-break: break-word; }
    .preview { margin-top: 10px; padding: 10px 12px; background: #f8f9fb; border-left: 3px solid #6c7a89; border-radius: 4px; }
    .preview-hd { color: #555; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
    .preview pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .q img.shot { max-width: 100%; border: 1px solid #ddd; border-radius: 6px; margin-top: 10px; }
    .lang { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eef; color: #225; font-size: 11px; margin-left: 8px; }
    details > summary { cursor: pointer; }
  </style>
</head>
<body>
  <h1>Test Category QC Report</h1>
  <div class="meta">Generated ${new Date().toLocaleString()} • ${reports.length} question-passes (${countByLang(reports)})</div>

  <div class="tiles">
    <div class="tile"><div class="n">${reports.length}</div><div class="l">Total</div></div>
    <div class="tile pass"><div class="n">${totals.pass}</div><div class="l">Pass</div></div>
    <div class="tile fail"><div class="n">${totals.fail}</div><div class="l">Fail</div></div>
    <div class="tile warn"><div class="n">${totals.warn}</div><div class="l">Warn</div></div>
  </div>

  <h2>Failing questions (${failing.length})</h2>
  ${failing.map(renderQuestion).join("\n") || "<p>None — clean run.</p>"}

  <h2>All questions</h2>
  <details><summary>Show every question (including passes)</summary>
    ${reports.map(renderQuestion).join("\n")}
  </details>
</body>
</html>`;
}

function renderQuestion(r: QuestionReport): string {
  const failed = r.checks.filter((c) => c.status === "fail").length;
  const shot = r.screenshotPath
    ? `<img class="shot" src="${path.basename(r.screenshotPath)}" alt="screenshot of question ${r.questionId}" />`
    : "";
  const correctLabel = r.correctLabel ? `correct option: <strong>${escapeHtml(r.correctLabel)}</strong>` : "";
  const previewBlock = r.solutionPreview
    ? `<div class="preview"><div class="preview-hd">solution OCR (first 600 chars) — ${correctLabel}</div><pre>${escapeHtml(r.solutionPreview)}</pre></div>`
    : "";
  return `<div class="q">
    <h3>#${r.index} · ${escapeHtml(r.questionId)} <span class="lang">${r.language.toUpperCase()}</span> ${failed ? `<span style="color:#b00020">— ${failed} fail(s)</span>` : ""}</h3>
    <div class="sub">${r.checks.length} checks ran</div>
    ${r.checks.map(renderCheck).join("\n")}
    ${previewBlock}
    ${shot}
  </div>`;
}

function renderCheck(c: CheckResult): string {
  return `<div class="check ${c.status}"><strong>${c.id}</strong> · ${c.status.toUpperCase()} — ${escapeHtml(c.message)}${
    c.details ? `<pre>${escapeHtml(JSON.stringify(c.details, null, 2))}</pre>` : ""
  }</div>`;
}

function summarize(reports: QuestionReport[]): { pass: number; fail: number; warn: number } {
  let pass = 0, fail = 0, warn = 0;
  for (const r of reports) {
    if (r.checks.some((c) => c.status === "fail")) fail++;
    else if (r.checks.some((c) => c.status === "warn")) warn++;
    else pass++;
  }
  return { pass, fail, warn };
}

function countByLang(reports: QuestionReport[]): string {
  const counts: Record<string, number> = {};
  for (const r of reports) counts[r.language] = (counts[r.language] || 0) + 1;
  return Object.entries(counts).map(([l, n]) => `${l}: ${n}`).join(" · ");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

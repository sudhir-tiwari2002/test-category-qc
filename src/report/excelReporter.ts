import ExcelJS from "exceljs";
import path from "node:path";
import type { CheckId, QuestionReport } from "../types.js";

const CHECK_COLUMNS: CheckId[] = [
  "correct_answer_marked",
  "correct_option_named",
  "correct_option_explained",
  "missing_field",
  "image_loaded",
  "image_cutoff",
  "hindi_present",
];

export async function writeExcelReport(reports: QuestionReport[], outDir: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "test-category-qc";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "#", key: "index", width: 5 },
    { header: "Question ID", key: "id", width: 24 },
    { header: "Language", key: "language", width: 10 },
    { header: "Status", key: "status", width: 10 },
    ...CHECK_COLUMNS.map((c) => ({ header: c, key: c, width: 16 })),
    { header: "Screenshot", key: "screenshot", width: 40 },
  ];

  reports.forEach((r) => {
    const row: Record<string, string | number> = {
      index: r.index,
      id: r.questionId,
      language: r.language,
      status: r.failed ? "FAIL" : "PASS",
      screenshot: r.screenshotPath ? path.basename(r.screenshotPath) : "",
    };
    for (const c of CHECK_COLUMNS) {
      const check = r.checks.find((x) => x.id === c);
      row[c] = check ? check.status.toUpperCase() : "-";
    }
    const added = summary.addRow(row);
    if (r.failed) added.font = { color: { argb: "FFB00020" }, bold: true };
  });
  summary.getRow(1).font = { bold: true };
  summary.views = [{ state: "frozen", ySplit: 1 }];

  const details = wb.addWorksheet("Details");
  details.columns = [
    { header: "#", key: "index", width: 5 },
    { header: "Question ID", key: "id", width: 24 },
    { header: "Language", key: "language", width: 8 },
    { header: "Check", key: "check", width: 18 },
    { header: "Status", key: "status", width: 8 },
    { header: "Message", key: "message", width: 60 },
    { header: "Details", key: "details", width: 80 },
  ];
  reports.forEach((r) => {
    r.checks.forEach((c) => {
      const row = details.addRow({
        index: r.index,
        id: r.questionId,
        language: r.language,
        check: c.id,
        status: c.status.toUpperCase(),
        message: c.message,
        details: c.details ? JSON.stringify(c.details).slice(0, 4000) : "",
      });
      if (c.status === "fail") row.font = { color: { argb: "FFB00020" } };
      else if (c.status === "warn") row.font = { color: { argb: "FFB07A00" } };
      else if (c.status === "pass") row.font = { color: { argb: "FF008060" } };
    });
  });
  details.getRow(1).font = { bold: true };
  details.views = [{ state: "frozen", ySplit: 1 }];

  const file = path.join(outDir, `qc-report-${stamp()}.xlsx`);
  await wb.xlsx.writeFile(file);
  return file;
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

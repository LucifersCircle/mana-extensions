import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SOURCE_ROOT = "src/sources";
export const SOURCE_MARKER = "index.ts";

// Shared by the runner and reporter: a newly added source cannot silently disappear.
export function discoverSources(root = 'src/sources') {
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'index.ts')))
    .map((entry) => entry.name).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (!names.length) throw new Error(`No source entry points found in ${root}`);
  return names;
}

// Validate the expected set, not whichever suites happened to emit output.
export function reportIssues(report, sources) {
  const issues = {};
  const validReport = report && typeof report === "object" && !Array.isArray(report);
  const unexpected = validReport ? Object.keys(report).filter((name) => !sources.includes(name)) : [];
  for (const source of sources) {
    const data = validReport && Object.hasOwn(report, source) ? report[source] : undefined;
    const tests = data?.tests;
    const passed = Array.isArray(tests) ? tests.filter((test) => test?.status === "pass").length : 0;
    const failed = Array.isArray(tests) ? tests.filter((test) => test?.status === "fail").length : 0;
    if (unexpected.length) issues[source] = "Report contains unexpected sources";
    else if (data?.error) issues[source] = String(data.error);
    else if (!Array.isArray(tests) || !tests.length || tests.some((test) => !test || typeof test.name !== "string" || !test.name.trim()) || passed + failed !== tests.length || data.summary?.total !== tests.length || data.summary.passed !== passed || data.summary.failed !== failed) issues[source] = "Missing, empty, malformed, or inconsistent test report";
  }
  return issues;
}

export function failedSources(report, sources) {
  const issues = reportIssues(report, sources);
  return sources.filter((source) => issues[source] || report?.[source]?.summary?.failed !== 0);
}

// Each invocation has its own output file. Continue after failures to retain every selected result.
export function collectSelectedReports(sources, runSource) {
  const report = {};
  for (const source of sources) {
    try {
      const result = runSource(source);
      const issue = reportIssues(result.report, [source])[source];
      report[source] = { ...result.report?.[source], ...((result.error || issue) ? { error: String(result.error || issue) } : {}) };
    } catch (error) {
      report[source] = { error: String(error.message ?? error) };
    }
  }
  return report;
}

#!/usr/bin/env node
import { defaultEvalScenarios, runEvalSuite } from "./index";

const format = process.argv.includes("--json") ? "json" : "text";
const results = runEvalSuite(defaultEvalScenarios);

if (format === "json") {
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
} else {
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    process.stdout.write(`${status} ${result.scenario_id} - ${result.scenario_name}\n`);
    for (const assertion of result.assertions) {
      process.stdout.write(`  ${assertion.passed ? "ok" : "not ok"} ${assertion.id}: ${assertion.description}\n`);
    }
  }
  const failed = results.filter((result) => !result.passed);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} scenarios passed\n`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

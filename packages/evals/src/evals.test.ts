import { describe, expect, it } from "vitest";
import { defaultEvalScenarios, runEvalSuite } from "./index";

describe("voice eval suite", () => {
  it("ships the default regression scenarios", () => {
    expect(defaultEvalScenarios.map((scenario) => scenario.id)).toEqual([
      "standard-intake",
      "barge-in",
      "silence-timeout",
      "duplicate-event",
      "slow-model",
      "tool-failure",
      "handoff",
      "postcall-webhook"
    ]);
  });

  it("runs every default scenario", () => {
    const results = runEvalSuite(defaultEvalScenarios);
    expect(results).toHaveLength(8);
    expect(results.every((result) => result.assertions.length > 0)).toBe(true);
  });
});

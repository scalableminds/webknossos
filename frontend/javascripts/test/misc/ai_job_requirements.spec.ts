import { collectRequirements } from "viewer/view/ai_jobs/components/job_requirements";
import { describe, expect, it } from "vitest";

describe("AI job requirements", () => {
  it("lists an empty required field only once, as missing", () => {
    const requirements = collectRequirements(
      [{ label: "Enter a new dataset name", isMissing: true, field: "newDatasetName" }],
      { newDatasetName: ["Please provide a name for the new dataset"] },
    );
    expect(requirements).toEqual([{ label: "Enter a new dataset name", severity: "warning" }]);
  });

  it("lists validation errors of filled fields as blocking", () => {
    const requirements = collectRequirements(
      [{ label: "Enter a new dataset name", isMissing: false, field: "newDatasetName" }],
      {
        newDatasetName: ["Only letters, digits and the following characters are allowed: . _ -"],
        useAnnotation: [],
      },
    );
    expect(requirements).toEqual([
      {
        label: "Only letters, digits and the following characters are allowed: . _ -",
        severity: "error",
      },
    ]);
  });
});

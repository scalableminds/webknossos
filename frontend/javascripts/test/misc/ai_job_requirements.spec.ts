import { collectRequirements } from "viewer/view/ai_jobs/components/job_requirements";
import { describe, expect, it } from "vitest";

const datasetName = (isMissing: boolean) => ({
  label: "Enter a new dataset name",
  isMissing,
  field: "newDatasetName",
});

describe("AI job requirements", () => {
  it("lists an empty required field only once, as missing", () => {
    const requirements = collectRequirements([datasetName(true)], {
      errors: { newDatasetName: ["Please provide a name for the new dataset"] },
      isValidating: false,
    });
    expect(requirements).toEqual([{ label: "Enter a new dataset name", severity: "warning" }]);
  });

  it("lists validation errors of filled fields as blocking", () => {
    const requirements = collectRequirements([datasetName(false)], {
      errors: {
        newDatasetName: ["Only letters, digits and the following characters are allowed: . _ -"],
        useAnnotation: [],
      },
      isValidating: false,
    });
    expect(requirements).toEqual([
      {
        label: "Only letters, digits and the following characters are allowed: . _ -",
        severity: "error",
      },
    ]);
  });

  it("blocks the job while a validation is still running", () => {
    const requirements = collectRequirements([datasetName(false)], {
      errors: {},
      isValidating: true,
    });
    expect(requirements).toEqual([{ label: "Checking your settings…", severity: "warning" }]);
  });
});

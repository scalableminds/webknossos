import { describe, it, expect } from "vitest";
import { generateDiffMessage } from "dashboard/dataset/queries";

describe("generateDiffMessage", () => {
  it("should produce a nice human-readable message (1)", () => {
    const expectedString = "";
    expect(generateDiffMessage({ changed: 0, onlyInOld: 0, onlyInNew: 0 })).toBe(expectedString);
  });

  it("should produce a nice human-readable message (2)", () => {
    const expectedString = "There is 1 changed dataset.";
    expect(generateDiffMessage({ changed: 1, onlyInOld: 0, onlyInNew: 0 })).toBe(expectedString);
  });

  it("should produce a nice human-readable message (3)", () => {
    const expectedString = "1 dataset no longer exists in this folder.";
    expect(generateDiffMessage({ changed: 0, onlyInOld: 1, onlyInNew: 0 })).toBe(expectedString);
  });

  it("should produce a nice human-readable message (4)", () => {
    const expectedString = "There is 1 new dataset.";
    expect(generateDiffMessage({ changed: 0, onlyInOld: 0, onlyInNew: 1 })).toBe(expectedString);
  });

  it("should produce a nice human-readable message (5)", () => {
    const expectedString =
      "There is 1 new dataset. Also, 1 dataset no longer exists in this folder.";
    expect(generateDiffMessage({ changed: 0, onlyInOld: 1, onlyInNew: 1 })).toBe(expectedString);
  });

  it("should produce a nice human-readable message (6)", () => {
    const expectedString =
      "There are 1 new and 2 changed datasets. Also, 1 dataset no longer exists in this folder.";
    expect(generateDiffMessage({ changed: 2, onlyInOld: 1, onlyInNew: 1 })).toBe(expectedString);
  });

  it("should produce a nice human-readable message (7)", () => {
    const expectedString = "There are 1 new and 2 changed datasets.";
    expect(generateDiffMessage({ changed: 2, onlyInOld: 0, onlyInNew: 1 })).toBe(expectedString);
  });

  it("should produce a nice human-readable message (8)", () => {
    const expectedString =
      "There are 2 changed datasets. Also, 1 dataset no longer exists in this folder.";
    expect(generateDiffMessage({ changed: 2, onlyInOld: 1, onlyInNew: 0 })).toBe(expectedString);
  });
});

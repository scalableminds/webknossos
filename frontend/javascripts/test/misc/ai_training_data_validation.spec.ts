import apiDataset from "test/fixtures/dataset_server_object";
import { annotation } from "test/fixtures/volumetracing_server_objects";
import type { UserBoundingBox } from "viewer/store";
import type { AiTrainingAnnotationSelection } from "viewer/view/ai_jobs/train_ai_model/ai_training_job_context";
import {
  getTrainingDataRequirements,
  getTrainingDataStepStatus,
} from "viewer/view/ai_jobs/train_ai_model/training_data_validation";
import { describe, expect, it } from "vitest";

const boundingBox = (max: number): UserBoundingBox => ({
  id: max,
  name: `box ${max}`,
  boundingBox: { min: [0, 0, 0], max: [max, max, max] },
  color: [1, 0, 0],
  isVisible: true,
});

const selection = (
  overrides: Partial<AiTrainingAnnotationSelection> = {},
): AiTrainingAnnotationSelection => ({
  annotation,
  dataset: apiDataset,
  imageDataLayer: "color",
  groundTruthLayer: "some volume name",
  magnification: [1, 1, 1],
  userBoundingBoxes: [boundingBox(64)],
  volumeTracingMags: { "some volume name": [{ mag: [1, 1, 1] }] },
  ...overrides,
});

describe("AI training data validation", () => {
  it("asks for an annotation when there is none", () => {
    expect(getTrainingDataRequirements([])).toEqual([
      { label: "Add a training annotation", severity: "warning" },
    ]);
    expect(getTrainingDataStepStatus([])).toBe("pending");
  });

  it("has no requirements for a complete selection", () => {
    expect(getTrainingDataRequirements([selection()])).toEqual([]);
    expect(getTrainingDataStepStatus([selection()])).toBe("done");
  });

  it("lists missing inputs as pending requirements", () => {
    const incomplete = selection({ magnification: undefined });
    expect(getTrainingDataRequirements([incomplete])).toEqual([
      { label: "Choose a magnification for f043e7", severity: "warning" },
    ]);
    expect(getTrainingDataStepStatus([incomplete])).toBe("pending");
  });

  it("treats missing bounding boxes as a blocking error", () => {
    const withoutBoxes = selection({ userBoundingBoxes: [] });
    expect(getTrainingDataRequirements([withoutBoxes])).toEqual([
      { label: "Add bounding boxes to f043e7", severity: "error" },
    ]);
    expect(getTrainingDataStepStatus([withoutBoxes])).toBe("error");
  });

  it("does not block on bounding box warnings", () => {
    const tooSmall = selection({ userBoundingBoxes: [boundingBox(16)] });
    expect(getTrainingDataRequirements([tooSmall])).toEqual([]);
    expect(getTrainingDataStepStatus([tooSmall])).toBe("done");
  });
});

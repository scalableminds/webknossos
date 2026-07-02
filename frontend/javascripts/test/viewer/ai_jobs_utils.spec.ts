import { AnnotationLayerEnum, type APIAnnotation } from "types/api_types";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import type { UserBoundingBox, VolumeTracing } from "viewer/store";
import {
  getGroundTruthLayerBoundingBox,
  getOutOfBoundsBoundingBoxes,
} from "viewer/view/ai_jobs/utils";
import { describe, expect, it } from "vitest";

function makeUserBoundingBox(
  id: number,
  name: string,
  min: [number, number, number],
  max: [number, number, number],
): UserBoundingBox {
  return {
    id,
    name,
    boundingBox: { min, max },
    color: [0, 0, 0],
    isVisible: true,
  };
}

describe("AI Jobs Utils", () => {
  describe("getOutOfBoundsBoundingBoxes", () => {
    const layerBoundingBox = new BoundingBox({ min: [0, 0, 0], max: [100, 100, 100] });

    it("returns no boxes when the layer bounding box is null", () => {
      const boxes = [makeUserBoundingBox(1, "outside", [200, 200, 200], [300, 300, 300])];
      expect(getOutOfBoundsBoundingBoxes(boxes, null)).toEqual([]);
    });

    it("returns no boxes when all boxes are fully contained", () => {
      const boxes = [
        makeUserBoundingBox(1, "inside", [10, 10, 10], [50, 50, 50]),
        makeUserBoundingBox(2, "exact", [0, 0, 0], [100, 100, 100]),
      ];
      expect(getOutOfBoundsBoundingBoxes(boxes, layerBoundingBox)).toEqual([]);
    });

    it("returns boxes that are fully or partially outside", () => {
      const partiallyOutside = makeUserBoundingBox(1, "partial", [80, 80, 80], [120, 120, 120]);
      const fullyOutside = makeUserBoundingBox(2, "full", [200, 200, 200], [300, 300, 300]);
      const inside = makeUserBoundingBox(3, "inside", [10, 10, 10], [50, 50, 50]);
      const result = getOutOfBoundsBoundingBoxes(
        [partiallyOutside, fullyOutside, inside],
        layerBoundingBox,
      );
      expect(result.map((box) => box.name)).toEqual(["partial", "full"]);
    });
  });

  describe("getGroundTruthLayerBoundingBox", () => {
    const annotation = {
      annotationLayers: [
        { name: "Volume Layer", tracingId: "tracing-1", typ: AnnotationLayerEnum.Volume },
        { name: "Skeleton", tracingId: "tracing-skeleton", typ: AnnotationLayerEnum.Skeleton },
      ],
    } as unknown as APIAnnotation;

    const volumeTracings = [
      { tracingId: "tracing-1", boundingBox: { min: [0, 0, 0], max: [100, 100, 100] } },
    ] as unknown as VolumeTracing[];

    it("returns the bounding box of the matching volume tracing", () => {
      const result = getGroundTruthLayerBoundingBox(annotation, "Volume Layer", volumeTracings);
      expect(result).not.toBeNull();
      expect(result?.min).toEqual([0, 0, 0]);
      expect(result?.max).toEqual([100, 100, 100]);
    });

    it("returns null when no ground truth layer is selected", () => {
      expect(getGroundTruthLayerBoundingBox(annotation, undefined, volumeTracings)).toBeNull();
    });

    it("returns null when no volume tracings are provided", () => {
      expect(getGroundTruthLayerBoundingBox(annotation, "Volume Layer", undefined)).toBeNull();
    });

    it("returns null when the matching tracing has no restricting bounding box", () => {
      const unboundedTracings = [
        { tracingId: "tracing-1", boundingBox: null },
      ] as unknown as VolumeTracing[];
      expect(
        getGroundTruthLayerBoundingBox(annotation, "Volume Layer", unboundedTracings),
      ).toBeNull();
    });
  });
});

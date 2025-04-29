import type { OxalisState } from "oxalis/store";
import { getVisibleSegmentationLayer } from "../accessors/dataset_accessor";
import {
  getHideUnregisteredSegmentsForVisibleSegmentationLayer,
  getVisibleSegments,
} from "../accessors/volumetracing_accessor";
import { updateSegmentAction } from "./volumetracing_actions";

export const getUpdateSegmentActionToToggleVisibility = (
  storeState: OxalisState,
  segmentId: number,
) => {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(storeState);
  const { segments } = getVisibleSegments(storeState);
  const hideUnregisteredSegments =
    getHideUnregisteredSegmentsForVisibleSegmentationLayer(storeState);

  if (visibleSegmentationLayer == null) {
    return null;
  }
  return updateSegmentAction(
    segmentId,
    {
      isVisible: !(segments?.getNullable(segmentId)?.isVisible ?? !hideUnregisteredSegments),
    },
    visibleSegmentationLayer.name,
    undefined,
    true,
  );
};

import type { Vector3 } from "oxalis/constants";
import type { WebknossosState } from "oxalis/store";
import type { AdditionalCoordinate } from "types/api_types";
import { getVisibleSegmentationLayer } from "../accessors/dataset_accessor";
import {
  getHideUnregisteredSegmentsForVisibleSegmentationLayer,
  getVisibleSegments,
} from "../accessors/volumetracing_accessor";
import { updateSegmentAction } from "./volumetracing_actions";

export const getUpdateSegmentActionToToggleVisibility = (
  storeState: WebknossosState,
  segmentId: number,
  somePosition?: Vector3,
  someAdditionalCoordinates?: AdditionalCoordinate[],
) => {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(storeState);
  const { segments } = getVisibleSegments(storeState);
  const hideUnregisteredSegments =
    getHideUnregisteredSegmentsForVisibleSegmentationLayer(storeState);

  if (visibleSegmentationLayer == null) {
    return null;
  }
  const oldSegment = segments?.getNullable(segmentId);
  return updateSegmentAction(
    segmentId,
    {
      isVisible: !(oldSegment?.isVisible ?? !hideUnregisteredSegments),
      somePosition: oldSegment?.somePosition ?? somePosition,
      someAdditionalCoordinates: oldSegment?.someAdditionalCoordinates ?? someAdditionalCoordinates,
    },
    visibleSegmentationLayer.name,
    undefined,
    true,
  );
};

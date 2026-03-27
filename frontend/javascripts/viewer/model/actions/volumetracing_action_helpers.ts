import type { AdditionalCoordinate } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import type { WebknossosState } from "viewer/store";
import { getVisibleSegmentationLayer } from "../accessors/dataset_accessor";
import {
  getHideUnregisteredSegmentsForVisibleSegmentationLayer,
  getVisibleSegments,
} from "../accessors/volumetracing_accessor";
import { updateSegmentAction } from "./volumetracing_actions";

export const getUpdateSegmentActionToToggleVisibility = (
  storeState: WebknossosState,
  segmentId: number,
  anchorPosition?: Vector3,
  additionalCoordinates?: AdditionalCoordinate[],
) => {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(storeState);
  if (visibleSegmentationLayer == null) {
    return null;
  }
  const { segments } = getVisibleSegments(storeState);
  const hideUnregisteredSegments =
    getHideUnregisteredSegmentsForVisibleSegmentationLayer(storeState);

  const oldSegment = segments?.getNullable(segmentId);
  return updateSegmentAction(
    segmentId,
    {
      isVisible: !(oldSegment?.isVisible ?? !hideUnregisteredSegments),
      anchorPosition: oldSegment?.anchorPosition ?? anchorPosition,
      additionalCoordinates: oldSegment?.additionalCoordinates ?? additionalCoordinates,
    },
    visibleSegmentationLayer.name,
    undefined,
    true,
  );
};

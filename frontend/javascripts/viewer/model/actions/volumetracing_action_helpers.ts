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
  somePosition?: Vector3,
  someAdditionalCoordinates?: AdditionalCoordinate[],
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
      somePosition: oldSegment?.somePosition ?? somePosition,
      someAdditionalCoordinates: oldSegment?.someAdditionalCoordinates ?? someAdditionalCoordinates,
    },
    visibleSegmentationLayer.name,
    undefined,
    true,
  );
};

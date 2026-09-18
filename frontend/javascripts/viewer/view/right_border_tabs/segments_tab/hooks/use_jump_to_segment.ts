import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { layerToGlobalTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { getAdditionalCoordinatesAsString } from "viewer/model/accessors/flycam_accessor";
import {
  setAdditionalCoordinatesAction,
  setPositionAction,
} from "viewer/model/actions/flycam_actions";
import type { Segment } from "viewer/store";
import Store from "viewer/store";

/*
 * Moves the camera to a segment's anchor position (and to its additional
 * coordinates, if it lives on a different slice of a non-3D axis).
 *
 * This is the "center in viewports" half of selecting a segment: the segment
 * list uses it both on its own (the crosshair action of a row) and as part of
 * selectSegmentAndJumpToPosition (see use_segment_selection).
 */
export function useJumpToSegment(): (segment: Segment) => void {
  const dispatch = useDispatch();
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);

  return useCallback(
    (segment: Segment) => {
      if (visibleSegmentationLayer == null) {
        Toast.info("Cannot go to this segment, because there is no visible segmentation layer.");
        return;
      }
      if (!segment.anchorPosition) {
        Toast.info("Cannot go to this segment, because its position is unknown.");
        return;
      }
      const transformedPosition = layerToGlobalTransformedPosition(
        segment.anchorPosition,
        visibleSegmentationLayer.name,
        "segmentation",
        Store.getState(),
      );
      dispatch(setPositionAction(transformedPosition));

      const { additionalCoordinates } = segment;
      if (
        additionalCoordinates != null &&
        getAdditionalCoordinatesAsString(Store.getState().flycam.additionalCoordinates) !==
          getAdditionalCoordinatesAsString(additionalCoordinates)
      ) {
        dispatch(setAdditionalCoordinatesAction(additionalCoordinates));
      }
    },
    [dispatch, visibleSegmentationLayer],
  );
}

import { useCallback } from "react";
import { useDispatch } from "react-redux";
import type { Vector3 } from "viewer/constants";
import { layerToGlobalTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import Store from "viewer/store";

/*
 * Moves the camera to a position that is given in the coordinate system of the passed
 * segmentation layer (e.g. a segment's anchor position or a bounding box from its statistics).
 */
export function useJumpToPosition(): (positionInLayer: Vector3, layerName: string) => void {
  const dispatch = useDispatch();
  return useCallback(
    (positionInLayer: Vector3, layerName: string) => {
      const transformedPosition = layerToGlobalTransformedPosition(
        positionInLayer,
        layerName,
        "segmentation",
        Store.getState(),
      );
      dispatch(setPositionAction(transformedPosition));
    },
    [dispatch],
  );
}

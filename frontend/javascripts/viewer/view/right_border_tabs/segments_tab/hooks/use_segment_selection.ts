import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useCallback, useEffect } from "react";
import { useDispatch } from "react-redux";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { layerToGlobalTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { getAdditionalCoordinatesAsString } from "viewer/model/accessors/flycam_accessor";
import { getSelectedIds, getVisibleSegments } from "viewer/model/accessors/volumetracing_accessor";
import {
  setAdditionalCoordinatesAction,
  setPositionAction,
} from "viewer/model/actions/flycam_actions";
import { setSelectedSegmentsOrGroupAction } from "viewer/model/actions/volumetracing_actions";
import type { Segment } from "viewer/store";
import Store from "viewer/store";
import { getGroupUiNodeKey, getSegmentUiNodeKey } from "../hierarchy";

export type SegmentSelection = {
  selectedSegmentIds: number[];
  selectedGroupId: number | null;
  // The selected segments, resolved from their ids.
  selectedSegments: Segment[];
  // Keys of the selected nodes (for highlighting them in the antd tree).
  selectedKeys: string[];
  // Selects the given segments and/or group (they are mutually exclusive).
  setSelection: (segmentIds: number[], groupId: number | null) => void;
  // Selects a single segment and moves the camera to its anchor position.
  selectSegmentAndJumpToPosition: (segment: Segment) => void;
  deselectAll: () => void;
};

/*
 * Manages which segments (or which single group) are selected in the tab.
 * In contrast to the skeleton tab, this selection lives in the Redux store
 * (per segmentation layer), since other parts of the app interact with it.
 */
export function useSegmentSelection(): SegmentSelection {
  const dispatch = useDispatch();
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const selectedIds = useWkSelector(getSelectedIds);
  const segments = useWkSelector((state) => getVisibleSegments(state).segments);

  useEffect(() => {
    // getSelectedIds removes stale ids (e.g., of segments that were removed
    // from the list) from the selection. Persist that clean-up to the store.
    selectedIds.maybeUpdateStoreAction?.();
  }, [selectedIds]);

  const setSelection = useCallback(
    (segmentIds: number[], groupId: number | null) => {
      if (visibleSegmentationLayer == null) {
        return;
      }
      dispatch(
        setSelectedSegmentsOrGroupAction(segmentIds, groupId, visibleSegmentationLayer.name),
      );
    },
    [dispatch, visibleSegmentationLayer],
  );

  const deselectAll = useCallback(() => setSelection([], null), [setSelection]);

  const selectSegmentAndJumpToPosition = useCallback(
    (segment: Segment) => {
      if (visibleSegmentationLayer == null) {
        Toast.info("Cannot select segment, because there is no visible segmentation layer.");
        return;
      }
      setSelection([segment.id], null);

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
    [dispatch, visibleSegmentationLayer, setSelection],
  );

  const selectedSegments =
    segments != null
      ? selectedIds.segments.flatMap((segmentId) => segments.getNullable(segmentId) ?? [])
      : [];

  const selectedKeys = selectedIds.segments.map(getSegmentUiNodeKey);
  if (selectedIds.group != null) {
    selectedKeys.push(getGroupUiNodeKey(selectedIds.group));
  }

  return {
    selectedSegmentIds: selectedIds.segments,
    selectedGroupId: selectedIds.group,
    selectedSegments,
    selectedKeys,
    setSelection,
    selectSegmentAndJumpToPosition,
    deselectAll,
  };
}

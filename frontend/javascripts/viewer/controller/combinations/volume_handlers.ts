import { V3 } from "libs/mjs";
import memoizeOne from "memoize-one";
import type { AdditionalCoordinate } from "types/api_types";
import type { OrthoView, Point2, Vector3 } from "viewer/constants";
import { ContourModeEnum } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { globalToLayerTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { calculateGlobalPos } from "viewer/model/accessors/view_mode_accessor";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import {
  addToLayerAction,
  finishEditingAction,
  floodFillAction,
  resetContourAction,
  setActiveCellAction,
  setContourTracingModeAction,
  startEditingAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { Model, Store, api } from "viewer/singletons";

export function handleDrawStart(pos: Point2, plane: OrthoView) {
  const state = Store.getState();
  const globalPosRounded = calculateGlobalPos(state, pos).rounded;
  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DRAW));
  Store.dispatch(startEditingAction(globalPosRounded, plane));
  Store.dispatch(addToLayerAction(globalPosRounded));
}
export function handleEraseStart(pos: Point2, plane: OrthoView) {
  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
  Store.dispatch(startEditingAction(calculateGlobalPos(Store.getState(), pos).rounded, plane));
}
export function handleMoveForDrawOrErase(pos: Point2) {
  const state = Store.getState();
  Store.dispatch(addToLayerAction(calculateGlobalPos(state, pos).rounded));
}
export function handleEndForDrawOrErase() {
  Store.dispatch(finishEditingAction());
  Store.dispatch(resetContourAction());
}
export function handlePickCell(pos: Point2) {
  const storeState = Store.getState();
  const globalPosRounded = calculateGlobalPos(storeState, pos).rounded;

  return handlePickCellFromGlobalPosition(
    globalPosRounded,
    storeState.flycam.additionalCoordinates || [],
  );
}
export const getSegmentIdForPosition = memoizeOne(
  (globalPos: Vector3) => {
    // This function will return the currently loaded segment ID for a given position.
    // If the corresponding bucket is not loaded at the moment, the return value will be 0.
    // See getSegmentIdForPositionAsync if the bucket loading should be awaited before returning the ID.
    const layer = Model.getVisibleSegmentationLayer();
    const { additionalCoordinates } = Store.getState().flycam;

    if (!layer) {
      return 0;
    }
    const posInLayerSpace = globalToLayerTransformedPosition(
      globalPos,
      layer.name,
      "segmentation",
      Store.getState(),
    );

    const segmentationCube = layer.cube;
    const segmentationLayerName = layer.name;
    const renderedZoomStepForCameraPosition = api.data.getRenderedZoomStepAtPosition(
      segmentationLayerName,
      posInLayerSpace,
    );
    return segmentationCube.getMappedDataValue(
      posInLayerSpace,
      additionalCoordinates,
      renderedZoomStepForCameraPosition,
    );
  },
  ([a], [b]) => V3.isEqual(a, b),
);
export async function getSegmentIdForPositionAsync(globalPos: Vector3) {
  // This function will return the segment ID for a given position, awaiting the loading
  // of the corresponding bucket.
  // See getSegmentIdForPosition if the bucket loading should not be awaited.
  const layer = Model.getVisibleSegmentationLayer();
  const { additionalCoordinates } = Store.getState().flycam;

  if (!layer) {
    return 0;
  }
  const posInLayerSpace = globalToLayerTransformedPosition(
    globalPos,
    layer.name,
    "segmentation",
    Store.getState(),
  );

  const segmentationCube = layer.cube;
  const segmentationLayerName = layer.name;
  const renderedZoomStepForCameraPosition = await api.data.getUltimatelyRenderedZoomStepAtPosition(
    segmentationLayerName,
    posInLayerSpace,
  );
  // Make sure the corresponding bucket is loaded
  await api.data.getDataValue(
    segmentationLayerName,
    posInLayerSpace,
    renderedZoomStepForCameraPosition,
    additionalCoordinates,
  );
  return segmentationCube.getMappedDataValue(
    posInLayerSpace,
    additionalCoordinates,
    renderedZoomStepForCameraPosition,
  );
}
export function handlePickCellFromGlobalPosition(
  globalPos: Vector3,
  additionalCoordinates: AdditionalCoordinate[],
) {
  const segmentId = getSegmentIdForPosition(globalPos);

  if (segmentId === 0) {
    return;
  }
  Store.dispatch(setActiveCellAction(segmentId, globalPos, additionalCoordinates));

  const visibleSegmentationLayer = getVisibleSegmentationLayer(Store.getState());
  if (visibleSegmentationLayer == null) {
    return;
  }
  Store.dispatch(
    updateSegmentAction(
      segmentId,
      {
        isVisible: true,
      },
      visibleSegmentationLayer.name,
      undefined,
      true,
    ),
  );
}
export function handleFloodFill(pos: Point2, plane: OrthoView) {
  const globalPosRounded = calculateGlobalPos(Store.getState(), pos).rounded;
  handleFloodFillFromGlobalPosition(globalPosRounded, plane);
}
export function handleFloodFillFromGlobalPosition(globalPos: Vector3, plane: OrthoView) {
  Store.dispatch(floodFillAction(globalPos, plane));
}
const MAX_BRUSH_CHANGE_VALUE = 5;
const BRUSH_CHANGING_CONSTANT = 0.02;
export function changeBrushSizeIfBrushIsActiveBy(factor: number) {
  const currentBrushSize = Store.getState().userConfiguration.brushSize;
  const newBrushSize =
    Math.min(Math.ceil(currentBrushSize * BRUSH_CHANGING_CONSTANT), MAX_BRUSH_CHANGE_VALUE) *
      factor +
    currentBrushSize;
  Store.dispatch(updateUserSettingAction("brushSize", newBrushSize));
}

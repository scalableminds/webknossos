import { V3 } from "libs/mjs";
import memoizeOne from "memoize-one";
import type { AdditionalCoordinate } from "types/api_types";
import type { OrthoView, Point2, Vector3 } from "viewer/constants";
import { ContourModeEnum } from "viewer/constants";
import {
  getLayerByName,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getTransformsForLayer,
  globalToLayerTransformedPosition,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  calculateGlobalPos,
  type PositionWithRounding,
} from "viewer/model/accessors/view_mode_accessor";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import {
  addToContourListAction,
  finishEditingAction,
  floodFillAction,
  resetContourAction,
  setActiveCellAction,
  setContourTracingModeAction,
  startEditingAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import {
  invertTransform,
  transformPointUnscaled,
} from "viewer/model/helpers/transformation_helpers";
import { api, Model, Store } from "viewer/singletons";
import type { WebknossosState } from "viewer/store";

export function handleDrawStart(pos: Point2, plane: OrthoView) {
  const state = Store.getState();
  const globalPosRounded = calculateGlobalPos(state, pos).rounded;
  const layerPos = getUntransformedSegmentationPosition(state, globalPosRounded);

  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DRAW));
  Store.dispatch(startEditingAction(layerPos, plane));
  Store.dispatch(addToContourListAction(layerPos));
}

export function getUntransformedSegmentationPosition(
  state: WebknossosState,
  globalPosRounded: Vector3,
) {
  /*
   * Converts the given position from world space to layer space.
   */
  const { nativelyRenderedLayerName } = state.datasetConfiguration;
  const maybeLayer = Model.getVisibleSegmentationLayer();
  if (maybeLayer == null) {
    throw new Error("Segmentation layer does not exist");
  }

  const layer = getLayerByName(state.dataset, maybeLayer.name);
  const segmentationTransforms = getTransformsForLayer(
    state.dataset,
    layer,
    nativelyRenderedLayerName,
  );
  const layerPos = transformPointUnscaled(invertTransform(segmentationTransforms))(
    globalPosRounded,
  );
  return layerPos;
}

export function handleEraseStart(pos: Point2, plane: OrthoView) {
  const state = Store.getState();
  const globalPosRounded = calculateGlobalPos(state, pos).rounded;
  const layerPos = getUntransformedSegmentationPosition(state, globalPosRounded);

  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
  Store.dispatch(startEditingAction(layerPos, plane));
}
export function handleMoveForDrawOrErase(pos: Point2) {
  const state = Store.getState();
  const globalPosRounded = calculateGlobalPos(state, pos).rounded;
  const layerPos = getUntransformedSegmentationPosition(state, globalPosRounded);
  Store.dispatch(addToContourListAction(layerPos));
}
export function handleEndForDrawOrErase() {
  Store.dispatch(finishEditingAction());
  Store.dispatch(resetContourAction());
}
export function handlePickCell(pos: Point2) {
  const state = Store.getState();
  const globalPos = calculateGlobalPos(state, pos);

  return handlePickCellFromGlobalPosition(globalPos, state.flycam.additionalCoordinates || []);
}

const _getSegmentIdForPosition = (mapped: boolean) => (globalPos: Vector3) => {
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

  return mapped
    ? segmentationCube.getMappedDataValue(
        posInLayerSpace,
        additionalCoordinates,
        renderedZoomStepForCameraPosition,
      )
    : segmentationCube.getDataValue(
        posInLayerSpace,
        additionalCoordinates,
        null,
        renderedZoomStepForCameraPosition,
      );
};
export const getSegmentIdForPosition = memoizeOne(_getSegmentIdForPosition(true), ([a], [b]) =>
  V3.isEqual(a, b),
);
export const getUnmappedSegmentIdForPosition = memoizeOne(
  _getSegmentIdForPosition(false),
  ([a], [b]) => V3.isEqual(a, b),
);

const _getSegmentIdInfoForPosition = (globalPos: Vector3) => {
  // This function will return the currently loaded segment ID for a given position.
  // If the corresponding bucket is not loaded at the moment, the return value will be 0.
  // See getSegmentIdForPositionAsync if the bucket loading should be awaited before returning the ID.
  const layer = Model.getVisibleSegmentationLayer();
  const { additionalCoordinates } = Store.getState().flycam;

  if (!layer) {
    return { mapped: 0, unmapped: 0 };
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

  return {
    mapped: segmentationCube.getMappedDataValue(
      posInLayerSpace,
      additionalCoordinates,
      renderedZoomStepForCameraPosition,
    ),
    unmapped: segmentationCube.getDataValue(
      posInLayerSpace,
      additionalCoordinates,
      null,
      renderedZoomStepForCameraPosition,
    ),
  };
};
export const getSegmentIdInfoForPosition = memoizeOne(_getSegmentIdInfoForPosition, ([a], [b]) =>
  V3.isEqual(a, b),
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
  globalPos: PositionWithRounding,
  additionalCoordinates: AdditionalCoordinate[],
) {
  const segmentId = getSegmentIdForPosition(globalPos.rounded);

  if (segmentId === 0) {
    return;
  }
  const visibleSegmentationLayer = getVisibleSegmentationLayer(Store.getState());
  if (visibleSegmentationLayer == null) {
    return;
  }
  const state = Store.getState();
  const layerPos = getUntransformedSegmentationPosition(state, globalPos.floating);
  Store.dispatch(setActiveCellAction(segmentId, layerPos, additionalCoordinates));

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
export function handleFloodFill(state: WebknossosState, screenPos: Point2, plane: OrthoView) {
  const globalPosRounded = calculateGlobalPos(Store.getState(), screenPos).rounded;
  handleFloodFillFromGlobalPosition(state, globalPosRounded, plane);
}
export function handleFloodFillFromGlobalPosition(
  state: WebknossosState,
  globalPos: Vector3,
  plane: OrthoView,
) {
  const positionInLayerSpace = getUntransformedSegmentationPosition(state, globalPos);
  Store.dispatch(floodFillAction(positionInLayerSpace, plane));
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

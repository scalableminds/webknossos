// @flow
import { saveAs } from "file-saver";

import type { APIDataset } from "admin/api_flow_types";
import { ResolutionInfo, getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import {
  changeActiveIsosurfaceCellAction,
  type ChangeActiveIsosurfaceCellAction,
} from "oxalis/model/actions/segmentation_actions";
import { ControlModeEnum, type Vector3 } from "oxalis/constants";
import { type FlycamAction, FlycamActions } from "oxalis/model/actions/flycam_actions";
import type {
  ImportIsosurfaceFromStlAction,
  RemoveIsosurfaceAction,
} from "oxalis/model/actions/annotation_actions";
import {
  type Saga,
  _takeEvery,
  call,
  put,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import { stlIsosurfaceConstants } from "oxalis/view/right-menu/meshes_view";
import { computeIsosurface } from "admin/admin_rest_api";
import { getFlooredPosition } from "oxalis/model/accessors/flycam_accessor";
import { setImportingMeshStateAction } from "oxalis/model/actions/ui_actions";
import { zoomedAddressToAnotherZoomStepWithInfo } from "oxalis/model/helpers/position_converter";
import DataLayer from "oxalis/model/data_layer";
import Model from "oxalis/model";
import ThreeDMap from "libs/ThreeDMap";
import * as Utils from "libs/utils";
import exportToStl from "libs/stl_exporter";
import getSceneController from "oxalis/controller/scene_controller_provider";
import parseStlBuffer from "libs/parse_stl_buffer";
import window from "libs/window";
import Toast from "libs/toast";
import messages from "messages";

const isosurfacesMap: Map<number, ThreeDMap<boolean>> = new Map();
const cubeSize = [256, 256, 256];

export function isIsosurfaceStl(buffer: ArrayBuffer): boolean {
  const dataView = new DataView(buffer);
  const isIsosurface = stlIsosurfaceConstants.isosurfaceMarker.every(
    (marker, index) => dataView.getUint8(index) === marker,
  );
  return isIsosurface;
}

function getMapForSegment(segmentId: number): ThreeDMap<boolean> {
  const maybeMap = isosurfacesMap.get(segmentId);
  if (maybeMap == null) {
    const newMap = new ThreeDMap();
    isosurfacesMap.set(segmentId, newMap);
    return newMap;
  }
  return maybeMap;
}

function removeMapForSegment(segmentId: number): void {
  isosurfacesMap.delete(segmentId);
}

function getZoomedCubeSize(zoomStep: number, resolutionInfo: ResolutionInfo): Vector3 {
  const [x, y, z] = zoomedAddressToAnotherZoomStepWithInfo(
    [...cubeSize, 0],
    resolutionInfo,
    zoomStep,
  );
  // Drop the last element of the Vector4;
  return [x, y, z];
}

function clipPositionToCubeBoundary(
  position: Vector3,
  zoomStep: number,
  resolutionInfo: ResolutionInfo,
): Vector3 {
  const zoomedCubeSize = getZoomedCubeSize(zoomStep, resolutionInfo);
  const currentCube = Utils.map3((el, idx) => Math.floor(el / zoomedCubeSize[idx]), position);
  const clippedPosition = Utils.map3((el, idx) => el * zoomedCubeSize[idx], currentCube);
  return clippedPosition;
}

function getNeighborPosition(
  clippedPosition: Vector3,
  neighborId: number,
  zoomStep: number,
  resolutionInfo: ResolutionInfo,
): Vector3 {
  // front_xy, front_xz, front_yz, back_xy, back_xz, back_yz
  const neighborLookup = [[0, 0, -1], [0, -1, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];

  const zoomedCubeSize = getZoomedCubeSize(zoomStep, resolutionInfo);
  const neighborMultiplier = neighborLookup[neighborId];
  const neighboringPosition = [
    clippedPosition[0] + neighborMultiplier[0] * zoomedCubeSize[0],
    clippedPosition[1] + neighborMultiplier[1] * zoomedCubeSize[1],
    clippedPosition[2] + neighborMultiplier[2] * zoomedCubeSize[2],
  ];
  return neighboringPosition;
}

// Since isosurface rendering is only supported in view mode right now
// (active cell id is only defined in volume annotations, mapping support
// for datasets is limited in volume tracings etc.), we use another state
// variable for the "active cell" in view mode. The cell can be changed via
// shift+click (similar to the volume tracing mode).
let currentViewIsosurfaceCellId = 0;
// The calculation of an isosurface is spread across multiple requests.
// In order to avoid, that too many chunks are computed for one user interaction,
// we store the amount of requests in a batch per segment.
const batchCounterPerSegment: { [key: number]: number } = {};
const MAXIMUM_BATCH_SIZE = 50;

function* changeActiveIsosurfaceCell(action: ChangeActiveIsosurfaceCellAction): Saga<void> {
  currentViewIsosurfaceCellId = action.cellId;

  yield* call(ensureSuitableIsosurface, null, action.seedPosition);
}

// This function either returns the activeCellId of the current volume tracing
// or the view-only active cell id
function* getCurrentCellId(): Saga<number> {
  const volumeTracing = yield* select(state => state.tracing.volume);
  if (volumeTracing != null) {
    return volumeTracing.activeCellId;
  }

  return currentViewIsosurfaceCellId;
}

function* ensureSuitableIsosurface(
  maybeFlycamAction: ?FlycamAction,
  seedPosition?: Vector3,
): Saga<void> {
  const segmentId = yield* call(getCurrentCellId);
  if (segmentId === 0) {
    return;
  }
  const renderIsosurfaces = yield* select(state => state.datasetConfiguration.renderIsosurfaces);
  const isControlModeSupported = yield* select(
    state =>
      state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW || window.allowIsosurfaces,
  );
  if (!renderIsosurfaces || !isControlModeSupported) {
    return;
  }
  const dataset = yield* select(state => state.dataset);
  const layer = Model.getSegmentationLayer();
  if (!layer) {
    return;
  }
  const position =
    seedPosition != null ? seedPosition : yield* select(state => getFlooredPosition(state.flycam));
  const resolutionInfo = getResolutionInfo(layer.new_resolutions);

  const preferredZoomStep = window.__isosurfaceZoomStep != null ? window.__isosurfaceZoomStep : 1;
  const zoomStep = resolutionInfo.getClosestExistingIndex(preferredZoomStep);

  const clippedPosition = clipPositionToCubeBoundary(position, zoomStep, resolutionInfo);

  batchCounterPerSegment[segmentId] = 0;
  yield* call(
    loadIsosurfaceWithNeighbors,
    dataset,
    layer,
    segmentId,
    clippedPosition,
    zoomStep,
    resolutionInfo,
  );
}

function* loadIsosurfaceWithNeighbors(
  dataset: APIDataset,
  layer: DataLayer,
  segmentId: number,
  clippedPosition: Vector3,
  zoomStep: number,
  resolutionInfo: ResolutionInfo,
): Saga<void> {
  let positionsToRequest = [clippedPosition];

  while (positionsToRequest.length > 0) {
    const position = positionsToRequest.shift();
    const neighbors = yield* call(
      maybeLoadIsosurface,
      dataset,
      layer,
      segmentId,
      position,
      zoomStep,
      resolutionInfo,
    );
    positionsToRequest = positionsToRequest.concat(neighbors);
  }
}

function hasBatchCounterExceededLimit(segmentId: number): boolean {
  return (
    batchCounterPerSegment[segmentId] > (window.__isosurfaceMaxBatchSize || MAXIMUM_BATCH_SIZE)
  );
}

function* maybeLoadIsosurface(
  dataset: APIDataset,
  layer: DataLayer,
  segmentId: number,
  clippedPosition: Vector3,
  zoomStep: number,
  resolutionInfo: ResolutionInfo,
): Saga<Array<Vector3>> {
  const threeDMap = getMapForSegment(segmentId);

  if (threeDMap.get(clippedPosition)) {
    return [];
  }
  if (hasBatchCounterExceededLimit(segmentId)) {
    return [];
  }
  batchCounterPerSegment[segmentId]++;

  threeDMap.set(clippedPosition, true);

  const voxelDimensions = window.__isosurfaceVoxelDimensions || [4, 4, 4];
  const dataStoreHost = yield* select(state => state.dataset.dataStore.url);

  const { buffer: responseBuffer, neighbors } = yield* call(
    computeIsosurface,
    dataStoreHost,
    dataset,
    layer,
    {
      position: clippedPosition,
      zoomStep,
      segmentId,
      voxelDimensions,
      cubeSize,
    },
  );

  // Check again whether the limit was exceeded, since this variable could have been
  // set in the mean time by ctrl-clicking the segment to remove it
  if (hasBatchCounterExceededLimit(segmentId)) {
    return [];
  }

  const vertices = new Float32Array(responseBuffer);
  getSceneController().addIsosurfaceFromVertices(vertices, segmentId);

  return neighbors.map(neighbor =>
    getNeighborPosition(clippedPosition, neighbor, zoomStep, resolutionInfo),
  );
}

function* downloadActiveIsosurfaceCell(): Saga<void> {
  const currentId = yield* call(getCurrentCellId);
  const sceneController = getSceneController();
  const geometry = sceneController.getIsosurfaceGeometry(currentId);
  if (geometry == null) {
    const errorMessages = messages["tracing.not_isosurface_available_to_download"];
    Toast.error(errorMessages[0], { sticky: false }, errorMessages[1]);
    return;
  }
  const stl = exportToStl(geometry);

  // Encode isosurface and cell id property
  const { isosurfaceMarker, cellIdIndex } = stlIsosurfaceConstants;
  isosurfaceMarker.forEach((marker, index) => {
    stl.setUint8(index, marker);
  });
  stl.setUint32(cellIdIndex, currentId, true);

  const blob = new Blob([stl]);
  yield* call(saveAs, blob, `isosurface-${currentId}.stl`);
}

function* importIsosurfaceFromStl(action: ImportIsosurfaceFromStlAction): Saga<void> {
  const { buffer } = action;
  const dataView = new DataView(buffer);
  const segmentId = dataView.getUint32(stlIsosurfaceConstants.cellIdIndex, true);
  const geometry = yield* call(parseStlBuffer, buffer);
  getSceneController().addIsosurfaceFromGeometry(geometry, segmentId);
  yield* put(setImportingMeshStateAction(false));
}

function* removeIsosurface(action: RemoveIsosurfaceAction): Saga<void> {
  const { cellId } = action;
  getSceneController().removeIsosurfaceById(cellId);
  removeMapForSegment(cellId);

  // Set batch counter to maximum so that potentially running requests are aborted
  batchCounterPerSegment[cellId] = 1 + (window.__isosurfaceMaxBatchSize || MAXIMUM_BATCH_SIZE);

  const currentCellId = yield* call(getCurrentCellId);
  if (cellId === currentCellId) {
    // Clear the active cell id to avoid that the isosurface is immediately reconstructed
    // when the position changes.
    yield* put(changeActiveIsosurfaceCellAction(0, [0, 0, 0]));
  }
}

export default function* isosurfaceSaga(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery(FlycamActions, ensureSuitableIsosurface);
  yield _takeEvery(
    ["CHANGE_ACTIVE_ISOSURFACE_CELL", "SET_ACTIVE_CELL"],
    changeActiveIsosurfaceCell,
  );
  yield _takeEvery("TRIGGER_ISOSURFACE_DOWNLOAD", downloadActiveIsosurfaceCell);
  yield _takeEvery("IMPORT_ISOSURFACE_FROM_STL", importIsosurfaceFromStl);
  yield _takeEvery("REMOVE_ISOSURFACE", removeIsosurface);
}

// @flow
import { saveAs } from "file-saver";

import type { APIDataset } from "admin/api_flow_types";
import type { ChangeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import { ControlModeEnum, type Vector3 } from "oxalis/constants";
import { type FlycamAction, FlycamActions } from "oxalis/model/actions/flycam_actions";
import type { ImportIsosurfaceFromStlAction } from "oxalis/model/actions/annotation_actions";
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
import { zoomedAddressToAnotherZoomStep } from "oxalis/model/helpers/position_converter";
import DataLayer from "oxalis/model/data_layer";
import Model from "oxalis/model";
import ThreeDMap from "libs/ThreeDMap";
import * as Utils from "libs/utils";
import exportToStl from "libs/stl_exporter";
import getSceneController from "oxalis/controller/scene_controller_provider";
import parseStlBuffer from "libs/parse_stl_buffer";
import window from "libs/window";

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

function getZoomedCubeSize(zoomStep: number, resolutions: Array<Vector3>): Vector3 {
  const [x, y, z] = zoomedAddressToAnotherZoomStep([...cubeSize, 0], resolutions, zoomStep);
  // Drop the last element of the Vector4;
  return [x, y, z];
}

function clipPositionToCubeBoundary(
  position: Vector3,
  zoomStep: number,
  resolutions: Array<Vector3>,
): Vector3 {
  const zoomedCubeSize = getZoomedCubeSize(zoomStep, resolutions);
  const currentCube = Utils.map3((el, idx) => Math.floor(el / zoomedCubeSize[idx]), position);
  const clippedPosition = Utils.map3((el, idx) => el * zoomedCubeSize[idx], currentCube);
  return clippedPosition;
}

function getNeighborPosition(
  clippedPosition: Vector3,
  neighborId: number,
  zoomStep: number,
  resolutions: Array<Vector3>,
): Vector3 {
  // front_xy, front_xz, front_yz, back_xy, back_xz, back_yz
  const neighborLookup = [[0, 0, -1], [0, -1, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];

  const zoomedCubeSize = getZoomedCubeSize(zoomStep, resolutions);
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
let currentIsosurfaceCellId = 0;
// The calculation of an isosurface is spread across multiple requests.
// In order to avoid, that too many chunks are computed for one user interaction,
// we store the amount of requests in a batch per segment.
const batchCounterPerSegment: { [key: number]: number } = {};
const MAXIMUM_BATCH_SIZE = 30;

function* changeActiveIsosurfaceCell(action: ChangeActiveIsosurfaceCellAction): Saga<void> {
  currentIsosurfaceCellId = action.cellId;

  yield* call(ensureSuitableIsosurface, null, action.seedPosition);
}

function* ensureSuitableIsosurface(
  maybeFlycamAction: ?FlycamAction,
  seedPosition?: Vector3,
): Saga<void> {
  const segmentId = currentIsosurfaceCellId;
  if (segmentId === 0) {
    return;
  }
  const renderIsosurfaces = yield* select(state => state.datasetConfiguration.renderIsosurfaces);
  const isControlModeSupported = yield* select(
    state => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
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
  const { resolutions } = layer;
  const preferredZoomStep = window.__isosurfaceZoomStep != null ? window.__isosurfaceZoomStep : 1;
  const zoomStep = Math.min(preferredZoomStep, resolutions.length - 1);

  const clippedPosition = clipPositionToCubeBoundary(position, zoomStep, resolutions);

  batchCounterPerSegment[segmentId] = 0;
  yield* call(
    loadIsosurfaceWithNeighbors,
    dataset,
    layer,
    segmentId,
    clippedPosition,
    zoomStep,
    resolutions,
  );
}

function* loadIsosurfaceWithNeighbors(
  dataset: APIDataset,
  layer: DataLayer,
  segmentId: number,
  clippedPosition: Vector3,
  zoomStep: number,
  resolutions: Array<Vector3>,
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
      resolutions,
    );
    positionsToRequest = positionsToRequest.concat(neighbors);
  }
}

function* maybeLoadIsosurface(
  dataset: APIDataset,
  layer: DataLayer,
  segmentId: number,
  clippedPosition: Vector3,
  zoomStep: number,
  resolutions: Array<Vector3>,
): Saga<Array<Vector3>> {
  const threeDMap = getMapForSegment(segmentId);

  if (threeDMap.get(clippedPosition)) {
    return [];
  }
  if (batchCounterPerSegment[segmentId] > (window.__isosurfaceMaxBatchSize || MAXIMUM_BATCH_SIZE)) {
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

  const vertices = new Float32Array(responseBuffer);
  getSceneController().addIsosurfaceFromVertices(vertices, segmentId);

  return neighbors.map(neighbor =>
    getNeighborPosition(clippedPosition, neighbor, zoomStep, resolutions),
  );
}

function* downloadActiveIsosurfaceCell(): Saga<void> {
  const sceneController = getSceneController();
  const geometry = sceneController.getIsosurfaceGeometry(currentIsosurfaceCellId);

  const stl = exportToStl(geometry);

  // Encode isosurface and cell id property
  const { isosurfaceMarker, cellIdIndex } = stlIsosurfaceConstants;
  isosurfaceMarker.forEach((marker, index) => {
    stl.setUint8(index, marker);
  });
  stl.setUint32(cellIdIndex, currentIsosurfaceCellId, true);

  const blob = new Blob([stl]);
  yield* call(saveAs, blob, `isosurface-${currentIsosurfaceCellId}.stl`);
}

function* importIsosurfaceFromStl(action: ImportIsosurfaceFromStlAction): Saga<void> {
  const { buffer } = action;
  const dataView = new DataView(buffer);
  const segmentationId = dataView.getUint32(stlIsosurfaceConstants.cellIdIndex, true);
  const geometry = yield* call(parseStlBuffer, buffer);
  getSceneController().addIsosurfaceFromGeometry(geometry, segmentationId);
  yield* put(setImportingMeshStateAction(false));
}

export default function* isosurfaceSaga(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery(FlycamActions, ensureSuitableIsosurface);
  yield _takeEvery("CHANGE_ACTIVE_ISOSURFACE_CELL", changeActiveIsosurfaceCell);
  yield _takeEvery("TRIGGER_ISOSURFACE_DOWNLOAD", downloadActiveIsosurfaceCell);
  yield _takeEvery("IMPORT_ISOSURFACE_FROM_STL", importIsosurfaceFromStl);
}

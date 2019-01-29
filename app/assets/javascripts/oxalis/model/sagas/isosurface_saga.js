// @flow
import type { APIDataset } from "admin/api_flow_types";
import type { ChangeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import { ControlModeEnum, type Vector3 } from "oxalis/constants";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import { type Saga, _takeEvery, select, call, take } from "oxalis/model/sagas/effect-generators";
import { computeIsosurface } from "admin/admin_rest_api";
import { getFlooredPosition } from "oxalis/model/accessors/flycam_accessor";
import { zoomedAddressToAnotherZoomStep } from "oxalis/model/helpers/position_converter";
import DataLayer from "oxalis/model/data_layer";
import Model from "oxalis/model";
import * as Utils from "libs/utils";
import getSceneController from "oxalis/controller/scene_controller_provider";

class ThreeDMap<T> {
  map: Map<number, ?Map<number, ?Map<number, T>>>;

  constructor() {
    this.map = new Map();
  }

  get(vec: Vector3): ?T {
    const [x, y, z] = vec;
    const atX = this.map.get(x);
    if (atX == null) {
      return null;
    }
    const atY = atX.get(y);
    if (atY == null) {
      return null;
    }
    return atY.get(z);
  }

  set(vec: Vector3, value: T): void {
    const [x, y, z] = vec;
    if (this.map.get(x) == null) {
      this.map.set(x, new Map());
    }
    // Flow doesn't understand that the access to X
    // is guaranteed to be not null due to the above code.
    // $FlowFixMe
    if (this.map.get(x).get(y) == null) {
      // $FlowFixMe
      this.map.get(x).set(y, new Map());
    }
    // $FlowFixMe
    this.map
      .get(x)
      .get(y)
      .set(z, value);
  }
}
const isosurfacesMap: Map<number, ThreeDMap<boolean>> = new Map();
const cubeSize = [256, 256, 256];

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

  yield* call(ensureSuitableIsosurface);
}

function* ensureSuitableIsosurface(): Saga<void> {
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
  const position = yield* select(state => getFlooredPosition(state.flycam));
  const { resolutions } = layer;
  const preferredZoomStep = 1;
  const zoomStep = Math.min(preferredZoomStep, resolutions.length);

  const clippedPosition = clipPositionToCubeBoundary(position, zoomStep, resolutions);

  batchCounterPerSegment[segmentId] = 0;
  yield* call(
    maybeLoadIsosurface,
    dataset,
    layer,
    segmentId,
    clippedPosition,
    zoomStep,
    resolutions,
  );
}

function* maybeLoadIsosurface(
  dataset: APIDataset,
  layer: DataLayer,
  segmentId: number,
  clippedPosition: Vector3,
  zoomStep: number,
  resolutions: Array<Vector3>,
): Saga<void> {
  const threeDMap = getMapForSegment(segmentId);

  if (threeDMap.get(clippedPosition)) {
    return;
  }
  if (batchCounterPerSegment[segmentId] > MAXIMUM_BATCH_SIZE) {
    return;
  }
  batchCounterPerSegment[segmentId]++;

  threeDMap.set(clippedPosition, true);

  const voxelDimensions = [4, 4, 4];
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
  getSceneController().addIsosurface(vertices, segmentId);

  for (const neighbor of neighbors) {
    const neighborPosition = getNeighborPosition(clippedPosition, neighbor, zoomStep, resolutions);
    yield* call(
      maybeLoadIsosurface,
      dataset,
      layer,
      segmentId,
      neighborPosition,
      zoomStep,
      resolutions,
    );
  }
}

export default function* isosurfaceSaga(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery(FlycamActions, ensureSuitableIsosurface);
  yield _takeEvery("CHANGE_ACTIVE_ISOSURFACE_CELL", changeActiveIsosurfaceCell);
}

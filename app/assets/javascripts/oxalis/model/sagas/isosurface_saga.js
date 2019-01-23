// @flow
import type { APIDataset } from "admin/api_flow_types";
import { ControlModeEnum, type Vector3 } from "oxalis/constants";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import { type Saga, _takeEvery, select, call, take } from "oxalis/model/sagas/effect-generators";
import { computeIsosurface } from "admin/admin_rest_api";
import { getActiveCellId } from "oxalis/model/accessors/volumetracing_accessor";
import { getFlooredPosition } from "oxalis/model/accessors/flycam_accessor";
import { map3 } from "libs/utils";
import DataLayer from "oxalis/model/data_layer";
import Model from "oxalis/model";
import getSceneController from "oxalis/controller/scene_controller_provider";
import * as Utils from "libs/utils";

class ThreeDMap<T> {
  map: Map<number, ?Map<number, ?Map<number, T>>>;

  constructor() {
    this.map = new Map();
  }

  get(vec: Vector3): ?T {
    const [x, y, z] = vec;
    if (this.map[x] == null) {
      return null;
    }
    if (this.map[x][y] == null) {
      return null;
    }
    if (this.map[x][y][z] == null) {
      return null;
    }
    return this.map[x][y][z];
  }

  set(vec: Vector3, value: T): void {
    const [x, y, z] = vec;
    if (this.map[x] == null) {
      this.map[x] = new Map();
    }
    if (this.map[x][y] == null) {
      this.map[x][y] = new Map();
    }
    this.map[x][y][z] = value;
  }
}
const isosurfacesMap: Map<number, ThreeDMap<boolean>> = new Map();
const cubeSize = [256, 256, 256];

function* ensureSuitableIsosurface(): Saga<void> {
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
  const existentMagnifications = layer.resolutions.map(resolution => Math.max(...resolution));
  const preferredZoomStep = 1;
  const zoomStep = Utils.clamp(
    Math.min(...existentMagnifications),
    preferredZoomStep,
    Math.max(...existentMagnifications),
  );

  const volumeTracing = yield* select(state => state.tracing.volume);
  if (!volumeTracing) {
    return;
  }
  const segmentId = getActiveCellId(volumeTracing);

  if (segmentId === 0 || segmentId == null) {
    return;
  }

  if (isosurfacesMap.get(segmentId) == null) {
    isosurfacesMap.set(segmentId, new ThreeDMap());
  }
  const threeDMap = isosurfacesMap.get(segmentId);

  const zoomedCubeSize = map3(el => el * 2 ** zoomStep, cubeSize);
  const currentCube = map3((el, idx) => Math.floor(el / zoomedCubeSize[idx]), position);
  const cubedPostion = map3((el, idx) => el * zoomedCubeSize[idx], currentCube);
  if (threeDMap.get(currentCube)) {
    return;
  }

  threeDMap.set(currentCube, true);
  yield* call(loadIsosurface, dataset, layer, segmentId, cubedPostion, zoomStep);
}

function* loadIsosurface(
  dataset: APIDataset,
  layer: DataLayer,
  segmentId: number,
  position: Vector3,
  zoomStep: number,
): Saga<void> {
  const voxelDimensions = [2, 2, 2];
  const dataStoreHost = yield* select(state => state.dataset.dataStore.url);

  const responseBuffer = yield* call(
    computeIsosurface,
    dataStoreHost,
    dataset,
    layer,
    position,
    zoomStep,
    segmentId,
    voxelDimensions,
    cubeSize,
  );
  const vertices = new Float32Array(responseBuffer);
  getSceneController().addIsosurface(vertices, segmentId);
}

export default function* isosurfaceSaga(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery(FlycamActions, ensureSuitableIsosurface);
}

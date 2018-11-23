import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import { type Saga, _takeEvery, select, take } from "oxalis/model/sagas/effect-generators";
import { V3 } from "libs/mjs";
import type { Vector3 } from "oxalis/constants";
import { computeIsosurface } from "admin/admin_rest_api";
import { getFlooredPosition } from "oxalis/model/accessors/flycam_accessor";
import { map3 } from "libs/utils";
import DataLayer from "oxalis/model/data_layer";
import Model from "oxalis/model";
import getSceneController from "oxalis/controller/scene_controller_provider";

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
const cubeSize = 256;

function* ensureSuitableIsosurface(): Saga<void> {
  const renderIsosurfaces = yield* select(state => state.datasetConfiguration.renderIsosurfaces);
  if (!renderIsosurfaces) {
    return;
  }
  const dataset = yield* select(state => state.dataset);
  const layer = Model.getSegmentationLayer();
  const position = yield* select(state => getFlooredPosition(state.flycam));
  const segmentId = layer.cube.getDataValue(position, null, 1);

  if (segmentId === 0 || segmentId == null) {
    return;
  }

  if (isosurfacesMap.get(segmentId) == null) {
    isosurfacesMap.set(segmentId, new ThreeDMap());
  }
  const threeDMap = isosurfacesMap.get(segmentId);

  const zoomStep = 1;
  const currentCube = map3(el => Math.floor(el / (cubeSize * 2 ** zoomStep)), position);
  const cubedPostion = map3(el => el * cubeSize * 2 ** zoomStep, currentCube);
  if (threeDMap.get(currentCube)) {
    return;
  }

  threeDMap.set(currentCube, true);
  loadIsosurface(dataset, layer, segmentId, cubedPostion, zoomStep);
}

async function loadIsosurface(
  dataset: APIDataset,
  layer: DataLayer,
  segmentId: number,
  position: Vector3,
  zoomStep: number,
) {
  const voxelDimensions = [2, 2, 2];

  const responseBuffer = await computeIsosurface(
    dataset,
    layer,
    V3.toArray(V3.sub(position, voxelDimensions)),
    zoomStep,
    segmentId,
    voxelDimensions,
    // todo: change when cubeSize is an vector
    cubeSize + voxelDimensions[0],
  );
  const vertices = new Float32Array(responseBuffer);
  getSceneController().addIsosurface(vertices, segmentId);
}

export default function* isosurfaceSaga(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery(FlycamActions, ensureSuitableIsosurface);
}

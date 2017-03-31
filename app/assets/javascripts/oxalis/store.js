/**
 * store.js
 * @flow
 */

 /* eslint-disable no-useless-computed-key */

import { createStore, applyMiddleware } from "redux";
import createSagaMiddleware from "redux-saga";
import reduceReducers from "oxalis/model/helpers/reduce_reducers";
import type { Vector3, Vector6, ModeType } from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import SettingsReducer from "oxalis/model/reducers/settings_reducer";
import TaskReducer from "oxalis/model/reducers/task_reducer";
import SaveReducer from "oxalis/model/reducers/save_reducer";
import SkeletonTracingReducer from "oxalis/model/reducers/skeletontracing_reducer";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import FlycamReducer from "oxalis/model/reducers/flycam_reducer";
import rootSaga from "oxalis/model/sagas/root_saga";
import timestampMiddleware from "oxalis/model/helpers/timestamp_middleware";
import overwriteActionMiddleware from "oxalis/model/helpers/overwrite_action_middleware";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";

export type CommentType = {
  node: number;
  content: string;
};

export type EdgeType = {
  source: number,
  target: number,
};

export type NodeType = {
  id: number,
  position: Vector3,
  rotation: Vector3,
  bitDepth: number,
  viewport: number,
  resolution: number,
  radius: number,
  timestamp: number,
};


export type BranchPointType = {
  id: number;
  timestamp: number;
};

export type NodeMapType = {[number]: NodeType};

export type BoundingBoxObjectType = {
  topLeft: Vector3,
  width: number,
  height: number,
  depth: number,
};

export type TreeType = {
  treeId: number,
  color: Vector3,
  name: string,
  timestamp: number,
  comments: Array<CommentType>,
  branchPoints: Array<BranchPointType>,
  edges: Array<EdgeType>,
  nodes: NodeMapType,
};

export type SkeletonContentDataType = {
  activeNode: null | number,
  trees: Array<TreeType>,
  zoomLevel: number,
  customLayers: null,
};

export type VolumeContentDataType = {
  activeCell: null | number,
  customLayers: Array<Object>,
  maxCoordinates: BoundingBoxObjectType,
  customLayers: ?Array<Object>,
  name: string,
};

export type MappingType = {
  parent?: string;
  name: string;
  classes?: Array<Array<number>>;
};

export type CategoryType = "color" | "segmentation";
export type ElementClassType = "uint8" | "uint16" | "uint32";

export type DataLayerType = {
  name: string,
  category: CategoryType,
  maxCoordinates: BoundingBoxObjectType,
  resolutions: Array<number>,
  // fallback: any,
  elementClass: ElementClassType,
  mappings: Array<MappingType>,
}

export type RestrictionsType = {
  allowAccess: boolean,
  allowUpdate: boolean,
  allowFinish: boolean,
  allowDownload: boolean,
};

export type AllowedModeType = "orthogonal" | "oblique" | "flight" | "volume";

export type SettingsType = {
  advancedOptionsAllowed: boolean,
  allowedModes: Array<AllowedModeType>,
  branchPointsAllowed: boolean,
  somaClickingAllowed: boolean,
};

export type DataStoreInfoType = {
  name: string,
  url: string,
  typ: string,
  accessToken?: string,
}

export type DatasetType = {
 name: string,
 dataStore: DataStoreInfoType,
 scale: Vector3,
 dataLayers: Array<DataLayerType>
};

export type TreeMapType = {[number]: TreeType};

export type SkeletonTracingType = {
  type: "skeleton",
  activeTreeId: ?number,
  activeNodeId: ?number,
  trees: TreeMapType,
  viewMode: ModeType, // SkeletonViewModeType,
  tracingId: string,
  tracingType: "Explorational" | "Task" | "View" | "CompoundTask" | "CompoundProject" | "CompoundTaskType",
  name: string,
  version: number,
  restrictions: RestrictionsType & SettingsType,
};

export type VolumeTracingType = {
  type: "volume",
  name: string,
  version: number,
  viewMode: ModeType, // VolumeViewModeType,
  cubes: [],
  activeCellId: ?number,
  controlMode: "Trace",
  tracingId: string,
  tracingType: "Explorational" | "Task" | "View" | "CompoundTask" | "CompoundProject" | "CompoundTaskType",
  restrictions: RestrictionsType & SettingsType,
};

export type ReadOnlyTracingType = {
  type: "readonly",
  name: string,
  version: 0,
  viewMode: 0,
  controlMode: "View",
  tracingId: string,
  tracingType: "View",
  restrictions: RestrictionsType & SettingsType,
  // restrictions: {
  //   branchPointsAllowed: false,
  //   allowUpdate: false,
  //   allowFinish: false,
  //   allowAccess: true,
  //   allowDownload: false,
  //   somaClickingAllowed: false,
  //   advancedOptionsAllowed: false,
  //   allowedModes: Array<"orthogonal">,
  // },
};

export type TracingType = SkeletonTracingType | VolumeTracingType | ReadOnlyTracingType;

export type DatasetLayerConfigurationType = {
  color: Vector3,
  brightness: number,
  contrast: number,
};

export type DatasetConfigurationType = {
  datasetName: string,
  fourBit: boolean,
  interpolation: boolean,
  keyboardDelay: number,
  layers: {
    [name:string]: DatasetLayerConfigurationType,
  },
  quality: number,
  segmentationOpacity: number,
};

export type UserConfigurationType = {
  clippingDistance: number,
  clippingDistanceArbitrary: number,
  crosshairSize: number,
  displayCrosshair: boolean,
  dynamicSpaceDirection: boolean,
  firstVisToggle: boolean,
  inverseX: boolean,
  inverseY: boolean,
  isosurfaceBBsize: number,
  isosurfaceDisplay: boolean,
  isosurfaceResolution: number,
  keyboardDelay: number,
  mouseRotateValue: number,
  moveValue: number,
  moveValue3d: number,
  newNodeNewTree: boolean,
  overrideNodeRadius: boolean,
  particleSize: number,
  radius: number,
  rotateValue: number,
  scale: number,
  scaleValue: number,
  sortCommentsAsc: boolean,
  sortTreesByName: boolean,
  sphericalCapRadius: number,
  tdViewDisplayPlanes: boolean,
};

export type TemporaryConfigurationType = {
  boundingBox: Vector6,
};

export type TaskType = {
  taskId: number,
};

export type SaveStateType = {
  isBusy: boolean,
  queue: Array<UpdateAction>,
  lastSaveTimestamp: number,
};

export type FlycamType = {
  zoomStep: number,
  currentMatrix: Matrix4x4,
  spaceDirectionOrtho: [-1 | 1, -1 | 1, -1 | 1],
}

export type OxalisState = {
  datasetConfiguration: DatasetConfigurationType,
  userConfiguration: UserConfigurationType,
  temporaryConfiguration: TemporaryConfigurationType,
  dataset: DatasetType,
  tracing: TracingType,
  task: ?TaskType,
  save: SaveStateType,
  flycam: FlycamType,
};

const defaultState: OxalisState = {
  datasetConfiguration: {
    datasetName: "",
    fourBit: true,
    interpolation: false,
    keyboardDelay: 342,
    layers: {},
    quality: 0,
    segmentationOpacity: 20,
  },
  userConfiguration: {
    clippingDistance: 50,
    clippingDistanceArbitrary: 64,
    crosshairSize: 0.1,
    displayCrosshair: true,
    dynamicSpaceDirection: true,
    firstVisToggle: false,
    inverseX: false,
    inverseY: false,
    isosurfaceBBsize: 1,
    isosurfaceDisplay: false,
    isosurfaceResolution: 80,
    keyboardDelay: 200,
    mouseRotateValue: 0.004,
    moveValue: 300,
    moveValue3d: 300,
    newNodeNewTree: false,
    overrideNodeRadius: true,
    particleSize: 5,
    radius: 5,
    rotateValue: 0.01,
    scale: 1,
    scaleValue: 0.05,
    sortCommentsAsc: true,
    sortTreesByName: false,
    sphericalCapRadius: 140,
    tdViewDisplayPlanes: true,
  },
  temporaryConfiguration: {
    boundingBox: [0, 0, 0, 0, 0, 0],
  },
  task: null,
  dataset: {
    name: "Test Dataset",
    scale: [5, 5, 5],
    dataStore: {
      name: "localhost",
      url: "http://localhost:9000",
      typ: "webknossos-store",
    },
    dataLayers: [],
  },
  tracing: {
    type: "skeleton",
    trees: {},
    name: "",
    version: 0,
    viewMode: 0,
    tracingId: "",
    tracingType: "Explorational",
    activeTreeId: null,
    activeNodeId: null,
    restrictions: {
      branchPointsAllowed: true,
      allowUpdate: true,
      allowFinish: true,
      allowAccess: true,
      allowDownload: true,
      somaClickingAllowed: true,
      advancedOptionsAllowed: true,
      allowedModes: ["orthogonal", "oblique", "flight"],
    },
  },
  save: {
    queue: [],
    isBusy: false,
    lastSaveTimestamp: 0,
  },
  flycam: {
    zoomStep: 1.3,
    currentMatrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    spaceDirectionOrtho: [1, 1, 1],
  },
};

const sagaMiddleware = createSagaMiddleware();
const combinedReducers = reduceReducers(
  SettingsReducer,
  SkeletonTracingReducer,
  VolumeTracingReducer,
  TaskReducer,
  SaveReducer,
  FlycamReducer,
);

const store = createStore(combinedReducers, defaultState, applyMiddleware(
  timestampMiddleware,
  sagaMiddleware,
  overwriteActionMiddleware,
));
sagaMiddleware.run(rootSaga);

export default store;

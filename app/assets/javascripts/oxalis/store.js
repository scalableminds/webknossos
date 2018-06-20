/**
 * store.js
 * @flow
 */

/* eslint-disable no-useless-computed-key */
import { createStore, applyMiddleware } from "redux";
import createSagaMiddleware from "redux-saga";
import reduceReducers from "oxalis/model/helpers/reduce_reducers";
import SettingsReducer from "oxalis/model/reducers/settings_reducer";
import TaskReducer from "oxalis/model/reducers/task_reducer";
import SaveReducer from "oxalis/model/reducers/save_reducer";
import SkeletonTracingReducer from "oxalis/model/reducers/skeletontracing_reducer";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import FlycamReducer from "oxalis/model/reducers/flycam_reducer";
import ViewModeReducer from "oxalis/model/reducers/view_mode_reducer";
import AnnotationReducer from "oxalis/model/reducers/annotation_reducer";
import UserReducer from "oxalis/model/reducers/user_reducer";
import rootSaga from "oxalis/model/sagas/root_saga";
import overwriteActionMiddleware from "oxalis/model/helpers/overwrite_action_middleware";
import googleAnalyticsMiddleware from "oxalis/model/helpers/google_analytics_middleware";
import Constants, { ControlModeEnum, OrthoViews } from "oxalis/constants";
import type {
  OrthoViewType,
  Vector2,
  Vector3,
  ModeType,
  ContourModeType,
  VolumeToolType,
  ControlModeType,
  BoundingBoxType,
} from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import type { ActionType } from "oxalis/model/actions/actions";
import type {
  APIRestrictionsType,
  APIAllowedModeType,
  APISettingsType,
  APIDataStoreType,
  APITracingType,
  APIScriptType,
  APITaskType,
  APIUserType,
  APIDatasetType,
  APIDataLayerType,
} from "admin/api_flow_types";

export type CommentType = {
  +content: string,
  +nodeId: number,
};

export type EdgeType = {
  +source: number,
  +target: number,
};

export type NodeType = {
  +id: number,
  +position: Vector3,
  +rotation: Vector3,
  +bitDepth: number,
  +viewport: number,
  +resolution: number,
  +radius: number,
  +timestamp: number,
  +interpolation: boolean,
};

export type BranchPointType = {
  +timestamp: number,
  +nodeId: number,
};

export type NodeMapType = DiffableMap<number, NodeType>;

export type BoundingBoxObjectType = {
  +topLeft: Vector3,
  +width: number,
  +height: number,
  +depth: number,
};

type TreeTypeBase = {
  +treeId: number,
  +groupId: ?number,
  +color: Vector3,
  +name: string,
  +timestamp: number,
  +comments: Array<CommentType>,
  +branchPoints: Array<BranchPointType>,
  +edges: EdgeCollection,
  +isVisible: boolean,
};

export type TreeType = TreeTypeBase & {
  +nodes: NodeMapType,
};

export type TreeGroupType = {
  name: string,
  groupId: number,
  children: Array<TreeGroupType>,
};

export type VolumeCellType = {
  +id: number,
};

export type VolumeCellMapType = { [number]: VolumeCellType };

export type CategoryType = "color" | "segmentation";
export type ElementClassType = "uint8" | "uint16" | "uint32";

export type DataLayerType = APIDataLayerType;

export type RestrictionsType = APIRestrictionsType;

export type AllowedModeType = APIAllowedModeType;

export type SettingsType = APISettingsType;

export type DataStoreInfoType = APIDataStoreType;

export type TreeMapType = { +[number]: TreeType };
export type TemporaryMutableTreeMapType = { [number]: TreeType };

export type TracingTypeTracingType = APITracingType;

type TracingBaseType = {
  +annotationId: string,
  +createdTimestamp: number,
  +name: string,
  +version: number,
  +tracingId: string,
  +boundingBox: ?BoundingBoxType,
  +userBoundingBox: ?BoundingBoxType,
  +restrictions: RestrictionsType & SettingsType,
  +isPublic: boolean,
  +tags: Array<string>,
  +description: string,
};

export type SkeletonTracingType = TracingBaseType & {
  +type: "skeleton",
  +tracingType: TracingTypeTracingType,
  +trees: TreeMapType,
  +treeGroups: Array<TreeGroupType>,
  +activeTreeId: ?number,
  +activeNodeId: ?number,
  +cachedMaxNodeId: number,
};

export type VolumeTracingType = TracingBaseType & {
  +type: "volume",
  +tracingType: TracingTypeTracingType,
  +maxCellId: number,
  +activeTool: VolumeToolType,
  +activeCellId: number,
  +lastCentroid: ?Vector3,
  +contourTracingMode: ContourModeType,
  +contourList: Array<Vector3>,
  +cells: VolumeCellMapType,
};

export type ReadOnlyTracingType = TracingBaseType & {
  +type: "readonly",
  +tracingType: "View",
};

export type TracingType = SkeletonTracingType | VolumeTracingType | ReadOnlyTracingType;

export type DatasetLayerConfigurationType = {
  +color: Vector3,
  +brightness: number,
  +contrast: number,
};

export type DatasetConfigurationType = {
  +fourBit: boolean,
  +interpolation: boolean,
  +keyboardDelay: number,
  +layers: {
    [name: string]: DatasetLayerConfigurationType,
  },
  +quality: 0 | 1 | 2,
  +segmentationOpacity: number,
  +highlightHoveredCellId: boolean,
  +position?: Vector3,
  +zoom?: number,
  +rotation?: Vector3,
};

export type UserConfigurationType = {
  +clippingDistance: number,
  +clippingDistanceArbitrary: number,
  +crosshairSize: number,
  +displayCrosshair: boolean,
  +dynamicSpaceDirection: boolean,
  +keyboardDelay: number,
  +mouseRotateValue: number,
  +moveValue: number,
  +moveValue3d: number,
  +newNodeNewTree: boolean,
  +highlightCommentedNodes: boolean,
  +overrideNodeRadius: boolean,
  +particleSize: number,
  +radius: number,
  +rotateValue: number,
  +scale: number,
  +scaleValue: number,
  +sortCommentsAsc: boolean,
  +sortTreesByName: boolean,
  +sphericalCapRadius: number,
  +tdViewDisplayPlanes: boolean,
};

export type MappingType = { [key: number]: number };

export type TemporaryConfigurationType = {
  +viewMode: ModeType,
  +flightmodeRecording: boolean,
  +controlMode: ControlModeType,
  +mousePosition: ?Vector2,
  +brushSize: number,
  +activeMapping: {
    +mapping: ?MappingType,
    +isMappingEnabled: boolean,
    +mappingSize: number,
  },
};

export type ScriptType = APIScriptType;

export type TaskType = APITaskType;

export type SaveQueueEntryType = {
  version: number,
  timestamp: number,
  actions: Array<UpdateAction>,
};

export type SaveStateType = {
  +isBusy: boolean,
  +queue: Array<SaveQueueEntryType>,
  +lastSaveTimestamp: number,
};

export type FlycamType = {
  +zoomStep: number,
  +currentMatrix: Matrix4x4,
  +spaceDirectionOrtho: [-1 | 1, -1 | 1, -1 | 1],
};

export type CameraData = {
  +near: number,
  +far: number,
  +left: number,
  +right: number,
  +top: number,
  +bottom: number,
  +up: Vector3,
  +lookAt: Vector3,
  +position: Vector3,
};

export type PartialCameraData = {
  +near?: number,
  +far?: number,
  +left?: number,
  +right?: number,
  +top?: number,
  +bottom?: number,
  +up?: Vector3,
  +lookAt?: Vector3,
  +position?: Vector3,
};

export type PlaneModeData = {
  +activeViewport: OrthoViewType,
  +tdCamera: CameraData,
};

type ArbitraryModeData = null;
type FlightModeData = null;

export type ViewModeData = {
  +plane: PlaneModeData,
  +arbitrary: ?ArbitraryModeData,
  +flight: ?FlightModeData,
};

export type OxalisState = {
  +datasetConfiguration: DatasetConfigurationType,
  +userConfiguration: UserConfigurationType,
  +temporaryConfiguration: TemporaryConfigurationType,
  +dataset: APIDatasetType,
  +tracing: TracingType,
  +task: ?TaskType,
  +save: SaveStateType,
  +flycam: FlycamType,
  +viewModeData: ViewModeData,
  +activeUser: ?APIUserType,
};

export const defaultState: OxalisState = {
  datasetConfiguration: {
    fourBit: true,
    interpolation: false,
    keyboardDelay: 342,
    layers: {},
    quality: 0,
    segmentationOpacity: 20,
    highlightHoveredCellId: true,
  },
  userConfiguration: {
    clippingDistance: 50,
    clippingDistanceArbitrary: 64,
    crosshairSize: 0.1,
    displayCrosshair: true,
    dynamicSpaceDirection: true,
    keyboardDelay: 200,
    mouseRotateValue: 0.004,
    moveValue: 300,
    moveValue3d: 300,
    newNodeNewTree: false,
    highlightCommentedNodes: false,
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
    viewMode: Constants.MODE_PLANE_TRACING,
    flightmodeRecording: false,
    controlMode: ControlModeEnum.VIEW,
    mousePosition: null,
    brushSize: 50,
    activeMapping: {
      mapping: null,
      isMappingEnabled: false,
      mappingSize: 0,
    },
  },
  task: null,
  dataset: {
    name: "Test Dataset",
    created: 123,
    dataSource: {
      dataLayers: [],
      scale: [5, 5, 5],
      id: {
        name: "Test Dataset",
        team: "",
      },
    },
    isPublic: false,
    isActive: true,
    isEditable: true,
    dataStore: {
      name: "localhost",
      url: "http://localhost:9000",
      typ: "webknossos-store",
    },
    owningOrganization: "Connectomics department",
    description: null,
    displayName: "Awesome Test Dataset",
    allowedTeams: [],
    logoUrl: null,
  },
  tracing: {
    annotationId: "",
    boundingBox: null,
    createdTimestamp: 0,
    userBoundingBox: null,
    type: "readonly",
    name: "",
    version: 0,
    isPublic: false,
    tracingId: "",
    tracingType: "View",
    restrictions: {
      branchPointsAllowed: false,
      allowUpdate: false,
      allowFinish: false,
      allowAccess: true,
      allowDownload: false,
      somaClickingAllowed: false,
      allowedModes: ["orthogonal", "oblique", "flight"],
    },
    tags: [],
    description: "",
  },
  save: {
    queue: [],
    isBusy: false,
    lastSaveTimestamp: 0,
  },
  flycam: {
    zoomStep: 1.3,
    currentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    spaceDirectionOrtho: [1, 1, 1],
  },
  viewModeData: {
    plane: {
      activeViewport: OrthoViews.PLANE_XY,
      tdCamera: {
        near: 0,
        far: 0,
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        up: [0, 0, 0],
        lookAt: [0, 0, 0],
        position: [0, 0, 0],
      },
    },
    arbitrary: null,
    flight: null,
  },
  activeUser: null,
};

const sagaMiddleware = createSagaMiddleware();

export type ReducerType = (state: OxalisState, action: ActionType) => OxalisState;

const combinedReducers = reduceReducers(
  SettingsReducer,
  SkeletonTracingReducer,
  VolumeTracingReducer,
  TaskReducer,
  SaveReducer,
  FlycamReducer,
  ViewModeReducer,
  AnnotationReducer,
  UserReducer,
);

const store = createStore(
  combinedReducers,
  defaultState,
  applyMiddleware(googleAnalyticsMiddleware, overwriteActionMiddleware, sagaMiddleware),
);
sagaMiddleware.run(rootSaga);

export default store;

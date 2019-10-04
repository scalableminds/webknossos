/**
 * store.js
 * @flow
 */

import { createStore, applyMiddleware, type Dispatch } from "redux";
import createSagaMiddleware from "redux-saga";

import type {
  APIAllowedMode,
  APIAnnotationType,
  APIDataLayer,
  APIDataStore,
  APIDataset,
  APIDatasetId,
  APIRestrictions,
  APIScript,
  APISettings,
  APITask,
  APITracingStore,
  APIUser,
  APIUserBase,
  MeshMetaData,
} from "admin/api_flow_types";
import type { Action } from "oxalis/model/actions/actions";
import type { Matrix4x4 } from "libs/mjs";
import type { SkeletonTracingStats } from "oxalis/model/accessors/skeletontracing_accessor";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import AnnotationReducer from "oxalis/model/reducers/annotation_reducer";
import {
  type BoundingBoxType,
  type ContourMode,
  type ControlMode,
  ControlModeEnum,
  type ViewMode,
  type OrthoView,
  type Rect,
  type Vector2,
  type Vector3,
  type VolumeTool,
} from "oxalis/constants";
import DatasetReducer from "oxalis/model/reducers/dataset_reducer";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import FlycamReducer from "oxalis/model/reducers/flycam_reducer";
import SaveReducer from "oxalis/model/reducers/save_reducer";
import SettingsReducer from "oxalis/model/reducers/settings_reducer";
import SkeletonTracingReducer from "oxalis/model/reducers/skeletontracing_reducer";
import TaskReducer from "oxalis/model/reducers/task_reducer";
import UiReducer from "oxalis/model/reducers/ui_reducer";
import UserReducer from "oxalis/model/reducers/user_reducer";
import ViewModeReducer from "oxalis/model/reducers/view_mode_reducer";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import actionLoggerMiddleware from "oxalis/model/helpers/action_logger_middleware";
import defaultState from "oxalis/default_state";
import overwriteActionMiddleware from "oxalis/model/helpers/overwrite_action_middleware";
import reduceReducers from "oxalis/model/helpers/reduce_reducers";
import rootSaga from "oxalis/model/sagas/root_saga";

export type CommentType = {|
  +content: string,
  +nodeId: number,
|};

export type Edge = {
  +source: number,
  +target: number,
};

export type Node = {
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

export type BranchPoint = {
  +timestamp: number,
  +nodeId: number,
};

export type NodeMap = DiffableMap<number, Node>;

export type BoundingBoxObject = {
  +topLeft: Vector3,
  +width: number,
  +height: number,
  +depth: number,
};

export type Tree = {|
  +treeId: number,
  +groupId: ?number,
  +color: Vector3,
  +name: string,
  +timestamp: number,
  +comments: Array<CommentType>,
  +branchPoints: Array<BranchPoint>,
  +edges: EdgeCollection,
  +isVisible: boolean,
  +nodes: NodeMap,
|};

export type TreeGroupTypeFlat = {|
  +name: string,
  +groupId: number,
|};

export type TreeGroup = {
  ...TreeGroupTypeFlat,
  +children: Array<TreeGroup>,
};

export type VolumeCell = {
  +id: number,
};

export type VolumeCellMap = { [number]: VolumeCell };

export type DataLayerType = APIDataLayer;

export type Restrictions = APIRestrictions;

export type AllowedMode = APIAllowedMode;

export type Settings = APISettings;

export type DataStoreInfo = APIDataStore;

export type TreeMap = { +[number]: Tree };
export type TemporaryMutableTreeMap = { [number]: Tree };

export type AnnotationType = APIAnnotationType;

export type RestrictionsAndSettings = {| ...Restrictions, ...Settings |};

export type Annotation = {|
  +annotationId: string,
  +restrictions: RestrictionsAndSettings,
  +isPublic: boolean,
  +tags: Array<string>,
  +description: string,
  +name: string,
  +tracingStore: APITracingStore,
  +annotationType: AnnotationType,
  +meshes: Array<MeshMetaData>,
  +user: ?APIUserBase,
|};

type TracingBase = {|
  +createdTimestamp: number,
  +version: number,
  +tracingId: string,
  +boundingBox: ?BoundingBoxType,
  +userBoundingBox: ?BoundingBoxType,
|};

export type SkeletonTracing = {|
  ...TracingBase,
  +type: "skeleton",
  +trees: TreeMap,
  +treeGroups: Array<TreeGroup>,
  +activeTreeId: ?number,
  +activeNodeId: ?number,
  +activeGroupId: ?number,
  +cachedMaxNodeId: number,
|};

export type VolumeTracing = {|
  ...TracingBase,
  +type: "volume",
  +maxCellId: number,
  +activeTool: VolumeTool,
  +activeCellId: number,
  +lastCentroid: ?Vector3,
  +contourTracingMode: ContourMode,
  +contourList: Array<Vector3>,
  +cells: VolumeCellMap,
  +fallbackLayer?: string,
|};

export type ReadOnlyTracing = {|
  ...TracingBase,
  +type: "readonly",
|};

export type HybridTracing = {|
  ...Annotation,
  skeleton: ?SkeletonTracing,
  volume: ?VolumeTracing,
  readOnly: ?ReadOnlyTracing,
|};

export type Tracing = HybridTracing;

export type TraceOrViewCommand =
  | {
      +type: typeof ControlModeEnum.VIEW,
      ...$Exact<APIDatasetId>,
    }
  | {
      +type: typeof ControlModeEnum.TRACE,
      +annotationId: string,
    };

export type DatasetLayerConfiguration = {|
  +color: Vector3,
  +brightness: number,
  +contrast: number,
  +alpha: number,
  +intensityRange: Vector2,
  +isDisabled: boolean,
|};

export type LoadingStrategy = "BEST_QUALITY_FIRST" | "PROGRESSIVE_QUALITY";

export type DatasetConfiguration = {|
  +fourBit: boolean,
  +interpolation: boolean,
  +layers: {
    [name: string]: DatasetLayerConfiguration,
  },
  +quality: 0 | 1 | 2,
  +segmentationOpacity: number,
  +isSegmentationDisabled: boolean,
  +highlightHoveredCellId: boolean,
  +renderIsosurfaces: boolean,
  +position?: Vector3,
  +zoom?: number,
  +rotation?: Vector3,
  +renderMissingDataBlack: boolean,
  +loadingStrategy: LoadingStrategy,
|};

export type UserConfiguration = {|
  +autoSaveLayouts: boolean,
  +brushSize: number,
  +clippingDistance: number,
  +clippingDistanceArbitrary: number,
  +crosshairSize: number,
  +showDiameter: boolean,
  +displayCrosshair: boolean,
  +displayScalebars: boolean,
  +dynamicSpaceDirection: boolean,
  +hideTreeRemovalWarning: boolean,
  +highlightCommentedNodes: boolean,
  +keyboardDelay: number,
  +layoutScaleValue: number,
  +mouseRotateValue: number,
  +moveValue3d: number,
  +moveValue: number,
  +newNodeNewTree: boolean,
  +overrideNodeRadius: boolean,
  +particleSize: number,
  +radius: number,
  +rotateValue: number,
  +sortCommentsAsc: boolean,
  +sortTreesByName: boolean,
  +sphericalCapRadius: number,
  +tdViewDisplayPlanes: boolean,
  +gpuMemoryFactor: number,
|};

export type RecommendedConfiguration = $Shape<{
  ...UserConfiguration,
  ...DatasetConfiguration,
  zoom: number,
}>;

export type Mapping = { [key: number]: number };

export type TemporaryConfiguration = {
  +viewMode: ViewMode,
  +flightmodeRecording: boolean,
  +controlMode: ControlMode,
  +mousePosition: ?Vector2,
  +hoveredIsosurfaceId: number,
  +activeMapping: {
    +mappingName: ?string,
    +mapping: ?Mapping,
    +mappingKeys: ?Array<number>,
    +mappingColors: ?Array<number>,
    +hideUnmappedIds: boolean,
    +isMappingEnabled: boolean,
    +mappingSize: number,
  },
  +isMergerModeEnabled: boolean,
  +isAutoBrushEnabled: boolean,
  +gpuSetup: {
    // These rendering-related variables are set up
    // during startup and cannot change (with the current
    // implementation). That's why, we are explicitly saving
    // these gpu setup variables here.
    +smallestCommonBucketCapacity: number,
    +initializedGpuFactor: number,
  },
};

export type Script = APIScript;

export type Task = APITask;

export type SaveQueueEntry = {
  version: number,
  timestamp: number,
  actions: Array<UpdateAction>,
  transactionId: string,
  transactionGroupCount: number,
  transactionGroupIndex: number,
  stats: ?SkeletonTracingStats,
  info: string,
};

export type ProgressInfo = {
  +processedActionCount: number,
  +totalActionCount: number,
};

export type IsBusyInfo = {
  +skeleton: boolean,
  +volume: boolean,
};

export type SaveState = {
  +isBusyInfo: IsBusyInfo,
  +queue: {
    +skeleton: Array<SaveQueueEntry>,
    +volume: Array<SaveQueueEntry>,
  },
  +lastSaveTimestamp: number,
  +progressInfo: ProgressInfo,
};

export type Flycam = {
  +zoomStep: number,
  +currentMatrix: Matrix4x4,
  +spaceDirectionOrtho: [-1 | 1, -1 | 1, -1 | 1],
  +direction: Vector3,
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
  +activeViewport: OrthoView,
  +tdCamera: CameraData,
  +inputCatcherRects: {
    +PLANE_XY: Rect,
    +PLANE_YZ: Rect,
    +PLANE_XZ: Rect,
    +TDView: Rect,
  },
};

type ArbitraryModeData = {
  +inputCatcherRect: Rect,
};

export type ViewModeData = {
  +plane: PlaneModeData,
  +arbitrary: ArbitraryModeData,
};

type UiInformation = {
  +showDropzoneModal: boolean,
  +showVersionRestore: boolean,
  +storedLayouts: Object,
  +isImportingMesh: boolean,
  +isInAnnotationView: boolean,
  +hasOrganizations: boolean,
};

export type OxalisState = {|
  +datasetConfiguration: DatasetConfiguration,
  +userConfiguration: UserConfiguration,
  +temporaryConfiguration: TemporaryConfiguration,
  +dataset: APIDataset,
  +tracing: Tracing,
  +task: ?Task,
  +save: SaveState,
  +flycam: Flycam,
  +viewModeData: ViewModeData,
  +activeUser: ?APIUser,
  +uiInformation: UiInformation,
|};

const sagaMiddleware = createSagaMiddleware();

export type Reducer = (state: OxalisState, action: Action) => OxalisState;

const combinedReducers = reduceReducers(
  SettingsReducer,
  DatasetReducer,
  SkeletonTracingReducer,
  VolumeTracingReducer,
  TaskReducer,
  SaveReducer,
  FlycamReducer,
  ViewModeReducer,
  AnnotationReducer,
  UserReducer,
  UiReducer,
);

const store = createStore<OxalisState, Action, Dispatch<*>>(
  combinedReducers,
  defaultState,
  applyMiddleware(actionLoggerMiddleware, overwriteActionMiddleware, sagaMiddleware),
);
sagaMiddleware.run(rootSaga);

export default store;

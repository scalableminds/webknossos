
import type { Dispatch } from "redux";
import { createStore, applyMiddleware } from "redux";
import { enableBatching } from "redux-batched-actions";
import createSagaMiddleware from "redux-saga";
import type {
  APIAllowedMode,
  APIAnnotationType,
  APIAnnotationVisibility,
  APIConnectomeFile,
  APIDataLayer,
  APIDataStore,
  APIDataset,
  APIDatasetId,
  APIHistogramData,
  APIRestrictions,
  APIScript,
  APISettings,
  APITask,
  APITracingStore,
  APIUser,
  APIUserBase,
  AnnotationLayerDescriptor,
  MeshMetaData,
  TracingType,
  APIMeshFile,
} from "types/api_flow_types";
import type { Action } from "oxalis/model/actions/actions";
import type {
  BoundingBoxType,
  ContourMode,
  OverwriteMode,
  FillMode,
  ControlMode,
  TDViewDisplayMode,
  ViewMode,
  OrthoView,
  Rect,
  Vector2,
  Vector3,
  AnnotationTool,
  MappingStatus,
} from "oxalis/constants";
import { ControlModeEnum } from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import type { SkeletonTracingStats } from "oxalis/model/accessors/skeletontracing_accessor";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import AnnotationReducer from "oxalis/model/reducers/annotation_reducer";
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
import ConnectomeReducer from "oxalis/model/reducers/connectome_reducer";
export type MutableCommentType = {
  content: string;
  nodeId: number;
};
export type CommentType = Readonly<MutableCommentType>;
export type MutableEdge = {
  source: number;
  target: number;
};
export type Edge = Readonly<MutableEdge>;
export type MutableNode = {
  id: number;
  position: Vector3;
  rotation: Vector3;
  bitDepth: number;
  viewport: number;
  resolution: number;
  radius: number;
  timestamp: number;
  interpolation: boolean;
};
export type Node = Readonly<MutableNode>;
export type MutableBranchPoint = {
  timestamp: number;
  nodeId: number;
};
export type BranchPoint = Readonly<MutableBranchPoint>;
export type MutableNodeMap = DiffableMap<number, MutableNode>;
export type NodeMap = DiffableMap<number, Node>;
export type BoundingBoxObject = {
  readonly topLeft: Vector3;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
};
export type UserBoundingBoxToServer = {
  boundingBox: BoundingBoxObject;
  id: number;
  name?: string;
  color?: Vector3;
  isVisible?: boolean;
};
export type UserBoundingBoxWithoutIdMaybe = {
  boundingBox?: BoundingBoxType;
  name?: string;
  color?: Vector3;
  isVisible?: boolean;
};
export type UserBoundingBoxWithoutId = {
  boundingBox: BoundingBoxType;
  name: string;
  color: Vector3;
  isVisible: boolean;
};
export type UserBoundingBox = UserBoundingBoxWithoutId & {
  id: number;
};
export type MutableTree = {
  treeId: number;
  groupId: number | null | undefined;
  color: Vector3;
  name: string;
  timestamp: number;
  comments: Array<MutableCommentType>;
  branchPoints: Array<MutableBranchPoint>;
  edges: EdgeCollection;
  isVisible: boolean;
  nodes: MutableNodeMap;
};
export type Tree = {
  readonly treeId: number;
  readonly groupId: number | null | undefined;
  readonly color: Vector3;
  readonly name: string;
  readonly timestamp: number;
  readonly comments: Array<CommentType>;
  readonly branchPoints: Array<BranchPoint>;
  readonly edges: EdgeCollection;
  readonly isVisible: boolean;
  readonly nodes: NodeMap;
};
export type TreeGroupTypeFlat = {
  readonly name: string;
  readonly groupId: number;
};
export type TreeGroup = TreeGroupTypeFlat & {
  readonly children: Array<TreeGroup>;
};
export type MutableTreeGroup = {
  name: string;
  groupId: number;
  children: Array<MutableTreeGroup>;
};
export type DataLayerType = APIDataLayer;
export type Restrictions = APIRestrictions;
export type AllowedMode = APIAllowedMode;
export type Settings = APISettings;
export type DataStoreInfo = APIDataStore;
export type MutableTreeMap = Record<number, MutableTree>;
export type TreeMap = Record<number, Tree>;
export type AnnotationType = APIAnnotationType;
export type AnnotationVisibility = APIAnnotationVisibility;
export type RestrictionsAndSettings = Restrictions & Settings;
export type Annotation = {
  readonly annotationId: string;
  readonly restrictions: RestrictionsAndSettings;
  readonly visibility: AnnotationVisibility;
  readonly annotationLayers: Array<AnnotationLayerDescriptor>;
  readonly tags: Array<string>;
  readonly description: string;
  readonly name: string;
  readonly tracingStore: APITracingStore;
  readonly annotationType: AnnotationType;
  // This property contains back-end stored mesh objects for which
  // the support is about to end. See webknossos/#5633.
  readonly meshes: Array<MeshMetaData>;
  readonly user: APIUserBase | null | undefined;
};
type TracingBase = {
  readonly createdTimestamp: number;
  readonly version: number;
  readonly tracingId: string;
  readonly boundingBox: BoundingBoxType | null | undefined;
  readonly userBoundingBoxes: Array<UserBoundingBox>;
};
export type NavigationList = {
  readonly list: Array<number>;
  readonly activeIndex: number;
};
export type SkeletonTracing = TracingBase & {
  readonly type: "skeleton";
  readonly trees: TreeMap;
  readonly treeGroups: Array<TreeGroup>;
  readonly activeTreeId: number | null | undefined;
  readonly activeNodeId: number | null | undefined;
  readonly activeGroupId: number | null | undefined;
  readonly cachedMaxNodeId: number;
  readonly navigationList: NavigationList;
  readonly showSkeletons: boolean;
};
export type Segment = {
  id: number;
  name: string | null | undefined;
  somePosition: Vector3;
  creationTime: number | null | undefined;
};
export type SegmentMap = DiffableMap<number, Segment>;
export type VolumeTracing = TracingBase & {
  readonly type: "volume";
  // Note that there are also SegmentMaps in `state.localSegmentationData`
  // for non-annotation volume layers.
  readonly segments: SegmentMap;
  readonly maxCellId: number;
  readonly activeCellId: number;
  readonly lastCentroid: Vector3 | null | undefined;
  readonly contourTracingMode: ContourMode;
  // Stores points of the currently drawn region in global coordinates
  readonly contourList: Array<Vector3>;
  readonly fallbackLayer?: string;
};
export type ReadOnlyTracing = TracingBase & {
  readonly type: "readonly";
};
export type HybridTracing = Annotation & {
  readonly skeleton: SkeletonTracing | null | undefined;
  readonly volumes: Array<VolumeTracing>;
  readonly readOnly: ReadOnlyTracing | null | undefined;
};
export type Tracing = HybridTracing;
export type TraceOrViewCommand =
  | (APIDatasetId & {
      readonly type: typeof ControlModeEnum.VIEW;
    })
  | {
      readonly type: typeof ControlModeEnum.TRACE;
      readonly annotationId: string;
    }
  | (APIDatasetId & {
      readonly type: typeof ControlModeEnum.SANDBOX;
      readonly tracingType: TracingType;
    });
export type DatasetLayerConfiguration = {
  readonly color: Vector3;
  readonly brightness?: number;
  readonly contrast?: number;
  readonly alpha: number;
  readonly intensityRange: Vector2;
  readonly min?: number;
  readonly max?: number;
  readonly isDisabled: boolean;
  readonly isInverted: boolean;
  readonly isInEditMode: boolean;
};
export type LoadingStrategy = "BEST_QUALITY_FIRST" | "PROGRESSIVE_QUALITY";
export type DatasetConfiguration = {
  readonly fourBit: boolean;
  readonly interpolation: boolean;
  readonly layers: Record<string, DatasetLayerConfiguration>;
  readonly position?: Vector3;
  readonly zoom?: number;
  readonly rotation?: Vector3;
  readonly renderMissingDataBlack: boolean;
  readonly loadingStrategy: LoadingStrategy;
  readonly segmentationPatternOpacity: number;
};
export type PartialDatasetConfiguration = Partial<
  DatasetConfiguration & {
    readonly layers: Record<string, Partial<DatasetLayerConfiguration>>;
  }
>;
export type UserConfiguration = {
  readonly autoSaveLayouts: boolean;
  readonly brushSize: number;
  readonly clippingDistance: number;
  readonly clippingDistanceArbitrary: number;
  readonly crosshairSize: number;
  readonly displayCrosshair: boolean;
  readonly displayScalebars: boolean;
  readonly dynamicSpaceDirection: boolean;
  readonly hideTreeRemovalWarning: boolean;
  readonly highlightCommentedNodes: boolean;
  readonly keyboardDelay: number;
  readonly mouseRotateValue: number;
  readonly moveValue3d: number;
  readonly moveValue: number;
  readonly newNodeNewTree: boolean;
  readonly centerNewNode: boolean;
  readonly overrideNodeRadius: boolean;
  readonly particleSize: number;
  readonly rotateValue: number;
  readonly sortCommentsAsc: boolean;
  readonly sortTreesByName: boolean;
  readonly sphericalCapRadius: number;
  readonly tdViewDisplayPlanes: TDViewDisplayMode;
  readonly tdViewDisplayDatasetBorders: boolean;
  readonly gpuMemoryFactor: number;
  // For volume (and hybrid) annotations, this mode specifies
  // how volume annotations overwrite existing voxels.
  readonly overwriteMode: OverwriteMode;
  readonly fillMode: FillMode;
  readonly useLegacyBindings: boolean;
};
export type RecommendedConfiguration = Partial<
  UserConfiguration &
    DatasetConfiguration & {
      zoom: number;
      segmentationOpacity: number;
    }
>;
export type HistogramDataForAllLayers = Record<string, APIHistogramData>;
export type Mapping = Record<number, number>;
export type MappingType = "JSON" | "HDF5";
export type ActiveMappingInfo = {
  readonly mappingName: string | null | undefined;
  readonly mapping: Mapping | null | undefined;
  readonly mappingKeys: Array<number> | null | undefined;
  readonly mappingColors: Array<number> | null | undefined;
  readonly hideUnmappedIds: boolean;
  readonly mappingStatus: MappingStatus;
  readonly mappingSize: number;
  readonly mappingType: MappingType;
};
export type TemporaryConfiguration = {
  readonly histogramData: HistogramDataForAllLayers;
  readonly viewMode: ViewMode;
  readonly flightmodeRecording: boolean;
  readonly controlMode: ControlMode;
  readonly mousePosition: Vector2 | null | undefined;
  readonly hoveredSegmentId: number;
  readonly activeMappingByLayer: Record<string, ActiveMappingInfo>;
  readonly isMergerModeEnabled: boolean;
  readonly gpuSetup: {
    // These rendering-related variables are set up
    // during startup and cannot change (with the current
    // implementation). That's why, we are explicitly saving
    // these gpu setup variables here.
    readonly smallestCommonBucketCapacity: number;
    readonly initializedGpuFactor: number;
    readonly maximumLayerCountToRender: number;
  };
  readonly preferredQualityForMeshPrecomputation: number;
  readonly preferredQualityForMeshAdHocComputation: number;
  readonly lastVisibleSegmentationLayerName: string | null | undefined;
};
export type Script = APIScript;
export type Task = APITask;
export type SaveQueueEntry = {
  version: number;
  timestamp: number;
  actions: Array<UpdateAction>;
  transactionId: string;
  transactionGroupCount: number;
  transactionGroupIndex: number;
  stats: SkeletonTracingStats | null | undefined;
  info: string;
};
export type ProgressInfo = {
  readonly processedActionCount: number;
  readonly totalActionCount: number;
};
export type IsBusyInfo = {
  readonly skeleton: boolean;
  readonly volume: boolean;
};
export type SaveState = {
  readonly isBusyInfo: IsBusyInfo;
  readonly queue: {
    readonly skeleton: Array<SaveQueueEntry>;
    readonly volumes: Record<string, Array<SaveQueueEntry>>;
  };
  readonly lastSaveTimestamp: {
    readonly skeleton: number;
    readonly volumes: Record<string, number>;
  };
  readonly progressInfo: ProgressInfo;
};
export type Flycam = {
  readonly zoomStep: number;
  readonly currentMatrix: Matrix4x4;
  readonly spaceDirectionOrtho: [-1 | 1, -1 | 1, -1 | 1];
  readonly direction: Vector3;
};
export type CameraData = {
  readonly near: number;
  readonly far: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly up: Vector3;
  readonly lookAt: Vector3;
  readonly position: Vector3;
};
export type PartialCameraData = {
  readonly near?: number;
  readonly far?: number;
  readonly left?: number;
  readonly right?: number;
  readonly top?: number;
  readonly bottom?: number;
  readonly up?: Vector3;
  readonly lookAt?: Vector3;
  readonly position?: Vector3;
};
export type PlaneModeData = {
  readonly activeViewport: OrthoView;
  readonly tdCamera: CameraData;
  readonly inputCatcherRects: {
    readonly PLANE_XY: Rect;
    readonly PLANE_YZ: Rect;
    readonly PLANE_XZ: Rect;
    readonly TDView: Rect;
  };
};
type ArbitraryModeData = {
  readonly inputCatcherRect: Rect;
};
export type ViewModeData = {
  readonly plane: PlaneModeData;
  readonly arbitrary: ArbitraryModeData;
};
export type BorderOpenStatus = {
  left: boolean;
  right: boolean;
};
export type Theme = "light" | "dark";
export type BusyBlockingInfo = {
  isBusy: boolean;
  reason?: string;
};
type UiInformation = {
  readonly showDropzoneModal: boolean;
  readonly showVersionRestore: boolean;
  readonly showShareModal: boolean;
  readonly activeTool: AnnotationTool;
  readonly storedLayouts: Record<string, any>;
  readonly isImportingMesh: boolean;
  readonly isInAnnotationView: boolean;
  readonly hasOrganizations: boolean;
  readonly borderOpenStatus: BorderOpenStatus;
  readonly theme: Theme;
  readonly busyBlockingInfo: BusyBlockingInfo;
};
type BaseIsosurfaceInformation = {
  readonly segmentId: number;
  readonly seedPosition: Vector3;
  readonly isLoading: boolean;
  readonly isVisible: boolean;
};
export type AdHocIsosurfaceInformation = BaseIsosurfaceInformation & {
  readonly isPrecomputed: false;
  readonly mappingName: string | null | undefined;
  readonly mappingType: MappingType | null | undefined;
};
export type PrecomputedIsosurfaceInformation = BaseIsosurfaceInformation & {
  readonly isPrecomputed: true;
  readonly meshFileName: string;
};
export type IsosurfaceInformation = AdHocIsosurfaceInformation | PrecomputedIsosurfaceInformation;
export type ConnectomeData = {
  readonly availableConnectomeFiles: Array<APIConnectomeFile> | null | undefined;
  readonly currentConnectomeFile: APIConnectomeFile | null | undefined;
  readonly pendingConnectomeFileName: string | null | undefined;
  readonly activeAgglomerateIds: Array<number>;
  readonly skeleton: SkeletonTracing | null | undefined;
};
export type OxalisState = {
  readonly datasetConfiguration: DatasetConfiguration;
  readonly userConfiguration: UserConfiguration;
  readonly temporaryConfiguration: TemporaryConfiguration;
  readonly dataset: APIDataset;
  readonly tracing: Tracing;
  readonly task: Task | null | undefined;
  readonly save: SaveState;
  readonly flycam: Flycam;
  readonly viewModeData: ViewModeData;
  readonly activeUser: APIUser | null | undefined;
  readonly uiInformation: UiInformation;
  readonly localSegmentationData: Record<
    string,
    {
      readonly isosurfaces: Record<number, IsosurfaceInformation>;
      readonly availableMeshFiles: Array<APIMeshFile> | null | undefined;
      readonly currentMeshFile: APIMeshFile | null | undefined;
      // Note that for a volume tracing, this information should be stored
      // in state.tracing.volume.segments, as this is also persisted on the
      // server (i.e., not "local").
      // The `segments` here should only be used for non-annotation volume
      // layers.
      readonly segments: SegmentMap;
      readonly connectomeData: ConnectomeData;
    }
  >;
};
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
  ConnectomeReducer,
);
// @ts-expect-error ts-migrate(2558) FIXME: Expected 1 type arguments, but got 3.
const store = createStore<OxalisState, Action, Dispatch<any>>(
  enableBatching(combinedReducers),
  defaultState,
  applyMiddleware(actionLoggerMiddleware, overwriteActionMiddleware, sagaMiddleware),
);
sagaMiddleware.run(rootSaga);
export default store;

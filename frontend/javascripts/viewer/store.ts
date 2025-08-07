import type DiffableMap from "libs/diffable_map";
import { type Middleware, applyMiddleware, createStore } from "redux";
import { enableBatching } from "redux-batched-actions";
import createSagaMiddleware, { type Saga } from "redux-saga";

// Type imports
import type { Matrix4x4 } from "libs/mjs";
import type {
  APIAllowedMode,
  APIAnnotationType,
  APIAnnotationVisibility,
  APIConnectomeFile,
  APIDataLayer,
  APIDataSourceId,
  APIDataStore,
  APIDataset,
  APIHistogramData,
  APIMeshFileInfo,
  APIOrganization,
  APIRestrictions,
  APIScript,
  APISettings,
  APITask,
  APITracingStore,
  APIUser,
  APIUserBase,
  APIUserCompact,
  AdditionalAxis,
  AdditionalCoordinate,
  AnnotationLayerDescriptor,
  MetadataEntryProto,
  ServerEditableMapping,
  TracingType,
} from "types/api_types";
import type {
  ContourMode,
  ControlMode,
  FillMode,
  InterpolationMode,
  MappingStatus,
  OrthoView,
  OrthoViewWithoutTD,
  OverwriteMode,
  Rect,
  TDViewDisplayMode,
  Vector2,
  Vector3,
  ViewMode,
} from "viewer/constants";
import type { BLEND_MODES, ControlModeEnum } from "viewer/constants";
import type { TracingStats } from "viewer/model/accessors/annotation_accessor";
import type { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import type { Action } from "viewer/model/actions/actions";
import type { UpdateAction } from "viewer/model/sagas/volume/update_actions";
import type { Toolkit } from "./model/accessors/tool_accessor";
import type {
  MutableTreeGroup,
  TreeGroup,
  TreeGroupTypeFlat,
  TreeMap,
} from "./model/types/tree_types";

import type { BoundingBoxMinMaxType, BoundingBoxObject } from "types/bounding_box";
// Value imports
import defaultState from "viewer/default_state";
import actionLoggerMiddleware from "viewer/model/helpers/action_logger_middleware";
import overwriteActionMiddleware from "viewer/model/helpers/overwrite_action_middleware";
import reduceReducers from "viewer/model/helpers/reduce_reducers";
import AnnotationReducer from "viewer/model/reducers/annotation_reducer";
import ConnectomeReducer from "viewer/model/reducers/connectome_reducer";
import DatasetReducer from "viewer/model/reducers/dataset_reducer";
import FlycamReducer from "viewer/model/reducers/flycam_reducer";
import SaveReducer from "viewer/model/reducers/save_reducer";
import SettingsReducer from "viewer/model/reducers/settings_reducer";
import SkeletonTracingReducer from "viewer/model/reducers/skeletontracing_reducer";
import TaskReducer from "viewer/model/reducers/task_reducer";
import UiReducer from "viewer/model/reducers/ui_reducer";
import UserReducer from "viewer/model/reducers/user_reducer";
import ViewModeReducer from "viewer/model/reducers/view_mode_reducer";
import VolumeTracingReducer from "viewer/model/reducers/volumetracing_reducer";
import { eventEmitterMiddleware } from "./model/helpers/event_emitter_middleware";
import FlycamInfoCacheReducer from "./model/reducers/flycam_info_cache_reducer";
import OrganizationReducer from "./model/reducers/organization_reducer";
import type { StartAIJobModalState } from "./view/action-bar/starting_job_modals";

export type { BoundingBoxObject } from "types/bounding_box";

export type UserBoundingBoxForServer = {
  boundingBox: BoundingBoxObject;
  id: number;
  name: string;
  color: Vector3;
  isVisible?: boolean;
};
export type UserBoundingBoxWithoutIdMaybe = {
  boundingBox?: BoundingBoxMinMaxType;
  name?: string;
  color?: Vector3;
  isVisible?: boolean;
};
export type UserBoundingBoxWithoutId = {
  boundingBox: BoundingBoxMinMaxType;
  name: string;
  color: Vector3;
  isVisible: boolean;
};
export type UserBoundingBox = UserBoundingBoxWithoutId & {
  id: number;
};
export type UserBoundingBoxWithOptIsVisible = Omit<UserBoundingBox, "isVisible"> & {
  isVisible?: boolean;
};

export type SegmentGroupTypeFlat = TreeGroupTypeFlat;
export type SegmentGroup = TreeGroup;
export type MutableSegmentGroup = MutableTreeGroup;

export type DataLayerType = APIDataLayer;
export type Restrictions = APIRestrictions & { initialAllowUpdate: boolean };
export type AllowedMode = APIAllowedMode;
export type Settings = APISettings;
export type DataStoreInfo = APIDataStore;
export type AnnotationVisibility = APIAnnotationVisibility;
export type RestrictionsAndSettings = Restrictions & Settings;
export type Annotation = {
  readonly annotationId: string;
  // This is the version that the front-end considers as
  // most recently saved. Usually, this will be identical
  // to the version stored in the back-end. Only if another
  // actor has saved a newer version to the front-end, the
  // versions won't match (=> conflict).
  // Unsaved changes don't change this version field.
  readonly version: number;
  readonly earliestAccessibleVersion: number;
  readonly restrictions: RestrictionsAndSettings;
  readonly visibility: AnnotationVisibility;
  readonly annotationLayers: Array<AnnotationLayerDescriptor>;
  readonly tags: Array<string>;
  readonly stats: TracingStats | null | undefined;
  readonly description: string;
  readonly name: string;
  readonly organization: string;
  readonly tracingStore: APITracingStore;
  readonly annotationType: APIAnnotationType;
  readonly owner: APIUserBase | null | undefined;
  readonly contributors: APIUserBase[];
  readonly othersMayEdit: boolean;
  readonly blockedByUser: APIUserCompact | null | undefined;
  readonly isLockedByOwner: boolean;
};
type TracingBase = {
  readonly createdTimestamp: number;
  readonly tracingId: string;
  readonly boundingBox: BoundingBoxMinMaxType | null | undefined;
  readonly userBoundingBoxes: Array<UserBoundingBox>;
  readonly additionalAxes: AdditionalAxis[];
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
  readonly id: number;
  readonly name: string | null | undefined;
  readonly somePosition: Vector3 | undefined;
  readonly someAdditionalCoordinates: AdditionalCoordinate[] | undefined | null;
  readonly creationTime: number | null | undefined;
  readonly color: Vector3 | null;
  readonly groupId: number | null | undefined;
  readonly isVisible: boolean;
  readonly metadata: MetadataEntryProto[];
};
export type SegmentMap = DiffableMap<number, Segment>;

export type LabelAction = {
  centroid: Vector3; // centroid of the label action
  plane: OrthoViewWithoutTD; // plane that was labeled
};

export type VolumeTracing = TracingBase & {
  readonly type: "volume";
  // Note that there are also SegmentMaps in `state.localSegmentationData`
  // for non-annotation volume layers.
  readonly segments: SegmentMap;
  readonly segmentGroups: Array<SegmentGroup>;
  readonly largestSegmentId: number | null;
  readonly activeCellId: number;
  readonly activeUnmappedSegmentId?: number | null; // not persisted
  // lastLabelActions[0] is the most recent one
  readonly lastLabelActions: Array<LabelAction>;
  readonly contourTracingMode: ContourMode;
  // Stores points of the currently drawn region in global coordinates
  readonly contourList: Array<Vector3>;
  readonly fallbackLayer?: string;
  readonly mappingName?: string | null | undefined;
  readonly hasEditableMapping?: boolean;
  readonly mappingIsLocked?: boolean;
  readonly hasSegmentIndex: boolean;
  readonly volumeBucketDataHasChanged?: boolean;
  readonly hideUnregisteredSegments: boolean;
};
export type ReadOnlyTracing = TracingBase & {
  readonly type: "readonly";
};
export type EditableMapping = Readonly<ServerEditableMapping> & {
  readonly type: "mapping";
};
export type StoreAnnotation = Annotation & {
  readonly skeleton: SkeletonTracing | null | undefined;
  readonly volumes: Array<VolumeTracing>;
  readonly readOnly: ReadOnlyTracing | null | undefined;
  readonly mappings: Array<EditableMapping>;
};
export type LegacyViewCommand = APIDataSourceId & {
  readonly type: typeof ControlModeEnum.VIEW;
};
export type TraceOrViewCommand =
  | {
      readonly datasetId: string;
      readonly type: typeof ControlModeEnum.VIEW;
    }
  | {
      readonly type: typeof ControlModeEnum.TRACE;
      readonly annotationId: string;
    }
  | {
      readonly datasetId: string;
      readonly type: typeof ControlModeEnum.SANDBOX;
      readonly tracingType: TracingType;
    };
export type DatasetLayerConfiguration = {
  readonly color: Vector3;
  readonly brightness?: number;
  readonly contrast?: number;
  readonly alpha: number;
  readonly intensityRange?: readonly [number, number];
  readonly min?: number;
  readonly max?: number;
  readonly isDisabled: boolean;
  readonly isInverted: boolean;
  readonly isInEditMode: boolean;
  readonly gammaCorrectionValue: number;
  readonly mapping?: { name: string; type: MappingType } | null | undefined;
};
export type LoadingStrategy = "BEST_QUALITY_FIRST" | "PROGRESSIVE_QUALITY";

export type BrushPresets = {
  readonly small: number;
  readonly medium: number;
  readonly large: number;
};

export type DatasetConfiguration = {
  readonly fourBit: boolean;
  readonly interpolation: boolean;
  readonly layers: Record<string, DatasetLayerConfiguration>;
  readonly colorLayerOrder: Array<string>;
  readonly position?: Vector3;
  readonly zoom?: number;
  readonly rotation?: Vector3;
  readonly renderMissingDataBlack: boolean;
  readonly loadingStrategy: LoadingStrategy;
  readonly segmentationPatternOpacity: number;
  readonly blendMode: BLEND_MODES;
  // If nativelyRenderedLayerName is not-null, the layer with
  // that name (or id) should be rendered without any transforms.
  // This means, that all other layers should be transformed so that
  // they still correlated with each other.
  // If other layers have the same transformation they will also be rendered
  // natively as their transform and the inverse transform of the nativelyRenderedLayer
  // layer cancel each other out.
  // If nativelyRenderedLayerName is null, all layers are rendered
  // as their transforms property signal it.
  // Currently, skeleton layers and volume layers without fallback do not have transforms
  // as a stored property. So, to render the skeleton layer natively,
  // nativelyRenderedLayerName can be set to null.
  readonly nativelyRenderedLayerName: string | null;
};

export type PartialDatasetConfiguration = Partial<Omit<DatasetConfiguration, "layers">> & {
  readonly layers?: Record<string, Partial<DatasetLayerConfiguration>>;
};

export type QuickSelectConfig = {
  readonly useHeuristic: boolean;
  // Only relevant for useHeuristic=false:
  readonly predictionDepth?: number;
  // Only relevant for useHeuristic=true:
  readonly showPreview: boolean;
  readonly segmentMode: "dark" | "light";
  readonly threshold: number;
  readonly closeValue: number;
  readonly erodeValue: number;
  readonly dilateValue: number;
};

export type UserConfiguration = {
  readonly autoSaveLayouts: boolean;
  readonly autoRenderMeshInProofreading: boolean;
  readonly selectiveVisibilityInProofreading: boolean;
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
  readonly continuousNodeCreation: boolean;
  readonly centerNewNode: boolean;
  readonly applyNodeRotationOnActivation: boolean;
  readonly overrideNodeRadius: boolean;
  readonly particleSize: number;
  readonly presetBrushSizes: BrushPresets | null;
  readonly rotateValue: number;
  readonly sortCommentsAsc: boolean;
  readonly sortTreesByName: boolean;
  readonly sphericalCapRadius: number;
  readonly tdViewDisplayPlanes: TDViewDisplayMode;
  readonly tdViewDisplayDatasetBorders: boolean;
  readonly tdViewDisplayLayerBorders: boolean;
  readonly gpuMemoryFactor: number;
  // For volume (and hybrid) annotations, this mode specifies
  // how volume annotations overwrite existing voxels.
  readonly overwriteMode: OverwriteMode;
  readonly fillMode: FillMode;
  readonly isFloodfillRestrictedToBoundingBox: boolean;
  readonly interpolationMode: InterpolationMode;
  readonly useLegacyBindings: boolean;
  readonly quickSelect: QuickSelectConfig;
  readonly renderWatermark: boolean;
  readonly antialiasRendering: boolean;
  readonly activeToolkit: Toolkit;
};
export type RecommendedConfiguration = Partial<
  UserConfiguration &
    DatasetConfiguration & {
      zoom: number;
      segmentationOpacity: number;
    }
>;
// A histogram value of undefined indicates that the histogram hasn't been fetched yet
// whereas a value of null indicates that the histogram couldn't be fetched
export type HistogramDataForAllLayers = Record<string, APIHistogramData | null>;
export type Mapping = Map<number, number> | Map<bigint, bigint>;
export type NumberLike = number | bigint;
export type NumberLikeMap = Map<NumberLike, NumberLike>;

export type MappingType = "JSON" | "HDF5";
export type ActiveMappingInfo = {
  readonly mappingName: string | null | undefined;
  readonly mapping: Mapping | null | undefined;
  readonly mappingColors: number[] | null | undefined;
  readonly hideUnmappedIds: boolean;
  readonly mappingStatus: MappingStatus;
  readonly mappingType: MappingType;
  readonly isMergerModeMapping?: boolean;
};
export type TemporaryConfiguration = {
  readonly histogramData: HistogramDataForAllLayers;
  readonly viewMode: ViewMode;
  readonly flightmodeRecording: boolean;
  readonly controlMode: ControlMode;
  readonly mousePosition: Vector2 | null | undefined;
  readonly hoveredSegmentId: number | null;
  readonly hoveredUnmappedSegmentId: number | null;
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
  authorId: string;
  actions: Array<UpdateAction>;
  transactionId: string;
  transactionGroupCount: number;
  transactionGroupIndex: number;
  stats: TracingStats | null | undefined;
  info: string;
};
export type ProgressInfo = {
  readonly processedActionCount: number;
  readonly totalActionCount: number;
};
export type SaveState = {
  readonly isBusy: boolean;
  readonly queue: Array<SaveQueueEntry>;
  readonly lastSaveTimestamp: number;
  readonly progressInfo: ProgressInfo;
};
export type Flycam = {
  readonly zoomStep: number;
  readonly currentMatrix: Matrix4x4;
  readonly additionalCoordinates: AdditionalCoordinate[] | null;
  readonly spaceDirectionOrtho: [-1 | 1, -1 | 1, -1 | 1];
  readonly direction: Vector3;
  readonly rotation: Vector3;
};
export type CameraData = {
  readonly near: number;
  readonly far: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly up: Vector3;
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
  readonly position?: Vector3;
};
export type PlaneRects = {
  readonly PLANE_XY: Rect;
  readonly PLANE_YZ: Rect;
  readonly PLANE_XZ: Rect;
  readonly TDView: Rect;
};
export type PlaneModeData = {
  readonly activeViewport: OrthoView;
  readonly tdCamera: CameraData;
  readonly inputCatcherRects: PlaneRects;
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
export type ContextMenuInfo = {
  readonly contextMenuPosition: Readonly<[number, number]> | null | undefined;
  readonly clickedNodeId: number | null | undefined;
  readonly meshId: number | null | undefined;
  readonly meshIntersectionPosition: Vector3 | null | undefined;
  readonly clickedBoundingBoxId: number | null | undefined;
  readonly globalPosition: Vector3 | null | undefined;
  readonly viewport: OrthoView | null | undefined;
  readonly unmappedSegmentId?: number | null;
};
type UiInformation = {
  readonly globalProgress: number; // 0 to 1
  readonly showDropzoneModal: boolean;
  readonly showVersionRestore: boolean;
  readonly showDownloadModal: boolean;
  readonly showPythonClientModal: boolean;
  readonly showShareModal: boolean;
  readonly showMergeAnnotationModal: boolean;
  readonly showZarrPrivateLinksModal: boolean;
  readonly showAddScriptModal: boolean;
  readonly aIJobModalState: StartAIJobModalState;
  readonly showRenderAnimationModal: boolean;
  readonly activeTool: AnnotationTool;
  readonly activeUserBoundingBoxId: number | null | undefined;
  readonly storedLayouts: Record<string, any>;
  readonly isImportingMesh: boolean;
  readonly isInAnnotationView: boolean;
  readonly hasOrganizations: boolean;
  readonly borderOpenStatus: BorderOpenStatus;
  readonly theme: Theme;
  readonly isWkReady: boolean;
  readonly busyBlockingInfo: BusyBlockingInfo;
  readonly quickSelectState:
    | "inactive"
    | "drawing" // the user is currently drawing a bounding box
    | "active"; // the quick select saga is currently running (calculating as well as preview mode)
  readonly areQuickSelectSettingsOpen: boolean;
  readonly measurementToolInfo: { lastMeasuredPosition: Vector3 | null; isMeasuring: boolean };
  readonly navbarHeight: number;
  readonly contextInfo: ContextMenuInfo;
};
type BaseMeshInformation = {
  readonly segmentId: number;
  readonly seedPosition: Vector3;
  readonly seedAdditionalCoordinates?: AdditionalCoordinate[] | null;
  readonly isLoading: boolean;
  readonly isVisible: boolean;
  readonly opacity: number;
  readonly mappingName: string | null | undefined;
};
export type AdHocMeshInformation = BaseMeshInformation & {
  readonly isPrecomputed: false;
  readonly mappingType: MappingType | null | undefined;
};
export type PrecomputedMeshInformation = BaseMeshInformation & {
  readonly isPrecomputed: true;
  readonly meshFileName: string;
};
export type MeshInformation = AdHocMeshInformation | PrecomputedMeshInformation;
export type ConnectomeData = {
  readonly availableConnectomeFiles: Array<APIConnectomeFile> | null | undefined;
  readonly currentConnectomeFile: APIConnectomeFile | null | undefined;
  readonly pendingConnectomeFileName: string | null | undefined;
  readonly activeAgglomerateIds: Array<number>;
  readonly skeleton: SkeletonTracing | null | undefined;
};
export type LocalSegmentationData = {
  // For meshes, the string represents additional coordinates, number is the segment ID.
  // The undefined types were added to enforce null checks when using this structure.
  readonly meshes: Record<string, Record<number, MeshInformation> | undefined> | undefined;
  readonly availableMeshFiles: Array<APIMeshFileInfo> | null | undefined;
  readonly currentMeshFile: APIMeshFileInfo | null | undefined;
  // Note that for a volume tracing, this information should be stored
  // in state.annotation.volume.segments, as this is also persisted on the
  // server (i.e., not "local").
  // The `segments` here should only be used for non-annotation volume
  // layers.
  readonly segments: SegmentMap;
  // Note that segments that are not in the segment tab could be stored as selected.
  // To get only available segments or group, use getSelectedIds() in volumetracing_accessor.
  readonly selectedIds: { segments: number[]; group: number | null };
  readonly connectomeData: ConnectomeData;
  readonly hideUnregisteredSegments: boolean;
};

export type StoreDataset = APIDataset & {
  // The backend serves an APIDataset object. The frontend
  // adds/merges volume tracing objects into that dataset. The
  // StoreDataset reflects this on a type level. For example,
  // one cannot accidentally use the APIDataset during store
  // initialization (which would be incorrect).
  areLayersPreprocessed: true;
};

export type WebknossosState = {
  readonly datasetConfiguration: DatasetConfiguration;
  readonly userConfiguration: UserConfiguration;
  readonly temporaryConfiguration: TemporaryConfiguration;
  readonly dataset: StoreDataset;
  readonly annotation: StoreAnnotation;
  readonly task: Task | null | undefined;
  readonly save: SaveState;
  readonly flycam: Flycam;
  readonly flycamInfoCache: {
    readonly maximumZoomForAllMags: Record<string, number[]>;
  };
  readonly viewModeData: ViewModeData;
  readonly activeUser: APIUser | null | undefined;
  readonly activeOrganization: APIOrganization | null;
  readonly uiInformation: UiInformation;
  readonly localSegmentationData: Record<
    string, // layerName
    LocalSegmentationData
  >;
};
const sagaMiddleware = createSagaMiddleware();
export type Reducer = (state: WebknossosState, action: Action) => WebknossosState;
export const combinedReducer = reduceReducers(
  SettingsReducer,
  DatasetReducer,
  SkeletonTracingReducer,
  VolumeTracingReducer,
  TaskReducer,
  SaveReducer,
  FlycamReducer,
  FlycamInfoCacheReducer,
  ViewModeReducer,
  AnnotationReducer,
  UserReducer,
  UiReducer,
  ConnectomeReducer,
  OrganizationReducer,
) as Reducer;

const store = createStore<WebknossosState, Action, unknown, unknown>(
  enableBatching(combinedReducer as any),
  defaultState,
  applyMiddleware(
    actionLoggerMiddleware,
    overwriteActionMiddleware,
    sagaMiddleware as Middleware,
    eventEmitterMiddleware,
  ),
);

export function startSaga(saga: Saga<any[]>) {
  return sagaMiddleware.run(saga);
}
export type StoreType = typeof store;

export default store;

import type { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import _ from "lodash";
import type {
  ColorObject,
  LOG_LEVELS,
  Point3,
  TreeType,
  UnitLong,
  Vector3,
  Vector4,
  Vector6,
} from "oxalis/constants";
import type {
  SkeletonTracingStats,
  TracingStats,
} from "oxalis/model/accessors/annotation_accessor";
import type { ServerUpdateAction } from "oxalis/model/sagas/update_actions";
import type {
  BoundingBoxObject,
  CommentType,
  Edge,
  MeshInformation,
  RecommendedConfiguration,
  SegmentGroup,
  TreeGroup,
} from "oxalis/store";
import type { EmptyObject } from "./globals";

export type AdditionalCoordinate = { name: string; value: number };

export type APIMessage = { [key in "info" | "warning" | "error"]?: string };
export type ElementClass =
  | "uint8"
  | "uint16"
  | "uint24"
  | "uint32"
  | "uint64"
  | "float"
  | "double"
  | "int8"
  | "int16"
  | "int32"
  | "int64";
export type APIMapping = {
  readonly parent?: string;
  readonly name: string;
  readonly classes?: Array<Array<number>>;
  readonly colors?: Array<number>;
  readonly hideUnmappedIds?: boolean;
};
export type AdditionalAxis = {
  bounds: [number, number];
  index: number;
  name: string;
};

export type ServerAdditionalAxis = {
  bounds: { x: number; y: number };
  index: number;
  name: string;
};

export type CoordinateTransformation =
  | {
      type: "affine";
      matrix: [Vector4, Vector4, Vector4, Vector4];
    }
  | {
      type: "thin_plate_spline";
      correspondences: { source: Vector3[]; target: Vector3[] };
    };
type APIDataLayerBase = {
  readonly name: string;
  readonly boundingBox: BoundingBoxObject;
  readonly resolutions: Array<Vector3>;
  readonly elementClass: ElementClass;
  readonly dataFormat?: "wkw" | "zarr";
  readonly additionalAxes: Array<AdditionalAxis> | null;
  readonly coordinateTransformations?: CoordinateTransformation[] | null;
  readonly hasSegmentIndex?: boolean;
};
type APIColorLayer = APIDataLayerBase & {
  readonly category: "color";
};
export type APISegmentationLayer = APIDataLayerBase & {
  readonly category: "segmentation";
  readonly largestSegmentId: number | undefined;
  readonly mappings?: Array<string>;
  readonly agglomerates?: Array<string>;
  readonly fallbackLayer?: string | null | undefined;
  readonly fallbackLayerInfo?: APIDataLayer | null;
  readonly tracingId?: string;
};
export type APIDataLayer = APIColorLayer | APISegmentationLayer;

// Only used in rare cases to generalize over actual data layers and
// a skeleton layer.
export type APISkeletonLayer = { category: "skeleton" };

export type LayerLink = {
  datasetId: string;
  dataSourceId: APIDataSourceId;
  datasetName: string;
  sourceName: string;
  newName: string;
  transformations: CoordinateTransformation[];
};

export type APIHistogramData = HistogramDatum[];
export type HistogramDatum = {
  numberOfElements: number;
  elementCounts: Array<number>;
  min: number;
  max: number;
};
type MutableAPIDataSourceBase = {
  id: {
    name: string;
    team: string;
  };
  status?: string;
};
type APIDataSourceBase = Readonly<MutableAPIDataSourceBase>;
export type APIUnimportedDatasource = APIDataSourceBase;
export type VoxelSize = {
  factor: Vector3;
  unit: UnitLong;
};
export type MutableAPIDataSource = MutableAPIDataSourceBase & {
  dataLayers: Array<APIDataLayer>;
  scale: VoxelSize;
};
export type APIDataSource = Readonly<MutableAPIDataSource>;
export type APIDataStore = {
  readonly name: string;
  readonly url: string;
  readonly allowsUpload: boolean;
  readonly jobsEnabled: boolean;
  readonly jobsSupportedByAvailableWorkers: APIJobType[];
};
export type APITracingStore = {
  readonly name: string;
  readonly url: string;
};
export type APITeam = {
  readonly id: string;
  readonly name: string;
  readonly organization: string;
};
export type APIPublicationAnnotation = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tracingStore: APITracingStore;
  readonly dataset: APIDataset;
};
export type APIPublication = {
  readonly id: string;
  readonly publicationDate: number;
  readonly imageUrl: string;
  readonly title: string;
  readonly description: string;
  readonly created: number;
  readonly datasets: Array<APIDataset>;
  readonly annotations: Array<APIPublicationAnnotation>;
};
export type MutableAPIDataSourceId = {
  owningOrganization: string;
  directoryName: string;
};
export type APIDataSourceId = Readonly<MutableAPIDataSourceId>;

export enum APIMetadataEnum {
  STRING = "string",
  NUMBER = "number",
  STRING_ARRAY = "string[]",
}
// This type has to be defined redundantly to the above enum, unfortunately,
// because the e2e tests assert that an object literal matches the type of
// APIMetadataEntry. In that object literal, a string literal exists (e.g., "number").
// TypeScript Enums don't typecheck against such literals by design (see
// https://github.com/microsoft/TypeScript/issues/17690#issuecomment-337975541).
// Therefore, we redundantly define the type of the enum here again and use that
// in APIMetadataEntry.
type APIMetadataType = "string" | "number" | "string[]";

// Note that this differs from MetadataEntryProto, because
// it's stored in sql and not in protobuf.
// The type is used for datasets and folders.
export type APIMetadataEntry = {
  type: APIMetadataType;
  key: string;
  value: string | number | string[];
};

type MutableAPIDatasetBase = MutableAPIDataSourceId & {
  readonly id: string; // Should never be changed.
  name: string;
  isUnreported: boolean;
  folderId: string;
  allowedTeams: Array<APITeam>;
  allowedTeamsCumulative: Array<APITeam>;
  created: number;
  dataStore: APIDataStore;
  description: string | null | undefined;
  metadata: APIMetadataEntry[] | null | undefined;
  isEditable: boolean;
  isPublic: boolean;
  directoryName: string;
  logoUrl: string | null | undefined;
  lastUsedByUser: number;
  sortingKey: number;
  owningOrganization: string;
  publication: null | undefined;
  tags: Array<string>;
  usedStorageBytes: number | null;
};
type APIDatasetBase = Readonly<MutableAPIDatasetBase>;
export type MutableAPIDataset = MutableAPIDatasetBase & {
  dataSource: MutableAPIDataSource;
  isActive: true;
};
export type APIDataset = APIDatasetBase & {
  readonly dataSource: APIDataSource;
  readonly isActive: true;
};

export type MaintenanceInfo = {
  startTime: number;
  endTime: number;
  id: string;
  message: string;
};

// Should be a strict subset of APIMaybeUnimportedDataset which makes
// typing easier in some places.
export type APIDatasetCompactWithoutStatusAndLayerNames = Pick<
  APIMaybeUnimportedDataset,
  | "owningOrganization"
  | "name"
  | "folderId"
  | "isActive"
  | "directoryName"
  | "created"
  | "isEditable"
  | "lastUsedByUser"
  | "tags"
  | "isUnreported"
>;
export type APIDatasetCompact = APIDatasetCompactWithoutStatusAndLayerNames & {
  id: string;
  status: MutableAPIDataSourceBase["status"];
  colorLayerNames: Array<string>;
  segmentationLayerNames: Array<string>;
};

export function convertDatasetToCompact(dataset: APIDataset): APIDatasetCompact {
  const [segmentationLayerNames, colorLayerNames] = _.partition(
    dataset.dataSource.dataLayers,
    (layer) => layer.category === "segmentation",
  ).map((layers) => layers.map((layer) => layer.name).sort());

  return {
    id: dataset.id,
    owningOrganization: dataset.owningOrganization,
    name: dataset.name,
    folderId: dataset.folderId,
    isActive: dataset.isActive,
    directoryName: dataset.directoryName,
    created: dataset.created,
    isEditable: dataset.isEditable,
    lastUsedByUser: dataset.lastUsedByUser,
    status: dataset.dataSource.status,
    tags: dataset.tags,
    isUnreported: dataset.isUnreported,
    colorLayerNames: colorLayerNames,
    segmentationLayerNames: segmentationLayerNames,
  };
}

type APIUnimportedDataset = APIDatasetBase & {
  readonly dataSource: APIUnimportedDatasource;
  readonly isActive: false;
};
export type APIMaybeUnimportedDataset = APIUnimportedDataset | APIDataset;
export type APITeamMembership = {
  readonly id: string;
  readonly name: string;
  readonly isTeamManager: boolean;
};
export type ExperienceMap = Readonly<Record<string, number>>;
export type ExperienceDomainList = Array<string>;

export type APIUserCompact = {
  readonly firstName: string;
  readonly lastName: string;
  readonly id: string;
};
export type APIUserBase = APIUserCompact & {
  readonly email: string;
  readonly isAnonymous: boolean;
  readonly teams: Array<APITeamMembership>;
  readonly isAdmin: boolean;
  readonly isDatasetManager: boolean;
};
export type NovelUserExperienceInfoType = {
  hasSeenDashboardWelcomeBanner?: boolean;
  hasSeenSegmentAnythingWithDepth?: boolean;
  shouldSeeModernControlsModal?: boolean;
  lastViewedWhatsNewTimestamp?: number;
  hasDiscardedHelpButton?: boolean;
  latestAcknowledgedMaintenanceInfo?: string;
};
export type APIUserTheme = "auto" | "light" | "dark";
export type APIUser = APIUserBase & {
  readonly isOrganizationOwner: boolean;
  readonly created: number;
  readonly experiences: ExperienceMap;
  readonly isSuperUser: boolean;
  readonly isActive: boolean;
  readonly isEditable: boolean;
  readonly lastActivity: number;
  readonly lastTaskTypeId: string | null | undefined;
  readonly organization: string;
  readonly novelUserExperienceInfos: NovelUserExperienceInfoType;
  readonly selectedTheme: APIUserTheme;
  readonly isEmailVerified: boolean;
};
export type APITimeInterval = {
  paymentInterval: {
    month: number;
    year: number;
  };
  durationInSeconds: number;
};
export type APIUserLoggedTime = {
  loggedTime: Array<APITimeInterval>;
};
export type APIActiveUser = {
  email: string;
  firstName: string;
  lastName: string;
  activeTasks: number;
};
export type APIRestrictions = {
  readonly allowAccess: boolean;
  readonly allowUpdate: boolean;
  readonly allowFinish: boolean;
  readonly allowDownload: boolean;
  // allowSave might be false even though allowUpdate is true (e.g., see sandbox annotations)
  readonly allowSave?: boolean;
};
export type APIAllowedMode = "orthogonal" | "oblique" | "flight";
export type APIMagRestrictions = {
  min?: number;
  max?: number;
};
export type APISettings = {
  readonly allowedModes: Array<APIAllowedMode>;
  readonly preferredMode?: APIAllowedMode;
  readonly branchPointsAllowed: boolean;
  readonly somaClickingAllowed: boolean;
  readonly volumeInterpolationAllowed: boolean;
  readonly mergerMode: boolean;
  readonly magRestrictions: APIMagRestrictions;
};
export enum APIAnnotationTypeEnum {
  Explorational = "Explorational",
  Task = "Task",
  View = "View",
  CompoundTask = "CompoundTask",
  CompoundProject = "CompoundProject",
  CompoundTaskType = "CompoundTaskType",
}
export enum APICompoundTypeEnum {
  CompoundTask = "CompoundTask",
  CompoundProject = "CompoundProject",
  CompoundTaskType = "CompoundTaskType",
}

export type APIAnnotationType = keyof typeof APIAnnotationTypeEnum;
export type APICompoundType = keyof typeof APICompoundTypeEnum;
export type APIAnnotationVisibility = "Private" | "Internal" | "Public";
export enum TracingTypeEnum {
  skeleton = "skeleton",
  volume = "volume",
  hybrid = "hybrid",
}
export type TracingType = keyof typeof TracingTypeEnum;
export type APITaskType = {
  readonly id: string;
  readonly summary: string;
  readonly description: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly settings: APISettings;
  readonly recommendedConfiguration: RecommendedConfiguration | null | undefined;
  readonly tracingType: TracingType;
};
export type TaskStatus = {
  readonly pending: number;
  readonly active: number;
  readonly finished: number;
};
type APIScriptTypeBase = {
  readonly name: string;
  readonly gist: string;
};
export type APIScript = APIScriptTypeBase & {
  readonly id: string;
  readonly owner: APIUserBase;
};
export type APIScriptUpdater = APIScriptTypeBase & {
  readonly id: string;
  readonly owner: string;
};
export type APIScriptCreator = APIScriptTypeBase & {
  readonly owner: string;
};
type APIProjectTypeBase = {
  readonly name: string;
  readonly team: string; // id
  readonly teamName: string;
  readonly priority: number;
  readonly paused: boolean;
  readonly expectedTime: number; // Also known as "time limit"
  readonly isBlacklistedFromReport: boolean;
};
export type APIProject = APIProjectTypeBase & {
  readonly id: string;
  readonly owner: APIUserBase;
  readonly created: number;
};
export type APIProjectUpdater = APIProjectTypeBase & {
  readonly id: string;
  readonly owner: string;
  readonly created: number;
};
export type APIProjectCreator = APIProjectTypeBase & {
  readonly owner: string;
};
export type APIProjectWithStatus = APIProject & {
  readonly pendingInstances: number;
  readonly tracingTime: number;
};
export type APITask = {
  readonly boundingBox: BoundingBoxObject | null | undefined;
  readonly boundingBoxVec6?: Vector6;
  readonly created: number;
  readonly creationInfo: string | null | undefined;
  readonly datasetId: string;
  readonly datasetName: string;
  readonly editPosition: Vector3;
  readonly editRotation: Vector3;
  readonly id: string;
  readonly neededExperience: {
    readonly domain: string;
    readonly value: number;
  };
  readonly projectName: string;
  readonly projectId: string;
  readonly script: APIScript | null | undefined;
  readonly status: TaskStatus;
  readonly team: string;
  readonly tracingTime: number | null | undefined;
  readonly type: APITaskType;
  readonly directLinks?: Array<string>;
};
export type AnnotationLayerDescriptor = {
  name: string;
  tracingId: string;
  typ: "Skeleton" | "Volume";
  stats: TracingStats | EmptyObject;
};
export type EditableLayerProperties = Partial<{
  name: string;
}>;
export type APIAnnotationInfo = {
  readonly annotationLayers: Array<AnnotationLayerDescriptor>;
  readonly datasetId: string;
  readonly dataSetName: string;
  readonly organization: string;
  readonly description: string;
  readonly modified: number;
  readonly id: string;
  readonly name: string;
  // Not used by the front-end anymore, but the
  // backend still serves this for backward-compatibility reasons.
  readonly stats?: SkeletonTracingStats | EmptyObject;
  readonly state: string;
  readonly isLockedByOwner: boolean;
  readonly tags: Array<string>;
  readonly typ: APIAnnotationType;
  // The owner can be null (e.g., for a sandbox annotation
  // or due to missing permissions).
  readonly owner?: APIUserCompact;
  readonly teams: APITeam[];
  readonly othersMayEdit: boolean;
};

export function annotationToCompact(annotation: APIAnnotation): APIAnnotationInfo {
  const {
    dataSetName,
    description,
    modified,
    id,
    datasetId,
    name,
    state,
    isLockedByOwner,
    tags,
    typ,
    owner,
    teams,
    othersMayEdit,
    organization,
    annotationLayers,
  } = annotation;

  return {
    datasetId,
    annotationLayers,
    dataSetName,
    organization,
    description,
    modified,
    id,
    isLockedByOwner,
    name,
    state,
    tags,
    typ,
    owner,
    teams,
    othersMayEdit,
  };
}

export type AnnotationViewConfiguration = {
  layers: Record<
    string,
    {
      isDisabled: boolean;
    }
  >;
};
type APIAnnotationBase = APIAnnotationInfo & {
  readonly visibility: APIAnnotationVisibility;
  readonly tracingTime: number | null | undefined;

  readonly dataStore: APIDataStore;
  readonly tracingStore: APITracingStore;
  readonly restrictions: APIRestrictions;
  readonly viewConfiguration?: AnnotationViewConfiguration | null | undefined;
  readonly settings: APISettings;
  readonly owner?: APIUserBase;
  // This `user` attribute is deprecated and should not be used, anymore. It only exists to satisfy e2e type checks
  readonly user?: APIUserBase;
  readonly contributors: APIUserBase[];
  readonly othersMayEdit: boolean;
};
export type APIAnnotation = APIAnnotationBase & {
  readonly task: APITask | null | undefined;
};
export type APIAnnotationWithTask = APIAnnotationBase & {
  readonly task: APITask;
};
export type APITaskWithAnnotation = APITask & {
  readonly annotation: APIAnnotation;
};
export type APITimeTrackingPerAnnotation = {
  annotation: string;
  task: string | undefined;
  projectName: string | undefined;
  timeMillis: number;
  annotationLayerStats: Array<TracingStats>;
};
export type APITimeTrackingPerUser = {
  user: APIUserCompact & {
    email: string;
  };
  timeMillis: number;
  annotationCount: number;
};
export type APITimeTrackingSpan = {
  userId: string;
  userEmail: string;
  datasetOrganization: string;
  datasetName: string;
  annotationId: string;
  annotationState: string;
  taskId: string | undefined;
  projectName: string | undefined;
  taskTypeId: string | undefined;
  taskTypeSummary: string | undefined;
  timeSpanId: string;
  timeSpanCreated: number;
  timeSpanTimeMillis: number;
};
export type APIProjectProgressReport = {
  readonly projectName: string;
  readonly paused: boolean;
  readonly totalTasks: number;
  readonly totalInstances: number;
  readonly pendingInstances: number;
  readonly activeInstances: number;
  readonly finishedInstances: number;
  readonly priority: number;
  readonly billedMilliseconds: number;
};
export type APIAvailableTasksReport = {
  readonly id: string;
  readonly user: string;
  readonly totalAvailableTasks: number;
  readonly availableTasksByProjects: Record<string, number>;
};
export type APIOrganizationCompact = {
  readonly id: string;
  readonly name: string;
};
export type APIOrganization = APIOrganizationCompact & {
  readonly additionalInformation: string;
  readonly pricingPlan: PricingPlanEnum;
  readonly enableAutoVerify: boolean;
  readonly newUserMailingList: string;
  readonly paidUntil: number;
  readonly includedUsers: number;
  readonly includedStorageBytes: number;
  readonly usedStorageBytes: number;
  readonly ownerName?: string;
  readonly creditBalance: number;
};
export type APIPricingPlanStatus = {
  readonly pricingPlan: PricingPlanEnum;
  readonly isExceeded: boolean;
  readonly isAlmostExceeded: boolean; // stays true when isExceeded is true)
};

export type APIBuildInfo = {
  webknossos: {
    name: string;
    commitHash: string;
    scalaVersion: string;
    version: string;
    sbtVersion: string;
    commitDate: string;
    ciTag: string;
    ciBuild: string;
    gitTag?: string;
    datastoreApiVersion: string;
  };
  "webknossos-wrap": {
    builtAtMillis: string;
    name: string;
    commitHash: string;
    scalaVersion: string;
    version: string;
    sbtVersion: string;
    builtAtString: string;
  };
  webknossosDatastore?: {
    name: string;
    commitHash: string;
    scalaVersion: string;
    version: string;
    sbtVersion: string;
    commitDate: string;
    ciTag: string;
    ciBuild: string;
    gitTag: string;
    datastoreApiVersion: string;
  };
  schemaVersion: number;
  localDataStoreEnabled: boolean;
  localTracingStoreEnabled: boolean;
};
export type APIFeatureToggles = {
  readonly discussionBoard: string | false;
  readonly discussionBoardRequiresAdmin: boolean;
  readonly hideNavbarLogin: boolean;
  readonly isWkorgInstance: boolean;
  readonly recommendWkorgInstance: boolean;
  readonly taskReopenAllowedInSeconds: number;
  readonly allowDeleteDatasets: boolean;
  readonly jobsEnabled: boolean;
  readonly voxelyticsEnabled: boolean;
  readonly publicDemoDatasetUrl: string;
  readonly exportTiffMaxVolumeMVx: number;
  readonly exportTiffMaxEdgeLengthVx: number;
  readonly defaultToLegacyBindings: boolean;
  readonly optInTabs?: Array<string>;
  readonly openIdConnectEnabled?: boolean;
  readonly segmentAnythingEnabled?: boolean;
};
export type APIJobState = "SUCCESS" | "PENDING" | "STARTED" | "FAILURE" | null;
export type APIJobManualState = "SUCCESS" | "FAILURE" | null;
export type APIEffectiveJobState = "UNKNOWN" | "SUCCESS" | "PENDING" | "STARTED" | "FAILURE";
export enum APIJobType {
  ALIGN_SECTIONS = "align_sections",
  CONVERT_TO_WKW = "convert_to_wkw",
  EXPORT_TIFF = "export_tiff",
  RENDER_ANIMATION = "render_animation",
  COMPUTE_MESH_FILE = "compute_mesh_file",
  COMPUTE_SEGMENT_INDEX_FILE = "compute_segment_index_file",
  FIND_LARGEST_SEGMENT_ID = "find_largest_segment_id",
  INFER_NUCLEI = "infer_nuclei",
  INFER_NEURONS = "infer_neurons",
  MATERIALIZE_VOLUME_ANNOTATION = "materialize_volume_annotation",
  TRAIN_MODEL = "train_model",
  INFER_WITH_MODEL = "infer_with_model",
  INFER_MITOCHONDRIA = "infer_mitochondria",
}

export type WkLibsNdBoundingBox = BoundingBoxObject & {
  axisOrder: { string: number };
  additionalAxes: Array<AdditionalAxis>;
};

export type APIJob = {
  readonly id: string;
  readonly datasetId: string | null | undefined;
  readonly owner: APIUserBase;
  readonly datasetName: string | null | undefined;
  readonly datasetDirectoryName: string | null | undefined;
  readonly exportFileName: string | null | undefined;
  readonly layerName: string | null | undefined;
  readonly annotationLayerName: string | null | undefined;
  readonly tracingId: string | null | undefined;
  readonly annotationId: string | null | undefined;
  readonly annotationType: string | null | undefined;
  readonly organizationId: string | null | undefined;
  readonly boundingBox: string | null | undefined;
  readonly ndBoundingBox: WkLibsNdBoundingBox | null | undefined;
  readonly mergeSegments: boolean | null | undefined;
  readonly type: APIJobType;
  readonly state: APIEffectiveJobState;
  readonly manualState: APIJobManualState;
  readonly result: string | null | undefined;
  readonly resultLink: string | null | undefined;
  readonly createdAt: number;
  readonly voxelyticsWorkflowHash: string | null;
  readonly trainingAnnotations: Array<{ annotationId: string }>;
};

export type AiModel = {
  id: string;
  name: string;
  dataStore: APIDataStore;
  user: APIUser;
  comment: string;
  created: number;
  trainingJob: APIJob | null;
};

// Tracing related datatypes
export type APIUpdateActionBatch = {
  version: number;
  value: Array<ServerUpdateAction>;
};
export type ServerNode = {
  id: number;
  position: Point3;
  additionalCoordinates: AdditionalCoordinate[];
  rotation: Point3;
  bitDepth: number;
  viewport: number;
  mag: number;
  radius: number;
  createdTimestamp: number;
  interpolation: boolean;
};
export type ServerBranchPoint = {
  createdTimestamp: number;
  nodeId: number;
};
export type ServerBoundingBox = {
  topLeft: Point3;
  width: number;
  height: number;
  depth: number;
};
export type UserBoundingBoxFromServer = {
  boundingBox: ServerBoundingBox;
  id: number;
  name?: string;
  color?: ColorObject;
  isVisible?: boolean;
};
export type ServerBoundingBoxTypeTuple = {
  topLeft: Vector3;
  width: number;
  height: number;
  depth: number;
};
export type ServerSkeletonTracingTree = {
  branchPoints: Array<ServerBranchPoint>;
  color: ColorObject | null | undefined;
  comments: Array<CommentType>;
  edges: Array<Edge>;
  name: string;
  nodes: Array<ServerNode>;
  treeId: number;
  createdTimestamp: number;
  groupId?: number | null | undefined;
  isVisible?: boolean;
  type?: TreeType;
  edgesAreVisible?: boolean;
  metadata: MetadataEntryProto[];
};

// Note that this differs from APIMetadataEntry, because
// it's internally stored as protobuf and not in sql.
// The type is used for in-annotation entities (segments, trees etc.)
export type MetadataEntryProto = {
  key: string;
  stringValue?: string;
  boolValue?: boolean;
  numberValue?: number;
  // Note that the server always sends an empty array currently,
  // because of the protobuf format. However, for consistency within
  // JS land, we mark it as nullable here.
  stringListValue?: string[];
};
type ServerSegment = {
  segmentId: number;
  name: string | null | undefined;
  anchorPosition: Point3 | null | undefined;
  additionalCoordinates: AdditionalCoordinate[] | null;
  creationTime: number | null | undefined;
  color: ColorObject | null;
  groupId: number | null | undefined;
  metadata: MetadataEntryProto[];
};
export type ServerTracingBase = {
  id: string;
  userBoundingBoxes: Array<UserBoundingBoxFromServer>;
  userBoundingBox?: ServerBoundingBox;
  createdTimestamp: number;
  editPosition: Point3;
  editPositionAdditionalCoordinates: AdditionalCoordinate[] | null;
  editRotation: Point3;
  error?: string;
  version: number;
  zoomLevel: number;
  additionalAxes: ServerAdditionalAxis[];
};
export type ServerSkeletonTracing = ServerTracingBase & {
  // The following property is added when fetching the
  // tracing from the back-end (by `getTracingForAnnotationType`)
  // This is done to simplify the selection for the type.
  typ: "Skeleton";
  activeNodeId?: number;
  boundingBox?: ServerBoundingBox;
  trees: Array<ServerSkeletonTracingTree>;
  treeGroups: Array<TreeGroup> | null | undefined;
};
export type ServerVolumeTracing = ServerTracingBase & {
  // The following property is added when fetching the
  // tracing from the back-end (by `getTracingForAnnotationType`)
  // This is done to simplify the selection for the type.
  typ: "Volume";
  activeSegmentId?: number;
  boundingBox: ServerBoundingBox;
  elementClass: ElementClass;
  fallbackLayer?: string;
  segments: Array<ServerSegment>;
  segmentGroups: Array<SegmentGroup> | null | undefined;
  largestSegmentId: number;
  // `mags` will be undefined for legacy annotations
  // which were created before the multi-magnification capabilities
  // were added to volume tracings. Also see:
  // https://github.com/scalableminds/webknossos/pull/4755
  mags?: Array<Point3>;
  mappingName?: string | null | undefined;
  hasEditableMapping?: boolean;
  mappingIsLocked?: boolean;
  hasSegmentIndex?: boolean;
  // volumeBucketDataHasChanged is automatically set to true by the back-end
  // once a bucket was mutated. There is no need to send an explicit UpdateAction
  // for that.
  volumeBucketDataHasChanged?: boolean;
};
export type ServerTracing = ServerSkeletonTracing | ServerVolumeTracing;
export type ServerEditableMapping = {
  createdTimestamp: number;
  version: number;
  mappingName: string;
  baseMappingName: string;
  // The id of the volume tracing the editable mapping belongs to
  tracingId: string;
};
export type APIMeshFile = {
  meshFileName: string;
  mappingName?: string | null | undefined;
  // 0   - is the first mesh file version
  // 1-2 - the format should behave as v0 (refer to voxelytics for actual differences)
  // 3   - is the newer version with draco encoding.
  formatVersion: number;
};
export type APIConnectomeFile = {
  connectomeFileName: string;
  mappingName: string;
};

export type ZarrPrivateLink = {
  id: string;
  annotation: string;
  accessToken: string;
  expirationDateTime: number | null;
};

export type ShortLink = {
  longLink: string;
  key: string;
  _id: string;
};

export enum VoxelyticsRunState {
  SKIPPED = "SKIPPED",
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  COMPLETE = "COMPLETE",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  STALE = "STALE",
}

type DistributionConfig = {
  strategy: string;
  resources?: Record<string, string>;
  processes?: number;
};
export type VoxelyticsTaskConfig = {
  isMetaTask: undefined;
  config: { name: string };
  inputs: Record<string, string | Record<string, string>>;
  description: string | null;
  distribution: DistributionConfig | null;
  output_paths: Record<string, string> | null;
  task: string;
};
export type VoxelyticsTaskConfigWithName = VoxelyticsTaskConfig & { taskName: string };
export type VoxelyticsTaskConfigWithHierarchy =
  | VoxelyticsTaskConfigWithName
  | {
      isMetaTask: true;
      key: string;
      subtasks: Array<VoxelyticsTaskConfigWithHierarchy>;
    };
export type VoxelyticsArtifactConfig = {
  fileSize: number;
  inodeCount: number;
  createdAt: number;
  path: string;
  version: string;
  metadata: {
    attributes: any;
    iframes: Record<string, string>;
    links: Record<string, string>;
  };
  foreignWorkflow: [string, string] | null;
};

export type VoxelyticsRunInfo = {
  id: string;
  name: string;
  userName: string;
  hostName: string;
  voxelyticsVersion: string;
  state: VoxelyticsRunState;
  beginTime: Date | null;
  endTime: Date | null;
};

export type VoxelyticsWorkflowDagEdge = { source: string; target: string; label: string };
export type VoxelyticsWorkflowDagNode = {
  id: string;
  label: string;
  state: VoxelyticsRunState;
  isMetaTask?: boolean;
};
export type VoxelyticsWorkflowDag = {
  edges: Array<VoxelyticsWorkflowDagEdge>;
  nodes: Array<VoxelyticsWorkflowDagNode>;
};

type StatePartial =
  | {
      state: VoxelyticsRunState.PENDING | VoxelyticsRunState.SKIPPED;
      beginTime: null;
      endTime: null;
    }
  | {
      state: VoxelyticsRunState.RUNNING;
      beginTime: Date;
      endTime: null;
    }
  | {
      state:
        | VoxelyticsRunState.COMPLETE
        | VoxelyticsRunState.FAILED
        | VoxelyticsRunState.CANCELLED
        | VoxelyticsRunState.STALE;
      beginTime: Date;
      endTime: Date;
    };
export type VoxelyticsTaskInfo = {
  taskName: string;
  currentExecutionId: string | null;
  chunkCounts: ChunkCounts;
  runs: Array<
    {
      runId: string;
      currentExecutionId: string | null;
      chunkCounts: ChunkCounts;
    } & StatePartial
  >;
} & StatePartial;

export type VoxelyticsWorkflowReport = {
  config: {
    config: EmptyObject | null;
    git_hash: string | null;
    global_parameters:
      | {
          env_vars: Record<string, string>;
          distribution: DistributionConfig | null;
          artifacts_path: string | null;
          skip_checksums: boolean;
        }
      | EmptyObject;
    paths: Array<string>;
    schema_version: number;
    tasks: Record<string, VoxelyticsTaskConfig>;
  };
  dag: VoxelyticsWorkflowDag;
  artifacts: Record<string, Record<string, VoxelyticsArtifactConfig>>;
  runs: Array<VoxelyticsRunInfo>;
  tasks: Array<VoxelyticsTaskInfo>;
  workflow: {
    name: string;
    hash: string;
    yamlContent: string;
  };
};

export type VoxelyticsWorkflowListingRun = {
  id: string;
  name: string;
  hostUserName: string;
  hostName: string;
  voxelyticsVersion: string;
  taskCounts: TaskCounts;
  userFirstName: string;
  userLastName: string;
  state: VoxelyticsRunState;
  beginTime: Date | null;
  endTime: Date | null;
};

export type VoxelyticsWorkflowListing = {
  name: string;
  hash: string;
  beginTime: number;
  endTime: number | null;
  state: VoxelyticsRunState;
  taskCounts: TaskCounts;
  runs: Array<VoxelyticsWorkflowListingRun>;
};

type Statistics = {
  max: number | null;
  median: number | null;
  stddev: number | null;
  sum?: number;
};

type ChunkCounts = {
  total: number;
  failed: number;
  skipped: number;
  complete: number;
  cancelled: number;
};
type TaskCounts = ChunkCounts & {
  fileSize: number;
  inodeCount: number;
};

export type VoxelyticsChunkStatistics = {
  executionId: string;
  chunkCounts: ChunkCounts;
  beginTime: number | null;
  endTime: number | null;
  wallTime: number | null;
  memory: Statistics | null;
  cpuUser: Statistics | null;
  cpuSystem: Statistics | null;
  duration: Statistics | null;
};

export type VoxelyticsLogLine = {
  func_name: string;
  host: string;
  level: LOG_LEVELS;
  line: number;
  logger_name: string;
  message: string;
  path: string;
  pgid: number;
  pid: number;
  process_name: string;
  program: string;
  thread_name: string;
  timestamp: number;
  user: string;
  vx_run_name: string;
  vx_task_name: string;
  vx_version: string;
  vx_workflow_hash: string;
  wk_org: string;
  wk_url: string;
};

// Backend type returned by the getFolderTree api method.
export type FlatFolderTreeItem = {
  name: string;
  id: string;
  parent: string | null;
  metadata: APIMetadataEntry[];
  isEditable: boolean;
};

// Frontend type of FlatFolderTreeItem with inferred nested structure.
export type FolderItem = {
  title: string;
  key: string; // folder id
  parent: string | null | undefined;
  children: FolderItem[];
  isEditable: boolean;
  metadata: APIMetadataEntry[];
  // Can be set so that the antd tree component can disable
  // individual folder items.
  disabled?: boolean;
};

export type Folder = {
  name: string;
  id: string;
  allowedTeams: APITeam[];
  allowedTeamsCumulative: APITeam[];
  metadata: APIMetadataEntry[];
  isEditable: boolean;
};

export type FolderUpdater = {
  id: string;
  name: string;
  allowedTeams: string[];
  metadata: APIMetadataEntry[];
};

export enum CAMERA_POSITIONS {
  MOVING = "MOVING",
  STATIC_XZ = "STATIC_XZ",
  STATIC_YZ = "STATIC_YZ",
}

export enum MOVIE_RESOLUTIONS {
  SD = "SD",
  HD = "HD",
}

export type RenderAnimationOptions = {
  layerName: string;
  meshes: ({
    layerName: string;
    tracingId: string | null;
    adhocMag: Vector3;
  } & MeshInformation)[];
  boundingBox: BoundingBoxObject;
  includeWatermark: boolean;
  intensityMin: number;
  intensityMax: number;
  magForTextures: Vector3;
  movieResolution: MOVIE_RESOLUTIONS;
  cameraPosition: CAMERA_POSITIONS;
};

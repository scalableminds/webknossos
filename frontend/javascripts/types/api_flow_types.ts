import type {
  BoundingBoxObject,
  Edge,
  CommentType,
  TreeGroup,
  RecommendedConfiguration,
} from "oxalis/store";
import type { ServerUpdateAction } from "oxalis/model/sagas/update_actions";
import type { SkeletonTracingStats } from "oxalis/model/accessors/skeletontracing_accessor";
import type { Vector3, Vector6, Point3, ColorObject } from "oxalis/constants";
import { PricingPlan } from "admin/organization/organization_edit_view";

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
type APIDataLayerBase = {
  readonly name: string;
  readonly boundingBox: BoundingBoxObject;
  readonly resolutions: Array<Vector3>;
  readonly elementClass: ElementClass;
};
type APIColorLayer = APIDataLayerBase & {
  readonly category: "color";
};
export type APISegmentationLayer = APIDataLayerBase & {
  readonly category: "segmentation";
  readonly largestSegmentId: number;
  readonly mappings?: Array<string>;
  readonly agglomerates?: Array<string>;
  readonly fallbackLayer?: string | null | undefined;
  readonly fallbackLayerInfo?: APIDataLayer | null;
  readonly tracingId?: string;
};
export type APIDataLayer = APIColorLayer | APISegmentationLayer;
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
type APIUnimportedDatasource = APIDataSourceBase;
export type MutableAPIDataSource = MutableAPIDataSourceBase & {
  dataLayers: Array<APIDataLayer>;
  scale: Vector3;
};
export type APIDataSource = Readonly<MutableAPIDataSource>;
export type APIDataStore = {
  readonly name: string;
  readonly url: string;
  readonly isScratch: boolean;
  readonly isConnector: boolean;
  readonly allowsUpload: boolean;
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
  readonly dataSet: APIDataset;
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
export type MutableAPIDatasetId = {
  owningOrganization: string;
  name: string;
};
export type APIDatasetId = Readonly<MutableAPIDatasetId>;
export type APIDatasetDetails = {
  readonly species?: string;
  readonly brainRegion?: string;
  readonly acquisition?: string;
};
type MutableAPIDatasetBase = MutableAPIDatasetId & {
  isUnreported: boolean;
  allowedTeams: Array<APITeam>;
  created: number;
  dataStore: APIDataStore;
  description: string | null | undefined;
  details: APIDatasetDetails | null | undefined;
  isEditable: boolean;
  isPublic: boolean;
  displayName: string | null | undefined;
  logoUrl: string | null | undefined;
  lastUsedByUser: number;
  jobsEnabled: boolean;
  sortingKey: number;
  owningOrganization: string;
  publication: null | undefined;
  tags: Array<string>;
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
type APIUnimportedDataset = APIDatasetBase & {
  readonly dataSource: APIUnimportedDatasource;
  readonly isActive: false;
};
export type APIMaybeUnimportedDataset = APIUnimportedDataset | APIDataset;
export type APIDataSourceWithMessages = {
  readonly dataSource?: APIDataSource;
  readonly previousDataSource?: APIDataSource;
  readonly messages: Array<APIMessage>;
};
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
  shouldSeeModernControlsModal?: boolean;
  lastViewedWhatsNewTimestamp?: number;
};
export type APIUserTheme = "auto" | "light" | "dark";
export type APIUser = APIUserBase & {
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
export type APIAllowedMode = "orthogonal" | "oblique" | "flight" | "volume";
export type APIResolutionRestrictions = {
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
  readonly resolutionRestrictions: APIResolutionRestrictions;
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
  readonly open: number;
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
};
export type APIProjectUpdater = APIProjectTypeBase & {
  readonly id: string;
  readonly owner: string;
};
export type APIProjectCreator = APIProjectTypeBase & {
  readonly owner: string;
};
export type APIProjectWithAssignments = APIProject & {
  readonly numberOfOpenAssignments: number;
  readonly tracingTime: number;
};
export type APITask = {
  readonly boundingBox: BoundingBoxObject | null | undefined;
  readonly boundingBoxVec6?: Vector6;
  readonly created: number;
  readonly creationInfo: string | null | undefined;
  readonly dataSet: string;
  readonly editPosition: Vector3;
  readonly editRotation: Vector3;
  readonly formattedHash: string;
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
  name?: string | null | undefined;
  tracingId: string;
  typ: "Skeleton" | "Volume";
};
export type EditableLayerProperties = Partial<{
  name: string | null | undefined;
}>;
export type APIAnnotationCompact = {
  readonly annotationLayers: Array<AnnotationLayerDescriptor>;
  readonly dataSetName: string;
  readonly organization: string;
  readonly description: string;
  readonly formattedHash: string;
  readonly modified: number;
  readonly id: string;
  readonly visibility: APIAnnotationVisibility;
  readonly name: string;
  readonly state: string;
  readonly stats: SkeletonTracingStats | {};
  readonly tags: Array<string>;
  readonly tracingTime: number | null | undefined;
  readonly typ: APIAnnotationType;
  // The owner can be null (e.g., for a sandbox annotation
  // or due to missing permissions).
  readonly owner?: APIUserCompact;
  readonly teams: APITeam[];
  readonly othersMayEdit: boolean;
};

export function annotationToCompact(annotation: APIAnnotation): APIAnnotationCompact {
  const {
    annotationLayers,
    dataSetName,
    organization,
    description,
    formattedHash,
    modified,
    id,
    visibility,
    name,
    state,
    stats,
    tags,
    tracingTime,
    typ,
    owner,
    teams,
    othersMayEdit,
  } = annotation;

  return {
    annotationLayers,
    dataSetName,
    organization,
    description,
    formattedHash,
    modified,
    id,
    visibility,
    name,
    state,
    stats,
    tags,
    tracingTime,
    typ,
    owner,
    teams,
    othersMayEdit,
  };
}

export type LocalMeshMetaData = {
  isVisible?: boolean;
  isLoaded?: boolean;
  isLoading?: boolean;
};
export type RemoteMeshMetaData = {
  annotationId: string;
  position: Vector3;
  description: string;
  id: string;
};
export type MeshMetaData = LocalMeshMetaData & RemoteMeshMetaData;
export type AnnotationViewConfiguration = {
  layers: Record<
    string,
    {
      isDisabled: boolean;
    }
  >;
};
type APIAnnotationBase = APIAnnotationCompact & {
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
  readonly meshes: Array<MeshMetaData>;
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
type NeuroglancerLayer = {
  // This is the source URL of the layer, should start with gs://, http:// or https://
  source: string;
  type: "image" | "segmentation";
};
type NeuroglancerDatasetConfig = Record<
  string,
  Record<
    string,
    {
      layers: Record<string, NeuroglancerLayer>;
      credentials?: Record<string, any>;
    }
  >
>;
type BossDatasetConfig = Record<
  string,
  Record<
    string,
    {
      domain: string;
      collection: string;
      experiment: string;
      username: string;
      password: string;
    }
  >
>;
export type WkConnectDatasetConfig = {
  neuroglancer?: NeuroglancerDatasetConfig;
  boss?: BossDatasetConfig;
};
export type APITimeTracking = {
  time: string;
  timestamp: number;
  annotation: string;
  _id: string;
  task_id: string;
  project_name: string;
  tasktype_id: string;
  tasktype_summary: string;
};
export type APIProjectProgressReport = {
  readonly projectName: string;
  readonly paused: boolean;
  readonly totalTasks: number;
  readonly totalInstances: number;
  readonly openInstances: number;
  readonly activeInstances: number;
  readonly finishedInstances: number;
  readonly priority: number;
  readonly billedMilliseconds: number;
};
export type APIOpenTasksReport = {
  readonly id: string;
  readonly user: string;
  readonly totalAssignments: number;
  readonly assignmentsByProjects: Record<string, number>;
};
export type APIOrganization = {
  readonly id: string;
  readonly name: string;
  readonly additionalInformation: string;
  readonly displayName: string;
  readonly pricingPlan: PricingPlan;
  readonly enableAutoVerify: boolean;
  readonly newUserMailingList: string;
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
    gitTag: string;
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
};
export type APIFeatureToggles = {
  readonly discussionBoard: string | false;
  readonly discussionBoardRequiresAdmin: boolean;
  readonly hideNavbarLogin: boolean;
  readonly isDemoInstance: boolean;
  readonly taskReopenAllowedInSeconds: number;
  readonly allowDeleteDatasets: boolean;
  readonly jobsEnabled: boolean;
  readonly publicDemoDatasetUrl: string;
  readonly exportTiffMaxVolumeMVx: number;
  readonly exportTiffMaxEdgeLengthVx: number;
  readonly defaultToLegacyBindings: boolean;
  readonly optInTabs?: Array<string>;
};
export type APIJobCeleryState = "SUCCESS" | "PENDING" | "STARTED" | "FAILURE" | null;
export type APIJobManualState = "SUCCESS" | "FAILURE" | null;
export type APIJobState = "UNKNOWN" | "SUCCESS" | "PENDING" | "STARTED" | "FAILURE" | "MANUAL";
export type APIJob = {
  readonly id: string;
  readonly datasetName: string | null | undefined;
  readonly exportFileName: string | null | undefined;
  readonly layerName: string | null | undefined;
  readonly annotationLayerName: string | null | undefined;
  readonly tracingId: string | null | undefined;
  readonly annotationId: string | null | undefined;
  readonly annotationType: string | null | undefined;
  readonly organizationName: string | null | undefined;
  readonly boundingBox: string | null | undefined;
  readonly mergeSegments: boolean | null | undefined;
  readonly type: string;
  readonly state: string;
  readonly manualState: string;
  readonly result: string | null | undefined;
  readonly resultLink: string | null | undefined;
  readonly createdAt: number;
};
// Tracing related datatypes
export type APIUpdateActionBatch = {
  version: number;
  value: Array<ServerUpdateAction>;
};
export type ServerNode = {
  id: number;
  position: Point3;
  rotation: Point3;
  bitDepth: number;
  viewport: number;
  resolution: number;
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
};
type ServerSegment = {
  segmentId: number;
  name: string | null | undefined;
  anchorPosition: Point3;
  creationTime: number | null | undefined;
};
export type ServerTracingBase = {
  id: string;
  userBoundingBoxes: Array<UserBoundingBoxFromServer>;
  userBoundingBox?: ServerBoundingBox;
  createdTimestamp: number;
  dataSetName: string;
  editPosition: Point3;
  editRotation: Point3;
  error?: string;
  version: number;
  zoomLevel: number;
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
  organizationName?: string;
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
  largestSegmentId: number;
  // `resolutions` will be undefined for legacy annotations
  // which were created before the multi-resolution capabilities
  // were added to volume tracings. Also see:
  // https://github.com/scalableminds/webknossos/pull/4755
  resolutions?: Array<Point3>;
  organizationName?: string;
  mappingName?: string | null | undefined;
  mappingIsEditable?: boolean;
};
export type ServerTracing = ServerSkeletonTracing | ServerVolumeTracing;
export type ServerEditableMapping = {
  createdTimestamp: number;
  version: number;
  mappingName: string;
  // The id of the volume tracing the editable mapping belongs to
  tracingId: string;
};
export type APIMeshFile = {
  meshFileName: string;
  mappingName?: string | null | undefined;
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

/**
 * api_flow_types.js
 * @flow
 */
import Enum from "Enumjs";

import type { BoundingBoxObject, Edge, CommentType, TreeGroup } from "oxalis/store";
import type { ServerUpdateAction } from "oxalis/model/sagas/update_actions";
import type { SkeletonTracingStats } from "oxalis/model/accessors/skeletontracing_accessor";
import type { Vector3, Vector6, Point3 } from "oxalis/constants";

export type APIMessage = { ["info" | "warning" | "error"]: string };

type ElementClass = "uint8" | "uint16" | "uint32";

export type APIMapping = {
  +parent?: string,
  +name: string,
  +classes?: Array<Array<number>>,
  +colors?: Array<number>,
  +hideUnmappedIds?: boolean,
};

type APIDataLayerBase = {|
  +name: string,
  +boundingBox: BoundingBoxObject,
  +resolutions: Array<Vector3>,
  +elementClass: ElementClass,
  +mappings?: Array<string>,
|};

type APIColorLayer = {|
  ...APIDataLayerBase,
  category: "color",
|};

type APISegmentationLayer = {|
  ...APIDataLayerBase,
  category: "segmentation",
  largestSegmentId: number,
|};

export type APIDataLayer = APIColorLayer | APISegmentationLayer;

type APIDataSourceBase = {
  +id: {
    +name: string,
    +team: string,
  },
  +status?: string,
};

export type APIMaybeUnimportedDataSource = APIDataSourceBase & {
  +dataLayers?: Array<APIDataLayer>,
  +scale: ?Vector3,
};

export type APIDataSource = APIDataSourceBase & {
  +dataLayers: Array<APIDataLayer>,
  +scale: Vector3,
};

export type APIDataStore = {
  +name: string,
  +url: string,
  +isForeign?: boolean,
  +isScratch: boolean,
};

export type APITracingStore = {
  +name: string,
  +url: string,
};

export type APITeam = {
  +id: string,
  +name: string,
  +organization: string,
};

type APIPublication = {
  +created: number,
  +description: string,
  +id: string,
  +imageUrl: string,
  +publicationDate: number,
  +title: string,
};

export type APIDatasetId = {
  +owningOrganization: string,
  +name: string,
};

export type APIDatasetDetails = {
  +species?: string,
  +brainRegion?: string,
  +acquisition?: string,
};

type APIDatasetBase = APIDatasetId & {
  +allowedTeams: Array<APITeam>,
  +created: number,
  +dataStore: APIDataStore,
  +description: ?string,
  +details: ?APIDatasetDetails,
  +isEditable: boolean,
  +isPublic: boolean,
  +displayName: ?string,
  +logoUrl: ?string,
  +lastUsedByUser: number,
  +isForeign: boolean,
  +sortingKey: number,
  +publication: ?APIPublication,
};

export type APIMaybeUnimportedDataset = APIDatasetBase & {
  +dataSource: APIMaybeUnimportedDataSource,
  +isActive: boolean,
};

export type APIDataset = APIDatasetBase & {
  +dataSource: APIDataSource,
  +isActive: true,
};

export type APIDataSourceWithMessages = {
  +dataSource?: APIDataSource,
  +messages: Array<APIMessage>,
};

export type APITeamMembership = {
  +id: string,
  +name: string,
  +isTeamManager: boolean,
};

export type ExperienceMap = { +[string]: number };

export type ExperienceDomainList = Array<string>;

export type APIUserBase = {
  +email: string,
  +firstName: string,
  +lastName: string,
  +id: string,
  +isAnonymous: boolean,
  +teams: Array<APITeamMembership>,
};

export type APIUser = APIUserBase & {
  +created: number,
  +experiences: ExperienceMap,
  +isAdmin: boolean,
  +isActive: boolean,
  +isEditable: boolean,
  +lastActivity: number,
  +lastTaskTypeId: ?string,
  +organization: string,
};

export type APITimeInterval = {
  paymentInterval: {
    month: number,
    year: number,
  },
  durationInSeconds: number,
};
export type APIUserLoggedTime = {
  loggedTime: Array<APITimeInterval>,
};

export type APIActiveUser = {
  email: string,
  activeTasks: number,
};

export type APIRestrictions = {|
  +allowAccess: boolean,
  +allowUpdate: boolean,
  +allowFinish: boolean,
  +allowDownload: boolean,
|};

export type APIAllowedMode = "orthogonal" | "oblique" | "flight" | "volume";

export type APISettings = {|
  +allowedModes: Array<APIAllowedMode>,
  +preferredMode?: APIAllowedMode,
  +branchPointsAllowed: boolean,
  +somaClickingAllowed: boolean,
|};

export const APIAnnotationTypeEnum = Enum.make({
  Explorational: "Explorational",
  Task: "Task",
  View: "View",
  CompoundTask: "CompoundTask",
  CompoundProject: "CompoundProject",
  CompoundTaskType: "CompoundTaskType",
});

export type APIAnnotationType = $Keys<typeof APIAnnotationTypeEnum>;

export type APITaskType = {
  +id: string,
  +summary: string,
  +description: string,
  +teamId: string,
  +teamName: string,
  +settings: APISettings,
  +recommendedConfiguration: ?string,
  +tracingType: "skeleton" | "volume",
};

export type TaskStatus = { +open: number, +active: number, +finished: number };

type APIScriptTypeBase = {
  +name: string,
  +gist: string,
};

export type APIScript = APIScriptTypeBase & {
  +id: string,
  +owner: APIUserBase,
};

export type APIScriptUpdater = APIScriptTypeBase & {
  +id: string,
  +owner: string,
};

export type APIScriptCreator = APIScriptTypeBase & {
  +owner: string,
};

type APIProjectTypeBase = {
  +name: string,
  +team: string,
  +priority: number,
  +paused: boolean,
  +expectedTime: number,
  +isBlacklistedFromReport: boolean,
};

export type APIProject = APIProjectTypeBase & {
  +id: string,
  +owner: APIUserBase,
};

export type APIProjectUpdater = APIProjectTypeBase & {
  +id: string,
  +owner: string,
};

export type APIProjectCreator = APIProjectTypeBase & {
  +owner: string,
};

export type APIProjectWithAssignments = APIProject & {
  +numberOfOpenAssignments: number,
};

export type APITask = {
  +boundingBox: ?BoundingBoxObject,
  +boundingBoxVec6?: Vector6,
  +created: number,
  +creationInfo: ?string,
  +dataSet: string,
  +editPosition: Vector3,
  +editRotation: Vector3,
  +formattedHash: string,
  +id: string,
  +neededExperience: {
    +domain: string,
    +value: number,
  },
  +projectName: string,
  +script: ?APIScript,
  +status: TaskStatus,
  +team: string,
  +tracingTime: ?number,
  +type: APITaskType,
  +typ: "skeleton" | "volume",
  +directLinks?: Array<string>,
};

export type APIAnnotationCompact = {
  +tracing: {
    +skeleton: ?string,
    +volume: ?string,
  },
  +dataSetName: string,
  +organization: string,
  +description: string,
  +formattedHash: string,
  +modified: number,
  +id: string,
  +isPublic: boolean,
  +name: string,
  +state: string,
  +stats: SkeletonTracingStats | {||},
  +tags: Array<string>,
  +tracingTime: ?number,
  +typ: APIAnnotationType,
};

export type LocalMeshMetaData = {|
  isVisible?: boolean,
  isLoaded?: boolean,
  isLoading?: boolean,
|};

export type RemoteMeshMetaData = {|
  annotationId: string,
  position: Vector3,
  description: string,
  id: string,
|};

export type MeshMetaData = {|
  ...LocalMeshMetaData,
  ...RemoteMeshMetaData,
|};

type APIAnnotationBase = APIAnnotationCompact & {
  +dataStore: APIDataStore,
  +tracingStore: APITracingStore,
  +restrictions: APIRestrictions,
  +settings: APISettings,
  +user?: APIUserBase,
  +meshes: Array<MeshMetaData>,
};

export type APIAnnotation = APIAnnotationBase & {
  +task: ?APITask,
};

export type APIAnnotationWithTask = APIAnnotationBase & {
  +task: APITask,
};

export type APITaskWithAnnotation = APITask & {
  +annotation: APIAnnotation,
};

export type DatasetConfig = {
  +name: string,
  +organization: string,
  +datastore: string,
  +zipFile: File,
};

export type APITimeTracking = {
  time: string,
  timestamp: number,
  annotation: string,
  _id: string,
  task_id: string,
  project_name: string,
  tasktype_id: string,
  tasktype_summary: string,
};

export type APIProjectProgressReport = {
  +projectName: string,
  +paused: boolean,
  +totalTasks: number,
  +totalInstances: number,
  +openInstances: number,
  +activeInstances: number,
  +finishedInstances: number,
  +priority: number,
};

export type APIOpenTasksReport = {
  +id: string,
  +user: string,
  +totalAssignments: number,
  +assignmentsByProjects: { [projectName: string]: number },
};

export type APIOrganization = {
  +id: string,
  +name: string,
  +additionalInformation: string,
  +displayName: string,
};

export type APIBuildInfo = {
  webknossos: {
    name: string,
    commitHash: string,
    scalaVersion: string,
    version: string,
    sbtVersion: string,
    commitDate: string,
    ciTag: string,
    ciBuild: string,
    gitTag: string,
    version: string,
    datastoreApiVersion: string,
  },
  "webknossos-wrap": {
    builtAtMillis: string,
    name: string,
    commitHash: string,
    scalaVersion: string,
    version: string,
    sbtVersion: string,
    builtAtString: string,
  },
  webknossosDatastore?: {
    name: string,
    commitHash: string,
    scalaVersion: string,
    version: string,
    sbtVersion: string,
    commitDate: string,
    ciTag: string,
    ciBuild: string,
    gitTag: string,
    version: string,
    datastoreApiVersion: string,
  },
};

export type APIFeatureToggles = {
  +discussionBoard: string | false,
  +discussionBoardRequiresAdmin: boolean,
  +allowOrganizationCreation: boolean,
  +addForeignDataset: boolean,
  +hideNavbarLogin: boolean,
  +freezeVolumeVersions: boolean,
};

// Tracing related datatypes
export type APIUpdateActionBatch = {
  version: number,
  value: Array<ServerUpdateAction>,
};

export type ServerNode = {
  id: number,
  position: Point3,
  rotation: Point3,
  bitDepth: number,
  viewport: number,
  resolution: number,
  radius: number,
  createdTimestamp: number,
  interpolation: boolean,
};

export type ServerBranchPoint = {
  createdTimestamp: number,
  nodeId: number,
};

export type ServerBoundingBox = {
  topLeft: Point3,
  width: number,
  height: number,
  depth: number,
};

export type ServerBoundingBoxTypeTuple = {
  topLeft: Vector3,
  width: number,
  height: number,
  depth: number,
};

export type ServerSkeletonTracingTree = {
  branchPoints: Array<ServerBranchPoint>,
  color: ?{ r: number, g: number, b: number },
  comments: Array<CommentType>,
  edges: Array<Edge>,
  name: string,
  nodes: Array<ServerNode>,
  treeId: number,
  createdTimestamp: number,
  groupId?: ?number,
};

export type ServerTracingBase = {|
  id: string,
  userBoundingBox?: ServerBoundingBox,
  createdTimestamp: number,
  dataSetName: string,
  editPosition: Point3,
  editRotation: Point3,
  error?: string,
  version: number,
  zoomLevel: number,
|};

export type ServerSkeletonTracing = {|
  ...ServerTracingBase,
  activeNodeId?: number,
  boundingBox?: ServerBoundingBox,
  trees: Array<ServerSkeletonTracingTree>,
  treeGroups: ?Array<TreeGroup>,
|};

export type ServerVolumeTracing = {|
  ...ServerTracingBase,
  activeSegmentId?: number,
  boundingBox: ServerBoundingBox,
  elementClass: ElementClass,
  fallbackLayer?: string,
  largestSegmentId: number,
|};

export type ServerTracing = ServerSkeletonTracing | ServerVolumeTracing;

export type HybridServerTracing = {
  skeleton: ?ServerSkeletonTracing,
  volume: ?ServerVolumeTracing,
};

export default {};

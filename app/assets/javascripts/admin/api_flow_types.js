/**
 * api_flow_types.js
 * @flow
 */
import type { SkeletonTracingStatsType } from "oxalis/model/accessors/skeletontracing_accessor";
import type { Vector3, Vector6, Point3 } from "oxalis/constants";
import type { BoundingBoxObjectType, EdgeType, CommentType, TreeGroupType } from "oxalis/store";
import type { ServerUpdateAction } from "oxalis/model/sagas/update_actions";
import Enum from "Enumjs";

export type APIMessageType = { ["info" | "warning" | "error"]: string };

type ElementClassType = "uint8" | "uint16" | "uint32";

export type APIMappingType = {
  +parent?: string,
  +name: string,
  +classes?: Array<Array<number>>,
  +colors?: Array<number>,
  +hideUnmappedIds?: boolean,
};

type APIDataLayerBaseType = {|
  +name: string,
  +boundingBox: BoundingBoxObjectType,
  +resolutions: Array<Vector3>,
  +elementClass: ElementClassType,
  +mappings?: Array<string>,
|};

type APIColorLayerType = {|
  ...APIDataLayerBaseType,
  category: "color",
|};

type APISegmentationLayerType = {|
  ...APIDataLayerBaseType,
  category: "segmentation",
  largestSegmentId: number,
|};

export type APIDataLayerType = APIColorLayerType | APISegmentationLayerType;

type APIDataSourceBaseType = {
  +id: {
    +name: string,
    +team: string,
  },
  +status?: string,
};

export type APIMaybeUnimportedDataSourceType = APIDataSourceBaseType & {
  +dataLayers?: Array<APIDataLayerType>,
  +scale: ?Vector3,
};

export type APIDataSourceType = APIDataSourceBaseType & {
  +dataLayers: Array<APIDataLayerType>,
  +scale: Vector3,
};

export type APIDataStoreType = {
  +name: string,
  +url: string,
  +isForeign?: boolean,
};

export type APITeamType = {
  +id: string,
  +name: string,
  +organization: string,
};

type APIDatasetBaseType = {
  +allowedTeams: Array<APITeamType>,
  +created: number,
  +dataStore: APIDataStoreType,
  +description: ?string,
  +isEditable: boolean,
  +isPublic: boolean,
  +name: string,
  +displayName: ?string,
  +owningOrganization: string,
  +logoUrl: ?string,
  +lastUsedByUser: number,
  +isForeign: boolean,
  +sortingKey: number,
};

export type APIMaybeUnimportedDatasetType = APIDatasetBaseType & {
  +dataSource: APIMaybeUnimportedDataSourceType,
  +isActive: boolean,
};

export type APIDatasetType = APIDatasetBaseType & {
  +dataSource: APIDataSourceType,
  +isActive: true,
};

export type APIDataSourceWithMessagesType = {
  +dataSource?: APIDataSourceType,
  +messages: Array<APIMessageType>,
};

export type APITeamMembershipType = {
  +id: string,
  +name: string,
  +isTeamManager: boolean,
};

export type ExperienceMapType = { +[string]: number };

export type ExperienceDomainListType = Array<string>;

export type APIUserBaseType = {
  +email: string,
  +firstName: string,
  +lastName: string,
  +id: string,
  +isAnonymous: boolean,
  +teams: Array<APITeamMembershipType>,
};

export type APIUserType = APIUserBaseType & {
  +created: number,
  +experiences: ExperienceMapType,
  +isAdmin: boolean,
  +isActive: boolean,
  +isEditable: boolean,
  +lastActivity: number,
  +organization: string,
};

export type APITimeIntervalType = {
  paymentInterval: {
    month: number,
    year: number,
  },
  durationInSeconds: number,
};
export type APIUserLoggedTimeType = {
  loggedTime: Array<APITimeIntervalType>,
};

export type APIActiveUserType = {
  email: string,
  activeTasks: number,
};

export type APIRestrictionsType = {|
  +allowAccess: boolean,
  +allowUpdate: boolean,
  +allowFinish: boolean,
  +allowDownload: boolean,
|};

export type APIAllowedModeType = "orthogonal" | "oblique" | "flight" | "volume";

export type APISettingsType = {|
  +allowedModes: Array<APIAllowedModeType>,
  +preferredMode?: APIAllowedModeType,
  +branchPointsAllowed: boolean,
  +somaClickingAllowed: boolean,
|};

export const APITracingTypeEnum = Enum.make({
  Explorational: "Explorational",
  Task: "Task",
  View: "View",
  CompoundTask: "CompoundTask",
  CompoundProject: "CompoundProject",
  CompoundTaskType: "CompoundTaskType",
});

export type APITracingType = $Keys<typeof APITracingTypeEnum>;

export type APITaskTypeType = {
  +id: string,
  +summary: string,
  +description: string,
  +teamId: string,
  +teamName: string,
  +settings: APISettingsType,
};

export type TaskStatusType = { +open: number, +active: number, +finished: number };

type APIScriptTypeBase = {
  +name: string,
  +gist: string,
};

export type APIScriptType = APIScriptTypeBase & {
  +id: string,
  +owner: APIUserBaseType,
};

export type APIScriptUpdaterType = APIScriptTypeBase & {
  +id: string,
  +owner: string,
};

export type APIScriptCreatorType = APIScriptTypeBase & {
  +owner: string,
};

type APIProjectTypeBase = {
  +name: string,
  +team: string,
  +priority: number,
  +paused: boolean,
  +expectedTime: number,
};

export type APIProjectType = APIProjectTypeBase & {
  +id: string,
  +owner: APIUserBaseType,
};

export type APIProjectUpdaterType = APIProjectTypeBase & {
  +id: string,
  +owner: string,
};

export type APIProjectCreatorType = APIProjectTypeBase & {
  +owner: string,
};

export type APIProjectWithAssignmentsType = APIProjectType & {
  +numberOfOpenAssignments: number,
};

export type APITaskType = {
  +boundingBox: ?BoundingBoxObjectType,
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
  +script: ?APIScriptType,
  +status: TaskStatusType,
  +team: string,
  +tracingTime: ?number,
  +type: APITaskTypeType,
  +directLinks?: Array<string>,
};

export type APIAnnotationTypeCompact = {
  +tracing: {
    +skeleton: ?string,
    +volume: ?string,
  },
  +dataSetName: string,
  +description: string,
  +formattedHash: string,
  +modified: number,
  +id: string,
  +isPublic: boolean,
  +name: string,
  +state: string,
  +stats: SkeletonTracingStatsType | {||},
  +tags: Array<string>,
  +tracingTime: ?number,
  +typ: APITracingType,
};

type APIAnnotationTypeBase = APIAnnotationTypeCompact & {
  +dataStore: APIDataStoreType,
  +restrictions: APIRestrictionsType,
  +settings: APISettingsType,
  +user?: APIUserBaseType,
};

export type APIAnnotationType = APIAnnotationTypeBase & {
  +task: ?APITaskType,
};

export type APIAnnotationWithTaskType = APIAnnotationTypeBase & {
  +task: APITaskType,
};

export type APITaskWithAnnotationType = APITaskType & {
  +annotation: APIAnnotationType,
};

export type DatasetConfigType = {
  +name: string,
  +organization: string,
  +datastore: string,
  +zipFile: File,
};

export type APITimeTrackingType = {
  time: string,
  timestamp: number,
  annotation: string,
  _id: string,
  task_id: string,
  project_name: string,
  tasktype_id: string,
  tasktype_summary: string,
};

export type APIProjectProgressReportType = {
  +projectName: string,
  +paused: boolean,
  +totalTasks: number,
  +totalInstances: number,
  +openInstances: number,
  +activeInstances: number,
  +finishedInstances: number,
};

export type APIOpenTasksReportType = {
  +id: string,
  +user: string,
  +totalAssignments: number,
  +assignmentsByProjects: { [projectName: string]: number },
};

export type APIOrganizationType = {
  +id: string,
  +name: string,
  +additionalInformation: string,
  +displayName: string,
};

export type APIBuildInfoType = {
  webknossos: {
    name: string,
    commitHash: string,
    scalaVersion: string,
    version: string,
    sbtVersion: string,
    commitDate: string,
    ciTag: string,
    ciBuild: string,
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
};

export type APIFeatureToggles = {
  +discussionBoard: string | false,
  +discussionBoardRequiresAdmin: boolean,
  +hybridTracings: boolean,
  +allowOrganizationCreation: boolean,
  +addForeignDataset: boolean,
};

// Tracing related datatypes
export type APIUpdateActionBatch = {
  version: number,
  value: Array<ServerUpdateAction>,
};

export type ServerNodeType = {
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

export type ServerBranchPointType = {
  createdTimestamp: number,
  nodeId: number,
};

export type ServerBoundingBoxType = {
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

export type ServerSkeletonTracingTreeType = {
  branchPoints: Array<ServerBranchPointType>,
  color: ?{ r: number, g: number, b: number },
  comments: Array<CommentType>,
  edges: Array<EdgeType>,
  name: string,
  nodes: Array<ServerNodeType>,
  treeId: number,
  createdTimestamp: number,
  groupId?: ?number,
};

export type ServerTracingBaseType = {|
  id: string,
  userBoundingBox?: ServerBoundingBoxType,
  createdTimestamp: number,
  dataSetName: string,
  editPosition: Point3,
  editRotation: Point3,
  error?: string,
  version: number,
  zoomLevel: number,
|};

export type ServerSkeletonTracingType = {|
  ...ServerTracingBaseType,
  activeNodeId?: number,
  boundingBox?: ServerBoundingBoxType,
  trees: Array<ServerSkeletonTracingTreeType>,
  treeGroups: ?Array<TreeGroupType>,
|};

export type ServerVolumeTracingType = {|
  ...ServerTracingBaseType,
  activeSegmentId?: number,
  boundingBox: ServerBoundingBoxType,
  elementClass: ElementClassType,
  fallbackLayer?: string,
  largestSegmentId: number,
|};

export type ServerTracingType = ServerSkeletonTracingType | ServerVolumeTracingType;

export type HybridServerTracingType = {
  skeleton: ?ServerSkeletonTracingType,
  volume: ?ServerVolumeTracingType,
};

export default {};

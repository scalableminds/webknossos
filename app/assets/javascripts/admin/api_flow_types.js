/**
 * api_flow_types.js
 * @flow
 */
import type { SkeletonTracingStatsType } from "oxalis/model/accessors/skeletontracing_accessor";
import type { Vector3, Vector6 } from "oxalis/constants";
import type { DataLayerType, SettingsType, BoundingBoxObjectType } from "oxalis/store";

type APIDataSourceType = {
  +id: {
    +name: string,
    +team: string,
  },
  +status?: string,
  +dataLayers: Array<DataLayerType>,
  +scale: Vector3,
};

export type APIDataStoreType = {
  +name: string,
  +url: string,
  +typ: "webknossos-store" | "nd-store",
  +accessToken?: string,
};

export type APIDatasetType = {
  +allowedTeams: Array<string>,
  +created: number,
  +dataSource: APIDataSourceType,
  +dataStore: APIDataStoreType,
  +description: ?string,
  +isActive: boolean,
  +isEditable: boolean,
  +isPublic: boolean,
  +name: string,
  +owningTeam: "Connectomics department",
  +sourceType: "wkw" | "knossos",
};

export type APIRoleType = { +name: string };

export type APITeamRoleType = {
  +team: string,
  +role: APIRoleType,
};

export type ExperienceMapType = { +[string]: number };

export type APIUserType = {
  +email: string,
  +experiences: ExperienceMapType,
  +firstName: string,
  +lastName: string,
  +id: string,
  +isActive: boolean,
  +isAnonymous: boolean,
  +isEditable: boolean,
  +lastActivity: number,
  +teams: Array<APITeamRoleType>,
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

export type APITeamType = {
  +id: string,
  +name: string,
  +owner: APIUserType,
  +parent: string,
  +roles: Array<APIRoleType>,
};

export type APIRestrictionsType = {
  +allowAccess: boolean,
  +allowUpdate: boolean,
  +allowFinish: boolean,
  +allowDownload: boolean,
};

export type APIAllowedModeType = "orthogonal" | "oblique" | "flight" | "volume";

export type APISettingsType = {
  +advancedOptionsAllowed: boolean,
  +allowedModes: Array<APIAllowedModeType>,
  +preferredMode?: APIAllowedModeType,
  +branchPointsAllowed: boolean,
  +somaClickingAllowed: boolean,
};

export const APITracingTypeEnum = {
  Explorational: "Explorational",
  Task: "Task",
  View: "View",
  CompoundTask: "CompoundTask",
  CompoundProject: "CompoundProject",
  CompoundTaskType: "CompoundTaskType",
};

export type APITracingType = $Keys<typeof APITracingTypeEnum>;

export type APITaskTypeType = {
  +id: string,
  +summary: string,
  +description: string,
  +team: string,
  +settings: SettingsType,
};

export type TaskStatusType = { +open: number, +inProgress: number, +completed: number };

export type APIScriptType = {
  +id: string,
  +name: string,
  +owner: APIUserType,
  +gist: string,
};

export type APIProjectType = {
  +id: string,
  +name: string,
  +team: string,
  +owner: APIUserType,
  +priority: number,
  +paused: boolean,
  +expectedTime: number,
  +numberOfOpenAssignments: number,
};

export type APITaskType = {
  +boundingBox: BoundingBoxObjectType,
  +boundingBoxVec6: Vector6,
  +created: string,
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
  +tracingTime: number,
  +type: APITaskTypeType,
  +directLinks?: Array<string>,
};

export type APIAnnotationType = {
  +content: {
    +id: string,
    +typ: string,
  },
  +dataSetName: string,
  +dataStore: APIDataStoreType,
  +description: string,
  +formattedHash: string,
  +modified: string,
  +id: string,
  +isPublic: boolean,
  +name: string,
  +restrictions: APIRestrictionsType,
  +settings: APISettingsType,
  +state: string,
  +stats: SkeletonTracingStatsType,
  +tags: Array<string>,
  +task: APITaskType,
  +tracingTime: number,
  +typ: APITracingType,
  +user?: APIUserType,
};

export type APITaskWithAnnotationType = {
  +id: string,
  +team: string,
  +formattedHash: string,
  +projectName: string,
  +type: APITaskTypeType,
  +dataSet: string,
  +editPosition: Vector3,
  +editRotation: Vector3,
  +boundingBox: null,
  +neededExperience: ExperienceMapType,
  +created: string,
  +status: TaskStatusType,
  +script: null,
  +tracingTime: null,
  +creationInfo: null,
  +annotation: APIAnnotationType,
};

export type APIDatastoreType = {
  +name: string,
  +url: string,
  +typ: string,
};

export type NDStoreConfigType = {
  +name: string,
  +team: string,
  +server: string,
  +token: string,
};

export type DatasetConfigType = {
  +name: string,
  +team: string,
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
  +totalTasks: number,
  +totalInstances: number,
  +openInstances: number,
  +finishedInstances: number,
  +inProgressInstances: number,
};

export type APIOpenTasksReportType = {
  +user: string,
  +totalAssignments: number,
  +assignmentsByProjects: { [projectName: string]: number },
};

export default {};

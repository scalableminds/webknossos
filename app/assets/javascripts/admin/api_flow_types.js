/**
 * api_flow_types.js
 * @flow
 */
import type { Vector3 } from "oxalis/constants";
import type { DataLayerType, SettingsType } from "oxalis/store";

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

type ExperienceMapType = { +[string]: number };

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

export type APITeamType = {
  +amIAnAdmin: boolean,
  +amIOwner: boolean,
  +id: string,
  +isEditable: boolean,
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
  +preferredMode: APIAllowedModeType,
  +branchPointsAllowed: boolean,
  +somaClickingAllowed: boolean,
};

export type APIScriptType = {
  +gist: string,
  +id: string,
  +name: string,
  +owner: APIUserType,
};

export type APITaskType = {
  +id: number,
  +type: "string",
  +script?: APIScriptType,
  +type: {
    +summary: string,
    +description: string,
    +id: string,
    +team: string,
  },
};

export const APITracingTypeTracingEnum = {
  Explorational: "Explorational",
  Task: "Task",
  View: "View",
  CompoundTask: "CompoundTask",
  CompoundProject: "CompoundProject",
  CompoundTaskType: "CompoundTaskType",
};

export type APITracingTypeTracingType = $Keys<typeof APITracingTypeTracingEnum>;

export type APIAnnotationType = {
  +content: {
    +id: string,
    +typ: string,
  },
  +created: string,
  +dataSetName: string,
  +dataStore: APIDataStoreType,
  +formattedHash: string,
  +id: string,
  +isPublic: boolean,
  +name: string,
  +restrictions: APIRestrictionsType,
  +settings: APISettingsType,
  +state: {
    +isAssigned: boolean,
    +isFinished: boolean,
    +isInProgress: boolean,
  },
  +stats: { +numberOfNodes: number, +numberOfEdges: number, +numberOfTrees: number },
  +tags: Array<string>,
  +task: APITaskType,
  +tracingTime: number,
  +typ: APITracingTypeTracingType,
};

export type APITaskTypeType = {
  +id: string,
  +summary: string,
  +description: string,
  +team: string,
  +settings: SettingsType,
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
  +status: { +open: number, +inProgress: number, +completed: number },
  +script: null,
  +tracingTime: null,
  +creationInfo: null,
  +annotation: APIAnnotationType,
};

export type APIProjectType = {
  +id: string,
  +name: string,
  +team: string,
  +owner: APIUserType,
  +priority: number,
  +paused: boolean,
  +expectedTime: number,
  +assignmentConfiguration: { location: "webknossos" | "mturk" },
  +numberOfOpenAssignments: number,
};

export default {};

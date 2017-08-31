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

export type APIDatasetType = {
  +name: string,
  +dataSource: APIDataSourceType,
  +dataStore: {
    +name: string,
    +url: string,
    +typ: "webknossos-store" | "nd-store",
  },
  +sourceType: "wkw" | "knossos",
  +owningTeam: "Connectomics department",
  +allowedTeams: Array<string>,
  +isActive: boolean,
  +accessToken: null,
  +isPublic: boolean,
  +description: ?string,
  +created: number,
  +isEditable: boolean,
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

export type APIAnnotationType = {
  +version: number,
  +user: {
    +id: string,
    +email: string,
    +firstName: string,
    +lastName: string,
    +isAnonymous: boolean,
    +teams: Array<APITeamRoleType>,
  },
  +created: string,
  +stateLabel: string,
  +state: { +isAssigned: boolean, +isFinished: boolean, +isInProgress: boolean },
  +id: string,
  +name: string,
  +typ: string,
  +stats: { +numberOfNodes: number, +numberOfEdges: number, +numberOfTrees: number },
  +restrictions: {
    +allowAccess: boolean,
    +allowUpdate: boolean,
    +allowFinish: boolean,
    +allowDownload: boolean,
  },
  +formattedHash: string,
  +downloadUrl: string,
  +contentType: string,
  +dataSetName: string,
  +tracingTime: null,
  +tags: Array<string>,
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

export type APIScriptType = {
  +id: string,
  +name: string,
  +owner: APIUserType,
  +gist: string,
};

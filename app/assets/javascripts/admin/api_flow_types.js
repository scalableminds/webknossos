import type { Vector3 } from "oxalis/constants";
import type { DataLayerType } from "oxalis/store";

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

export type APITeamRoleType = {
  +team: string,
  +role: { +name: string },
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
  version: number,
  user: {
    id: string,
    email: string,
    firstName: string,
    lastName: string,
    isAnonymous: boolean,
    teams: Array<APITeamRoleType>,
  },
  created: string,
  stateLabel: string,
  state: { isAssigned: boolean, isFinished: boolean, isInProgress: boolean },
  id: string,
  name: string,
  typ: string,
  stats: { numberOfNodes: number, numberOfEdges: number, numberOfTrees: number },
  restrictions: {
    allowAccess: boolean,
    allowUpdate: boolean,
    allowFinish: boolean,
    allowDownload: boolean,
  },
  formattedHash: string,
  downloadUrl: string,
  contentType: string,
  dataSetName: string,
  tracingTime: null,
};

export type APITaskWithAnnotationType = {
  id: string,
  team: string,
  formattedHash: string,
  projectName: string,
  type: {
    id: string,
    summary: string,
    description: string,
    team: string,
    settings: {
      allowedModes: ["orthogonal", "oblique", "flight"],
      branchPointsAllowed: boolean,
      somaClickingAllowed: boolean,
      advancedOptionsAllowed: boolean,
    },
    fileName: null,
  },
  dataSet: string,
  editPosition: Vector3,
  editRotation: Vector3,
  boundingBox: null,
  neededExperience: ExperienceMapType,
  created: string,
  status: { open: number, inProgress: number, completed: number },
  script: null,
  tracingTime: null,
  creationInfo: null,
  annotation: APIAnnotationType,
};

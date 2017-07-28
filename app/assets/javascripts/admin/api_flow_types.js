import type { Vector3 } from "oxalis/constants";
import type { DataLayerType } from "oxalis/store";

type APIDataSourceType = {
  id: {
    name: string,
    team: string,
  },
  status?: string,
  dataLayers: Array<DataLayerType>,
  scale: Vector3,
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
  isPublic: boolean,
  description: ?string,
  +created: number,
  +isEditable: boolean,
};

export type APITeamRoleType = {
  team: string,
  role: { name: string },
};

export type APIUserType = {
  +email: string,
  +experiences: { [string]: number },
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
  amIAnAdmin: boolean,
  amIOwner: boolean,
  id: string,
  isEditable: boolean,
  name: string,
  owner: APIUserType,
  parent: string,
  roles: Array<APIRoleType>,
};

// @flow
import _ from "lodash";
import Request from "libs/request";
import Toast from "libs/toast";
import type { MessageType } from "libs/toast";
import * as Utils from "libs/utils";
import { location } from "libs/window";
import messages from "messages";
import { parseProtoTracing } from "oxalis/model/helpers/proto_helpers";
import type {
  APIUserType,
  APIScriptType,
  APIScriptCreatorType,
  APIScriptUpdaterType,
  APITaskTypeType,
  APITeamType,
  APIProjectType,
  APIProjectWithAssignmentsType,
  APIProjectCreatorType,
  APIProjectUpdaterType,
  APITaskType,
  APIAnnotationType,
  APIAnnotationWithTaskType,
  APIDataStoreType,
  DatasetConfigType,
  APIDatasetIdType,
  APIDatasetType,
  APIMaybeUnimportedDatasetType,
  APIDataSourceType,
  APIDataSourceWithMessagesType,
  APITimeIntervalType,
  APIUserLoggedTimeType,
  APITimeTrackingType,
  APIProjectProgressReportType,
  APIOpenTasksReportType,
  APIBuildInfoType,
  APITracingType,
  APIFeatureToggles,
  APIOrganizationType,
  ServerTracingType,
  APIActiveUserType,
  HybridServerTracingType,
  ServerSkeletonTracingType,
  ServerVolumeTracingType,
  APIAnnotationTypeCompact,
} from "admin/api_flow_types";
import { APITracingTypeEnum } from "admin/api_flow_types";
import type { QueryObjectType } from "admin/task/task_search_form";
import type { NewTaskType, TaskCreationResponseType } from "admin/task/task_create_bulk_view";
import type { DatasetConfigurationType } from "oxalis/store";

const MAX_SERVER_ITEMS_PER_RESPONSE = 1000;

type NewTeamType = {
  +name: string,
};

function assertResponseLimit(collection) {
  if (collection.length === MAX_SERVER_ITEMS_PER_RESPONSE) {
    Toast.warning(messages["request.max_item_count_alert"], { sticky: true });
  }
}

// ### Do with userToken
let tokenRequestPromise;
function requestUserToken(): Promise<string> {
  if (tokenRequestPromise) {
    return tokenRequestPromise;
  }

  tokenRequestPromise = Request.receiveJSON("/api/userToken/generate").then(tokenObj => {
    tokenRequestPromise = null;
    return tokenObj.token;
  });

  return tokenRequestPromise;
}

export function getSharingToken(): ?string {
  if (location != null) {
    const params = Utils.getUrlParamsObject();
    if (params != null && params.token != null) {
      return params.token;
    }
  }
  return null;
}

let tokenPromise;
export function doWithToken<T>(fn: (token: string) => Promise<T>): Promise<*> {
  const sharingToken = getSharingToken();
  if (sharingToken != null) {
    return fn(sharingToken);
  }
  if (!tokenPromise) tokenPromise = requestUserToken();
  return tokenPromise.then(fn).catch(error => {
    if (error.status === 403) {
      console.warn("Token expired. Requesting new token...");
      tokenPromise = requestUserToken();
      return doWithToken(fn);
    }
    throw error;
  });
}

// ### Users
export async function loginUser(formValues: { email: string, password: string }): Promise<Object> {
  await Request.sendJSONReceiveJSON("/api/auth/login", { data: formValues });
  return getActiveUser();
}

export async function getUsers(): Promise<Array<APIUserType>> {
  const users = await Request.receiveJSON("/api/users");
  assertResponseLimit(users);

  return users;
}

export async function getAdminUsers(): Promise<Array<APIUserType>> {
  const users = await Request.receiveJSON("/api/users?isAdmin=true");
  assertResponseLimit(users);

  return users;
}

export async function getEditableUsers(): Promise<Array<APIUserType>> {
  const users = await Request.receiveJSON("/api/users?isEditable=true");
  assertResponseLimit(users);

  return users;
}

export function getUser(userId: string): Promise<APIUserType> {
  return Request.receiveJSON(`/api/users/${userId}`);
}

export function updateUser(newUser: APIUserType): Promise<APIUserType> {
  return Request.sendJSONReceiveJSON(`/api/users/${newUser.id}`, {
    method: "PUT",
    data: newUser,
  });
}

export async function getAuthToken(): Promise<string> {
  const { token } = await Request.receiveJSON("/api/auth/token");
  return token;
}

export async function revokeAuthToken(): Promise<void> {
  await Request.receiveJSON("/api/auth/token", { method: "DELETE" });
}

export async function getLoggedTimes(userID: ?string): Promise<Array<APITimeIntervalType>> {
  const url = userID != null ? `/api/users/${userID}/loggedTime` : "/api/user/loggedTime";

  const response: APIUserLoggedTimeType = await Request.receiveJSON(url);
  return response.loggedTime;
}

// ### Scripts
export async function getScripts(): Promise<Array<APIScriptType>> {
  const scripts = await Request.receiveJSON("/api/scripts");
  assertResponseLimit(scripts);

  return scripts;
}

export function getScript(scriptId: string): Promise<APIScriptType> {
  return Request.receiveJSON(`/api/scripts/${scriptId}`);
}

export function deleteScript(scriptId: string): Promise<void> {
  return Request.receiveJSON(`/api/scripts/${scriptId}`, {
    method: "DELETE",
  });
}

export function createScript(script: APIScriptCreatorType): Promise<APIScriptType> {
  return Request.sendJSONReceiveJSON("/api/scripts", {
    data: script,
  });
}

export function updateScript(
  scriptId: string,
  script: APIScriptUpdaterType,
): Promise<APIScriptType> {
  return Request.sendJSONReceiveJSON(`/api/scripts/${scriptId}`, {
    method: "PUT",
    data: script,
  });
}

// ### TaskTypes
export async function getTaskTypes(): Promise<Array<APITaskTypeType>> {
  const taskTypes = await Request.receiveJSON("/api/taskTypes");
  assertResponseLimit(taskTypes);

  return taskTypes;
}

export function deleteTaskType(taskTypeId: string): Promise<void> {
  return Request.receiveJSON(`/api/taskTypes/${taskTypeId}`, {
    method: "DELETE",
  });
}

export function getTaskType(taskTypeId: string): Promise<APITaskTypeType> {
  return Request.receiveJSON(`/api/taskTypes/${taskTypeId}`);
}

export function createTaskType(
  taskType: $Diff<APITaskTypeType, { id: string, teamName: string }>,
): Promise<APITaskTypeType> {
  return Request.sendJSONReceiveJSON("/api/taskTypes", {
    data: taskType,
  });
}

export function updateTaskType(taskTypeId: string, taskType: APITaskTypeType): Promise<void> {
  return Request.sendJSONReceiveJSON(`/api/taskTypes/${taskTypeId}`, {
    method: "PUT",
    data: taskType,
  });
}

// ### Teams
export async function getTeams(): Promise<Array<APITeamType>> {
  const teams = await Request.receiveJSON("/api/teams");
  assertResponseLimit(teams);

  return teams;
}

export async function getEditableTeams(): Promise<Array<APITeamType>> {
  const teams = await Request.receiveJSON("/api/teams?isEditable=true");
  assertResponseLimit(teams);

  return teams;
}

export function createTeam(newTeam: NewTeamType): Promise<APITeamType> {
  return Request.sendJSONReceiveJSON("/api/teams", {
    data: newTeam,
  });
}

export function deleteTeam(teamId: string): Promise<void> {
  return Request.receiveJSON(`/api/teams/${teamId}`, {
    method: "DELETE",
  });
}

// ### Projects
function transformProject<T: APIProjectType | APIProjectWithAssignmentsType>(response: T): T {
  return Object.assign({}, response, {
    expectedTime: Utils.millisecondsToMinutes(response.expectedTime),
  });
}

export async function getProjects(): Promise<Array<APIProjectType>> {
  const responses = await Request.receiveJSON("/api/projects");
  assertResponseLimit(responses);

  return responses.map(transformProject);
}

export async function getProjectsWithOpenAssignments(): Promise<
  Array<APIProjectWithAssignmentsType>,
> {
  const responses = await Request.receiveJSON("/api/projects/assignments");
  assertResponseLimit(responses);

  return responses.map(transformProject);
}

export async function getProject(projectName: string): Promise<APIProjectType> {
  const project = await Request.receiveJSON(`/api/projects/${projectName}`);
  return transformProject(project);
}

export async function increaseProjectTaskInstances(
  projectName: string,
  delta?: number = 1,
): Promise<APIProjectWithAssignmentsType> {
  const project = await Request.receiveJSON(
    `/api/projects/${projectName}/incrementEachTasksInstances?delta=${delta}`,
  );
  return transformProject(project);
}

export function deleteProject(projectName: string): Promise<void> {
  return Request.receiveJSON(`/api/projects/${projectName}`, {
    method: "DELETE",
  });
}

export function createProject(project: APIProjectCreatorType): Promise<APIProjectType> {
  const transformedProject = Object.assign({}, project, {
    expectedTime: Utils.minutesToMilliseconds(project.expectedTime),
  });

  return Request.sendJSONReceiveJSON("/api/projects", {
    data: transformedProject,
  });
}

export function updateProject(
  projectName: string,
  project: APIProjectUpdaterType,
): Promise<APIProjectType> {
  const transformedProject = Object.assign({}, project, {
    expectedTime: Utils.minutesToMilliseconds(project.expectedTime),
  });

  return Request.sendJSONReceiveJSON(`/api/projects/${projectName}`, {
    method: "PUT",
    data: transformedProject,
  });
}

export async function pauseProject(projectName: string): Promise<APIProjectType> {
  const project = await Request.receiveJSON(`/api/projects/${projectName}/pause`);
  return transformProject(project);
}

export async function resumeProject(projectName: string): Promise<APIProjectType> {
  const project = await Request.receiveJSON(`/api/projects/${projectName}/resume`);
  return transformProject(project);
}

// ### Tasks
export function peekNextTasks(): Promise<?APITaskType> {
  return Request.receiveJSON("/api/user/tasks/peek");
}

export function requestTask(): Promise<APIAnnotationWithTaskType> {
  return Request.receiveJSON("/api/user/tasks/request");
}

export function getAnnotationsForTask(taskId: string): Promise<Array<APIAnnotationType>> {
  return Request.receiveJSON(`/api/tasks/${taskId}/annotations`);
}

export function deleteTask(taskId: string): Promise<void> {
  return Request.receiveJSON(`/api/tasks/${taskId}`, {
    method: "DELETE",
  });
}
function transformTask(task: APITaskType): APITaskType {
  const tracingTime = task.tracingTime == null ? 0 : task.tracingTime;

  // convert bounding box
  let boundingBoxVec6;
  if (task.boundingBox != null) {
    const { topLeft, width, height, depth } = task.boundingBox;
    boundingBoxVec6 = Utils.numberArrayToVector6(topLeft.concat([width, height, depth]));
  }

  return { ...task, tracingTime, boundingBoxVec6 };
}

export async function getTasks(queryObject: QueryObjectType): Promise<Array<APITaskType>> {
  const responses = await Request.sendJSONReceiveJSON("/api/tasks/list", {
    data: queryObject,
  });

  const tasks = responses.map(response => transformTask(response));
  assertResponseLimit(tasks);
  return tasks;
}

// TODO fix return types
export function createTasks(tasks: Array<NewTaskType>): Promise<Array<TaskCreationResponseType>> {
  return Request.sendJSONReceiveJSON("/api/tasks", {
    data: tasks,
  });
}

// TODO fix return types
export function createTaskFromNML(task: NewTaskType): Promise<Array<TaskCreationResponseType>> {
  return Request.sendMultipartFormReceiveJSON("/api/tasks/createFromFile", {
    data: {
      nmlFile: task.nmlFile,
      formJSON: JSON.stringify(task),
    },
  });
}

export async function getTask(taskId: string): Promise<APITaskType> {
  const task = await Request.receiveJSON(`/api/tasks/${taskId}`);
  return transformTask(task);
}

export async function updateTask(taskId: string, task: NewTaskType): Promise<APITaskType> {
  const updatedTask = await Request.sendJSONReceiveJSON(`/api/tasks/${taskId}`, {
    method: "PUT",
    data: task,
  });
  return transformTask(updatedTask);
}

export function finishTask(annotationId: string): Promise<APIAnnotationType> {
  return finishAnnotation(annotationId, APITracingTypeEnum.Task);
}

export function transferTask(annotationId: string, userId: string): Promise<APIAnnotationType> {
  return Request.sendJSONReceiveJSON(`/api/annotations/Task/${annotationId}/transfer`, {
    data: {
      userId,
    },
  });
}

export async function transferActiveTasksOfProject(
  projectName: string,
  userId: string,
): Promise<APIAnnotationType> {
  return Request.sendJSONReceiveJSON(`/api/projects/${projectName}/transferActiveTasks`, {
    data: {
      userId,
    },
    method: "POST",
  });
}

export async function getUsersWithActiveTasks(
  projectName: string,
): Promise<Array<APIActiveUserType>> {
  return Request.receiveJSON(`/api/projects/${projectName}/usersWithActiveTasks`);
}

// ### Annotations
export function getCompactAnnotations(
  isFinished: boolean,
): Promise<Array<APIAnnotationTypeCompact>> {
  return Request.receiveJSON(`/api/user/annotations?isFinished=${isFinished.toString()}`);
}

export function getCompactAnnotationsForUser(
  userId: string,
  isFinished: boolean,
): Promise<Array<APIAnnotationTypeCompact>> {
  return Request.receiveJSON(
    `/api/users/${userId}/annotations?isFinished=${isFinished.toString()}`,
  );
}

export function reOpenAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/reopen`);
}

export type EditableAnnotationType = {
  name: string,
  description: string,
  isPublic: boolean,
  tags: Array<string>,
};

export function editAnnotation(
  annotationId: string,
  annotationType: APITracingType,
  data: $Shape<EditableAnnotationType>,
): Promise<void> {
  return Request.sendJSONReceiveJSON(`/api/annotations/${annotationType}/${annotationId}/edit`, {
    data,
  });
}

export function finishAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/finish`);
}

export function resetAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/reset`);
}

export function deleteAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<{ messages: Array<MessageType> }> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}`, {
    method: "DELETE",
  });
}

export function finishAllAnnotations(
  selectedAnnotationIds: Array<string>,
): Promise<{ messages: Array<MessageType> }> {
  return Request.sendJSONReceiveJSON("/api/annotations/Explorational/finish", {
    data: {
      annotations: selectedAnnotationIds,
    },
  });
}

export function copyAnnotationToUserAccount(
  annotationId: string,
  tracingType: APITracingType,
): Promise<APIAnnotationType> {
  const url = `/api/annotations/${tracingType}/${annotationId}/duplicate`;
  return Request.receiveJSON(url);
}

export function getAnnotationInformation(
  annotationId: string,
  tracingType: APITracingType,
): Promise<APIAnnotationType> {
  // Include /readOnly part whenever it is in the pathname
  const isReadOnly = location.pathname.endsWith("/readOnly");
  const readOnlyPart = isReadOnly ? "readOnly/" : "";
  const infoUrl = `/api/annotations/${tracingType}/${annotationId}/${readOnlyPart}info`;
  return Request.receiveJSON(infoUrl);
}

export function createExplorational(
  datasetId: APIDatasetIdType,
  typ: "volume" | "skeleton" | "hybrid",
  withFallback: boolean,
): Promise<APIAnnotationType> {
  const url = `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/createExplorational`;
  return Request.sendJSONReceiveJSON(url, { data: { typ, withFallback } });
}

export async function getTracingForAnnotations(
  annotation: APIAnnotationType,
): Promise<HybridServerTracingType> {
  const [_skeleton, _volume] = await Promise.all([
    getTracingForAnnotationType(annotation, "skeleton"),
    getTracingForAnnotationType(annotation, "volume"),
  ]);

  const skeleton = ((_skeleton: any): ?ServerSkeletonTracingType);
  const volume = ((_volume: any): ?ServerVolumeTracingType);

  return {
    skeleton,
    volume,
  };
}

export async function getTracingForAnnotationType(
  annotation: APIAnnotationType,
  tracingType: "skeleton" | "volume",
): Promise<?ServerTracingType> {
  const tracingId = annotation.tracing[tracingType];
  if (!tracingId) {
    return null;
  }
  const tracingArrayBuffer = await doWithToken(token =>
    Request.receiveArraybuffer(
      `${annotation.dataStore.url}/data/tracings/${tracingType}/${tracingId}?token=${token}`,
      { headers: { Accept: "application/x-protobuf" } },
    ),
  );

  const tracing = parseProtoTracing(tracingArrayBuffer, tracingType);
  // The tracing id is not contained in the server tracing, but in the annotation content
  tracing.id = tracingId;
  return tracing;
}

// ### Datasets
export async function getDatasets(): Promise<Array<APIMaybeUnimportedDatasetType>> {
  const datasets = await Request.receiveJSON("/api/datasets");
  assertResponseLimit(datasets);

  return datasets;
}

export function getDatasetDatasource(
  dataset: APIMaybeUnimportedDatasetType,
): Promise<APIDataSourceWithMessagesType> {
  return doWithToken(token =>
    Request.receiveJSON(
      `${dataset.dataStore.url}/data/datasets/${dataset.owningOrganization}/${
        dataset.name
      }?token=${token}`,
    ),
  );
}

export function readDatasetDatasource(dataset: APIDatasetType): Promise<APIDataSourceType> {
  return doWithToken(token =>
    Request.receiveJSON(
      `${dataset.dataStore.url}/data/datasets/${dataset.owningOrganization}/${
        dataset.name
      }/readInboxDataSource?token=${token}`,
    ),
  );
}

export async function updateDatasetDatasource(
  datasetName: string,
  dataStoreUrl: string,
  datasource: APIDataSourceType,
): Promise<void> {
  await doWithToken(token =>
    Request.sendJSONReceiveJSON(
      `${dataStoreUrl}/data/datasets/${datasource.id.team}/${datasetName}?token=${token}`,
      {
        data: datasource,
      },
    ),
  );
}

export async function getActiveDatasets(): Promise<Array<APIDatasetType>> {
  const datasets = await Request.receiveJSON("/api/datasets?isActive=true");
  assertResponseLimit(datasets);

  return datasets;
}

export function getDataset(
  datasetId: APIDatasetIdType,
  sharingToken?: ?string,
): Promise<APIDatasetType> {
  const sharingTokenSuffix = sharingToken != null ? `?sharingToken=${sharingToken}` : "";
  return Request.receiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}${sharingTokenSuffix}`,
  );
}

export function updateDataset(
  datasetId: APIDatasetIdType,
  dataset: APIDatasetType,
): Promise<APIDatasetType> {
  return Request.sendJSONReceiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}`,
    {
      data: dataset,
    },
  );
}

export function getDatasetConfiguration(datasetId: APIDatasetIdType): Promise<Object> {
  return Request.receiveJSON(
    `/api/dataSetConfigurations/${datasetId.owningOrganization}/${datasetId.name}`,
  );
}

export function getDatasetDefaultConfiguration(
  datasetId: APIDatasetIdType,
): Promise<DatasetConfigurationType> {
  return Request.receiveJSON(
    `/api/dataSetConfigurations/default/${datasetId.owningOrganization}/${datasetId.name}`,
  );
}

export function updateDatasetDefaultConfiguration(
  datasetId: APIDatasetIdType,
  datasetConfiguration: DatasetConfigurationType,
): Promise<{}> {
  return Request.sendJSONReceiveJSON(
    `/api/dataSetConfigurations/default/${datasetId.owningOrganization}/${datasetId.name}`,
    {
      data: datasetConfiguration,
    },
  );
}

export function getDatasetAccessList(datasetId: APIDatasetIdType): Promise<Array<APIUserType>> {
  return Request.receiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/accessList`,
  );
}

export async function addDataset(datasetConfig: DatasetConfigType): Promise<void> {
  await doWithToken(token =>
    Request.sendMultipartFormReceiveJSON(`/data/datasets?token=${token}`, {
      data: datasetConfig,
      host: datasetConfig.datastore,
    }),
  );
}

export async function addForeignDataSet(
  dataStoreName: string,
  url: string,
  dataSetName: string,
): Promise<string> {
  const { result } = await Request.sendJSONReceiveJSON("/api/datasets/addForeign", {
    data: {
      dataStoreName,
      url,
      dataSetName,
    },
  });
  return result;
}

// Returns void if the name is valid. Otherwise, a string is returned which denotes the reason.
export async function isDatasetNameValid(datasetId: APIDatasetIdType): Promise<?string> {
  if (datasetId.name === "") {
    return "The dataset name must not be empty.";
  }
  try {
    await Request.receiveJSON(
      `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/isValidNewName`,
      {
        doNotCatch: true,
      },
    );
    return null;
  } catch (ex) {
    const json = JSON.parse(await ex.text());
    return json.messages.map(msg => Object.values(msg)[0]).join(". ");
  }
}

export function updateDatasetTeams(
  datasetId: APIDatasetIdType,
  newTeams: Array<string>,
): Promise<APIDatasetType> {
  return Request.sendJSONReceiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/teams`,
    {
      data: newTeams,
    },
  );
}

export async function triggerDatasetCheck(datastoreHost: string): Promise<void> {
  await doWithToken(token =>
    Request.triggerRequest(`/data/triggers/checkInboxBlocking?token=${token}`, {
      host: datastoreHost,
    }),
  );
}

export async function triggerDatasetClearCache(
  datastoreHost: string,
  datasetId: APIDatasetIdType,
): Promise<void> {
  await doWithToken(token =>
    Request.triggerRequest(
      `/data/triggers/clearCache/${datasetId.owningOrganization}/${datasetId.name}?token=${token}`,
      {
        host: datastoreHost,
      },
    ),
  );
}

export async function getDatasetSharingToken(datasetId: APIDatasetIdType): Promise<string> {
  const { sharingToken } = await Request.receiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/sharingToken`,
  );
  return sharingToken;
}

export async function revokeDatasetSharingToken(datasetId: APIDatasetIdType): Promise<void> {
  await Request.triggerRequest(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/sharingToken`,
    { method: "DELETE" },
  );
}

// #### Datastores
export async function getDatastores(): Promise<Array<APIDataStoreType>> {
  const datastores = await Request.receiveJSON("/api/datastores");
  assertResponseLimit(datastores);

  return datastores;
}
export const getDataStoresCached = _.memoize(getDatastores);

// ### Active User
export function getActiveUser(options: Object = {}): Promise<APIUserType> {
  return Request.receiveJSON("/api/user", options);
}

export function getUserConfiguration(): Object {
  return Request.receiveJSON("/api/user/userConfiguration");
}

// ### TimeTracking
export async function getTimeTrackingForUserByMonth(
  userEmail: string,
  day: moment$Moment,
): Promise<Array<APITimeTrackingType>> {
  const month = day.format("M");
  const year = day.format("YYYY");

  const timeTrackingData = await Request.receiveJSON(
    `/api/time/userlist/${year}/${month}?email=${userEmail}`,
  );

  const { timelogs } = timeTrackingData[0];
  assertResponseLimit(timelogs);

  return timelogs;
}

export async function getTimeTrackingForUser(
  userId: string,
  startDate: moment$Moment,
  endDate: moment$Moment,
): Promise<Array<APITimeTrackingType>> {
  const timeTrackingData = await Request.receiveJSON(
    `/api/time/user/${userId}?startDate=${startDate.unix() * 1000}&endDate=${endDate.unix() *
      1000}`,
  );

  const { timelogs } = timeTrackingData;
  assertResponseLimit(timelogs);

  return timelogs;
}

export async function getProjectProgressReport(
  teamId: string,
  doNotCatch?: boolean = false,
): Promise<Array<APIProjectProgressReportType>> {
  const progressData = await Request.receiveJSON(`/api/teams/${teamId}/progressOverview`, {
    doNotCatch,
  });
  assertResponseLimit(progressData);
  return progressData;
}

export async function getOpenTasksReport(teamId: string): Promise<Array<APIOpenTasksReportType>> {
  const openTasksData = await Request.receiveJSON(`/api/teams/${teamId}/openTasksOverview`);
  assertResponseLimit(openTasksData);
  return openTasksData;
}

// ### Organizations
export function getOrganizations(): Promise<Array<APIOrganizationType>> {
  return Request.receiveJSON("/api/organizations");
}

export async function getOrganizationNames(): Promise<Array<string>> {
  const organizations = await getOrganizations();
  return organizations.map(org => org.name);
}

// ### BuildInfo
export function getBuildInfo(): Promise<APIBuildInfoType> {
  return Request.receiveJSON("/api/buildinfo");
}

// ### Feature Selection
export function getFeatureToggles(): Promise<APIFeatureToggles> {
  return Request.receiveJSON("/api/features");
}

export function getOperatorData(): Promise<string> {
  return Request.receiveJSON("/api/operatorData");
}

// @flow
import Request from "libs/request";
import Toast from "libs/toast";
import type { MessageType } from "libs/toast";
import Utils from "libs/utils";
import { location } from "libs/window";
import messages from "messages";
import type {
  APIUserType,
  APIScriptType,
  APITaskTypeType,
  APITeamType,
  APIProjectType,
  APIProjectCreatorType,
  APIProjectUpdaterType,
  APITaskType,
  APIAnnotationType,
  APIDataStoreType,
  DatasetConfigType,
  APIDatasetType,
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
} from "admin/api_flow_types";
import type { QueryObjectType } from "admin/task/task_search_form";
import type { NewTaskType, TaskCreationResponseType } from "admin/task/task_create_bulk_view";
import type { DatasetConfigurationType } from "oxalis/store";
import type { APIOrganizationType } from "./api_flow_types";

const MAX_SERVER_ITEMS_PER_RESPONSE = 1000;

type NewTeamType = {
  +name: string,
};

function assertResponseLimit(collection) {
  if (collection.length === MAX_SERVER_ITEMS_PER_RESPONSE) {
    Toast.warning(messages["request.max_item_count_alert"], true);
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
      return ((params.token: any): string);
    }
  }
  return null;
}

let tokenPromise;
export async function doWithToken<T>(fn: (token: string) => Promise<T>): Promise<*> {
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

export async function getUser(userId: string): Promise<APIUserType> {
  return Request.receiveJSON(`/api/users/${userId}`);
}

export async function updateUser(newUser: APIUserType): Promise<APIUserType> {
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

export async function getScript(scriptId: string): Promise<APIScriptType> {
  return Request.receiveJSON(`/api/scripts/${scriptId}`);
}

export async function deleteScript(scriptId: string): Promise<void> {
  return Request.receiveJSON(`/api/scripts/${scriptId}`, {
    method: "DELETE",
  });
}

export async function createScript(script: APIScriptType): Promise<APIScriptType> {
  return Request.sendJSONReceiveJSON("/api/scripts", {
    data: script,
  });
}

export async function updateScript(
  scriptId: string,
  script: APIScriptType,
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

export async function deleteTaskType(taskTypeId: string): Promise<void> {
  return Request.receiveJSON(`/api/taskTypes/${taskTypeId}`, {
    method: "DELETE",
  });
}

export async function getTaskType(taskTypeId: string): Promise<APITaskTypeType> {
  return Request.receiveJSON(`/api/taskTypes/${taskTypeId}`);
}

export async function createTaskType(
  taskType: $Diff<APITaskTypeType, { id: string }>,
): Promise<APITaskTypeType> {
  return Request.sendJSONReceiveJSON("/api/taskTypes", {
    data: taskType,
  });
}

export async function updateTaskType(taskTypeId: string, taskType: APITaskTypeType): Promise<void> {
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

export async function createTeam(newTeam: NewTeamType): Promise<APITeamType> {
  return Request.sendJSONReceiveJSON("/api/teams", {
    data: newTeam,
  });
}

export async function deleteTeam(teamId: string): Promise<void> {
  return Request.receiveJSON(`/api/teams/${teamId}`, {
    method: "DELETE",
  });
}

// ### Projects
function transformProject(response): APIProjectType {
  return Object.assign(response, {
    expectedTime: Utils.millisecondsToMinutes(response.expectedTime),
  });
}

export async function getProjects(): Promise<Array<APIProjectType>> {
  const responses = await Request.receiveJSON("/api/projects");
  assertResponseLimit(responses);

  return responses.map(transformProject);
}

export async function getProjectsWithOpenAssignments(): Promise<Array<APIProjectType>> {
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
): Promise<APIProjectType> {
  const project = await Request.receiveJSON(
    `/api/projects/${projectName}/incrementEachTasksInstances?delta=${delta}`,
  );
  return transformProject(project);
}

export async function deleteProject(projectName: string): Promise<void> {
  return Request.receiveJSON(`/api/projects/${projectName}`, {
    method: "DELETE",
  });
}

export async function createProject(project: APIProjectCreatorType): Promise<APIProjectType> {
  const transformedProject = Object.assign({}, project, {
    expectedTime: Utils.minutesToMilliseconds(project.expectedTime),
  });

  return Request.sendJSONReceiveJSON("/api/projects", {
    data: transformedProject,
  });
}

export async function updateProject(
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
export async function peekNextTasks(): Promise<?APITaskType> {
  return Request.receiveJSON("/api/user/tasks/peek");
}

export async function requestTask(): Promise<APIAnnotationType> {
  return Request.receiveJSON("/api/user/tasks/request");
}

export async function getAnnotationsForTask(taskId: string): Promise<void> {
  return Request.receiveJSON(`/api/tasks/${taskId}/annotations`);
}

export async function deleteTask(taskId: string): Promise<void> {
  return Request.receiveJSON(`/api/tasks/${taskId}`, {
    method: "DELETE",
  });
}
function transformTask(response): APITaskType {
  // apply some defaults
  response.type = {
    summary: Utils.__guard__(response.type, x => x.summary) || "<deleted>",
    id: Utils.__guard__(response.type, x1 => x1.id) || "",
  };

  if (response.tracingTime == null) {
    response.tracingTime = 0;
  }
  // convert bounding box
  if (response.boundingBox != null) {
    const { topLeft, width, height, depth } = response.boundingBox;
    response.boundingBoxVec6 = topLeft.concat([width, height, depth]);
  } else {
    response.boundingBoxVec6 = [];
  }

  return response;
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
export async function createTasks(
  tasks: Array<NewTaskType>,
): Promise<Array<TaskCreationResponseType>> {
  return Request.sendJSONReceiveJSON("/api/tasks", {
    data: tasks,
  });
}

// TODO fix return types
export async function createTaskFromNML(
  task: NewTaskType,
): Promise<Array<TaskCreationResponseType>> {
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

export async function finishTask(annotationId: string): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/api/annotations/Task/${annotationId}/finish`);
}

export async function transferTask(
  annotationId: string,
  userId: string,
): Promise<APIAnnotationType> {
  return Request.sendJSONReceiveJSON(`/api/annotations/Task/${annotationId}/transfer`, {
    data: {
      userId,
    },
  });
}

// ### Annotations
export async function reOpenAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/reopen`);
}

type EditableAnnotationType = {
  name: string,
  description: string,
  isPublic: boolean,
  tags: Array<string>,
};

export async function editAnnotation(
  annotationId: string,
  annotationType: APITracingType,
  data: $Shape<EditableAnnotationType>,
): Promise<APIAnnotationType> {
  return Request.sendJSONReceiveJSON(`/api/annotations/${annotationType}/${annotationId}/edit`, {
    data,
  });
}

export async function finishAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/finish`);
}

export async function resetAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/reset`);
}

export async function deleteAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}`, {
    method: "DELETE",
  });
}

export async function finishAllAnnotations(
  selectedAnnotationIds: Array<string>,
): Promise<{ messages: Array<MessageType> }> {
  return Request.sendJSONReceiveJSON("/api/annotations/Explorational/finish", {
    data: {
      annotations: selectedAnnotationIds,
    },
  });
}

export async function copyAnnotationToUserAccount(
  annotationId: string,
  tracingType: string,
): Promise<APIAnnotationType> {
  const url = `/api/annotations/${tracingType}/${annotationId}/duplicate`;
  return Request.receiveJSON(url);
}

export async function getAnnotationInformation(
  annotationId: string,
  tracingType: string,
): Promise<APIAnnotationType> {
  // Include /readOnly part whenever it is in the pathname
  const isReadOnly = location.pathname.endsWith("/readOnly");
  const readOnlyPart = isReadOnly ? "readOnly/" : "";
  const infoUrl = `/api/annotations/${tracingType}/${annotationId}/${readOnlyPart}info`;
  return Request.receiveJSON(infoUrl);
}

export async function createExplorational(
  dataset: APIDatasetType,
  typ: "volume" | "skeleton",
  withFallback: boolean,
) {
  const url = `/api/datasets/${dataset.name}/createExplorational`;

  return Request.sendJSONReceiveJSON(url, { data: { typ, withFallback } });
}

// ### Datasets
export async function getDatasets(): Promise<Array<APIDatasetType>> {
  const datasets = await Request.receiveJSON("/api/datasets");
  assertResponseLimit(datasets);

  return datasets;
}

export async function getDatasetDatasource(
  dataset: APIDatasetType,
): Promise<APIDataSourceWithMessagesType> {
  return doWithToken(token =>
    Request.receiveJSON(`${dataset.dataStore.url}/data/datasets/${dataset.name}?token=${token}`),
  );
}

export async function updateDatasetDatasource(
  datasetName: string,
  dataStoreUrl: string,
  datasource: APIDataSourceType,
): Promise<void> {
  await doWithToken(token =>
    Request.sendJSONReceiveJSON(`${dataStoreUrl}/data/datasets/${datasetName}?token=${token}`, {
      data: datasource,
    }),
  );
}

export async function getActiveDatasets(): Promise<Array<APIDatasetType>> {
  const datasets = await Request.receiveJSON("/api/datasets?isActive=true");
  assertResponseLimit(datasets);

  return datasets;
}

export async function getDataset(
  datasetName: string,
  sharingToken?: string,
): Promise<APIDatasetType> {
  const sharingTokenSuffix = sharingToken != null ? `?sharingToken=${sharingToken}` : "";
  const dataset = await Request.receiveJSON(`/api/datasets/${datasetName}${sharingTokenSuffix}`);
  return dataset;
}

export async function updateDataset(
  datasetName: string,
  dataset: APIDatasetType,
): Promise<APIDatasetType> {
  const updatedDataset = await Request.sendJSONReceiveJSON(`/api/datasets/${datasetName}`, {
    data: dataset,
  });
  return updatedDataset;
}

export async function getDatasetDefaultConfiguration(
  datasetName: string,
): Promise<DatasetConfigurationType> {
  const datasetDefaultConfiguration = await Request.receiveJSON(
    `/api/dataSetConfigurations/default/${datasetName}`,
  );
  return datasetDefaultConfiguration;
}

export async function updateDatasetDefaultConfiguration(
  datasetName: string,
  datasetConfiguration: DatasetConfigurationType,
): Promise<{}> {
  const datasetDefaultConfiguration = await Request.sendJSONReceiveJSON(
    `/api/dataSetConfigurations/default/${datasetName}`,
    { data: datasetConfiguration },
  );
  return datasetDefaultConfiguration;
}

export async function getDatasetAccessList(datasetName: string): Promise<Array<APIUserType>> {
  return Request.receiveJSON(`/api/datasets/${datasetName}/accessList`);
}

export async function addDataset(datatsetConfig: DatasetConfigType): Promise<void> {
  await doWithToken(token =>
    Request.sendMultipartFormReceiveJSON(`/data/datasets?token=${token}`, {
      data: datatsetConfig,
      host: datatsetConfig.datastore,
    }),
  );
}

export async function updateDatasetTeams(
  datasetName: string,
  newTeams: Array<string>,
): Promise<APIDatasetType> {
  return Request.sendJSONReceiveJSON(`/api/datasets/${datasetName}/teams`, {
    data: newTeams,
  });
}

export async function triggerDatasetCheck(datatstoreHost: string): Promise<void> {
  await doWithToken(token =>
    Request.triggerRequest(`/data/triggers/checkInboxBlocking?token=${token}`, {
      host: datatstoreHost,
    }),
  );
}

export async function getDatasetSharingToken(datasetName: string): Promise<string> {
  const { sharingToken } = await Request.receiveJSON(`/api/datasets/${datasetName}/sharingToken`);
  return sharingToken;
}

export async function revokeDatasetSharingToken(datasetName: string): Promise<void> {
  await Request.triggerRequest(`/api/datasets/${datasetName}/sharingToken`, { method: "DELETE" });
}

// #### Datastores
export async function getDatastores(): Promise<Array<APIDataStoreType>> {
  const datastores = await Request.receiveJSON("/api/datastores");
  assertResponseLimit(datastores);

  return datastores;
}

// ### Active User
export async function getActiveUser(options: Object = {}) {
  return Request.receiveJSON("/api/user", options);
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
export async function getOrganization(): Promise<Array<APIOrganizationType>> {
  return Request.receiveJSON("/api/organizations");
}

export async function getOrganizationNames(): Promise<Array<string>> {
  const organizations = await getOrganization();
  return organizations.map(org => org.name);
}

// ### BuildInfo
export function getBuildInfo(): Promise<APIBuildInfoType> {
  return Request.receiveJSON("/api/buildinfo");
}

// ### Feature Selection
export async function getFeatureToggles(): Promise<APIFeatureToggles> {
  return Request.receiveJSON("/api/features");
}

export async function getOperatorData(): Promise<string> {
  return Request.receiveJSON("/api/operatorData");
}

export async function getOrganizationData(): Promise<string> {
  return Request.receiveJSON("/api/organizationData");
}

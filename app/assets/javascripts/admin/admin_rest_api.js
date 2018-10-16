// @flow
import _ from "lodash";
import Request from "libs/request";
import Toast from "libs/toast";
import type { Message } from "libs/toast";
import * as Utils from "libs/utils";
import { location } from "libs/window";
import messages from "messages";
import { parseProtoTracing } from "oxalis/model/helpers/proto_helpers";
import type {
  APIUser,
  APIScript,
  APIScriptCreator,
  APIScriptUpdater,
  APITaskType,
  APITeam,
  APIProject,
  APIProjectWithAssignments,
  APIProjectCreator,
  APIProjectUpdater,
  APITask,
  APIAnnotation,
  APIAnnotationWithTask,
  APIDataStore,
  APITracingStore,
  DatasetConfig,
  APIDatasetId,
  APIDataset,
  APIMaybeUnimportedDataset,
  APIDataSource,
  APIDataSourceWithMessages,
  APITimeInterval,
  APIUserLoggedTime,
  APITimeTracking,
  APIProjectProgressReport,
  APIOpenTasksReport,
  APIBuildInfo,
  APITracingType,
  APIFeatureToggles,
  APIOrganization,
  ServerTracing,
  APIActiveUser,
  HybridServerTracing,
  ServerSkeletonTracing,
  ServerVolumeTracing,
  APIAnnotationTypeCompact,
  APIUpdateActionBatch,
  ExperienceDomainList,
} from "admin/api_flow_types";
import { APITracingTypeEnum } from "admin/api_flow_types";
import type { QueryObject } from "admin/task/task_search_form";
import type { NewTask, TaskCreationResponse } from "admin/task/task_create_bulk_view";
import type { DatasetConfiguration } from "oxalis/store";
import type { RequestOptions } from "libs/request";
import type { Versions } from "oxalis/view/version_view";

const MAX_SERVER_ITEMS_PER_RESPONSE = 1000;

type NewTeam = {
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

  tokenRequestPromise = Request.receiveJSON("/api/userToken/generate", { method: "POST" }).then(
    tokenObj => {
      tokenRequestPromise = null;
      return tokenObj.token;
    },
  );

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

export async function getUsers(): Promise<Array<APIUser>> {
  const users = await Request.receiveJSON("/api/users");
  assertResponseLimit(users);

  return users;
}

export async function getAdminUsers(): Promise<Array<APIUser>> {
  const users = await Request.receiveJSON("/api/users?isAdmin=true");
  assertResponseLimit(users);

  return users;
}

export async function getEditableUsers(): Promise<Array<APIUser>> {
  const users = await Request.receiveJSON("/api/users?isEditable=true");
  assertResponseLimit(users);

  return users;
}

export function getUser(userId: string): Promise<APIUser> {
  return Request.receiveJSON(`/api/users/${userId}`);
}

export function updateUser(newUser: APIUser): Promise<APIUser> {
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

export async function getLoggedTimes(userID: ?string): Promise<Array<APITimeInterval>> {
  const url = userID != null ? `/api/users/${userID}/loggedTime` : "/api/user/loggedTime";

  const response: APIUserLoggedTime = await Request.receiveJSON(url);
  return response.loggedTime;
}

// ### Scripts
export async function getScripts(): Promise<Array<APIScript>> {
  const scripts = await Request.receiveJSON("/api/scripts");
  assertResponseLimit(scripts);

  return scripts;
}

export function getScript(scriptId: string): Promise<APIScript> {
  return Request.receiveJSON(`/api/scripts/${scriptId}`);
}

export function deleteScript(scriptId: string): Promise<void> {
  return Request.receiveJSON(`/api/scripts/${scriptId}`, {
    method: "DELETE",
  });
}

export function createScript(script: APIScriptCreator): Promise<APIScript> {
  return Request.sendJSONReceiveJSON("/api/scripts", {
    data: script,
  });
}

export function updateScript(scriptId: string, script: APIScriptUpdater): Promise<APIScript> {
  return Request.sendJSONReceiveJSON(`/api/scripts/${scriptId}`, {
    method: "PUT",
    data: script,
  });
}

// ### TaskTypes
export async function getTaskTypes(): Promise<Array<APITaskType>> {
  const taskTypes = await Request.receiveJSON("/api/taskTypes");
  assertResponseLimit(taskTypes);

  return taskTypes;
}

export function deleteTaskType(taskTypeId: string): Promise<void> {
  return Request.receiveJSON(`/api/taskTypes/${taskTypeId}`, {
    method: "DELETE",
  });
}

export function getTaskType(taskTypeId: string): Promise<APITaskType> {
  return Request.receiveJSON(`/api/taskTypes/${taskTypeId}`);
}

export function createTaskType(
  taskType: $Diff<APITaskType, { id: string, teamName: string }>,
): Promise<APITaskType> {
  return Request.sendJSONReceiveJSON("/api/taskTypes", {
    data: taskType,
  });
}

export function updateTaskType(taskTypeId: string, taskType: APITaskType): Promise<void> {
  return Request.sendJSONReceiveJSON(`/api/taskTypes/${taskTypeId}`, {
    method: "PUT",
    data: taskType,
  });
}

// ### Teams
export async function getTeams(): Promise<Array<APITeam>> {
  const teams = await Request.receiveJSON("/api/teams");
  assertResponseLimit(teams);

  return teams;
}

export async function getEditableTeams(): Promise<Array<APITeam>> {
  const teams = await Request.receiveJSON("/api/teams?isEditable=true");
  assertResponseLimit(teams);

  return teams;
}

export function createTeam(newTeam: NewTeam): Promise<APITeam> {
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
function transformProject<T: APIProject | APIProjectWithAssignments>(response: T): T {
  return Object.assign({}, response, {
    expectedTime: Utils.millisecondsToMinutes(response.expectedTime),
  });
}

export async function getProjects(): Promise<Array<APIProject>> {
  const responses = await Request.receiveJSON("/api/projects");
  assertResponseLimit(responses);

  return responses.map(transformProject);
}

export async function getProjectsWithOpenAssignments(): Promise<Array<APIProjectWithAssignments>> {
  const responses = await Request.receiveJSON("/api/projects/assignments");
  assertResponseLimit(responses);

  return responses.map(transformProject);
}

export async function getProject(projectName: string): Promise<APIProject> {
  const project = await Request.receiveJSON(`/api/projects/${projectName}`);
  return transformProject(project);
}

export async function increaseProjectTaskInstances(
  projectName: string,
  delta?: number = 1,
): Promise<APIProjectWithAssignments> {
  const project = await Request.receiveJSON(
    `/api/projects/${projectName}/incrementEachTasksInstances?delta=${delta}`,
    { method: "PATCH" },
  );
  return transformProject(project);
}

export function deleteProject(projectName: string): Promise<void> {
  return Request.receiveJSON(`/api/projects/${projectName}`, {
    method: "DELETE",
  });
}

export function createProject(project: APIProjectCreator): Promise<APIProject> {
  const transformedProject = Object.assign({}, project, {
    expectedTime: Utils.minutesToMilliseconds(project.expectedTime),
  });

  return Request.sendJSONReceiveJSON("/api/projects", {
    data: transformedProject,
  });
}

export function updateProject(
  projectName: string,
  project: APIProjectUpdater,
): Promise<APIProject> {
  const transformedProject = Object.assign({}, project, {
    expectedTime: Utils.minutesToMilliseconds(project.expectedTime),
  });

  return Request.sendJSONReceiveJSON(`/api/projects/${projectName}`, {
    method: "PUT",
    data: transformedProject,
  });
}

export async function pauseProject(projectName: string): Promise<APIProject> {
  const project = await Request.receiveJSON(`/api/projects/${projectName}/pause`, {
    method: "PATCH",
  });
  return transformProject(project);
}

export async function resumeProject(projectName: string): Promise<APIProject> {
  const project = await Request.receiveJSON(`/api/projects/${projectName}/resume`, {
    method: "PATCH",
  });
  return transformProject(project);
}

// ### Tasks
export function peekNextTasks(): Promise<?APITask> {
  return Request.receiveJSON("/api/user/tasks/peek");
}

export function requestTask(): Promise<APIAnnotationWithTask> {
  return Request.receiveJSON("/api/user/tasks/request", { method: "POST" });
}

export function getAnnotationsForTask(taskId: string): Promise<Array<APIAnnotation>> {
  return Request.receiveJSON(`/api/tasks/${taskId}/annotations`);
}

export function deleteTask(taskId: string): Promise<void> {
  return Request.receiveJSON(`/api/tasks/${taskId}`, {
    method: "DELETE",
  });
}
function transformTask(task: APITask): APITask {
  const tracingTime = task.tracingTime == null ? 0 : task.tracingTime;

  // convert bounding box
  let boundingBoxVec6;
  if (task.boundingBox != null) {
    const { topLeft, width, height, depth } = task.boundingBox;
    boundingBoxVec6 = Utils.numberArrayToVector6(topLeft.concat([width, height, depth]));
  }

  return { ...task, tracingTime, boundingBoxVec6 };
}

export async function getTasks(queryObject: QueryObject): Promise<Array<APITask>> {
  const responses = await Request.sendJSONReceiveJSON("/api/tasks/list", {
    data: queryObject,
  });

  const tasks = responses.map(response => transformTask(response));
  assertResponseLimit(tasks);
  return tasks;
}

// TODO fix return types
export function createTasks(tasks: Array<NewTask>): Promise<Array<TaskCreationResponse>> {
  return Request.sendJSONReceiveJSON("/api/tasks", {
    data: tasks,
  });
}

// TODO fix return types
export function createTaskFromNML(task: NewTask): Promise<Array<TaskCreationResponse>> {
  return Request.sendMultipartFormReceiveJSON("/api/tasks/createFromFiles", {
    data: {
      nmlFiles: task.nmlFiles,
      formJSON: JSON.stringify(task),
    },
  });
}

export async function getTask(taskId: string): Promise<APITask> {
  const task = await Request.receiveJSON(`/api/tasks/${taskId}`);
  return transformTask(task);
}

export async function updateTask(taskId: string, task: NewTask): Promise<APITask> {
  const updatedTask = await Request.sendJSONReceiveJSON(`/api/tasks/${taskId}`, {
    method: "PUT",
    data: task,
  });
  return transformTask(updatedTask);
}

export function finishTask(annotationId: string): Promise<APIAnnotation> {
  return finishAnnotation(annotationId, APITracingTypeEnum.Task);
}

export function transferTask(annotationId: string, userId: string): Promise<APIAnnotation> {
  return Request.sendJSONReceiveJSON(`/api/annotations/Task/${annotationId}/transfer`, {
    method: "PATCH",
    data: {
      userId,
    },
  });
}

export async function transferActiveTasksOfProject(
  projectName: string,
  userId: string,
): Promise<APIAnnotation> {
  return Request.sendJSONReceiveJSON(`/api/projects/${projectName}/transferActiveTasks`, {
    data: {
      userId,
    },
    method: "POST",
  });
}

export async function getUsersWithActiveTasks(projectName: string): Promise<Array<APIActiveUser>> {
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
): Promise<APIAnnotation> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/reopen`, {
    method: "PATCH",
  });
}

export type EditableAnnotation = {
  name: string,
  description: string,
  isPublic: boolean,
  tags: Array<string>,
};

export function editAnnotation(
  annotationId: string,
  annotationType: APITracingType,
  data: $Shape<EditableAnnotation>,
): Promise<void> {
  return Request.sendJSONReceiveJSON(`/api/annotations/${annotationType}/${annotationId}/edit`, {
    data,
    method: "PATCH",
  });
}

export function finishAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<APIAnnotation> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/finish`, {
    method: "PATCH",
  });
}

export function resetAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<APIAnnotation> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/reset`, {
    method: "PUT",
  });
}

export function deleteAnnotation(
  annotationId: string,
  annotationType: APITracingType,
): Promise<{ messages: Array<Message> }> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}`, {
    method: "DELETE",
  });
}

export function finishAllAnnotations(
  selectedAnnotationIds: Array<string>,
): Promise<{ messages: Array<Message> }> {
  return Request.sendJSONReceiveJSON("/api/annotations/Explorational/finish", {
    method: "PATCH",
    data: {
      annotations: selectedAnnotationIds,
    },
  });
}

export function copyAnnotationToUserAccount(
  annotationId: string,
  tracingType: APITracingType,
): Promise<APIAnnotation> {
  const url = `/api/annotations/${tracingType}/${annotationId}/duplicate`;
  return Request.receiveJSON(url, { method: "POST" });
}

export function getAnnotationInformation(
  annotationId: string,
  tracingType: APITracingType,
): Promise<APIAnnotation> {
  const infoUrl = `/api/annotations/${tracingType}/${annotationId}/info`;
  return Request.receiveJSON(infoUrl);
}

export function createExplorational(
  datasetId: APIDatasetId,
  typ: "volume" | "skeleton" | "hybrid",
  withFallback: boolean,
  options?: RequestOptions = {},
): Promise<APIAnnotation> {
  const url = `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/createExplorational`;
  return Request.sendJSONReceiveJSON(
    url,
    Object.assign({}, { data: { typ, withFallback } }, options),
  );
}

export async function getTracingForAnnotations(
  annotation: APIAnnotation,
  versions?: Versions = {},
): Promise<HybridServerTracing> {
  const [_skeleton, _volume] = await Promise.all([
    getTracingForAnnotationType(annotation, "skeleton", versions.skeleton),
    getTracingForAnnotationType(annotation, "volume", versions.volume),
  ]);

  const skeleton = ((_skeleton: any): ?ServerSkeletonTracing);
  const volume = ((_volume: any): ?ServerVolumeTracing);

  return {
    skeleton,
    volume,
  };
}

export async function getTracingForAnnotationType(
  annotation: APIAnnotation,
  tracingType: "skeleton" | "volume",
  version?: ?number,
): Promise<?ServerTracing> {
  const tracingId = annotation.tracing[tracingType];
  if (!tracingId) {
    return null;
  }
  const possibleVersionString = version != null ? `&version=${version}` : "";
  const tracingArrayBuffer = await doWithToken(token =>
    Request.receiveArraybuffer(
      `${
        annotation.tracingStore.url
      }/tracings/${tracingType}/${tracingId}?token=${token}${possibleVersionString}`,
      { headers: { Accept: "application/x-protobuf" } },
    ),
  );

  const tracing = parseProtoTracing(tracingArrayBuffer, tracingType);
  // The tracing id is not contained in the server tracing, but in the annotation content
  tracing.id = tracingId;
  return tracing;
}

export function getUpdateActionLog(
  tracingStoreUrl: string,
  tracingId: string,
  tracingType: "skeleton" | "volume",
): Promise<Array<APIUpdateActionBatch>> {
  return doWithToken(token =>
    Request.receiveJSON(
      `${tracingStoreUrl}/tracings/${tracingType}/${tracingId}/updateActionLog?token=${token}`,
    ),
  );
}

// ### Datasets
export async function getDatasets(): Promise<Array<APIMaybeUnimportedDataset>> {
  const datasets = await Request.receiveJSON("/api/datasets");
  assertResponseLimit(datasets);

  return datasets;
}

export function getDatasetDatasource(
  dataset: APIMaybeUnimportedDataset,
): Promise<APIDataSourceWithMessages> {
  return doWithToken(token =>
    Request.receiveJSON(
      `${dataset.dataStore.url}/data/datasets/${dataset.owningOrganization}/${
        dataset.name
      }?token=${token}`,
    ),
  );
}

export function readDatasetDatasource(dataset: APIDataset): Promise<APIDataSource> {
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
  datasource: APIDataSource,
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

export async function getActiveDatasets(): Promise<Array<APIDataset>> {
  const datasets = await Request.receiveJSON("/api/datasets?isActive=true");
  assertResponseLimit(datasets);

  return datasets;
}

export function getDataset(datasetId: APIDatasetId, sharingToken?: ?string): Promise<APIDataset> {
  const sharingTokenSuffix = sharingToken != null ? `?sharingToken=${sharingToken}` : "";
  return Request.receiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}${sharingTokenSuffix}`,
  );
}

export function updateDataset(datasetId: APIDatasetId, dataset: APIDataset): Promise<APIDataset> {
  return Request.sendJSONReceiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}`,
    {
      method: "PATCH",
      data: dataset,
    },
  );
}

export function getDatasetConfiguration(datasetId: APIDatasetId): Promise<Object> {
  return Request.receiveJSON(
    `/api/dataSetConfigurations/${datasetId.owningOrganization}/${datasetId.name}`,
  );
}

export function updateDatasetConfiguration(
  datasetId: APIDatasetId,
  datasetConfig: DatasetConfiguration,
): Object {
  return Request.sendJSONReceiveJSON(
    `/api/dataSetConfigurations/${datasetId.owningOrganization}/${datasetId.name}`,
    {
      method: "PUT",
      data: datasetConfig,
    },
  );
}

export function getDatasetDefaultConfiguration(
  datasetId: APIDatasetId,
): Promise<DatasetConfiguration> {
  return Request.receiveJSON(
    `/api/dataSetConfigurations/default/${datasetId.owningOrganization}/${datasetId.name}`,
  );
}

export function updateDatasetDefaultConfiguration(
  datasetId: APIDatasetId,
  datasetConfiguration: DatasetConfiguration,
): Promise<{}> {
  return Request.sendJSONReceiveJSON(
    `/api/dataSetConfigurations/default/${datasetId.owningOrganization}/${datasetId.name}`,
    {
      method: "PUT",
      data: datasetConfiguration,
    },
  );
}

export function getDatasetAccessList(datasetId: APIDatasetId): Promise<Array<APIUser>> {
  return Request.receiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/accessList`,
  );
}

export async function addDataset(datasetConfig: DatasetConfig): Promise<void> {
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
export async function isDatasetNameValid(datasetId: APIDatasetId): Promise<?string> {
  if (datasetId.name === "") {
    return "The dataset name must not be empty.";
  }
  try {
    await Request.receiveJSON(
      `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/isValidNewName`,
      {
        showErrorToast: false,
      },
    );
    return null;
  } catch (ex) {
    const json = JSON.parse(await ex.text());
    return json.messages.map(msg => Object.values(msg)[0]).join(". ");
  }
}

export function updateDatasetTeams(
  datasetId: APIDatasetId,
  newTeams: Array<string>,
): Promise<APIDataset> {
  return Request.sendJSONReceiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/teams`,
    {
      method: "PATCH",
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
  datasetId: APIDatasetId,
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

export async function getDatasetSharingToken(datasetId: APIDatasetId): Promise<string> {
  const { sharingToken } = await Request.receiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/sharingToken`,
  );
  return sharingToken;
}

export async function revokeDatasetSharingToken(datasetId: APIDatasetId): Promise<void> {
  await Request.triggerRequest(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/sharingToken`,
    { method: "DELETE" },
  );
}

export async function getOrganizationForDataset(datasetName: string): Promise<string> {
  const { organizationName } = await Request.receiveJSON(
    `/api/datasets/disambiguate/${datasetName}/toNew`,
  );
  return organizationName;
}

// #### Datastores
export async function getDatastores(): Promise<Array<APIDataStore>> {
  const datastores = await Request.receiveJSON("/api/datastores");
  assertResponseLimit(datastores);

  return datastores;
}
export const getDataStoresCached = _.memoize(getDatastores);

export function getTracingstore(): Promise<APITracingStore> {
  return Request.receiveJSON("/api/tracingstore");
}

export const getTracingStoreCached = _.memoize(getTracingstore);

// ### Active User
export function getActiveUser(options: Object = {}): Promise<APIUser> {
  return Request.receiveJSON("/api/user", options);
}

export function getUserConfiguration(): Object {
  return Request.receiveJSON("/api/user/userConfiguration");
}

export function updateUserConfiguration(userConfiguration: Object): Object {
  return Request.sendJSONReceiveJSON("/api/user/userConfiguration", {
    method: "PUT",
    data: userConfiguration,
  });
}

// ### TimeTracking
export async function getTimeTrackingForUserByMonth(
  userEmail: string,
  day: moment$Moment,
): Promise<Array<APITimeTracking>> {
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
): Promise<Array<APITimeTracking>> {
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
  showErrorToast?: boolean = true,
): Promise<Array<APIProjectProgressReport>> {
  const progressData = await Request.receiveJSON(`/api/teams/${teamId}/progressOverview`, {
    showErrorToast,
  });
  assertResponseLimit(progressData);
  return progressData;
}

export async function getOpenTasksReport(teamId: string): Promise<Array<APIOpenTasksReport>> {
  const openTasksData = await Request.receiveJSON(`/api/teams/${teamId}/openTasksOverview`);
  assertResponseLimit(openTasksData);
  return openTasksData;
}

// ### Organizations
export function getOrganizations(): Promise<Array<APIOrganization>> {
  return Request.receiveJSON("/api/organizations");
}

export async function getOrganizationNames(): Promise<Array<string>> {
  const organizations = await getOrganizations();
  return organizations.map(org => org.name);
}

// ### BuildInfo webknossos
export function getBuildInfo(): Promise<APIBuildInfo> {
  return Request.receiveJSON("/api/buildinfo");
}

// ### BuildInfo datastore
export function getDataStoreBuildInfo(dataStoreUrl: string): Promise<APIBuildInfo> {
  return Request.receiveJSON(`${dataStoreUrl}/api/buildinfo`);
}

// ### Feature Selection
export function getFeatureToggles(): Promise<APIFeatureToggles> {
  return Request.receiveJSON("/api/features");
}

export function getOperatorData(): Promise<string> {
  return Request.receiveJSON("/api/operatorData");
}

// ## Experience Domains
export function getExistingExperienceDomains(): Promise<ExperienceDomainList> {
  return Request.receiveJSON("/api/tasks/experienceDomains");
}

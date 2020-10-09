// @flow
import _ from "lodash";

import {
  type APIActiveUser,
  type APIAnnotation,
  type APIAnnotationCompact,
  type APIAnnotationWithTask,
  type APIAnnotationVisibility,
  type APIBuildInfo,
  type APIDataSource,
  type APIDataSourceWithMessages,
  type APIDataStore,
  type APIDataset,
  type APIDatasetId,
  type APIFeatureToggles,
  type APIHistogramData,
  type APIMaybeUnimportedDataset,
  type APIOpenTasksReport,
  type APIOrganization,
  type APIProject,
  type APIProjectCreator,
  type APIProjectProgressReport,
  type APIProjectUpdater,
  type APIProjectWithAssignments,
  type APISampleDataset,
  type APIScript,
  type APIScriptCreator,
  type APIScriptUpdater,
  type APITask,
  type APITaskType,
  type APITeam,
  type APITimeInterval,
  type APITimeTracking,
  type APITracingStore,
  type APIAnnotationType,
  APIAnnotationTypeEnum,
  type APIUpdateActionBatch,
  type APIUser,
  type APIUserLoggedTime,
  type DatasetConfig,
  type ExperienceDomainList,
  type HybridServerTracing,
  type MeshMetaData,
  type RemoteMeshMetaData,
  type ServerSkeletonTracing,
  type ServerTracing,
  type ServerVolumeTracing,
  type TracingType,
  type WkConnectDatasetConfig,
} from "admin/api_flow_types";
import type { DatasetConfiguration, Tracing } from "oxalis/store";
import type { NewTask, TaskCreationResponseContainer } from "admin/task/task_create_bulk_view";
import type { QueryObject } from "admin/task/task_search_form";
import { V3 } from "libs/mjs";
import type { Vector3 } from "oxalis/constants";
import type { Versions } from "oxalis/view/version_view";
import { parseProtoTracing } from "oxalis/model/helpers/proto_helpers";
import DataLayer from "oxalis/model/data_layer";
import Request, { type RequestOptions } from "libs/request";
import Toast, { type Message } from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import window, { location } from "libs/window";
import { saveAs } from "file-saver";

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
export function doWithToken<T>(fn: (token: string) => Promise<T>, tries: number = 1): Promise<*> {
  const sharingToken = getSharingToken();
  if (sharingToken != null) {
    return fn(sharingToken);
  }
  if (!tokenPromise) tokenPromise = requestUserToken();
  return tokenPromise.then(fn).catch(error => {
    if (error.status === 403) {
      console.warn("Token expired. Requesting new token...");
      tokenPromise = requestUserToken();
      // If three new tokens did not fix the 403, abort, otherwise we'll get into an endless loop here
      if (tries < 3) {
        return doWithToken(fn, tries + 1);
      }
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

export async function getTeamManagerOrAdminUsers(): Promise<Array<APIUser>> {
  const users = await Request.receiveJSON("/api/users?isTeamManagerOrAdmin=true");
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

export function updateUser(newUser: $Shape<APIUser>): Promise<APIUser> {
  return Request.sendJSONReceiveJSON(`/api/users/${newUser.id}`, {
    method: "PATCH",
    data: newUser,
  });
}

export function updateLastTaskTypeIdOfUser(
  userId: string,
  lastTaskTypeId: string,
): Promise<APIUser> {
  return Request.sendJSONReceiveJSON(`/api/users/${userId}/taskTypeId`, {
    method: "PUT",
    data: { lastTaskTypeId },
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

export async function getProjectsForTaskType(
  taskTypeId: string,
): Promise<Array<APIProjectWithAssignments>> {
  const responses = await Request.receiveJSON(`/api/taskTypes/${taskTypeId}/projects`);
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
export function createTasks(tasks: Array<NewTask>): Promise<TaskCreationResponseContainer> {
  return Request.sendJSONReceiveJSON("/api/tasks", {
    data: tasks,
  });
}

// TODO fix return types
export function createTaskFromNML(task: NewTask): Promise<TaskCreationResponseContainer> {
  return Request.sendMultipartFormReceiveJSON("/api/tasks/createFromFiles", {
    data: {
      nmlFiles: task.nmlFiles,
      formJSON: JSON.stringify(task),
    },
  });
}

export async function getTask(taskId: string, options?: RequestOptions = {}): Promise<APITask> {
  const task = await Request.receiveJSON(`/api/tasks/${taskId}`, options);
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
  return finishAnnotation(annotationId, APIAnnotationTypeEnum.Task);
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
  pageNumber: number = 0,
): Promise<Array<APIAnnotationCompact>> {
  return Request.receiveJSON(
    `/api/user/annotations?isFinished=${isFinished.toString()}&pageNumber=${pageNumber}`,
  );
}

export function getCompactAnnotationsForUser(
  userId: string,
  isFinished: boolean,
  pageNumber: number = 0,
): Promise<Array<APIAnnotationCompact>> {
  return Request.receiveJSON(
    `/api/users/${userId}/annotations?isFinished=${isFinished.toString()}&pageNumber=${pageNumber}`,
  );
}

export function getSharedAnnotations(): Promise<Array<APIAnnotationCompact>> {
  return Request.receiveJSON("/api/annotations/shared");
}

export function getTeamsForSharedAnnotation(
  typ: string,
  id: string,
  options?: RequestOptions,
): Promise<Array<APITeam>> {
  return Request.receiveJSON(`/api/annotations/${typ}/${id}/sharedTeams`, options);
}

export function updateTeamsForSharedAnnotation(
  typ: string,
  id: string,
  teamIds: Array<string>,
): Promise<Array<APITeam>> {
  return Request.sendJSONReceiveJSON(`/api/annotations/${typ}/${id}/sharedTeams`, {
    data: teamIds,
    method: "PATCH",
  });
}

export function reOpenAnnotation(
  annotationId: string,
  annotationType: APIAnnotationType,
): Promise<APIAnnotation> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/reopen`, {
    method: "PATCH",
  });
}

export type EditableAnnotation = {
  name: string,
  description: string,
  visibility: APIAnnotationVisibility,
  tags: Array<string>,
};

export function editAnnotation(
  annotationId: string,
  annotationType: APIAnnotationType,
  data: $Shape<EditableAnnotation>,
): Promise<void> {
  return Request.sendJSONReceiveJSON(`/api/annotations/${annotationType}/${annotationId}/edit`, {
    data,
    method: "PATCH",
  });
}

export function finishAnnotation(
  annotationId: string,
  annotationType: APIAnnotationType,
): Promise<APIAnnotation> {
  return Request.receiveJSON(
    `/api/annotations/${annotationType}/${annotationId}/finish?timestamp=${Date.now()}`,
    {
      method: "PATCH",
    },
  );
}

export function resetAnnotation(
  annotationId: string,
  annotationType: APIAnnotationType,
): Promise<APIAnnotation> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/reset`, {
    method: "PUT",
  });
}

export function deleteAnnotation(
  annotationId: string,
  annotationType: APIAnnotationType,
): Promise<{ messages: Array<Message> }> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}`, {
    method: "DELETE",
  });
}

export function finishAllAnnotations(
  selectedAnnotationIds: Array<string>,
): Promise<{ messages: Array<Message> }> {
  return Request.sendJSONReceiveJSON(
    `/api/annotations/Explorational/finish?timestamp=${Date.now()}`,
    {
      method: "PATCH",
      data: {
        annotations: selectedAnnotationIds,
      },
    },
  );
}

export function copyAnnotationToUserAccount(
  annotationId: string,
  annotationType: APIAnnotationType,
): Promise<APIAnnotation> {
  const url = `/api/annotations/${annotationType}/${annotationId}/duplicate`;
  return Request.receiveJSON(url, { method: "POST" });
}

export function getAnnotationInformation(
  annotationId: string,
  annotationType: APIAnnotationType,
  options?: RequestOptions = {},
): Promise<APIAnnotation> {
  const infoUrl = `/api/annotations/${annotationType}/${annotationId}/info?timestamp=${Date.now()}`;
  return Request.receiveJSON(infoUrl, options);
}

export function createExplorational(
  datasetId: APIDatasetId,
  typ: TracingType,
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
  // The tracing id is not contained in the server tracing, but in the annotation content.
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

export async function importVolumeTracing(tracing: Tracing, dataFile: File): Promise<number> {
  const volumeTracing = tracing.volume;
  if (!volumeTracing) throw new Error("Volume Tracing must exist when importing Volume Tracing.");

  return doWithToken(token =>
    Request.sendMultipartFormReceiveJSON(
      `${tracing.tracingStore.url}/tracings/volume/${
        volumeTracing.tracingId
      }/importVolumeData?token=${token}`,
      {
        data: {
          dataFile,
          currentVersion: volumeTracing.version,
        },
      },
    ),
  );
}

export function convertToHybridTracing(annotationId: string): Promise<void> {
  return Request.receiveJSON(`/api/annotations/Explorational/${annotationId}/makeHybrid`, {
    method: "PATCH",
  });
}

export async function downloadNml(
  annotationId: string,
  annotationType: APIAnnotationType,
  showVolumeDownloadWarning?: boolean = false,
  versions?: Versions = {},
) {
  const possibleVersionString = Object.entries(versions)
    // $FlowIssue[incompatible-type] Flow returns val as mixed here due to the use of Object.entries
    .map(([key, val]) => `${key}Version=${val}`)
    .join("&");
  if (showVolumeDownloadWarning) {
    Toast.info(messages["annotation.no_fallback_data_included"], { timeout: 12000 });
  }
  const downloadUrl = `/api/annotations/${annotationType}/${annotationId}/download?${possibleVersionString}`;
  const { buffer, headers } = await Request.receiveArraybuffer(downloadUrl, {
    extractHeaders: true,
  });
  // Using headers to determine the name and type of the file.
  const contentDispositionHeader = headers["content-disposition"];
  const filenameStartingPart = 'filename="';
  const filenameStartingPosition =
    contentDispositionHeader.indexOf(filenameStartingPart) + filenameStartingPart.length;
  const filenameEndPosition = contentDispositionHeader.indexOf('"', filenameStartingPosition + 1);
  const filename = contentDispositionHeader.substring(
    filenameStartingPosition,
    filenameEndPosition,
  );
  const blob = new Blob([buffer], { type: headers["content-type"] });
  saveAs(blob, filename);
}

// ### Datasets
export async function getDatasets(
  isUnreported: ?boolean,
): Promise<Array<APIMaybeUnimportedDataset>> {
  const parameters = isUnreported != null ? `?isUnreported=${String(isUnreported)}` : "";
  const datasets = await Request.receiveJSON(`/api/datasets${parameters}`);
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

export function getDatasetViewConfiguration(
  datasetId: APIDatasetId,
  displayedVolumeTracings: Array<string>,
): Promise<Object> {
  return Request.sendJSONReceiveJSON(
    `/api/dataSetConfigurations/${datasetId.owningOrganization}/${datasetId.name}`,
    {
      data: displayedVolumeTracings,
      method: "POST",
    },
  );
}

export function updateDatasetConfiguration(
  datasetId: APIDatasetId,
  datasetConfig: DatasetConfiguration,
  options?: RequestOptions = {},
): Object {
  return Request.sendJSONReceiveJSON(
    `/api/dataSetConfigurations/${datasetId.owningOrganization}/${datasetId.name}`,
    {
      ...options,
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

export function addDataset(datasetConfig: DatasetConfig): Promise<void> {
  return doWithToken(token =>
    Request.sendMultipartFormReceiveJSON(`/data/datasets?token=${token}`, {
      data: datasetConfig,
      host: datasetConfig.datastore,
    }),
  );
}

export function addWkConnectDataset(
  datastoreHost: string,
  datasetConfig: WkConnectDatasetConfig,
): Promise<void> {
  return doWithToken(token =>
    Request.sendJSONReceiveJSON(`/data/datasets?token=${token}`, {
      data: datasetConfig,
      host: datastoreHost,
      method: "POST",
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
    return ex.messages.map(msg => Object.values(msg)[0]).join(". ");
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
  layerName?: string,
): Promise<void> {
  await doWithToken(token =>
    Request.triggerRequest(
      `/data/triggers/reload/${datasetId.owningOrganization}/${datasetId.name}?token=${token}${
        layerName ? `&layerName=${layerName}` : ""
      }`,
      {
        host: datastoreHost,
      },
    ),
  );
}

export async function deleteDatasetOnDisk(
  datastoreHost: string,
  datasetId: APIDatasetId,
): Promise<void> {
  await doWithToken(token =>
    Request.triggerRequest(
      `/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/deleteOnDisk?token=${token}`,
      {
        host: datastoreHost,
        method: "DELETE",
      },
    ),
  );
}

export async function triggerDatasetClearThumbnailCache(datasetId: APIDatasetId): Promise<void> {
  await Request.triggerRequest(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/clearThumbnailCache`,
    { method: "PUT" },
  );
}

export async function clearCache(dataset: APIMaybeUnimportedDataset, layerName?: string) {
  return Promise.all([
    triggerDatasetClearCache(dataset.dataStore.url, dataset, layerName),
    triggerDatasetClearThumbnailCache(dataset),
  ]);
}

export async function getDatasetSharingToken(
  datasetId: APIDatasetId,
  options?: RequestOptions,
): Promise<string> {
  const { sharingToken } = await Request.receiveJSON(
    `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/sharingToken`,
    options,
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

export async function findDataPositionForLayer(
  datastoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
): Promise<{ position: ?Vector3, resolution: ?Vector3 }> {
  const { position, resolution } = await doWithToken(token =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/layers/${layerName}/findData?token=${token}`,
    ),
  );
  return { position, resolution };
}

export async function findDataPositionForVolumeTracing(
  tracingstoreUrl: string,
  tracingId: string,
): Promise<{ position: ?Vector3, resolution: ?Vector3 }> {
  const { position, resolution } = await doWithToken(token =>
    Request.receiveJSON(`${tracingstoreUrl}/tracings/volume/${tracingId}/findData?token=${token}`),
  );
  return { position, resolution };
}

export async function getHistogramForLayer(
  datastoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
): Promise<APIHistogramData> {
  return doWithToken(token =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/layers/${layerName}/histogram?token=${token}`,
    ),
  );
}

export async function getMappingsForDatasetLayer(
  datastoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
): Promise<Array<string>> {
  return doWithToken(token =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/layers/${layerName}/mappings?token=${token}`,
    ),
  );
}

export async function getAgglomeratesForDatasetLayer(
  datastoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
): Promise<Array<string>> {
  return doWithToken(token =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/layers/${layerName}/agglomerates?token=${token}`,
    ),
  );
}

export function getSampleDatasets(
  datastoreUrl: string,
  organizationName: string,
): Promise<Array<APISampleDataset>> {
  return doWithToken(token =>
    Request.receiveJSON(`${datastoreUrl}/data/datasets/sample/${organizationName}?token=${token}`),
  );
}

export async function triggerSampleDatasetDownload(
  datastoreUrl: string,
  organizationName: string,
  datasetName: string,
) {
  await doWithToken(token =>
    Request.triggerRequest(
      `${datastoreUrl}/data/datasets/sample/${organizationName}/${datasetName}/download?token=${token}`,
      { method: "POST" },
    ),
  );
}

export async function getMeanAndStdDevFromDataset(
  datastoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
): Promise<{ mean: number, stdDev: number }> {
  return doWithToken(token =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/layers/${layerName}/colorStatistics?token=${token}`,
    ),
  );
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
export function getActiveUser(options?: RequestOptions): Promise<APIUser> {
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
export async function getDefaultOrganization(): Promise<?APIOrganization> {
  // Only returns an organization if the webKnossos instance only has one organization
  return Request.receiveJSON("/api/organizations/default");
}

export function getOrganization(organizationName: string): Promise<APIOrganization> {
  return Request.receiveJSON(`/api/organizations/${organizationName}`);
}

export async function checkAnyOrganizationExists(): Promise<boolean> {
  return !(await Request.receiveJSON("/api/organizationsIsEmpty"));
}

// ### BuildInfo webknossos
export function getBuildInfo(): Promise<APIBuildInfo> {
  return Request.receiveJSON("/api/buildinfo", { doNotInvestigate: true });
}

// ### BuildInfo datastore
export function getDataStoreBuildInfo(dataStoreUrl: string): Promise<APIBuildInfo> {
  return Request.receiveJSON(`${dataStoreUrl}/api/buildinfo`, { doNotInvestigate: true });
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

export async function isInMaintenance(): Promise<boolean> {
  const info = await Request.receiveJSON("/api/maintenance", { doNotInvestigate: true });
  return info.isMaintenance;
}

export function setMaintenance(bool: boolean): Promise<void> {
  return Request.triggerRequest("/api/maintenance", { method: bool ? "POST" : "DELETE" });
}
window.setMaintenance = setMaintenance;

// ### Meshes

type MeshMetaDataForCreation = $Diff<MeshMetaData, {| id: string |}>;

export async function createMesh(
  metadata: MeshMetaDataForCreation,
  data: ArrayBuffer,
): Promise<MeshMetaData> {
  const mesh = await createMeshMetaData(metadata);
  await updateMeshData(mesh.id, data);
  return mesh;
}

function createMeshMetaData(metadata: MeshMetaDataForCreation): Promise<MeshMetaData> {
  return Request.sendJSONReceiveJSON("/api/meshes", { method: "POST", data: metadata });
}

export async function updateMeshMetaData(metadata: RemoteMeshMetaData): Promise<void> {
  return Request.sendJSONReceiveJSON(`/api/meshes/${metadata.id}`, {
    method: "PUT",
    data: metadata,
  });
}

export async function updateMeshData(id: string, data: ArrayBuffer): Promise<void> {
  return Request.sendJSONReceiveJSON(`/api/meshes/${id}/data`, { method: "PUT", data });
}

export function deleteMesh(id: string): Promise<void> {
  return Request.triggerRequest(`/api/meshes/${id}`, { method: "DELETE" });
}

export function getMeshMetaData(id: string): Promise<MeshMetaData> {
  return Request.receiveJSON(`/api/meshes/${id}`);
}

export function getMeshData(id: string): Promise<ArrayBuffer> {
  return Request.receiveArraybuffer(`/api/meshes/${id}/data`);
}

// These parameters are bundled into an object to avoid that the computeIsosurface function
// receives too many parameters, since this doesn't play well with the saga typings.
type IsosurfaceRequest = {
  position: Vector3,
  zoomStep: number,
  segmentId: number,
  voxelDimensions: Vector3,
  cubeSize: Vector3,
  scale: Vector3,
};

export function computeIsosurface(
  requestUrl: string,
  layer: DataLayer,
  isosurfaceRequest: IsosurfaceRequest,
): Promise<{ buffer: ArrayBuffer, neighbors: Array<number> }> {
  const { position, zoomStep, segmentId, voxelDimensions, cubeSize, scale } = isosurfaceRequest;
  return doWithToken(async token => {
    const { buffer, headers } = await Request.sendJSONReceiveArraybufferWithHeaders(
      `${requestUrl}/isosurface?token=${token}`,
      {
        data: {
          // The back-end needs a small padding at the border of the
          // bounding box to calculate the isosurface. This padding
          // is added here to the position and bbox size.
          position: V3.toArray(V3.sub(position, voxelDimensions)),
          cubeSize: V3.toArray(V3.add(cubeSize, voxelDimensions)),
          zoomStep,
          // Segment to build isosurface for
          segmentId,
          // Name of mapping to apply before building isosurface (optional)
          mapping: layer.activeMapping,
          mappingType: layer.activeMappingType,
          // "size" of each voxel (i.e., only every nth voxel is considered in each dimension)
          voxelDimensions,
          scale,
        },
      },
    );
    const neighbors = Utils.parseAsMaybe(headers.neighbors).getOrElse([]);

    return { buffer, neighbors };
  });
}

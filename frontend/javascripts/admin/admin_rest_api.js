// @flow
import { saveAs } from "file-saver";
import ResumableJS from "resumablejs";
import _ from "lodash";

import {
  type APIActiveUser,
  type APIAnnotation,
  type APIAnnotationCompact,
  type APIAnnotationType,
  APIAnnotationTypeEnum,
  type APIAnnotationVisibility,
  type APIAnnotationWithTask,
  type APIBuildInfo,
  type APIDataSource,
  type APIDataSourceWithMessages,
  type APIDataStore,
  type APIDataset,
  type APIDatasetId,
  type APIFeatureToggles,
  type APIHistogramData,
  type APIJob,
  type APIJobCeleryState,
  type APIJobManualState,
  type APIJobState,
  type APIMapping,
  type APIMaybeUnimportedDataset,
  type APIOpenTasksReport,
  type APIOrganization,
  type APIProject,
  type APIProjectCreator,
  type APIProjectProgressReport,
  type APIProjectUpdater,
  type APIProjectWithAssignments,
  type APIResolutionRestrictions,
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
  type APIUpdateActionBatch,
  type APIUser,
  type APIUserLoggedTime,
  type APIUserTheme,
  type AnnotationLayerDescriptor,
  type EditableLayerProperties,
  type ExperienceDomainList,
  type MeshMetaData,
  type RemoteMeshMetaData,
  type ServerTracing,
  type TracingType,
  type WkConnectDatasetConfig,
} from "types/api_flow_types";
import { ControlModeEnum, type Vector3, type Vector6 } from "oxalis/constants";
import type {
  DatasetConfiguration,
  Tracing,
  TraceOrViewCommand,
  AnnotationType,
  ActiveMappingInfo,
  VolumeTracing,
} from "oxalis/store";
import type { NewTask, TaskCreationResponseContainer } from "admin/task/task_create_bulk_view";
import type { QueryObject } from "admin/task/task_search_form";
import { V3 } from "libs/mjs";
import type { Versions } from "oxalis/view/version_view";
import { enforceValidatedDatasetViewConfiguration } from "types/schemas/dataset_view_configuration_defaults";
import { parseProtoTracing } from "oxalis/model/helpers/proto_helpers";
import Request, { type RequestOptions } from "libs/request";
import Toast, { type Message } from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import window, { location } from "libs/window";

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

export function sendAnalyticsEvent(eventType: string, eventProperties: {} = {}): void {
  // Note that the Promise from sendJSONReceiveJSON is not awaited or returned here,
  // since failing analytics events should not have an impact on the application logic.
  Request.sendJSONReceiveJSON(`/api/analytics/${eventType}`, {
    method: "POST",
    data: eventProperties,
    showErrorToast: false,
  });
}

export function sendFailedRequestAnalyticsEvent(
  requestType: string,
  error: Object,
  requestProperties: {},
): void {
  const eventProperties = {
    request_type: requestType,
    request_properties: requestProperties,
    status: error.status || 0,
    messages: error.messages || [],
  };
  sendAnalyticsEvent("request_failed", eventProperties);
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

export function updateNovelUserExperienceInfos(
  user: APIUser,
  novelUserExperienceShape: Object,
): [APIUser, Promise<APIUser>] {
  const novelUserExperienceInfos = {
    ...user.novelUserExperienceInfos,
    ...novelUserExperienceShape,
  };
  const newUserSync = {
    ...user,
    novelUserExperienceInfos,
  };
  const newUserAsync = Request.sendJSONReceiveJSON(
    `/api/users/${user.id}/novelUserExperienceInfos`,
    {
      method: "PUT",
      data: novelUserExperienceInfos,
    },
  );

  return [newUserSync, newUserAsync];
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

export function updateSelectedThemeOfUser(
  userId: string,
  selectedTheme: APIUserTheme,
): Promise<APIUser> {
  return Request.sendJSONReceiveJSON(`/api/users/${userId}/selectedTheme`, {
    method: "PUT",
    data: JSON.stringify(selectedTheme),
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

export async function getProject(projectId: string): Promise<APIProject> {
  const project = await Request.receiveJSON(`/api/projects/${projectId}`);
  return transformProject(project);
}

export async function increaseProjectTaskInstances(
  projectId: string,
  delta?: number = 1,
): Promise<APIProjectWithAssignments> {
  const project = await Request.receiveJSON(
    `/api/projects/${projectId}/incrementEachTasksInstances?delta=${delta}`,
    { method: "PATCH" },
  );
  return transformProject(project);
}

export function deleteProject(projectId: string): Promise<void> {
  return Request.receiveJSON(`/api/projects/${projectId}`, {
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

export function updateProject(projectId: string, project: APIProjectUpdater): Promise<APIProject> {
  const transformedProject = Object.assign({}, project, {
    expectedTime: Utils.minutesToMilliseconds(project.expectedTime),
  });

  return Request.sendJSONReceiveJSON(`/api/projects/${projectId}`, {
    method: "PUT",
    data: transformedProject,
  });
}

export async function pauseProject(projectId: string): Promise<APIProject> {
  const project = await Request.receiveJSON(`/api/projects/${projectId}/pause`, {
    method: "PATCH",
  });
  return transformProject(project);
}

export async function resumeProject(projectId: string): Promise<APIProject> {
  const project = await Request.receiveJSON(`/api/projects/${projectId}/resume`, {
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
  projectId: string,
  userId: string,
): Promise<APIAnnotation> {
  return Request.sendJSONReceiveJSON(`/api/projects/${projectId}/transferActiveTasks`, {
    data: {
      userId,
    },
    method: "POST",
  });
}

export async function getUsersWithActiveTasks(projectId: string): Promise<Array<APIActiveUser>> {
  return Request.receiveJSON(`/api/projects/${projectId}/usersWithActiveTasks`);
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

export function updateAnnotationLayer(
  annotationId: string,
  annotationType: APIAnnotationType,
  tracingId: string,
  layerProperties: EditableLayerProperties,
): Promise<{ name: ?string }> {
  return Request.sendJSONReceiveJSON(
    `/api/annotations/${annotationType}/${annotationId}/editLayer/${tracingId}`,
    {
      method: "PATCH",
      data: layerProperties,
    },
  );
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

export function getEmptySandboxAnnotationInformation(
  datasetId: APIDatasetId,
  tracingType: TracingType,
  sharingToken?: ?string,
  options?: RequestOptions = {},
): Promise<APIAnnotation> {
  const sharingTokenSuffix = sharingToken != null ? `?sharingToken=${sharingToken}` : "";
  const infoUrl = `/api/datasets/${datasetId.owningOrganization}/${
    datasetId.name
  }/sandbox/${tracingType}${sharingTokenSuffix}`;
  return Request.receiveJSON(infoUrl, options);
}

export function createExplorational(
  datasetId: APIDatasetId,
  typ: TracingType,
  fallbackLayerName: ?string,
  resolutionRestrictions: ?APIResolutionRestrictions,
  options?: RequestOptions = {},
): Promise<APIAnnotation> {
  const url = `/api/datasets/${datasetId.owningOrganization}/${datasetId.name}/createExplorational`;

  let layers = [];
  if (typ === "skeleton") {
    layers = [{ typ: "Skeleton", name: "Skeleton" }];
  } else if (typ === "volume") {
    layers = [
      { typ: "Volume", name: "Volume", fallbackLayerName, resolutionRestrictions },
      // { typ: "Volume", name: "Volume 2" },
    ];
  } else {
    layers = [
      { typ: "Skeleton", name: "Skeleton" },
      { typ: "Volume", name: "Volume", fallbackLayerName, resolutionRestrictions },
      // { typ: "Volume", name: "Volume 2" },
    ];
  }

  return Request.sendJSONReceiveJSON(url, {
    ...options,
    data: layers,
  });
}

export async function getTracingsForAnnotation(
  annotation: APIAnnotation,
  versions?: Versions = {},
): Promise<Array<ServerTracing>> {
  const skeletonLayers = annotation.annotationLayers.filter(layer => layer.typ === "Skeleton");
  const fullAnnotationLayers = await Promise.all(
    annotation.annotationLayers.map(layer =>
      getTracingForAnnotationType(annotation, layer, versions),
    ),
  );

  if (skeletonLayers.length > 1) {
    throw new Error(
      "Having more than one skeleton layer is currently not supported by webKnossos.",
    );
  }

  return fullAnnotationLayers;
}

function extractVersion(
  versions: Versions,
  tracingId: string,
  typ: "Volume" | "Skeleton",
): ?number {
  if (typ === "Skeleton") {
    return versions.skeleton;
  } else if (versions.volumes != null) {
    return versions.volumes[tracingId];
  }
  return null;
}

export async function getTracingForAnnotationType(
  annotation: APIAnnotation,
  annotationLayerDescriptor: AnnotationLayerDescriptor,
  versions?: Versions = {},
): Promise<ServerTracing> {
  const { tracingId, typ } = annotationLayerDescriptor;

  const version = extractVersion(versions, tracingId, typ);
  const tracingType = typ.toLowerCase();
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

  // Additionally, we assign the typ property (skeleton vs volume).
  // Flow complains since we don't doublecheck that we assign the correct type depending
  // on the tracing's structure.
  // $FlowIgnore[incompatible-type]
  tracing.typ = typ;

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

export async function importVolumeTracing(
  tracing: Tracing,
  volumeTracing: VolumeTracing,
  dataFile: File,
): Promise<number> {
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

export function convertToHybridTracing(
  annotationId: string,
  fallbackLayerName: ?string,
): Promise<void> {
  return Request.receiveJSON(`/api/annotations/Explorational/${annotationId}/makeHybrid`, {
    method: "PATCH",
    fallbackLayerName,
  });
}

export async function downloadNml(
  annotationId: string,
  annotationType: APIAnnotationType,
  showVolumeFallbackDownloadWarning?: boolean = false,
  versions?: Versions = {},
) {
  const possibleVersionString = Object.entries(versions)
    // $FlowIssue[incompatible-type] Flow returns val as mixed here due to the use of Object.entries
    .map(([key, val]) => `${key}Version=${val}`)
    .join("&");
  if (showVolumeFallbackDownloadWarning) {
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

export async function unlinkFallbackSegmentation(
  annotationId: string,
  annotationType: APIAnnotationType,
  tracingId: string,
): Promise<void> {
  await Request.receiveJSON(
    `/api/annotations/${annotationType}/${annotationId}/unlinkFallback?tracingId=${tracingId}`,
    {
      method: "PATCH",
    },
  );
}

// When the annotation is open, please use the corresponding method
// in api_latest.js. It will take care of saving the annotation and
// reloading it.
export async function downsampleSegmentation(
  annotationId: string,
  annotationType: APIAnnotationType,
  tracingId: string,
): Promise<void> {
  await Request.receiveJSON(
    `/api/annotations/${annotationType}/${annotationId}/downsample?tracingId=${tracingId}`,
    {
      method: "PATCH",
    },
  );
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

export async function getJobs(): Promise<Array<APIJob>> {
  const jobs = await Request.receiveJSON("/api/jobs");
  assertResponseLimit(jobs);
  return jobs.map(job => ({
    id: job.id,
    type: job.command,
    datasetName: job.commandArgs.kwargs.dataset_name,
    organizationName: job.commandArgs.kwargs.organization_name,
    layerName: job.commandArgs.kwargs.layer_name,
    boundingBox: job.commandArgs.kwargs.bbox,
    exportFileName: job.commandArgs.kwargs.export_file_name,
    tracingId: job.commandArgs.kwargs.volume_tracing_id,
    annotationId: job.commandArgs.kwargs.annotation_id,
    annotationType: job.commandArgs.kwargs.annotation_type,
    state: adaptJobState(job.command, job.celeryInfo.state, job.manualState),
    manualState: job.manualState,
    result: job.celeryInfo.result,
    createdAt: job.created,
  }));
}

function adaptJobState(
  command: string,
  celeryState: APIJobCeleryState,
  manualState: APIJobManualState,
): APIJobState {
  if (manualState) {
    return manualState;
  } else if (celeryState === "FAILURE" && isManualPassJobType(command)) {
    return "MANUAL";
  }
  return celeryState || "UNKNOWN";
}

function isManualPassJobType(command: string) {
  return ["convert_to_wkw"].includes(command);
}

export async function startConvertToWkwJob(
  datasetName: string,
  organizationName: string,
  scale: Vector3,
): Promise<Array<APIJob>> {
  return Request.receiveJSON(
    `/api/jobs/run/convertToWkw/${organizationName}/${datasetName}?scale=${scale.toString()}`,
  );
}

export async function startExportTiffJob(
  datasetName: string,
  organizationName: string,
  bbox: Vector6,
  layerName: ?string,
  tracingId: ?string,
  annotationId: ?string,
  annotationType: ?APIAnnotationType,
  mappingName: ?string,
  mappingType: ?string,
  hideUnmappedIds: ?boolean,
  tracingVersion: ?number = null,
): Promise<Array<APIJob>> {
  const layerNameSuffix = layerName != null ? `&layerName=${layerName}` : "";
  const tracingIdSuffix = tracingId != null ? `&tracingId=${tracingId}` : "";
  const annotationIdSuffix = annotationId != null ? `&annotationId=${annotationId}` : "";
  const annotationTypeSuffix = annotationType != null ? `&annotationType=${annotationType}` : "";
  const tracingVersionSuffix = tracingVersion != null ? `&tracingVersion=${tracingVersion}` : "";
  const mappingNameSuffix = mappingName != null ? `&mappingName=${mappingName}` : "";
  const mappingTypeSuffix = mappingType != null ? `&mappingType=${mappingType}` : "";
  const hideUnmappedIdsSuffix =
    hideUnmappedIds != null ? `&hideUnmappedIds=${hideUnmappedIds.toString()}` : "";
  return Request.receiveJSON(
    `/api/jobs/run/exportTiff/${organizationName}/${datasetName}?bbox=${bbox.join(
      ",",
    )}${layerNameSuffix}${tracingIdSuffix}${tracingVersionSuffix}${annotationIdSuffix}${annotationTypeSuffix}${mappingNameSuffix}${mappingTypeSuffix}${hideUnmappedIdsSuffix}`,
  );
}

export function startComputeMeshFileJob(
  organizationName: string,
  datasetName: string,
  layerName: string,
  mag: Vector3,
  agglomerateView?: string,
): Promise<APIJob> {
  return Request.receiveJSON(
    `/api/jobs/run/computeMeshFile/${organizationName}/${datasetName}?layerName=${layerName}&mag=${mag.join(
      "-",
    )}${agglomerateView ? `&agglomerateView=${agglomerateView}` : ""}`,
  );
}

export function startNucleiInferralJob(
  organizationName: string,
  datasetName: string,
  layerName: string,
): Promise<APIJob> {
  return Request.receiveJSON(
    `/api/jobs/run/inferNuclei/${organizationName}/${datasetName}?layerName=${layerName}`,
  );
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

export async function getDatasetViewConfiguration(
  dataset: APIDataset,
  displayedVolumeTracings: Array<string>,
  sharingToken?: ?string,
): Promise<DatasetConfiguration> {
  const sharingTokenSuffix = sharingToken != null ? `?sharingToken=${sharingToken}` : "";
  const settings = await Request.sendJSONReceiveJSON(
    `/api/dataSetConfigurations/${dataset.owningOrganization}/${dataset.name}${sharingTokenSuffix}`,
    {
      data: displayedVolumeTracings,
      method: "POST",
    },
  );

  enforceValidatedDatasetViewConfiguration(settings, dataset);
  return settings;
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

export function createResumableUpload(
  datasetId: APIDatasetId,
  datastoreUrl: string,
  totalFileCount: number,
  uploadId: string,
): Promise<*> {
  const generateUniqueIdentifier = file => {
    if (file.path == null) {
      // file.path should be set by react-dropzone (which uses file-selector::toFileWithPath).
      // In case this "enrichment" of the file should change at some point (e.g., due to library changes),
      // throw an error.
      throw new Error("file.path is undefined.");
    }
    return `${uploadId}/${file.path || file.name}`;
  };

  const additionalParameters = {
    ...datasetId,
    totalFileCount,
  };

  return doWithToken(
    token =>
      new ResumableJS({
        testChunks: false,
        target: `${datastoreUrl}/data/datasets?token=${token}`,
        query: additionalParameters,
        chunkSize: 10 * 1024 * 1024, // set chunk size to 10MB
        permanentErrors: [400, 403, 404, 409, 415, 500, 501],
        // Only increase this value when https://github.com/scalableminds/webknossos/issues/5056 is fixed
        simultaneousUploads: 1,
        chunkRetryInterval: 2000,
        maxChunkRetries: undefined,
        generateUniqueIdentifier,
      }),
  );
}

export function finishDatasetUpload(datastoreHost: string, uploadInformation: {}): Promise<void> {
  return doWithToken(token =>
    Request.sendJSONReceiveJSON(`/data/datasets/finishUpload?token=${token}`, {
      data: uploadInformation,
      host: datastoreHost,
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

export function fetchMapping(
  datastoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
  mappingName: string,
): Promise<APIMapping> {
  return doWithToken(token =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/layers/${layerName}/mappings/${mappingName}?token=${token}`,
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

// ### Time Tracking
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

export function joinOrganization(inviteToken: string): Promise<void> {
  return Request.triggerRequest(`/api/auth/joinOrganization/${inviteToken}`, { method: "POST" });
}

export async function switchToOrganization(organizationName: string): Promise<void> {
  await Request.triggerRequest(`/api/auth/switchOrganization/${organizationName}`, {
    method: "POST",
  });
  location.reload();
}

export function getUsersOrganizations(): Promise<Array<APIOrganization>> {
  return Request.receiveJSON("/api/organizations");
}

export function getOrganizationByInvite(inviteToken: string): Promise<APIOrganization> {
  return Request.receiveJSON(`/api/organizations/byInvite/${inviteToken}`, {
    showErrorToast: false,
  });
}

export function sendInvitesForOrganization(
  recipients: Array<string>,
  autoActivate: boolean,
): Promise<void> {
  return Request.sendJSONReceiveJSON("/api/auth/sendInvites", {
    method: "POST",
    data: { recipients, autoActivate },
  });
}

export function getOrganization(organizationName: string): Promise<APIOrganization> {
  return Request.receiveJSON(`/api/organizations/${organizationName}`);
}

export async function checkAnyOrganizationExists(): Promise<boolean> {
  return !(await Request.receiveJSON("/api/organizationsIsEmpty"));
}

export async function deleteOrganization(organizationName: string): Promise<void> {
  return Request.triggerRequest(`/api/organizations/${organizationName}`, {
    method: "DELETE",
  });
}

export async function updateOrganization(
  organizationName: string,
  displayName: string,
  newUserMailingList: string,
): Promise<APIOrganization> {
  return Request.sendJSONReceiveJSON(`/api/organizations/${organizationName}`, {
    method: "PATCH",
    data: { displayName, newUserMailingList },
  });
}

export async function isDatasetAccessibleBySwitching(
  annotationType: AnnotationType,
  commandType: TraceOrViewCommand,
): Promise<?APIOrganization> {
  if (commandType.type === ControlModeEnum.TRACE) {
    return Request.receiveJSON(
      `/api/auth/accessibleBySwitching?annotationTyp=${annotationType}&annotationId=${
        commandType.annotationId
      }`,
    );
  } else {
    return Request.receiveJSON(
      `/api/auth/accessibleBySwitching?organizationName=${
        commandType.owningOrganization
      }&dataSetName=${commandType.name}`,
    );
  }
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
  mappingInfo: ActiveMappingInfo,
  isosurfaceRequest: IsosurfaceRequest,
): Promise<{ buffer: ArrayBuffer, neighbors: Array<number> }> {
  const { position, zoomStep, segmentId, voxelDimensions, cubeSize, scale } = isosurfaceRequest;
  return doWithToken(async token => {
    const { buffer, headers } = await Request.sendJSONReceiveArraybufferWithHeaders(
      `${requestUrl}/isosurface?token=${token}`,
      {
        data: {
          // The back-end needs a small padding at the border of the
          // bounding box to calculate the mesh. This padding
          // is added here to the position and bbox size.
          position: V3.toArray(V3.sub(position, voxelDimensions)),
          cubeSize: V3.toArray(V3.add(cubeSize, voxelDimensions)),
          zoomStep,
          // Segment to build mesh for
          segmentId,
          // Name of mapping to apply before building mesh (optional)
          mapping: mappingInfo.mappingName,
          mappingType: mappingInfo.mappingType,
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

export function getAgglomerateSkeleton(
  dataStoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
  mappingId: string,
  agglomerateId: number,
): Promise<ArrayBuffer> {
  return doWithToken(token =>
    Request.receiveArraybuffer(
      `${dataStoreUrl}/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/layers/${layerName}/agglomerates/${mappingId}/skeleton/${agglomerateId}?token=${token}`,
      // The webworker code cannot do proper error handling and always expects an array buffer from the server.
      // In this case, the server sends an error json instead of an array buffer sometimes. Therefore, don't use the webworker code.
      { useWebworkerForArrayBuffer: false },
    ),
  );
}

export function getMeshfilesForDatasetLayer(
  dataStoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
): Promise<Array<string>> {
  return doWithToken(token =>
    Request.receiveJSON(
      `${dataStoreUrl}/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/layers/${layerName}/meshes?token=${token}`,
    ),
  );
}

export function getMeshfileChunksForSegment(
  dataStoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
  meshFile: string,
  segmentId: number,
): Promise<Array<Vector3>> {
  return doWithToken(token =>
    Request.sendJSONReceiveJSON(
      `${dataStoreUrl}/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/layers/${layerName}/meshes/chunks?token=${token}`,
      {
        data: {
          meshFile,
          segmentId,
        },
        showErrorToast: false,
      },
    ),
  );
}

export function getMeshfileChunkData(
  dataStoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
  meshFile: string,
  segmentId: number,
  position: Vector3,
): Promise<ArrayBuffer> {
  return doWithToken(async token => {
    const data = await Request.sendJSONReceiveArraybufferWithHeaders(
      `${dataStoreUrl}/data/datasets/${datasetId.owningOrganization}/${
        datasetId.name
      }/layers/${layerName}/meshes/chunks/data?token=${token}`,
      {
        data: {
          meshFile,
          segmentId,
          position,
        },
        useWebworkerForArrayBuffer: false,
      },
    );
    return data;
  });
}

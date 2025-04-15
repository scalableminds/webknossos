import dayjs from "dayjs";
import { V3 } from "libs/mjs";
import type { RequestOptions } from "libs/request";
import Request from "libs/request";
import type { Message } from "libs/toast";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import window, { location } from "libs/window";
import _ from "lodash";
import messages from "messages";
import type { AnnotationTypeFilterEnum, LOG_LEVELS, Vector3 } from "oxalis/constants";
import Constants, { ControlModeEnum, AnnotationStateFilterEnum } from "oxalis/constants";
import type BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import {
  parseProtoAnnotation,
  parseProtoListOfLong,
  parseProtoTracing,
  serializeProtoListOfLong,
} from "oxalis/model/helpers/proto_helpers";
import type {
  DatasetConfiguration,
  Mapping,
  MappingType,
  NumberLike,
  PartialDatasetConfiguration,
  StoreAnnotation,
  TraceOrViewCommand,
  UserConfiguration,
  VolumeTracing,
} from "oxalis/store";
import ResumableJS from "resumablejs";
import {
  type APIAnnotation,
  type APIAnnotationInfo,
  type APIAnnotationType,
  type APIAnnotationVisibility,
  type APIAvailableTasksReport,
  type APIBuildInfo,
  type APICompoundType,
  type APIConnectomeFile,
  type APIDataSource,
  type APIDataSourceId,
  type APIDataStore,
  type APIDataset,
  type APIDatasetCompact,
  type APIFeatureToggles,
  type APIHistogramData,
  type APIMagRestrictions,
  type APIMapping,
  type APIMaybeUnimportedDataset,
  type APIMeshFile,
  type APIOrganization,
  type APIOrganizationCompact,
  type APIPricingPlanStatus,
  type APIProject,
  type APIProjectCreator,
  type APIProjectProgressReport,
  type APIProjectUpdater,
  type APIProjectWithStatus,
  type APIPublication,
  type APIScript,
  type APIScriptCreator,
  type APIScriptUpdater,
  type APITaskType,
  type APITeam,
  type APITimeInterval,
  type APITimeTrackingPerAnnotation,
  type APITimeTrackingPerUser,
  type APITimeTrackingSpan,
  type APITracingStore,
  type APITracingStoreAnnotation,
  type APIUpdateActionBatch,
  type APIUser,
  type APIUserCompact,
  type APIUserLoggedTime,
  type APIUserTheme,
  type AdditionalCoordinate,
  type AnnotationLayerDescriptor,
  AnnotationLayerEnum,
  type AnnotationViewConfiguration,
  type ExperienceDomainList,
  type LayerLink,
  type MaintenanceInfo,
  type ServerEditableMapping,
  type ServerTracing,
  type ShortLink,
  type TracingType,
  type VoxelSize,
  type VoxelyticsChunkStatistics,
  type VoxelyticsLogLine,
  type VoxelyticsWorkflowListing,
  type VoxelyticsWorkflowReport,
  type ZarrPrivateLink,
} from "types/api_flow_types";
import type { ArbitraryObject } from "types/globals";
import { enforceValidatedDatasetViewConfiguration } from "types/schemas/dataset_view_configuration_defaults";
import type { DatasourceConfiguration } from "types/schemas/datasource.types";
import { assertResponseLimit } from "./api/api_utils";
import { getDatasetIdFromNameAndOrganization } from "./api/disambiguate_legacy_routes";
import { doWithToken } from "./api/token";

export * from "./api/token";
export * from "./api/jobs";
export * as meshApi from "./api/mesh";

type NewTeam = {
  readonly name: string;
};

export function sendAnalyticsEvent(
  eventType: string,
  eventProperties: Record<string, any> = {},
): void {
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
  error: Record<string, any>,
  requestProperties: ArbitraryObject,
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
export async function loginUser(formValues: {
  email: string;
  password: string;
}): Promise<[APIUser, APIOrganization]> {
  await Request.sendJSONReceiveJSON("/api/auth/login", {
    data: formValues,
  });
  const activeUser = await getActiveUser();
  const organization = await getOrganization(activeUser.organization);

  return [activeUser, organization];
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

export function updateUser(newUser: Partial<APIUser>): Promise<APIUser> {
  return Request.sendJSONReceiveJSON(`/api/users/${newUser.id}`, {
    method: "PATCH",
    data: newUser,
  });
}

export function updateNovelUserExperienceInfos(
  user: APIUser,
  novelUserExperienceShape: Record<string, any>,
): [APIUser, Promise<APIUser>] {
  const novelUserExperienceInfos = {
    ...user.novelUserExperienceInfos,
    ...novelUserExperienceShape,
  };
  const newUserSync = { ...user, novelUserExperienceInfos };
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
    data: {
      lastTaskTypeId,
    },
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
  await Request.receiveJSON("/api/auth/token", {
    method: "DELETE",
  });
}

// Used only by the webknossos-libs python client, but tested here in the snapshot tests.
export async function getLoggedTimes(userID: string): Promise<Array<APITimeInterval>> {
  const url = `/api/users/${userID}/loggedTime`;
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
  taskType: Omit<APITaskType, "id" | "teamName">,
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
  const teams = await Request.receiveJSON("/api/teams", {
    doNotInvestigate: true,
  });
  assertResponseLimit(teams);
  return teams;
}

export async function getEditableTeams(): Promise<Array<APITeam>> {
  const teams = await Request.receiveJSON("/api/teams?isEditable=true", {
    doNotInvestigate: true,
  });
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
function transformProject<T extends APIProject | APIProjectWithStatus>(response: T): T {
  return Object.assign({}, response, {
    expectedTime: Utils.millisecondsToMinutes(response.expectedTime),
  });
}

export async function getProjects(): Promise<Array<APIProject>> {
  const responses = await Request.receiveJSON("/api/projects");
  assertResponseLimit(responses);
  return responses.map(transformProject);
}
export async function getProjectsWithStatus(): Promise<Array<APIProjectWithStatus>> {
  const responses = await Request.receiveJSON("/api/projects/withStatus");
  assertResponseLimit(responses);
  return responses.map(transformProject);
}
export async function getProjectsForTaskType(
  taskTypeId: string,
): Promise<Array<APIProjectWithStatus>> {
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
  delta: number = 1,
): Promise<APIProjectWithStatus> {
  const project = await Request.receiveJSON(
    `/api/projects/${projectId}/incrementEachTasksInstances?delta=${delta}`,
    {
      method: "PATCH",
    },
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

// ### Private Links

export function createPrivateLink(
  annotationId: string,
  initialExpirationPeriodInDays: number = 30,
): Promise<ZarrPrivateLink> {
  return Request.sendJSONReceiveJSON("/api/zarrPrivateLinks", {
    data: {
      annotation: annotationId,
      expirationDateTime: dayjs().endOf("day").add(initialExpirationPeriodInDays, "days").valueOf(),
    },
  });
}

export function getPrivateLinksByAnnotation(annotationId: string): Promise<Array<ZarrPrivateLink>> {
  return Request.receiveJSON(`/api/zarrPrivateLinks/byAnnotation/${annotationId}`);
}

export function updatePrivateLink(link: ZarrPrivateLink): Promise<ZarrPrivateLink> {
  return Request.sendJSONReceiveJSON(`/api/zarrPrivateLinks/${link.id}`, {
    data: link,
    method: "PUT",
  });
}

export function deletePrivateLink(linkId: string): Promise<{
  messages: Array<Message>;
}> {
  return Request.receiveJSON(`/api/zarrPrivateLinks/${linkId}`, {
    method: "DELETE",
  });
}

// ### Annotations
export function getCompactAnnotationsForUser(
  userId: string,
  isFinished: boolean,
  pageNumber: number = 0,
): Promise<Array<APIAnnotationInfo>> {
  return Request.receiveJSON(
    `/api/users/${userId}/annotations?isFinished=${isFinished.toString()}&pageNumber=${pageNumber}`,
  );
}

export function getReadableAnnotations(
  isFinished: boolean,
  pageNumber: number = 0,
): Promise<Array<APIAnnotationInfo>> {
  return Request.receiveJSON(
    `/api/annotations/readable?isFinished=${isFinished.toString()}&pageNumber=${pageNumber}`,
  );
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
  name: string;
  visibility: APIAnnotationVisibility;
  tags: Array<string>;
  viewConfiguration?: AnnotationViewConfiguration;
};

export function editAnnotation(
  annotationId: string,
  annotationType: APIAnnotationType,
  data: Partial<EditableAnnotation>,
): Promise<void> {
  return Request.sendJSONReceiveJSON(`/api/annotations/${annotationType}/${annotationId}/edit`, {
    data,
    method: "PATCH",
  });
}

export function editLockedState(
  annotationId: string,
  annotationType: APIAnnotationType,
  isLockedByOwner: boolean,
): Promise<APIAnnotation> {
  return Request.receiveJSON(
    `/api/annotations/${annotationType}/${annotationId}/editLockedState?isLockedByOwner=${isLockedByOwner}`,
    {
      method: "PATCH",
    },
  );
}

export function setOthersMayEditForAnnotation(
  annotationId: string,
  annotationType: APIAnnotationType,
  othersMayEdit: boolean,
): Promise<void> {
  return Request.receiveJSON(
    `/api/annotations/${annotationType}/${annotationId}/othersMayEdit?othersMayEdit=${othersMayEdit}`,
    {
      method: "PATCH",
    },
  );
}

type AnnotationLayerCreateDescriptor = {
  typ: AnnotationLayerEnum;
  name: string | null | undefined;
  autoFallbackLayer?: boolean;
  fallbackLayerName?: string | null | undefined;
  mappingName?: string | null | undefined;
  magRestrictions?: APIMagRestrictions | null | undefined;
};

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
): Promise<{
  messages: Array<Message>;
}> {
  return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}`, {
    method: "DELETE",
  });
}

export function finishAllAnnotations(selectedAnnotationIds: Array<string>): Promise<{
  messages: Array<Message>;
}> {
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

export function duplicateAnnotation(
  annotationId: string,
  annotationType: APIAnnotationType,
): Promise<APIAnnotation> {
  const url = `/api/annotations/${annotationType}/${annotationId}/duplicate`;
  return Request.receiveJSON(url, {
    method: "POST",
  });
}

export async function getUnversionedAnnotationInformation(
  annotationId: string,
  options: RequestOptions = {},
): Promise<APIAnnotation> {
  const infoUrl = `/api/annotations/${annotationId}/info?timestamp=${Date.now()}`;
  const annotationWithMessages = await Request.receiveJSON(infoUrl, options);

  // Extract the potential messages property before returning the task to avoid
  // failing e2e tests in annotations.e2e.ts
  const { messages: _messages, ...annotation } = annotationWithMessages;
  return annotation;
}

export async function getAnnotationCompoundInformation(
  annotationId: string,
  annotationType: APICompoundType,
  options: RequestOptions = {},
): Promise<APIAnnotation> {
  const infoUrl = `/api/annotations/${annotationType}/${annotationId}/info?timestamp=${Date.now()}`;
  const annotationWithMessages = await Request.receiveJSON(infoUrl, options);

  // Extract the potential messages property before returning the task to avoid
  // failing e2e tests in annotations.e2e.ts
  const { messages: _messages, ...annotation } = annotationWithMessages;
  return annotation;
}

export function getEmptySandboxAnnotationInformation(
  datasetId: string,
  tracingType: TracingType,
  sharingToken?: string | null | undefined,
  options: RequestOptions = {},
): Promise<APIAnnotation> {
  const sharingTokenSuffix = sharingToken != null ? `?sharingToken=${sharingToken}` : "";
  const infoUrl = `/api/datasets/${datasetId}/sandbox/${tracingType}${sharingTokenSuffix}`;
  return Request.receiveJSON(infoUrl, options);
}

export function createExplorational(
  datasetId: string,
  typ: TracingType,
  autoFallbackLayer: boolean,
  fallbackLayerName?: string | null | undefined,
  mappingName?: string | null | undefined,
  magRestrictions?: APIMagRestrictions | null | undefined,
  options: RequestOptions = {},
): Promise<APIAnnotation> {
  const url = `/api/datasets/${datasetId}/createExplorational`;
  let layers: Array<AnnotationLayerCreateDescriptor> = [];

  if (typ === "skeleton") {
    layers = [
      {
        typ: AnnotationLayerEnum.Skeleton,
        name: "Skeleton",
      },
    ];
  } else if (typ === "volume") {
    layers = [
      {
        typ: AnnotationLayerEnum.Volume,
        name: fallbackLayerName,
        fallbackLayerName,
        autoFallbackLayer,
        mappingName,
        magRestrictions,
      },
    ];
  } else {
    layers = [
      {
        typ: AnnotationLayerEnum.Skeleton,
        name: "Skeleton",
      },
      {
        typ: AnnotationLayerEnum.Volume,
        name: fallbackLayerName,
        fallbackLayerName,
        autoFallbackLayer,
        mappingName,
        magRestrictions,
      },
    ];
  }

  return Request.sendJSONReceiveJSON(url, { ...options, data: layers });
}

export async function getTracingsForAnnotation(
  annotation: APIAnnotation,
  version?: number | null | undefined,
): Promise<Array<ServerTracing>> {
  const skeletonLayers = annotation.annotationLayers.filter(
    (layer) => layer.typ === AnnotationLayerEnum.Skeleton,
  );
  const fullAnnotationLayers = await Promise.all(
    annotation.annotationLayers.map((layer) =>
      getTracingForAnnotationType(annotation, layer, version),
    ),
  );

  if (skeletonLayers.length > 1) {
    throw new Error(
      "Having more than one skeleton layer is currently not supported by WEBKNOSSOS.",
    );
  }

  return fullAnnotationLayers;
}

export async function acquireAnnotationMutex(
  annotationId: string,
): Promise<{ canEdit: boolean; blockedByUser: APIUserCompact | undefined | null }> {
  const { canEdit, blockedByUser } = await Request.receiveJSON(
    `/api/annotations/${annotationId}/acquireMutex`,
    {
      method: "POST",
    },
  );
  return { canEdit, blockedByUser };
}

export async function getTracingForAnnotationType(
  annotation: APIAnnotation,
  annotationLayerDescriptor: AnnotationLayerDescriptor,
  version?: number | null | undefined,
): Promise<ServerTracing> {
  const { tracingId, typ } = annotationLayerDescriptor;
  const tracingType = typ.toLowerCase() as "skeleton" | "volume";
  const params = new URLSearchParams({ annotationId: annotation.id });
  if (version != null) {
    params.set("version", version.toString());
  }
  const tracingArrayBuffer = await doWithToken((token) => {
    params.set("token", token);
    return Request.receiveArraybuffer(
      `${annotation.tracingStore.url}/tracings/${tracingType}/${tracingId}?${params}`,
      {
        headers: {
          Accept: "application/x-protobuf",
        },
      },
    );
  });
  const tracing = parseProtoTracing(tracingArrayBuffer, tracingType);

  if (!process.env.IS_TESTING) {
    // Log to console as the decoded tracing is hard to inspect in the devtools otherwise.
    console.log("Parsed protobuf tracing:", tracing);
  }
  // The tracing id is not contained in the server tracing, but in the annotation content.
  tracing.id = tracingId;
  // Additionally, we assign the typ property (skeleton vs volume).
  // Flow complains since we don't doublecheck that we assign the correct type depending
  // on the tracing's structure.
  tracing.typ = typ;

  // @ts-ignore Remove datasetName and organizationId as these should not be used in the front-end, anymore.
  delete tracing.datasetName;
  // @ts-ignore
  delete tracing.organizationId;

  return tracing;
}

export function getUpdateActionLog(
  tracingStoreUrl: string,
  annotationId: string,
  oldestVersion?: number,
  newestVersion?: number,
): Promise<Array<APIUpdateActionBatch>> {
  return doWithToken((token) => {
    const params = new URLSearchParams();
    params.set("token", token);
    if (oldestVersion != null) {
      params.set("oldestVersion", oldestVersion.toString());
    }
    if (newestVersion != null) {
      params.set("newestVersion", newestVersion.toString());
    }
    return Request.receiveJSON(
      `${tracingStoreUrl}/tracings/annotation/${annotationId}/updateActionLog?${params}`,
    );
  });
}

export function getNewestVersionForAnnotation(
  tracingStoreUrl: string,
  annotationId: string,
): Promise<number> {
  return doWithToken((token) =>
    Request.receiveJSON(
      `${tracingStoreUrl}/tracings/annotation/${annotationId}/newestVersion?token=${token}`,
    ).then((obj) => obj.version),
  );
}

export async function getAnnotationProto(
  tracingStoreUrl: string,
  annotationId: string,
  version?: number | null | undefined,
): Promise<APITracingStoreAnnotation> {
  const params = new URLSearchParams();
  if (version != null) {
    params.set("version", version.toString());
  }
  const annotationArrayBuffer = await doWithToken((token) => {
    params.set("token", token);
    return Request.receiveArraybuffer(
      `${tracingStoreUrl}/tracings/annotation/${annotationId}?${params}`,
      {
        headers: {
          Accept: "application/x-protobuf",
        },
      },
    );
  });
  const annotationProto = parseProtoAnnotation(annotationArrayBuffer);
  if (!process.env.IS_TESTING) {
    // Log to console as the decoded annotationProto is hard to inspect in the devtools otherwise.
    console.log("Parsed protobuf annotation:", annotationProto);
  }
  return annotationProto;
}

export function hasSegmentIndexInDataStore(
  dataStoreUrl: string,
  datasetDirectoryName: string,
  dataLayerName: string,
  organizationId: string,
) {
  return doWithToken((token) =>
    Request.receiveJSON(
      `${dataStoreUrl}/data/datasets/${organizationId}/${datasetDirectoryName}/layers/${dataLayerName}/hasSegmentIndex?token=${token}`,
    ),
  );
}

export function getSegmentVolumes(
  requestUrl: string,
  mag: Vector3,
  segmentIds: Array<number>,
  additionalCoordinates: AdditionalCoordinate[] | undefined | null,
  mappingName: string | null | undefined,
): Promise<number[]> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(`${requestUrl}/segmentStatistics/volume?token=${token}`, {
      data: { additionalCoordinates, mag, segmentIds, mappingName },
      method: "POST",
    }),
  );
}

export function getSegmentBoundingBoxes(
  requestUrl: string,
  mag: Vector3,
  segmentIds: Array<number>,
  additionalCoordinates: AdditionalCoordinate[] | undefined | null,
  mappingName: string | null | undefined,
): Promise<Array<{ topLeft: Vector3; width: number; height: number; depth: number }>> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(`${requestUrl}/segmentStatistics/boundingBox?token=${token}`, {
      data: { additionalCoordinates, mag, segmentIds, mappingName },
      method: "POST",
    }),
  );
}

export async function importVolumeTracing(
  annotation: StoreAnnotation,
  volumeTracing: VolumeTracing,
  dataFile: File,
  version: number,
): Promise<number> {
  return doWithToken((token) =>
    Request.sendMultipartFormReceiveJSON(
      `${annotation.tracingStore.url}/tracings/volume/${volumeTracing.tracingId}/importVolumeData?token=${token}`,
      {
        data: {
          dataFile,
          currentVersion: version,
        },
      },
    ),
  );
}

export async function downloadWithFilename(downloadUrl: string) {
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function downloadAnnotation(
  annotationId: string,
  annotationType: APIAnnotationType,
  showVolumeFallbackDownloadWarning: boolean = false,
  version: number | null | undefined = null,
  downloadFileFormat: "zarr3" | "wkw" | "nml" = "wkw",
  includeVolumeData: boolean = true,
) {
  const params = new URLSearchParams();
  if (version != null) {
    params.set("version", version.toString());
  }

  if (includeVolumeData && showVolumeFallbackDownloadWarning) {
    Toast.info(messages["annotation.no_fallback_data_included"], {
      timeout: 12000,
    });
  }
  if (!includeVolumeData) {
    params.set("skipVolumeData", "true");
  } else {
    if (downloadFileFormat === "nml") {
      throw new Error(
        "Cannot download annotation with nml-only format while includeVolumeData is true",
      );
    }
    params.set("volumeDataZipFormat", downloadFileFormat);
  }

  const downloadUrl = `/api/annotations/${annotationType}/${annotationId}/download?${params}`;
  await downloadWithFilename(downloadUrl);
}

// ### Datasets
export async function getDatasets(
  isUnreported: boolean | null | undefined = null,
  folderId: string | null = null,
  searchQuery: string | null = null,
  includeSubfolders: boolean | null = null,
  limit: number | null = null,
): Promise<Array<APIDatasetCompact>> {
  const params = new URLSearchParams();
  if (isUnreported != null) {
    params.set("isUnreported", String(isUnreported));
  }
  if (folderId != null && folderId !== "") {
    params.set("folderId", folderId);
  }
  if (searchQuery != null) {
    params.set("searchQuery", searchQuery.trim());
  }
  if (limit != null) {
    params.set("limit", String(limit));
  }
  if (includeSubfolders != null) {
    params.set("includeSubfolders", includeSubfolders ? "true" : "false");
  }

  params.set("compact", "true");

  const datasets = await Request.receiveJSON(`/api/datasets?${params}`);
  assertResponseLimit(datasets);
  return datasets;
}

export function readDatasetDatasource(dataset: APIDataset): Promise<APIDataSource> {
  return doWithToken((token) =>
    Request.receiveJSON(
      `${dataset.dataStore.url}/data/datasets/${dataset.owningOrganization}/${dataset.directoryName}/readInboxDataSource?token=${token}`,
    ),
  );
}

export async function updateDatasetDatasource(
  datasetDirectoryName: string,
  dataStoreUrl: string,
  datasource: APIDataSource,
): Promise<void> {
  await doWithToken((token) =>
    Request.sendJSONReceiveJSON(
      `${dataStoreUrl}/data/datasets/${datasource.id.team}/${datasetDirectoryName}?token=${token}`,
      {
        data: datasource,
        method: "PUT",
      },
    ),
  );
}

export async function getActiveDatasetsOfMyOrganization(): Promise<Array<APIDataset>> {
  const datasets = await Request.receiveJSON("/api/datasets?isActive=true&onlyMyOrganization=true");
  assertResponseLimit(datasets);
  return datasets;
}

export function getDataset(
  datasetId: string,
  sharingToken?: string | null | undefined,
  options: RequestOptions = {},
): Promise<APIDataset> {
  const sharingTokenSuffix = sharingToken != null ? `?sharingToken=${sharingToken}` : "";
  return Request.receiveJSON(`/api/datasets/${datasetId}${sharingTokenSuffix}`, options);
}

export async function getDatasetLegacy(
  datasetOrga: string,
  datasetName: string,
  sharingToken?: string | null | undefined,
  options: RequestOptions = {},
): Promise<APIDataset> {
  const datasetId = await getDatasetIdFromNameAndOrganization(
    datasetName,
    datasetOrga,
    sharingToken,
    options,
  );
  return getDataset(datasetId, sharingToken, options);
}

export type DatasetUpdater = {
  description?: string | null;
  displayName?: string | null;
  sortingKey?: number;
  isPublic?: boolean;
  tags?: string[];
  folderId?: string;
  metadata?: APIDataset["metadata"];
};

export function updateDatasetPartial(
  datasetId: string,
  updater: DatasetUpdater,
): Promise<APIDataset> {
  return Request.sendJSONReceiveJSON(`/api/datasets/${datasetId}/updatePartial`, {
    method: "PATCH",
    data: updater,
  });
}

export async function getDatasetViewConfiguration(
  dataset: APIDataset,
  displayedVolumeTracings: Array<string>,
  sharingToken?: string | null | undefined,
): Promise<DatasetConfiguration> {
  const sharingTokenSuffix = sharingToken != null ? `?sharingToken=${sharingToken}` : "";
  const settings = await Request.sendJSONReceiveJSON(
    `/api/datasetConfigurations/${dataset.id}${sharingTokenSuffix}`,
    {
      data: displayedVolumeTracings,
      method: "POST",
    },
  );
  enforceValidatedDatasetViewConfiguration(settings, dataset);
  return settings;
}

export function updateDatasetConfiguration(
  datasetId: string,
  datasetConfig: PartialDatasetConfiguration,
  options: RequestOptions = {},
): Promise<Record<string, any>> {
  return Request.sendJSONReceiveJSON(`/api/datasetConfigurations/${datasetId}`, {
    ...options,
    method: "PUT",
    data: datasetConfig,
  });
}

export function getDatasetDefaultConfiguration(datasetId: string): Promise<DatasetConfiguration> {
  return Request.receiveJSON(`/api/datasetConfigurations/default/${datasetId}`);
}

export function updateDatasetDefaultConfiguration(
  datasetId: string,
  datasetConfiguration: DatasetConfiguration,
): Promise<ArbitraryObject> {
  return Request.sendJSONReceiveJSON(`/api/datasetConfigurations/default/${datasetId}`, {
    method: "PUT",
    data: datasetConfiguration,
  });
}

export function getDatasetAccessList(dataset: APIDataset): Promise<Array<APIUser>> {
  return Request.receiveJSON(`/api/datasets/${dataset.id}/accessList`);
}

type DatasetCompositionArgs = {
  newDatasetName: string;
  targetFolderId: string;
  organizationId: string;
  voxelSize: VoxelSize;
  layers: LayerLink[];
};

export function createDatasetComposition(
  datastoreUrl: string,
  payload: DatasetCompositionArgs,
): Promise<NewDatasetReply> {
  // Formatting the dataSourceId to the old format so that the backend can parse it.
  // And removing the datasetId as the datastore cannot use it.
  const updatedLayers = payload.layers.map(({ dataSourceId, datasetId, ...rest }) => ({
    ...rest,
    dataSourceId: { name: dataSourceId.directoryName, team: dataSourceId.owningOrganization },
  }));
  const payloadWithUpdatedLayers = {
    ...payload,
    layers: updatedLayers,
  };
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(`${datastoreUrl}/data/datasets/compose?token=${token}`, {
      data: payloadWithUpdatedLayers,
    }),
  );
}

export function createResumableUpload(datastoreUrl: string, uploadId: string): Promise<any> {
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'file' implicitly has an 'any' type.
  const generateUniqueIdentifier = (file) => {
    if (file.path == null) {
      // file.path should be set by react-dropzone (which uses file-selector::toFileWithPath).
      // In case this "enrichment" of the file should change at some point (e.g., due to library changes),
      // throw an error.
      throw new Error("file.path is undefined.");
    }

    return `${uploadId}/${file.path || file.name}`;
  };

  return doWithToken(
    (token) =>
      // @ts-expect-error ts-migrate(2739) FIXME: Type 'Resumable' is missing the following properti... Remove this comment to see the full error message
      new ResumableJS({
        testChunks: true,
        target: `${datastoreUrl}/data/datasets?token=${token}`,
        chunkSize: 10 * 1024 * 1024, // 10MB
        permanentErrors: [400, 403, 404, 409, 415, 500, 501],
        simultaneousUploads: 3,
        chunkRetryInterval: 2000,
        maxChunkRetries: undefined,
        xhrTimeout: 10 * 60 * 1000, // 10m
        // @ts-expect-error ts-migrate(2322) FIXME: Type '(file: any) => string' is not assignable to ... Remove this comment to see the full error message
        generateUniqueIdentifier,
      }),
  );
}
type ReserveUploadInformation = {
  uploadId: string;
  name: string;
  directoryName: string;
  newDatasetId: string;
  organization: string;
  totalFileCount: number;
  filePaths: Array<string>;
  initialTeams: Array<string>;
  folderId: string | null;
};

export function reserveDatasetUpload(
  datastoreHost: string,
  reserveUploadInformation: ReserveUploadInformation,
): Promise<void> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(`/data/datasets/reserveUpload?token=${token}`, {
      data: reserveUploadInformation,
      host: datastoreHost,
    }),
  );
}

export type UnfinishedUpload = {
  uploadId: string;
  datasetName: string;
  folderId: string;
  created: number;
  filePaths: Array<string> | null | undefined;
  allowedTeams: Array<string>;
};

export function getUnfinishedUploads(
  datastoreHost: string,
  organizationName: string,
): Promise<UnfinishedUpload[]> {
  return doWithToken(async (token) => {
    const unfinishedUploads = (await Request.receiveJSON(
      `/data/datasets/getUnfinishedUploads?token=${token}&organizationName=${organizationName}`,
      {
        host: datastoreHost,
      },
    )) as Array<UnfinishedUpload>;
    return unfinishedUploads;
  });
}

type NewDatasetReply = {
  newDatasetId: string;
};

export function finishDatasetUpload(
  datastoreHost: string,
  uploadInformation: ArbitraryObject,
): Promise<NewDatasetReply> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(`/data/datasets/finishUpload?token=${token}`, {
      data: uploadInformation,
      host: datastoreHost,
    }),
  );
}

export function cancelDatasetUpload(
  datastoreHost: string,
  cancelUploadInformation: {
    uploadId: string;
  },
): Promise<void> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(`/data/datasets/cancelUpload?token=${token}`, {
      data: cancelUploadInformation,
      host: datastoreHost,
    }),
  );
}

type ExplorationResult = {
  dataSource: DatasourceConfiguration | undefined;
  report: string;
};

export async function exploreRemoteDataset(
  remoteUris: string[],
  datastoreName: string,
  credentials?: { username: string; pass: string } | null,
  preferredVoxelSize?: Vector3,
): Promise<ExplorationResult> {
  const { dataSource, report } = await Request.sendJSONReceiveJSON("/api/datasets/exploreRemote", {
    data: remoteUris.map((uri) => {
      const extendedUri = {
        remoteUri: uri.trim(),
        preferredVoxelSize,
        datastoreName,
      };

      if (credentials) {
        return {
          ...extendedUri,
          credentialIdentifier: credentials.username,
          credentialSecret: credentials.pass,
        };
      }

      return extendedUri;
    }),
  });
  if (report.indexOf("403 Forbidden") !== -1 || report.indexOf("401 Unauthorized") !== -1) {
    Toast.error("The data could not be accessed. Please verify the credentials!");
  }
  return { dataSource, report };
}

export async function storeRemoteDataset(
  datastoreUrl: string,
  datasetName: string,
  organizationId: string,
  datasource: string,
  folderId: string | null,
): Promise<NewDatasetReply> {
  return doWithToken((token) => {
    const params = new URLSearchParams();
    params.set("token", token);
    if (folderId) {
      params.set("folderId", folderId);
    }

    return Request.sendJSONReceiveJSON(
      `${datastoreUrl}/data/datasets/${organizationId}/${datasetName}?${params}`,
      {
        method: "POST",
        data: datasource,
      },
    );
  });
}

// Returns void if the name is valid. Otherwise, a string is returned which denotes the reason.
export async function isDatasetNameValid(datasetName: string): Promise<string | null | undefined> {
  if (datasetName === "") {
    return "The dataset name must not be empty.";
  }

  const response = await Request.receiveJSON(`/api/datasets/${datasetName}/isValidNewName`);
  if (response.isValid) {
    return null;
  } else {
    return response.errors[0];
  }
}

export function updateDatasetTeams(
  datasetId: string,
  newTeams: Array<string>,
): Promise<APIDataset> {
  return Request.sendJSONReceiveJSON(`/api/datasets/${datasetId}/teams`, {
    method: "PATCH",
    data: newTeams,
  });
}

export async function triggerDatasetCheck(datastoreHost: string): Promise<void> {
  await doWithToken((token) =>
    Request.triggerRequest(`/data/triggers/checkInboxBlocking?token=${token}`, {
      host: datastoreHost,
      method: "POST",
    }),
  );
}

export async function triggerDatasetClearCache(
  datastoreHost: string,
  dataSourceId: APIDataSourceId,
  layerName?: string,
): Promise<void> {
  await doWithToken((token) => {
    const params = new URLSearchParams();
    params.set("token", token);
    if (layerName) {
      params.set("layerName", layerName);
    }
    return Request.triggerRequest(
      `/data/triggers/reload/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}?${params}`,
      {
        host: datastoreHost,
        method: "POST",
      },
    );
  });
}

export async function deleteDatasetOnDisk(
  datastoreHost: string,
  dataSourceId: APIDataSourceId,
): Promise<void> {
  await doWithToken((token) =>
    Request.triggerRequest(
      `/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/deleteOnDisk?token=${token}`,
      {
        host: datastoreHost,
        method: "DELETE",
      },
    ),
  );
}

export async function triggerDatasetClearThumbnailCache(datasetId: string): Promise<void> {
  await Request.triggerRequest(`/api/datasets/${datasetId}/clearThumbnailCache`, {
    method: "PUT",
  });
}

export async function clearCache(dataset: APIMaybeUnimportedDataset, layerName?: string) {
  return Promise.all([
    triggerDatasetClearCache(dataset.dataStore.url, dataset, layerName),
    triggerDatasetClearThumbnailCache(dataset.id),
  ]);
}

export async function getDatasetSharingToken(
  datasetId: string,
  options?: RequestOptions,
): Promise<string> {
  const { sharingToken } = await Request.receiveJSON(
    `/api/datasets/${datasetId}/sharingToken`,
    options,
  );
  return sharingToken;
}

export async function revokeDatasetSharingToken(datasetId: string): Promise<void> {
  await Request.triggerRequest(`/api/datasets/${datasetId}/sharingToken`, {
    method: "DELETE",
  });
}

export async function findDataPositionForLayer(
  datastoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
): Promise<{
  position: Vector3 | null | undefined;
  mag: Vector3 | null | undefined;
}> {
  const { position, mag } = await doWithToken((token) =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/findData?token=${token}`,
    ),
  );
  return {
    position,
    mag,
  };
}

export async function findDataPositionForVolumeTracing(
  tracingstoreUrl: string,
  tracingId: string,
): Promise<{
  position: Vector3 | null | undefined;
  mag: Vector3 | null | undefined;
}> {
  const { position, mag } = await doWithToken((token) =>
    Request.receiveJSON(`${tracingstoreUrl}/tracings/volume/${tracingId}/findData?token=${token}`),
  );
  return {
    position,
    mag,
  };
}

export async function getHistogramForLayer(
  datastoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
): Promise<APIHistogramData> {
  return doWithToken((token) =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/histogram?token=${token}`,
      { showErrorToast: false },
    ),
  );
}

export async function getMappingsForDatasetLayer(
  datastoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
): Promise<Array<string>> {
  return doWithToken((token) =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/mappings?token=${token}`,
    ),
  );
}

export function fetchMapping(
  datastoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
  mappingName: string,
): Promise<APIMapping> {
  return doWithToken((token) =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/mappings/${mappingName}?token=${token}`,
    ),
  );
}

export function getEditableMappingInfo(
  tracingStoreUrl: string,
  tracingId: string,
  annotationId: string,
  version: number | undefined | null,
): Promise<ServerEditableMapping> {
  return doWithToken((token) => {
    const params = new URLSearchParams({
      token,
      annotationId: `${annotationId}`,
    });
    if (version != null) {
      params.set("version", version.toString());
    }
    return Request.receiveJSON(`${tracingStoreUrl}/tracings/mapping/${tracingId}/info?${params}`);
  });
}

export function getPositionForSegmentInAgglomerate(
  datastoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
  mappingName: string,
  segmentId: number,
): Promise<Vector3> {
  return doWithToken(async (token) => {
    const params = new URLSearchParams({
      token,
      segmentId: `${segmentId}`,
    });
    const position = await Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${
        dataSourceId.directoryName
      }/layers/${layerName}/agglomerates/${mappingName}/positionForSegment?${params.toString()}`,
    );
    return position;
  });
}

export async function getAgglomeratesForDatasetLayer(
  datastoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
): Promise<Array<string>> {
  return doWithToken((token) =>
    Request.receiveJSON(
      `${datastoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/agglomerates?token=${token}`,
    ),
  );
}

// #### Publications
export async function getPublications(): Promise<Array<APIPublication>> {
  const publications = await Request.receiveJSON("/api/publications");
  assertResponseLimit(publications);
  return publications;
}

export async function getPublication(id: string): Promise<APIPublication> {
  const publication = await Request.receiveJSON(`/api/publications/${id}`);
  return publication;
}

// #### Datastores
export async function getDatastores(): Promise<APIDataStore[]> {
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

export function getOrganizationPayingForActiveUser(
  activeUserId: string,
  options?: RequestOptions,
): Promise<string> {
  return Request.receiveJSON(`/api/user/${activeUserId}/payingOrganization`, options);
}

export function getUserConfiguration(): Promise<UserConfiguration> {
  return Request.receiveJSON("/api/user/userConfiguration");
}

export function updateUserConfiguration(
  userConfiguration: Record<string, any>,
): Promise<Record<string, any>> {
  return Request.sendJSONReceiveJSON("/api/user/userConfiguration", {
    method: "PUT",
    data: userConfiguration,
  });
}

export async function getTimeTrackingForUserSummedPerAnnotation(
  userId: string,
  startDate: dayjs.Dayjs,
  endDate: dayjs.Dayjs,
  annotationTypes: "Explorational" | "Task" | "Task,Explorational",
  annotationState: AnnotationStateFilterEnum,
  projectIds?: string[] | null,
): Promise<Array<APITimeTrackingPerAnnotation>> {
  const params = new URLSearchParams({
    start: startDate.valueOf().toString(),
    end: endDate.valueOf().toString(),
  });
  if (annotationTypes != null) params.set("annotationTypes", annotationTypes);
  if (projectIds != null && projectIds.length > 0) params.set("projectIds", projectIds.join(","));
  if (annotationState !== AnnotationStateFilterEnum.ALL) {
    params.set("annotationStates", annotationState);
  } else {
    params.set("annotationStates", "Active,Finished");
  }
  const timeTrackingData = await Request.receiveJSON(
    `/api/time/user/${userId}/summedByAnnotation?${params}`,
  );
  assertResponseLimit(timeTrackingData);
  return timeTrackingData;
}

export async function getTimeTrackingForUserSpans(
  userId: string,
  startDate: number,
  endDate: number,
  annotationTypes: "Explorational" | "Task" | "Task,Explorational",
  selectedState: AnnotationStateFilterEnum,
  projectIds?: string[] | null,
): Promise<Array<APITimeTrackingSpan>> {
  const params = new URLSearchParams({
    start: startDate.toString(),
    end: endDate.toString(),
  });
  if (annotationTypes != null) params.set("annotationTypes", annotationTypes);
  if (projectIds != null && projectIds.length > 0) {
    params.set("projectIds", projectIds.join(","));
  }
  if (selectedState !== AnnotationStateFilterEnum.ALL) {
    params.set("annotationStates", selectedState);
  } else {
    params.set("annotationStates", "Active,Finished");
  }
  return await Request.receiveJSON(`/api/time/user/${userId}/spans?${params}`);
}

export async function getTimeEntries(
  startMs: number,
  endMs: number,
  teamIds: string[],
  selectedTypes: AnnotationTypeFilterEnum,
  selectedState: AnnotationStateFilterEnum,
  projectIds: string[],
): Promise<Array<APITimeTrackingPerUser>> {
  const params = new URLSearchParams({
    start: startMs.toString(),
    end: endMs.toString(),
    annotationTypes: selectedTypes,
  });
  if (selectedState !== AnnotationStateFilterEnum.ALL) {
    params.set("annotationStates", selectedState);
  } else {
    params.set("annotationStates", "Active,Finished");
  }
  // Omit empty parameters in request
  if (projectIds.length > 0) params.set("projectIds", projectIds.join(","));
  if (teamIds.length > 0) params.set("teamIds", teamIds.join(","));
  return await Request.receiveJSON(`api/time/overview?${params}`);
}

export async function getProjectProgressReport(
  teamId: string,
  showErrorToast: boolean = true,
): Promise<Array<APIProjectProgressReport>> {
  const progressData = await Request.receiveJSON(`/api/teams/${teamId}/projectProgressReport`, {
    showErrorToast,
  });
  assertResponseLimit(progressData);
  return progressData;
}

export async function getAvailableTasksReport(
  teamId: string,
): Promise<Array<APIAvailableTasksReport>> {
  const availableTasksData = await Request.receiveJSON(`/api/teams/${teamId}/availableTasksReport`);
  assertResponseLimit(availableTasksData);
  return availableTasksData;
}

// ### Organizations
export async function getDefaultOrganization(): Promise<APIOrganization | null> {
  // Only returns an organization if the WEBKNOSSOS instance only has one organization
  return Request.receiveJSON("/api/organizations/default");
}

export function joinOrganization(inviteToken: string): Promise<void> {
  return Request.triggerRequest(`/api/auth/joinOrganization/${inviteToken}`, {
    method: "POST",
  });
}

export async function switchToOrganization(organizationId: string): Promise<void> {
  await Request.triggerRequest(`/api/auth/switchOrganization/${organizationId}`, {
    method: "POST",
  });
  location.reload();
}

export async function getUsersOrganizations(): Promise<Array<APIOrganizationCompact>> {
  const organizations: APIOrganizationCompact[] = await Request.receiveJSON(
    "/api/organizations?compact=true",
  );
  const scmOrganization = organizations.find((org) => org.id === "scalable_minds");
  if (scmOrganization == null) {
    return organizations;
  }
  // Move scalableminds organization to the front so it appears in the organization switcher
  // at the top.
  return [scmOrganization, ...organizations.filter((org) => org.id !== scmOrganization.id)];
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
    data: {
      recipients,
      autoActivate,
    },
  });
}

export async function getOrganization(organizationId: string): Promise<APIOrganization> {
  const organization = await Request.receiveJSON(`/api/organizations/${organizationId}`);
  return {
    ...organization,
    paidUntil: organization.paidUntil ?? Constants.MAXIMUM_DATE_TIMESTAMP,
    includedStorageBytes: organization.includedStorageBytes ?? Number.POSITIVE_INFINITY,
    includedUsers: organization.includedUsers ?? Number.POSITIVE_INFINITY,
  };
}

export async function checkAnyOrganizationExists(): Promise<boolean> {
  return !(await Request.receiveJSON("/api/organizationsIsEmpty"));
}

export async function deleteOrganization(organizationId: string): Promise<void> {
  return Request.triggerRequest(`/api/organizations/${organizationId}`, {
    method: "DELETE",
  });
}

export async function updateOrganization(
  organizationId: string,
  name: string,
  newUserMailingList: string,
): Promise<APIOrganization> {
  return Request.sendJSONReceiveJSON(`/api/organizations/${organizationId}`, {
    method: "PATCH",
    data: {
      name,
      newUserMailingList,
    },
  });
}

export async function isDatasetAccessibleBySwitching(
  commandType: TraceOrViewCommand,
): Promise<APIOrganization | null | undefined> {
  if (commandType.type === ControlModeEnum.TRACE) {
    return Request.receiveJSON(
      `/api/auth/accessibleBySwitching?annotationId=${commandType.annotationId}`,
      {
        showErrorToast: false,
      },
    );
  } else {
    return Request.receiveJSON(
      `/api/auth/accessibleBySwitching?datasetId=${commandType.datasetId}`,
      {
        showErrorToast: false,
      },
    );
  }
}

export async function isWorkflowAccessibleBySwitching(
  workflowHash: string,
): Promise<APIOrganization | null> {
  return Request.receiveJSON(`/api/auth/accessibleBySwitching?workflowHash=${workflowHash}`);
}

export async function sendUpgradePricingPlanEmail(requestedPlan: string): Promise<void> {
  return Request.receiveJSON(`/api/pricing/requestUpgrade?requestedPlan=${requestedPlan}`, {
    method: "POST",
  });
}

export async function sendExtendPricingPlanEmail(): Promise<void> {
  return Request.receiveJSON("/api/pricing/requestExtension", {
    method: "POST",
  });
}

export async function sendUpgradePricingPlanUserEmail(requestedUsers: number): Promise<void> {
  return Request.receiveJSON(`/api/pricing/requestUsers?requestedUsers=${requestedUsers}`, {
    method: "POST",
  });
}

export async function sendUpgradePricingPlanStorageEmail(requestedStorage: number): Promise<void> {
  return Request.receiveJSON(`/api/pricing/requestStorage?requestedStorage=${requestedStorage}`, {
    method: "POST",
  });
}

export async function sendOrderCreditsEmail(requestedCredits: number): Promise<void> {
  return Request.receiveJSON(`/api/pricing/requestCredits?requestedCredits=${requestedCredits}`, {
    method: "POST",
  });
}

export async function getPricingPlanStatus(): Promise<APIPricingPlanStatus> {
  return Request.receiveJSON("/api/pricing/status");
}

export const cachedGetPricingPlanStatus = _.memoize(getPricingPlanStatus);

// ### BuildInfo webknossos
export function getBuildInfo(): Promise<APIBuildInfo> {
  return Request.receiveJSON("/api/buildinfo", {
    doNotInvestigate: true,
  });
}

// ### BuildInfo datastore
export function getDataStoreBuildInfo(dataStoreUrl: string): Promise<APIBuildInfo> {
  return Request.receiveJSON(`${dataStoreUrl}/api/buildinfo`, {
    doNotInvestigate: true,
  });
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
  const allMaintenances: Array<MaintenanceInfo> = await Request.receiveJSON(
    "/api/maintenances/listCurrentAndUpcoming",
  );
  const currentEpoch = Date.now();
  const currentMaintenance = allMaintenances.find(
    (maintenance) => maintenance.startTime < currentEpoch,
  );
  return currentMaintenance != null;
}

export async function listCurrentAndUpcomingMaintenances(): Promise<Array<MaintenanceInfo>> {
  return Request.receiveJSON("/api/maintenances/listCurrentAndUpcoming");
}

export function setMaintenance(bool: boolean): Promise<void> {
  return Request.triggerRequest("/api/maintenance", {
    method: bool ? "POST" : "DELETE",
  });
}
// @ts-ignore
window.setMaintenance = setMaintenance;

// Meshes

// These parameters are bundled into an object to avoid that the computeAdHocMesh function
// receives too many parameters, since this doesn't play well with the saga typings.
type MeshRequest = {
  // The position is in voxels in mag 1
  position: Vector3;
  additionalCoordinates: AdditionalCoordinate[] | undefined;
  mag: Vector3;
  segmentId: number; // Segment to build mesh for
  // The cubeSize is in voxels in mag <mag>
  cubeSize: Vector3;
  scaleFactor: Vector3;
  mappingName: string | null | undefined;
  mappingType: MappingType | null | undefined;
  findNeighbors: boolean;
};

export function computeAdHocMesh(
  requestUrl: string,
  meshRequest: MeshRequest,
): Promise<{
  buffer: ArrayBuffer;
  neighbors: Array<number>;
}> {
  const { position, additionalCoordinates, cubeSize, mappingName, scaleFactor, mag, ...rest } =
    meshRequest;

  return doWithToken(async (token) => {
    const params = new URLSearchParams();
    params.set("token", token);

    const { buffer, headers } = await Request.sendJSONReceiveArraybufferWithHeaders(
      `${requestUrl}/adHocMesh?${params}`,
      {
        data: {
          // The back-end needs a small padding at the border of the
          // bounding box to calculate the mesh. This padding
          // is added here to the position and bbox size.
          position: V3.toArray(V3.sub(position, mag)), // position is in mag1
          additionalCoordinates,
          cubeSize: V3.toArray(V3.add(cubeSize, [1, 1, 1])), //cubeSize is in target mag
          // Name and type of mapping to apply before building mesh (optional)
          mapping: mappingName,
          voxelSizeFactorInUnit: scaleFactor,
          mag,
          ...rest,
        },
      },
    );
    const neighbors = (Utils.parseMaybe(headers.neighbors) as number[] | null) || [];
    return {
      buffer,
      neighbors,
    };
  });
}

export function getBucketPositionsForAdHocMesh(
  tracingStoreUrl: string,
  tracingId: string,
  segmentId: number,
  cubeSize: Vector3,
  mag: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
): Promise<Vector3[]> {
  return doWithToken(async (token) => {
    const params = new URLSearchParams();
    params.set("token", token);
    const positions = await Request.sendJSONReceiveJSON(
      `${tracingStoreUrl}/tracings/volume/${tracingId}/segmentIndex/${segmentId}?${params}`,
      {
        data: {
          cubeSize,
          mag,
          additionalCoordinates,
        },
        method: "POST",
      },
    );
    return positions;
  });
}

export function getAgglomerateSkeleton(
  dataStoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
  mappingId: string,
  agglomerateId: number,
): Promise<ArrayBuffer> {
  return doWithToken((token) =>
    Request.receiveArraybuffer(
      `${dataStoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/agglomerates/${mappingId}/skeleton/${agglomerateId}?token=${token}`, // The webworker code cannot do proper error handling and always expects an array buffer from the server.
      // The webworker code cannot do proper error handling and always expects an array buffer from the server.
      // However, the server might send an error json instead of an array buffer. Therefore, don't use the webworker code.
      {
        useWebworkerForArrayBuffer: false,
        showErrorToast: false,
      },
    ),
  );
}

export async function getAgglomeratesForSegmentsFromDatastore<T extends number | bigint>(
  dataStoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
  mappingId: string,
  segmentIds: Array<T>,
): Promise<Mapping> {
  const segmentIdBuffer = serializeProtoListOfLong<T>(segmentIds);
  const listArrayBuffer: ArrayBuffer = await doWithToken((token) => {
    const params = new URLSearchParams({ token });
    return Request.receiveArraybuffer(
      `${dataStoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/agglomerates/${mappingId}/agglomeratesForSegments?${params}`,
      {
        method: "POST",
        body: segmentIdBuffer,
        headers: {
          "Content-Type": "application/octet-stream",
        },
      },
    );
  });
  // Ensure that the values are bigint if the keys are bigint
  const adaptToType = Utils.isBigInt(segmentIds[0])
    ? (el: NumberLike) => BigInt(el)
    : (el: NumberLike) => el;
  const keyValues = _.zip(segmentIds, parseProtoListOfLong(listArrayBuffer).map(adaptToType));
  // @ts-ignore
  return new Map(keyValues);
}

export async function getAgglomeratesForSegmentsFromTracingstore<T extends number | bigint>(
  tracingStoreUrl: string,
  tracingId: string,
  segmentIds: Array<T>,
  annotationId: string,
  version?: number | null | undefined,
): Promise<Mapping> {
  const params = new URLSearchParams({ annotationId });
  if (version != null) {
    params.set("version", version.toString());
  }
  const segmentIdBuffer = serializeProtoListOfLong<T>(
    // The tracing store expects the ids to be sorted
    segmentIds.sort(<T extends NumberLike>(a: T, b: T) => Number(a - b)),
  );
  const listArrayBuffer: ArrayBuffer = await doWithToken((token) => {
    params.set("token", token);
    return Request.receiveArraybuffer(
      `${tracingStoreUrl}/tracings/mapping/${tracingId}/agglomeratesForSegments?${params}`,
      {
        method: "POST",
        body: segmentIdBuffer,
        headers: {
          "Content-Type": "application/octet-stream",
        },
      },
    );
  });

  // Ensure that the values are bigint if the keys are bigint
  const adaptToType = Utils.isBigInt(segmentIds[0])
    ? (el: NumberLike) => BigInt(el)
    : (el: NumberLike) => el;

  const keyValues = _.zip(segmentIds, parseProtoListOfLong(listArrayBuffer).map(adaptToType));
  // @ts-ignore
  return new Map(keyValues);
}

export function getEditableAgglomerateSkeleton(
  tracingStoreUrl: string,
  tracingId: string,
  agglomerateId: number,
): Promise<ArrayBuffer> {
  return doWithToken((token) =>
    Request.receiveArraybuffer(
      `${tracingStoreUrl}/tracings/mapping/${tracingId}/agglomerateSkeleton/${agglomerateId}?token=${token}`,
      // The webworker code cannot do proper error handling and always expects an array buffer from the server.
      // However, the server might send an error json instead of an array buffer. Therefore, don't use the webworker code.
      {
        useWebworkerForArrayBuffer: false,
        showErrorToast: false,
      },
    ),
  );
}

export async function getMeshfilesForDatasetLayer(
  dataStoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
): Promise<Array<APIMeshFile>> {
  const meshFiles: Array<APIMeshFile> = await doWithToken((token) =>
    Request.receiveJSON(
      `${dataStoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/meshes?token=${token}`,
    ),
  );

  for (const file of meshFiles) {
    if (file.mappingName === "") {
      file.mappingName = undefined;
    }
  }

  return meshFiles;
}

// ### Connectomes
export function getConnectomeFilesForDatasetLayer(
  dataStoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
): Promise<Array<APIConnectomeFile>> {
  return doWithToken((token) =>
    Request.receiveJSON(
      `${dataStoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/connectomes?token=${token}`,
    ),
  );
}

export function getSynapsesOfAgglomerates(
  dataStoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
  connectomeFile: string,
  agglomerateIds: Array<number>,
): Promise<
  Array<{
    in: Array<number>;
    out: Array<number>;
  }>
> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(
      `${dataStoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/connectomes/synapses?token=${token}`,
      {
        data: {
          connectomeFile,
          agglomerateIds,
        },
      },
    ),
  );
}

function getSynapseSourcesOrDestinations(
  dataStoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
  connectomeFile: string,
  synapseIds: Array<number>,
  srcOrDst: "src" | "dst",
): Promise<Array<number>> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(
      `${dataStoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/connectomes/synapses/${srcOrDst}?token=${token}`,
      {
        data: {
          connectomeFile,
          synapseIds,
        },
      },
    ),
  );
}

export function getSynapseSources(...args: any): Promise<Array<number>> {
  // @ts-expect-error ts-migrate(2556) FIXME: Expected 6 arguments, but got 1 or more.
  return getSynapseSourcesOrDestinations(...args, "src");
}

export function getSynapseDestinations(...args: any): Promise<Array<number>> {
  // @ts-expect-error ts-migrate(2556) FIXME: Expected 6 arguments, but got 1 or more.
  return getSynapseSourcesOrDestinations(...args, "dst");
}

export function getSynapsePositions(
  dataStoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
  connectomeFile: string,
  synapseIds: Array<number>,
): Promise<Array<Vector3>> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(
      `${dataStoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/connectomes/synapses/positions?token=${token}`,
      {
        data: {
          connectomeFile,
          synapseIds,
        },
      },
    ),
  );
}

export function getSynapseTypes(
  dataStoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
  connectomeFile: string,
  synapseIds: Array<number>,
): Promise<{
  synapseTypes: Array<number>;
  typeToString: Array<string>;
}> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(
      `${dataStoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/connectomes/synapses/types?token=${token}`,
      {
        data: {
          connectomeFile,
          synapseIds,
        },
      },
    ),
  );
}

type MinCutTargetEdge = {
  position1: Vector3;
  position2: Vector3;
  segmentId1: number;
  segmentId2: number;
};
export async function getEdgesForAgglomerateMinCut(
  tracingStoreUrl: string,
  tracingId: string,
  segmentsInfo: {
    segmentId1: NumberLike;
    segmentId2: NumberLike;
    mag: Vector3;
    agglomerateId: NumberLike;
    editableMappingId: string;
  },
): Promise<Array<MinCutTargetEdge>> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(
      `${tracingStoreUrl}/tracings/mapping/${tracingId}/agglomerateGraphMinCut?token=${token}`,
      {
        data: {
          ...segmentsInfo,
          // TODO: Proper 64 bit support (#6921)
          segmentId1: Number(segmentsInfo.segmentId1),
          segmentId2: Number(segmentsInfo.segmentId2),
          agglomerateId: Number(segmentsInfo.agglomerateId),
        },
      },
    ),
  );
}

export type NeighborInfo = {
  segmentId: number;
  neighbors: Array<{ segmentId: number; position: Vector3 }>;
};

export async function getNeighborsForAgglomerateNode(
  tracingStoreUrl: string,
  tracingId: string,
  segmentInfo: {
    segmentId: NumberLike;
    mag: Vector3;
    agglomerateId: NumberLike;
    editableMappingId: string;
  },
): Promise<NeighborInfo> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(
      `${tracingStoreUrl}/tracings/mapping/${tracingId}/agglomerateGraphNeighbors?token=${token}`,
      {
        data: {
          ...segmentInfo,
          // TODO: Proper 64 bit support (#6921)
          segmentId: Number(segmentInfo.segmentId),
          agglomerateId: Number(segmentInfo.agglomerateId),
        },
      },
    ),
  );
}

// ### Smart Select

export async function getSamMask(
  dataset: APIDataset,
  layerName: string,
  mag: Vector3,
  surroundingBoxMag1: BoundingBox, // in mag 1
  prompt:
    | {
        type: "BOUNDING_BOX"; // relative to topleft
        selectionTopLeftX: number; // int, in target mag
        selectionTopLeftY: number; // int, in target mag
        selectionBottomRightX: number; // int, in target mag
        selectionBottomRightY: number; // int, in target mag
      }
    | {
        type: "POINT";
        pointX: number; // int, relative to topleft
        pointY: number; // int, relative to topleft
      },
  additionalCoordinates: AdditionalCoordinate[],
  intensityRange?: readonly [number, number] | null,
): Promise<Uint8Array> {
  const params = new URLSearchParams();
  if (intensityRange != null) {
    params.set("intensityMin", `${intensityRange[0]}`);
    params.set("intensityMax", `${intensityRange[1]}`);
  }

  const { type: interactionType, ...promptWithoutType } = prompt;

  const buffer = await Request.sendJSONReceiveArraybuffer(
    `/api/datasets/${dataset.id}/layers/${layerName}/segmentAnythingMask?${params}`,
    {
      data: {
        mag,
        surroundingBoundingBox: surroundingBoxMag1.asServerBoundingBox(),
        additionalCoordinates,
        interactionType,
        ...promptWithoutType,
      },
      showErrorToast: false,
    },
  );
  return new Uint8Array(buffer);
}

// ### Short links
export const createShortLink = _.memoize(
  (longLink: string): Promise<ShortLink> =>
    Request.sendJSONReceiveJSON("/api/shortLinks", {
      method: "POST",
      // stringify is necessary because the back-end expects a JSON string
      // (i.e., a string which contains quotes at the beginning and end).
      // The Request module does not add additional string quotes
      // if the data parameter is already a string.
      data: JSON.stringify(longLink),
    }),
);

export function getShortLink(key: string): Promise<ShortLink> {
  return Request.receiveJSON(`/api/shortLinks/byKey/${key}`);
}

// ### Voxelytics
export async function getVoxelyticsWorkflows(): Promise<Array<VoxelyticsWorkflowListing>> {
  return Request.receiveJSON("/api/voxelytics/workflows");
}

export function getVoxelyticsWorkflow(
  workflowHash: string,
  runId: string | null,
): Promise<VoxelyticsWorkflowReport> {
  const params = new URLSearchParams();
  if (runId != null) {
    params.set("runId", runId);
  }
  return Request.receiveJSON(`/api/voxelytics/workflows/${workflowHash}?${params}`);
}

export function getVoxelyticsLogs(
  runId: string,
  taskName: string | null,
  minLevel: LOG_LEVELS,
  startTime: Date,
  endTime: Date,
  limit: number | null = null,
): Promise<Array<VoxelyticsLogLine>> {
  // Data is fetched with the limit from the end backward, i.e. the latest data is fetched first.
  // The data is still ordered chronologically, i.e. ascending timestamps.
  const params = new URLSearchParams({
    runId,
    minLevel,
    startTimestamp: startTime.getTime().toString(),
    endTimestamp: endTime.getTime().toString(),
  });
  if (taskName != null) {
    params.set("taskName", taskName);
  }
  if (limit != null) {
    params.set("limit", limit.toString());
  }
  return Request.receiveJSON(`/api/voxelytics/logs?${params}`);
}

export function getVoxelyticsChunkStatistics(
  workflowHash: string,
  runId: string | null,
  taskName: string,
): Promise<Array<VoxelyticsChunkStatistics>> {
  const params = new URLSearchParams({
    taskName,
  });
  if (runId != null) {
    params.set("runId", runId);
  }
  return Request.receiveJSON(`/api/voxelytics/workflows/${workflowHash}/chunkStatistics?${params}`);
}
export function getVoxelyticsArtifactChecksums(
  workflowHash: string,
  runId: string | null,
  taskName: string,
  artifactName?: string,
): Promise<Array<Record<string, string | number>>> {
  const params = new URLSearchParams({
    taskName,
  });
  if (runId != null) {
    params.set("runId", runId);
  }
  if (artifactName != null) {
    params.set("artifactName", artifactName);
  }
  return Request.receiveJSON(
    `/api/voxelytics/workflows/${workflowHash}/artifactChecksums?${params}`,
  );
}

export function deleteWorkflow(workflowHash: string): Promise<void> {
  return Request.triggerRequest(`/api/voxelytics/workflows/${workflowHash}`, {
    method: "DELETE",
  });
}

// ### Help / Feedback userEmail
export function sendHelpEmail(message: string) {
  return Request.receiveJSON(
    `/api/helpEmail?${new URLSearchParams({
      message,
      currentUrl: window.location.href,
    })}`,
    {
      method: "POST",
    },
  );
}

export function requestSingleSignOnLogin() {
  return Request.receiveJSON("/api/auth/oidc/login");
}

export function verifyEmail(key: string) {
  return Request.receiveJSON(`/api/verifyEmail/${key}`, {
    method: "POST",
    showErrorToast: false,
  });
}

export function requestVerificationMail() {
  return Request.receiveJSON("/api/verifyEmail", {
    method: "POST",
  });
}

// @flow
import Request from "libs/request";
import Toast from "libs/toast";
import Utils from "libs/utils";
import { location } from "libs/window";
import messages from "messages";
import type {
  APIUserType,
  APIScriptType,
  APITaskTypeType,
  APITeamType,
  APIProjectType,
  APITaskType,
  APIAnnotationType,
  APIDatastoreType,
  NDStoreConfigType,
  DatasetConfigType,
  APIDatasetType,
  APITimeIntervalType,
  APIUserLoggedTimeType,
  APITimeTrackingType,
  APIProjectProgressReportType,
  APIOpenTasksReportType,
  APIOrganizationType,
} from "admin/api_flow_types";
import type { QueryObjectType } from "admin/views/task/task_search_form";
import type { NewTaskType, TaskCreationResponseType } from "admin/views/task/task_create_bulk_view";

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

let tokenPromise;
export async function doWithToken<T>(fn: (token: string) => Promise<T>): Promise<*> {
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
    method: "POST",
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

export async function createTaskType(taskType: APITaskTypeType): Promise<APITaskTypeType> {
  return Request.sendJSONReceiveJSON("/api/taskTypes", {
    method: "POST",
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

export async function deleteProject(projectName: string): Promise<void> {
  return Request.receiveJSON(`/api/projects/${projectName}`, {
    method: "DELETE",
  });
}

export async function createProject(project: APIProjectType): Promise<APIProjectType> {
  const transformedProject = Object.assign({}, project, {
    expectedTime: Utils.minutesToMilliseconds(project.expectedTime),
  });

  return Request.sendJSONReceiveJSON("/api/projects", {
    method: "POST",
    data: transformedProject,
  });
}

export async function updateProject(
  projectName: string,
  project: APIProjectType,
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

// ### Annotations
export async function reOpenAnnotation(annotationId: string): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/annotations/Task/${annotationId}/reopen`);
}

export async function finishAnnotation(annotationId: string): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/annotations/Task/${annotationId}/finish`);
}

export async function resetAnnotation(annotationId: string): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/annotations/Task/${annotationId}/reset`);
}

export async function deleteAnnotation(annotationId: string): Promise<APIAnnotationType> {
  return Request.receiveJSON(`/annotations/Task/${annotationId}`, {
    method: "DELETE",
  });
}

export async function copyAnnotationToUserAccount(
  annotationId: string,
  tracingType: string,
): Promise<APIAnnotationType> {
  const url = `/annotations/${tracingType}/${annotationId}/duplicate`;
  return Request.receiveJSON(url);
}

export async function getAnnotationInformation(
  annotationId: string,
  tracingType: string,
): Promise<APIAnnotationType> {
  // Include /readOnly part whenever it is in the pathname
  const isReadOnly = location.pathname.endsWith("/readOnly");
  const readOnlyPart = isReadOnly ? "readOnly/" : "";
  const infoUrl = `/annotations/${tracingType}/${annotationId}/${readOnlyPart}info`;
  return Request.receiveJSON(infoUrl);
}

// ### Datasets
export async function getDatasets(): Promise<Array<APIDatasetType>> {
  const datasets = await Request.receiveJSON("/api/datasets");
  assertResponseLimit(datasets);

  return datasets;
}

export async function getActiveDatasets(): Promise<Array<APIDatasetType>> {
  const datasets = await Request.receiveJSON("/api/datasets?isActive=true");
  assertResponseLimit(datasets);

  return datasets;
}

export async function getDatasetAccessList(datasetName: string): Promise<Array<APIUserType>> {
  return Request.receiveJSON(`/api/datasets/${datasetName}/accessList`);
}

export async function addNDStoreDataset(
  ndstoreConfig: NDStoreConfigType,
): Promise<APIAnnotationType> {
  return Request.sendJSONReceiveJSON("/api/datasets?typ=ndstore", {
    data: ndstoreConfig,
  });
}

export async function addDataset(datatsetConfig: DatasetConfigType): Promise<APIAnnotationType> {
  return doWithToken(token =>
    Request.sendMultipartFormReceiveJSON(`/data/datasets?token=${token}`, {
      data: datatsetConfig,
      host: datatsetConfig.datastore,
    }),
  );
}

// #### Datastores
export async function getDatastores(): Promise<Array<APIDatastoreType>> {
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

  const timelogs = timeTrackingData[0].timelogs;
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

  const timelogs = timeTrackingData.timelogs;
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
export async function getOrganizations(): Promise<Array<APIOrganizationType>> {
  return Request.receiveJSON("/api/organizations");
}

// @flow
import Request from "libs/request";
import Toast from "libs/toast";
import messages from "messages";
import Utils from "libs/utils";
import type {
  APIUserType,
  APIScriptType,
  APITaskTypeType,
  APITeamType,
  APIProjectType,
  APITaskType,
  APIAnnotationType,
} from "admin/api_flow_types";
import type { QueryObjectType } from "admin/views/task/task_search_form";

const MAX_SERVER_ITEMS_PER_RESPONSE = 1000;

function assertResponseLimit(collection) {
  if (collection.length === MAX_SERVER_ITEMS_PER_RESPONSE) {
    Toast.warning(messages["request.max_item_count_alert"], true);
  }
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
    data: newUser,
  });
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

export async function getRootTeams(): Promise<Array<APITeamType>> {
  const teams = await Request.receiveJSON("/api/teams?isRoot=true");
  assertResponseLimit(teams);

  return teams;
}

export async function createTeam(newTeam: APITeamType): Promise<APITeamType> {
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
export async function getProjects(): Promise<Array<APIProjectType>> {
  const responses = await Request.receiveJSON("/api/projects");
  assertResponseLimit(responses);

  const projects = responses.map(response =>
    Object.assign(response, { expectedTime: Utils.millisecondsToMinutes(response.expectedTime) }),
  );
  return projects;
}

export async function getProjectsWithOpenAssignments(): Promise<Array<APIProjectType>> {
  const responses = await Request.receiveJSON("/api/projects/assignments");
  assertResponseLimit(responses);

  const projects = responses.map(response =>
    Object.assign(response, { expectedTime: Utils.millisecondsToMinutes(response.expectedTime) }),
  );
  return projects;
}

export async function getProject(projectName: string): Promise<APIProjectType> {
  const project = await Request.receiveJSON(`/api/projects/${projectName}`);
  return Object.assign(project, {
    expectedTime: Utils.millisecondsToMinutes(project.expectedTime),
  });
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

export function pauseProject(projectName: string): Promise<void> {
  return Request.receiveJSON(`/api/projects/${projectName}/pause`);
}

export function resumeProject(projectName: string): Promise<void> {
  return Request.receiveJSON(`/api/projects/${projectName}/resume`);
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

export async function getTasks(queryObject: QueryObjectType): Promise<Array<APITaskType>> {
  const responses = await Request.sendJSONReceiveJSON("/api/tasks/list", {
    data: queryObject,
  });

  const tasks = responses.map(response => {
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
  });

  return tasks;
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

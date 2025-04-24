import { finishAnnotation } from "admin/admin_rest_api";
import type {
  NewNmlTask,
  NewTask,
  TaskCreationResponseContainer,
} from "admin/task/task_create_bulk_view";
import type { QueryObject } from "admin/task/task_search_form";
import type { RequestOptions } from "libs/request";
import Request from "libs/request";
import * as Utils from "libs/utils";
import type {
  APIActiveUser,
  APIAnnotation,
  APIAnnotationWithTask,
  APITask,
} from "types/api_flow_types";
import { APIAnnotationTypeEnum } from "types/api_flow_types";
import { assertResponseLimit } from "./api_utils";

export function peekNextTasks(): Promise<APITask | null | undefined> {
  return Request.receiveJSON("/api/user/tasks/peek");
}

export async function requestTask(): Promise<APIAnnotationWithTask> {
  const taskWithMessages = await Request.receiveJSON("/api/user/tasks/request", {
    method: "POST",
  });
  // Extract the potential messages property before returning the task to avoid
  // failing e2e tests in annotations.e2e.ts
  const { messages: _messages, ...task } = taskWithMessages;
  return task;
}

export function getAnnotationsForTask(
  taskId: string,
  options?: RequestOptions,
): Promise<Array<APIAnnotation>> {
  return Request.receiveJSON(`/api/tasks/${taskId}/annotations`, options);
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

export async function getTasks(queryObject: QueryObject): Promise<APITask[]> {
  const responses = await Request.sendJSONReceiveJSON("/api/tasks/list", {
    data: queryObject,
  });
  const tasks = responses.map((response: APITask) => transformTask(response));
  assertResponseLimit(tasks);
  return tasks;
}

export function createTasks(tasks: NewTask[]): Promise<TaskCreationResponseContainer> {
  return Request.sendJSONReceiveJSON("/api/tasks", {
    data: tasks,
  });
}

export function createTaskFromNML(
  task: NewNmlTask,
  nmlFiles: File[],
): Promise<TaskCreationResponseContainer> {
  return Request.sendMultipartFormReceiveJSON("/api/tasks/createFromFiles", {
    data: {
      nmlFiles: nmlFiles,
      formJSON: JSON.stringify(task),
    },
  });
}

export async function getTask(taskId: string, options: RequestOptions = {}): Promise<APITask> {
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

export async function assignTaskToUser(taskId: string, userId: string): Promise<APITask> {
  return Request.receiveJSON(`/api/tasks/${taskId}/assign?userId=${userId}`, {
    method: "POST",
  });
}

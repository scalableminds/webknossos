/* eslint-disable import/prefer-default-export */

/**
 * task_actions.js
 * @flow
 */
import type { TaskType } from "oxalis/store";

type setTaskActionType = { type: "SET_TASK", task: ?TaskType };
export type TaskActionType = setTaskActionType;

export const setTaskAction = (task: ?TaskType): setTaskActionType => ({
  type: "SET_TASK",
  task,
});

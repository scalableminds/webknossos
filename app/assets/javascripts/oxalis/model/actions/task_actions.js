/* eslint-disable import/prefer-default-export */

/**
 * task_actions.js
 * @flow
 */
import type { Task } from "oxalis/store";

type setTaskActionType = { type: "SET_TASK", task: ?Task };
export type TaskAction = setTaskActionType;

export const setTaskAction = (task: ?Task): setTaskActionType => ({
  type: "SET_TASK",
  task,
});

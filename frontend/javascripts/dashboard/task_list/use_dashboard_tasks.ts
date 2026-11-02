import { PropTypes } from "@scalableminds/prop-types";
import { requestTask } from "admin/api/tasks";
import { handleGenericError } from "libs/error_handling";
import Persistence from "libs/persistence";
import Request from "libs/request";
import { useCallback, useState } from "react";
import type { APIAnnotation, APITaskWithAnnotation } from "types/api_types";

const pageLength: number = 1000;

export type TaskModeState = {
  tasks: Array<APITaskWithAnnotation>;
  loadedAllTasks: boolean;
  lastLoadedPage: number;
};
export type TaskModeStates = {
  finished: TaskModeState;
  unfinished: TaskModeState;
};
export type TaskMode = keyof TaskModeStates;

const INITIAL_TASK_MODE_STATE: TaskModeState = {
  tasks: [],
  loadedAllTasks: false,
  lastLoadedPage: -1,
};

export const persistence = new Persistence<{ showFinishedTasks: boolean }>(
  {
    showFinishedTasks: PropTypes.bool,
  },
  "dashboardTaskList",
);

export const getTaskMode = (showFinishedTasks: boolean): TaskMode =>
  showFinishedTasks ? "finished" : "unfinished";

export const convertAnnotationToTaskWithAnnotationType = (
  annotation: APIAnnotation,
): APITaskWithAnnotation => {
  const { task } = annotation;

  if (!task) {
    // This should never be the case unless tasks were deleted in the DB.
    throw new Error(
      `[Dashboard Tasks] Annotation ${annotation.id} has no task assigned. Please inform your admin.`,
    );
  }

  if (!task.type) {
    // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'type' because it is a read-only ... Remove this comment to see the full error message
    task.type = {
      summary: `[deleted] ${annotation.typ}`,
      description: "",
      settings: {
        allowedModes: "",
      },
    };
  }

  const newTask: APITaskWithAnnotation = Object.assign({}, task, {
    annotation,
  });
  return newTask;
};

/**
 * Holds the paginated task lists for finished and unfinished tasks and the
 * operations that load or modify them.
 */
export function useDashboardTasks(userId: string | null | undefined) {
  const [taskModeStates, setTaskModeStates] = useState<TaskModeStates>({
    finished: INITIAL_TASK_MODE_STATE,
    unfinished: INITIAL_TASK_MODE_STATE,
  });
  const [isLoading, setIsLoading] = useState(false);

  const updateTaskModeState = useCallback(
    (mode: TaskMode, update: (modeState: TaskModeState) => Partial<TaskModeState>) => {
      setTaskModeStates((prevStates) => ({
        ...prevStates,
        [mode]: { ...prevStates[mode], ...update(prevStates[mode]) },
      }));
    },
    [],
  );

  // This refers not to the pagination of antd but to the pagination of querying data from SQL.
  const fetchPage = useCallback(
    async (mode: TaskMode, pageNumber: number) => {
      const isFinished = (mode === "finished").toString();
      const url = userId
        ? `/api/users/${userId}/tasks?isFinished=${isFinished}&pageNumber=${pageNumber}`
        : `/api/user/tasks?isFinished=${isFinished}&pageNumber=${pageNumber}`;

      try {
        setIsLoading(true);
        const annotationsWithTasks: APIAnnotation[] = await Request.receiveJSON(url);
        const tasks = annotationsWithTasks.map(convertAnnotationToTaskWithAnnotationType);
        updateTaskModeState(mode, (modeState) => ({
          loadedAllTasks:
            annotationsWithTasks.length !== pageLength || annotationsWithTasks.length === 0,
          tasks: modeState.tasks.concat(tasks),
          lastLoadedPage: pageNumber,
        }));
      } catch (error) {
        handleGenericError(error as Error);
      } finally {
        setIsLoading(false);
      }
    },
    [userId, updateTaskModeState],
  );

  const removeTaskByAnnotationId = useCallback(
    (mode: TaskMode, annotationId: string | null | undefined) => {
      updateTaskModeState(mode, (modeState) => ({
        tasks: modeState.tasks.filter((t) => t.annotation.id !== annotationId),
      }));
    },
    [updateTaskModeState],
  );

  const moveTaskToFinished = useCallback((taskId: string, finishedTask: APITaskWithAnnotation) => {
    setTaskModeStates((prevStates) => ({
      unfinished: {
        ...prevStates.unfinished,
        tasks: prevStates.unfinished.tasks.filter((t) => t.id !== taskId),
      },
      finished: {
        ...prevStates.finished,
        tasks: [finishedTask].concat(prevStates.finished.tasks),
      },
    }));
  }, []);

  const requestNewTask = useCallback(async () => {
    setIsLoading(true);
    try {
      const newTaskAnnotation = await requestTask();
      updateTaskModeState("unfinished", (modeState) => ({
        tasks: modeState.tasks.concat([
          convertAnnotationToTaskWithAnnotationType(newTaskAnnotation),
        ]),
      }));
    } catch (_ex) {
      // catch exception so that promise does not fail and the modal will close
    } finally {
      setIsLoading(false);
    }
  }, [updateTaskModeState]);

  return {
    taskModeStates,
    isLoading,
    fetchPage,
    removeTaskByAnnotationId,
    moveTaskToFinished,
    requestNewTask,
  };
}

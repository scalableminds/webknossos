import { PropTypes } from "@scalableminds/prop-types";
import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { requestTask } from "admin/api/tasks";
import { handleGenericError } from "libs/error_handling";
import Persistence from "libs/persistence";
import Request from "libs/request";
import { useEffect, useMemo, useState } from "react";
import type { APIAnnotation, APITaskType, APITaskWithAnnotation } from "types/api_types";

const pageLength: number = 1000;

export type TaskMode = "finished" | "unfinished";
type TaskPages = InfiniteData<APITaskWithAnnotation[], number>;

export const persistence = new Persistence<{ showFinishedTasks: boolean }>(
  {
    showFinishedTasks: PropTypes.bool,
  },
  "dashboardTaskList",
);

export const getTaskMode = (showFinishedTasks: boolean): TaskMode =>
  showFinishedTasks ? "finished" : "unfinished";

// Prefix of the query keys of both modes, so that an update can target both at once.
const getUserTasksQueryKey = (userId: string | null | undefined) =>
  ["dashboardTasks", userId ?? null] as const;
const getTasksQueryKey = (userId: string | null | undefined, mode: TaskMode) =>
  [...getUserTasksQueryKey(userId), mode] as const;

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

  // Only the fields that the dashboard renders are filled for the type of a deleted task type.
  const type =
    task.type ??
    ({
      summary: `[deleted] ${annotation.typ}`,
      description: "",
      settings: { allowedModes: [] },
    } as unknown as APITaskType);

  return { ...task, type, annotation };
};

// This refers not to the pagination of antd but to the pagination of querying data from SQL.
async function fetchTaskPage(
  userId: string | null | undefined,
  mode: TaskMode,
  pageNumber: number,
): Promise<APITaskWithAnnotation[]> {
  const isFinished = (mode === "finished").toString();
  const url = userId
    ? `/api/users/${userId}/tasks?isFinished=${isFinished}&pageNumber=${pageNumber}`
    : `/api/user/tasks?isFinished=${isFinished}&pageNumber=${pageNumber}`;
  const annotationsWithTasks: APIAnnotation[] = await Request.receiveJSON(url);
  return annotationsWithTasks.map(convertAnnotationToTaskWithAnnotationType);
}

function mapTaskPages(
  data: TaskPages | undefined,
  update: (tasks: APITaskWithAnnotation[], pageIndex: number) => APITaskWithAnnotation[],
): TaskPages | undefined {
  // Lists that were never loaded stay unloaded, so that they are fetched completely later.
  return data == null ? data : { ...data, pages: data.pages.map(update) };
}

/**
 * Loads the paginated task list of the given mode and provides the operations that modify the
 * task lists. The lists are cached per user and mode.
 */
export function useDashboardTasks(userId: string | null | undefined, mode: TaskMode) {
  const queryClient = useQueryClient();
  const [isRequestingTask, setIsRequestingTask] = useState(false);

  const query = useInfiniteQuery({
    queryKey: getTasksQueryKey(userId, mode),
    queryFn: ({ pageParam }) => fetchTaskPage(userId, mode, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length < pageLength ? undefined : lastPageParam + 1,
    // Request already shows an error toast, so retrying would repeat it.
    retry: false,
    refetchOnWindowFocus: false,
    // Task lists can be large, so don't persist them to localStorage.
    meta: { persist: false },
  });

  useEffect(() => {
    if (query.error != null) handleGenericError(query.error);
  }, [query.error]);

  const tasks = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);

  const updateTasks = async (
    queryKey: readonly unknown[],
    update: (tasks: APITaskWithAnnotation[], pageIndex: number) => APITaskWithAnnotation[],
  ) => {
    // Cancel a running fetch so that its stale response cannot overwrite this update.
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueriesData<TaskPages>({ queryKey }, (data) => mapTaskPages(data, update));
  };

  const removeTaskByAnnotationId = (annotationId: string) =>
    updateTasks(getUserTasksQueryKey(userId), (pageTasks) =>
      pageTasks.filter((task) => task.annotation.id !== annotationId),
    );

  const moveTaskToFinished = async (taskId: string) => {
    await updateTasks(getTasksQueryKey(userId, "unfinished"), (pageTasks) =>
      pageTasks.filter((task) => task.id !== taskId),
    );
    // Prepending the task to the finished list would shift its pages, so reload it instead.
    await queryClient.invalidateQueries({ queryKey: getTasksQueryKey(userId, "finished") });
  };

  const hasUnfinishedTasks = () =>
    (queryClient.getQueryData<TaskPages>(getTasksQueryKey(userId, "unfinished"))?.pages ?? []).some(
      (pageTasks) => pageTasks.length > 0,
    );

  const requestNewTask = async () => {
    setIsRequestingTask(true);
    try {
      const newTask = convertAnnotationToTaskWithAnnotationType(await requestTask());
      await updateTasks(getTasksQueryKey(userId, "unfinished"), (pageTasks, pageIndex) =>
        pageIndex === 0 ? [...pageTasks, newTask] : pageTasks,
      );
    } catch (error) {
      // Don't rethrow, so that the confirmation modal closes.
      handleGenericError(error as Error);
    } finally {
      setIsRequestingTask(false);
    }
  };

  return {
    tasks,
    isLoading: query.isFetching || isRequestingTask,
    hasMoreTasks: query.hasNextPage,
    loadMoreTasks: () => query.fetchNextPage(),
    removeTaskByAnnotationId,
    moveTaskToFinished,
    hasUnfinishedTasks,
    requestNewTask,
  };
}

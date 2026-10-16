import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import type { VoxelyticsWorkflowReport } from "types/api_types";
import { collapseMetaTasksInDag, getMetaTaskAncestors, isInMetaTask } from "./task_hierarchy";
import type { TaskListLocationState } from "./task_runs_tab";

export function getTaskPanelId(taskNameOrMetaTaskKey: string) {
  return `task-panel-${taskNameOrMetaTaskKey}`;
}

// Meta tasks are collapsed into single nodes in the DAG, unless the user expanded them or they
// are (or contain) the meta task opened in the extra view.
export function useDagMetaTaskExpansion(
  report: VoxelyticsWorkflowReport | undefined,
  openMetaTask: string | null,
) {
  const [isExpandedByUser, setIsExpandedByUser] = useState<Record<string, boolean>>({});

  const isMetaTaskExpanded = useCallback(
    (metaTaskKey: string) =>
      (openMetaTask != null &&
        (metaTaskKey === openMetaTask || isInMetaTask(openMetaTask, metaTaskKey))) ||
      (isExpandedByUser[metaTaskKey] ?? false),
    [openMetaTask, isExpandedByUser],
  );

  const toggleMetaTask = useCallback((metaTaskKey: string) => {
    setIsExpandedByUser((expanded) => ({ ...expanded, [metaTaskKey]: !expanded[metaTaskKey] }));
  }, []);

  const collapsedReport = useMemo(
    () => (report != null ? collapseMetaTasksInDag(report, isMetaTaskExpanded) : null),
    [report, isMetaTaskExpanded],
  );

  return { collapsedReport, isMetaTaskExpanded, toggleMetaTask };
}

// Holds the expanded panels of the task list: the active keys of the outer and all nested
// (meta task) collapses.
export function useTaskPanelExpansion() {
  const [expandedKeys, setExpandedKeys] = useState<Array<string>>([]);

  // Each collapse only reports its own active keys, so only those are replaced.
  const setActiveKeysOfCollapse = useCallback(
    (collapseKeys: Array<string>, activeKeys: string | Array<string>) => {
      const newKeys = Array.isArray(activeKeys) ? activeKeys : [activeKeys];
      setExpandedKeys((expanded) => [
        ...expanded.filter((key) => !collapseKeys.includes(key)),
        ...newKeys,
      ]);
    },
    [],
  );

  // Also expands the meta tasks containing the task.
  const expandTask = useCallback((taskName: string) => {
    const keysToExpand = [...getMetaTaskAncestors(taskName), taskName];
    setExpandedKeys((expanded) => [
      ...expanded,
      ...keysToExpand.filter((key) => !expanded.includes(key)),
    ]);
  }, []);

  const collapseAll = useCallback(() => setExpandedKeys([]), []);

  return { expandedKeys, setActiveKeysOfCollapse, expandTask, collapseAll };
}

// Returns a function which prepares the task panel via onFocus (e.g., by expanding it) and then
// scrolls to it. Also focuses the task passed via the location state by links to another run.
export function useTaskFocus(onFocus: (taskName: string) => void) {
  // Wrapped in an object so that focusing the same task again triggers a new scroll.
  const [taskToFocus, setTaskToFocus] = useState<{ taskName: string } | null>(null);
  const location = useLocation();

  const focusTask = (taskName: string) => {
    onFocus(taskName);
    setTaskToFocus({ taskName });
  };

  // Depending on the location key (instead of the task name) re-focuses the task on every
  // navigation, because the task list stays mounted when switching between runs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only run when navigating.
  useEffect(() => {
    const highlightedTask = (location.state as TaskListLocationState | null)?.highlightedTask;
    if (highlightedTask != null) focusTask(highlightedTask);
  }, [location.key]);

  // Scroll only after the task panel was prepared and rendered. Other panels stay as they are,
  // so the layout above the task doesn't shift during the scroll.
  useEffect(() => {
    if (taskToFocus == null) return;
    const element = document.getElementById(getTaskPanelId(taskToFocus.taskName));
    element?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [taskToFocus]);

  return focusTask;
}

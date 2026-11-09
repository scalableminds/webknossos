import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { isWorkflowAccessibleBySwitching } from "admin/api/organization";
import { getVoxelyticsWorkflow } from "admin/rest_api";
import BrainSpinner, { BrainSpinnerWithError } from "components/brain_spinner";
import { useSearchParams, useWkSelector } from "libs/react_hooks";
import { useCallback, useMemo } from "react";
import { useParams } from "react-router";
import type { VoxelyticsWorkflowReport } from "types/api_types";
import TabTitle from "viewer/view/components/tab_title_component";
import { parseReport } from "./parse_api_data";
import { filterReportToMetaTask, getTasksWithHierarchy } from "./task_hierarchy";
import { useDagMetaTaskExpansion } from "./task_hierarchy_hooks";
import TaskListView from "./task_list_view";

export default function WorkflowView() {
  const { workflowHash = "", runId } = useParams();
  const { metatask } = useSearchParams();
  const user = useWkSelector((state) => state.activeUser);

  // If a meta task is passed via a URL parameter, the entire report is filtered so that only the
  // tasks of the given meta task are shown (left-hand as well as right-hand side).
  // Memoized, because react-query re-runs select (creating a new report) whenever it changes.
  const selectReport = useCallback(
    (data: VoxelyticsWorkflowReport) => {
      const parsedReport = parseReport(data);
      return metatask != null ? filterReportToMetaTask(parsedReport, metatask) : parsedReport;
    },
    [metatask],
  );

  const {
    data: report,
    isFetching: isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["voxelyticsWorkflow", workflowHash, runId],
    queryFn: async () => await getVoxelyticsWorkflow(workflowHash, runId ?? null),
    select: selectReport,
    staleTime: 0, // disable caching
    gcTime: 0, // disable garbage collection
    retry: false,
    placeholderData: keepPreviousData,
  });

  const queryClient = useQueryClient();
  // Reloading the report also refreshes the chunk statistics of its tasks, which change
  // while the workflow is still running. Mounted statistics refetch right away, the
  // others once they are opened again.
  const reload = useCallback(() => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["voxelyticsChunkStatistics", workflowHash] });
  }, [refetch, queryClient, workflowHash]);

  const { data: accessibleOrganization } = useQuery({
    queryKey: ["voxelyticsWorkflowAccess", workflowHash],
    queryFn: () => isWorkflowAccessibleBySwitching(workflowHash),
    enabled: isError && user != null,
  });

  // The DAG collapses meta tasks, while the task list always shows all tasks
  // (in a hierarchical manner if meta tasks exist).
  const { collapsedReport, isMetaTaskExpanded, toggleMetaTask } = useDagMetaTaskExpansion(
    report,
    metatask,
  );
  const tasksWithHierarchy = useMemo(
    () => (report != null ? getTasksWithHierarchy(report, metatask) : null),
    [report, metatask],
  );

  if (isError && user != null) {
    return (
      <BrainSpinnerWithError
        gotUnhandledError={false}
        organizationToSwitchTo={accessibleOrganization ?? undefined}
        entity="workflow"
      />
    );
  }
  if (report == null || collapsedReport == null || tasksWithHierarchy == null) {
    return <BrainSpinner />;
  }

  return (
    <div className="container voxelytics-view">
      <TabTitle title={`${collapsedReport.workflow.name} | WEBKNOSSOS`} />
      <TaskListView
        report={collapsedReport}
        tasksWithHierarchy={tasksWithHierarchy}
        isMetaTaskExpandedInDag={isMetaTaskExpanded}
        onToggleMetaTaskInDag={toggleMetaTask}
        openMetatask={metatask}
        runId={runId ?? null}
        onReload={reload}
        isLoading={isLoading}
      />
    </div>
  );
}

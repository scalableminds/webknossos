import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { isWorkflowAccessibleBySwitching } from "admin/api/organization";
import { getVoxelyticsWorkflow } from "admin/rest_api";
import BrainSpinner, { BrainSpinnerWithError } from "components/brain_spinner";
import { useSearchParams, useWkSelector } from "libs/react_hooks";
import { useCallback, useMemo } from "react";
import { useParams } from "react-router";
import { VoxelyticsRunState, type VoxelyticsWorkflowReport } from "types/api_types";
import TabTitle from "viewer/view/components/tab_title_component";
import { parseReport } from "./parse_api_data";
import { filterReportToMetaTask, getTasksWithHierarchy } from "./task_hierarchy";
import { useDagMetaTaskExpansion } from "./task_hierarchy_hooks";
import TaskListView from "./task_list_view";
import { VX_POLLING_INTERVAL } from "./utils";

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
    refetchInterval: (query) => {
      const data = query.state.data;
      return data == null || data.runs.some((run) => run.state === VoxelyticsRunState.RUNNING)
        ? (VX_POLLING_INTERVAL ?? false)
        : false;
    },
    staleTime: 0, // disable caching
    gcTime: 0, // disable garbage collection
    retry: false,
    placeholderData: keepPreviousData,
  });

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
        onReload={refetch}
        isLoading={isLoading}
      />
    </div>
  );
}

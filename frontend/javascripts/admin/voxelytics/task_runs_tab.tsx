import { Table, type TableProps, Tag } from "antd";
import { formatDateMedium, formatTimeIntervalStrict } from "libs/format_utils";
import { Link } from "react-router";
import {
  type VoxelyticsRunInfo,
  VoxelyticsRunState,
  type VoxelyticsTaskInfo,
} from "types/api_types";

type TaskRun = VoxelyticsTaskInfo["runs"][number];
type ExecutedTaskRun = Exclude<
  TaskRun,
  { state: VoxelyticsRunState.PENDING | VoxelyticsRunState.SKIPPED }
>;
export type TaskExecution = { run: VoxelyticsRunInfo; taskRun: ExecutedTaskRun };

// Navigating with this state expands the task in the task list of the target run.
export type TaskListLocationState = { highlightedTask?: string };

const TASK_STATE_TAG_COLORS: Record<ExecutedTaskRun["state"], string> = {
  [VoxelyticsRunState.RUNNING]: "processing",
  [VoxelyticsRunState.COMPLETE]: "success",
  [VoxelyticsRunState.FAILED]: "error",
  [VoxelyticsRunState.CANCELLED]: "error",
  [VoxelyticsRunState.STALE]: "error",
};

function isExecutedTaskRun(taskRun: TaskRun): taskRun is ExecutedTaskRun {
  return (
    taskRun.state !== VoxelyticsRunState.PENDING && taskRun.state !== VoxelyticsRunState.SKIPPED
  );
}

// Returns the runs in which the task was actually executed (not skipped), most recent first.
export function getTaskExecutions(
  taskRuns: Array<TaskRun>,
  runs: Array<VoxelyticsRunInfo>,
): Array<TaskExecution> {
  return taskRuns
    .filter(isExecutedTaskRun)
    .flatMap((taskRun) => {
      const run = runs.find((r) => r.id === taskRun.runId);
      return run != null ? [{ run, taskRun }] : [];
    })
    .sort((a, b) => b.taskRun.beginTime.getTime() - a.taskRun.beginTime.getTime());
}

export function TaskRunLink({
  workflowHash,
  runId,
  taskName,
  children,
}: {
  workflowHash: string;
  runId: string;
  taskName: string;
  children: React.ReactNode;
}) {
  const state: TaskListLocationState = { highlightedTask: taskName };
  return (
    <Link to={`/workflows/${workflowHash}/run/${encodeURIComponent(runId)}`} state={state}>
      {children}
    </Link>
  );
}

export default function TaskRunsTab({
  workflowHash,
  taskName,
  selectedRunId,
  taskExecutions,
}: {
  workflowHash: string;
  taskName: string;
  selectedRunId: string | null;
  taskExecutions: Array<TaskExecution>;
}) {
  const columns: TableProps<TaskExecution>["columns"] = [
    {
      title: "Run",
      key: "run",
      render: (_, { run }) =>
        run.id === selectedRunId ? (
          <b>{run.name}</b>
        ) : (
          <TaskRunLink workflowHash={workflowHash} runId={run.id} taskName={taskName}>
            {run.name}
          </TaskRunLink>
        ),
    },
    {
      title: "State",
      key: "state",
      render: (_, { taskRun }) => (
        <Tag color={TASK_STATE_TAG_COLORS[taskRun.state]}>{taskRun.state.toLowerCase()}</Tag>
      ),
    },
    {
      title: "Begin Time",
      key: "beginTime",
      render: (_, { taskRun }) => formatDateMedium(taskRun.beginTime),
    },
    {
      title: "Duration",
      key: "duration",
      render: (_, { taskRun }) =>
        taskRun.endTime != null
          ? formatTimeIntervalStrict(taskRun.endTime, taskRun.beginTime)
          : "-",
    },
    { title: "User", key: "user", render: (_, { run }) => run.userName },
    { title: "Host", key: "host", render: (_, { run }) => run.hostName },
  ];

  return (
    <Table
      columns={columns}
      dataSource={taskExecutions}
      rowKey={({ run }) => run.id}
      pagination={false}
      size="small"
    />
  );
}

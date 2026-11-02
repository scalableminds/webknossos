import {
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  RollbackOutlined,
  TeamOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import { finishTask, peekNextTasks, requestTask } from "admin/api/tasks";
import { deleteAnnotation, downloadAnnotation, resetAnnotation } from "admin/rest_api";
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  type DescriptionsProps,
  Flex,
  Grid,
  List,
  Row,
  Space,
  type SpaceProps,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import classNames from "classnames";
import { AsyncButton, AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import FormattedId from "components/formatted_id";
import LinkButton from "components/link_button";
import TransferTaskModal from "dashboard/transfer_task_modal";
import { handleGenericError } from "libs/error_handling";
import Markdown from "libs/markdown_adapter";
import Persistence from "libs/persistence";
import { useEffectOnlyOnce, useWkSelector } from "libs/react_hooks";
import Request from "libs/request";
import Toast from "libs/toast";
import { compareBy, scrollToTop } from "libs/utils";
import messages from "messages";
import { type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { Link } from "react-router";
import type { APIAnnotation, APITaskWithAnnotation, APIUser } from "types/api_types";
import {
  getSkeletonDescriptor,
  getVolumeDescriptors,
} from "viewer/model/accessors/annotation_accessor";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { RenderToPortal } from "viewer/view/layouting/portal_utils";
import { ActiveTabContext, RenderingTabContext } from "./dashboard_contexts";
import { DashboardEmptyTasksPlaceholder } from "./dashboard_empty_tasks_placeholder";

const pageLength: number = 1000;
// List items are bare cards without a <List.Item>, so the list adds no spacing between them.
const TASK_CARD_STYLE = { marginBottom: 16 };

type TaskModeState = {
  tasks: Array<APITaskWithAnnotation>;
  loadedAllTasks: boolean;
  lastLoadedPage: number;
};
type TaskModeStates = {
  finished: TaskModeState;
  unfinished: TaskModeState;
};
type TaskMode = keyof TaskModeStates;
type Props = {
  userId: string | null | undefined;
  isAdminView: boolean;
};

const INITIAL_TASK_MODE_STATE: TaskModeState = {
  tasks: [],
  loadedAllTasks: false,
  lastLoadedPage: -1,
};

const persistence = new Persistence<{ showFinishedTasks: boolean }>(
  {
    showFinishedTasks: PropTypes.bool,
  },
  "dashboardTaskList",
);

const getTaskMode = (showFinishedTasks: boolean): TaskMode =>
  showFinishedTasks ? "finished" : "unfinished";

const convertAnnotationToTaskWithAnnotationType = (
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
function useDashboardTasks(userId: string | null | undefined) {
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

function DashboardTaskListView({ userId, isAdminView }: Props) {
  const { modal } = App.useApp();
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  const [showFinishedTasks, setShowFinishedTasks] = useState(
    () => persistence.load().showFinishedTasks ?? false,
  );
  const [transferredAnnotationId, setTransferredAnnotationId] = useState<string | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const {
    taskModeStates,
    isLoading,
    fetchPage,
    removeTaskByAnnotationId,
    moveTaskToFinished,
    requestNewTask,
  } = useDashboardTasks(userId);

  const currentMode = getTaskMode(showFinishedTasks);
  const { tasks: currentTasks, loadedAllTasks, lastLoadedPage } = taskModeStates[currentMode];

  useEffectOnlyOnce(() => {
    fetchPage(currentMode, 0);
  });

  const sortedTasks = useMemo(
    () =>
      [...currentTasks].sort(
        compareBy<APITaskWithAnnotation>(
          (task) => (showFinishedTasks ? task.annotation.modified : task.created),
          false,
        ),
      ),
    [currentTasks, showFinishedTasks],
  );

  const toggleShowFinished = () => {
    const newShowFinishedTasks = !showFinishedTasks;
    setShowFinishedTasks(newShowFinishedTasks);
    persistence.persist({ showFinishedTasks: newShowFinishedTasks });
    const newMode = getTaskMode(newShowFinishedTasks);
    if (taskModeStates[newMode].lastLoadedPage === -1) fetchPage(newMode, 0);
  };

  const confirmFinish = (task: APITaskWithAnnotation) => {
    modal.confirm({
      title: messages["annotation.finish"],
      onOk: async () => {
        const changedAnnotationWithTask = await finishTask(task.annotation.id);
        moveTaskToFinished(
          task.id,
          convertAnnotationToTaskWithAnnotationType(changedAnnotationWithTask),
        );
      },
    });
  };

  const confirmReset = (annotation: APIAnnotation) => {
    modal.confirm({
      title: messages["task.confirm_reset"],
      cancelText: messages.no,
      okText: messages.yes,
      onOk: async () => {
        await resetAnnotation(annotation.id, annotation.typ);
        Toast.success(messages["annotation.reset_success"]);
      },
    });
  };

  const confirmCancel = (annotation: APIAnnotation) => {
    modal.confirm({
      title: messages["annotation.delete"],
      cancelText: messages.no,
      okText: messages.yes,
      onOk: async () => {
        await deleteAnnotation(annotation.id, annotation.typ);
        removeTaskByAnnotationId(currentMode, annotation.id);
      },
    });
  };

  const confirmGetNewTask = async (): Promise<void> => {
    if (taskModeStates.unfinished.tasks.length === 0) {
      await requestNewTask();
      return;
    }
    const likelyNextTask = await peekNextTasks();
    modal.confirm({
      title: messages["task.request_new"],
      content:
        likelyNextTask != null
          ? messages["task.peek_next"]({ projectName: likelyNextTask.projectName })
          : undefined,
      onOk: requestNewTask,
    });
  };

  const openTransferModal = (annotationId: string) => {
    setTransferredAnnotationId(annotationId);
    setIsTransferModalOpen(true);
  };

  const handleTransferredTask = () => {
    setIsTransferModalOpen(false);
    removeTaskByAnnotationId(currentMode, transferredAnnotationId);
  };

  return (
    <div>
      <TopBar
        confirmGetNewTask={confirmGetNewTask}
        isAdminView={isAdminView}
        userId={userId}
        toggleShowFinished={toggleShowFinished}
        showFinishedTasks={showFinishedTasks}
      />
      <Typography.Title level={3}>
        {showFinishedTasks ? "My Finished Tasks" : "My Open Tasks"}
      </Typography.Title>
      <TaskCardList
        tasks={sortedTasks}
        showFinishedTasks={showFinishedTasks}
        isAdminView={isAdminView}
        isLoading={isLoading}
        placeholder={
          isLoading ? null : <DashboardEmptyTasksPlaceholder isAdmin={activeUser.isAdmin} />
        }
        renderActions={(task, orientation) => (
          <TaskActions
            task={task}
            orientation={orientation}
            activeUser={activeUser}
            isAdminView={isAdminView}
            onTransfer={openTransferModal}
            onReset={confirmReset}
            onCancel={confirmCancel}
            onFinish={confirmFinish}
          />
        )}
      />
      {/* Not passed as the List's `loadMore`, since antd would then hide the pagination. */}
      {sortedTasks.length > 0 && !loadedAllTasks ? (
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Button onClick={() => fetchPage(currentMode, lastLoadedPage + 1)} loading={isLoading}>
            Load more Tasks
          </Button>
        </Flex>
      ) : null}
      <TransferTaskModal
        isOpen={isTransferModalOpen}
        annotationId={transferredAnnotationId}
        onCancel={() => setIsTransferModalOpen(false)}
        onChange={handleTransferredTask}
      />
    </div>
  );
}

function TaskActions({
  task,
  orientation,
  activeUser,
  isAdminView,
  onTransfer,
  onReset,
  onCancel,
  onFinish,
}: {
  task: APITaskWithAnnotation;
  orientation: SpaceProps["orientation"];
  activeUser: APIUser;
  isAdminView: boolean;
  onTransfer: (annotationId: string) => void;
  onReset: (annotation: APIAnnotation) => void;
  onCancel: (annotation: APIAnnotation) => void;
  onFinish: (task: APITaskWithAnnotation) => void;
}) {
  const { annotation } = task;
  const isAdmin =
    activeUser.isAdmin ||
    activeUser.teams
      .filter((team) => team.isTeamManager)
      .map((team) => team.name)
      .includes(task.team);
  const label = isAdminView ? (
    <LinkButton icon={<EyeOutlined />}>View</LinkButton>
  ) : (
    <LinkButton icon={<PlayCircleOutlined />}>Open</LinkButton>
  );
  return (
    <Space orientation={orientation} size={orientation === "vertical" ? 1 : "middle"} wrap>
      <Link to={`/annotations/${annotation.id}`}>{label}</Link>
      {isAdmin || isAdminView ? (
        <LinkButton onClick={() => onTransfer(annotation.id)} icon={<TeamOutlined />}>
          Transfer
        </LinkButton>
      ) : null}
      {isAdmin ? (
        <>
          <AsyncLink
            onClick={() => {
              const isVolumeIncluded = getVolumeDescriptors(annotation).length > 0;
              return downloadAnnotation(annotation.id, "Task", isVolumeIncluded);
            }}
            icon={<DownloadOutlined className="icon-margin-right" />}
          >
            Download
          </AsyncLink>
          <LinkButton onClick={() => onReset(annotation)} icon={<RollbackOutlined />}>
            <Tooltip title={messages["task.tooltip_explain_reset"]} placement="left">
              Reset
            </Tooltip>
          </LinkButton>
          <LinkButton onClick={() => onCancel(annotation)} icon={<DeleteOutlined />}>
            <Tooltip title={messages["task.tooltip_explain_reset_cancel"]} placement="left">
              Reset and Cancel
            </Tooltip>
          </LinkButton>
        </>
      ) : null}
      {isAdminView ? null : (
        <LinkButton onClick={() => onFinish(task)} icon={<CheckCircleOutlined />}>
          Finish
        </LinkButton>
      )}
    </Space>
  );
}

function TaskCardTitle({ task }: { task: APITaskWithAnnotation }) {
  return (
    <Flex vertical gap={4} style={{ paddingBlock: 12 }}>
      <span style={{ overflowWrap: "anywhere" }}>
        {task.projectName} (<FormattedDate timestamp={task.created} />)
      </span>
      <Flex wrap gap={4}>
        {getSkeletonDescriptor(task.annotation) == null ? null : (
          <Tag color="success" variant="outlined">
            skeleton
          </Tag>
        )}
        {getVolumeDescriptors(task.annotation).length === 0 ? null : (
          <Tag color="warning" variant="outlined">
            volume
          </Tag>
        )}
        {task.type.settings.allowedModes.map((mode) => (
          <Tag key={mode} variant="outlined">
            {mode}
          </Tag>
        ))}
      </Flex>
    </Flex>
  );
}

function TaskCardList({
  tasks,
  showFinishedTasks,
  isAdminView,
  isLoading,
  placeholder,
  renderActions,
}: {
  tasks: APITaskWithAnnotation[];
  showFinishedTasks: boolean;
  isAdminView: boolean;
  isLoading: boolean;
  placeholder: ReactNode;
  renderActions: (task: APITaskWithAnnotation, orientation: SpaceProps["orientation"]) => ReactNode;
}) {
  // Read once for the whole list instead of subscribing to breakpoint changes in every card.
  const isMultiColumn = Grid.useBreakpoint().md ?? false;
  const descriptionClassName = classNames("task-type-description", { short: isAdminView });

  const renderTaskCard = (task: APITaskWithAnnotation) =>
    showFinishedTasks ? (
      <Card key={task.id} style={TASK_CARD_STYLE}>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 3 }}
          styles={{ content: { overflowWrap: "anywhere" } }}
          items={[
            { key: "id", label: "Task ID", children: <FormattedId id={task.id} /> },
            { key: "project", label: "Project", children: task.projectName },
            {
              key: "finished",
              label: "Finished",
              children: <FormattedDate timestamp={task.annotation.modified} />,
            },
          ]}
        />
      </Card>
    ) : (
      <Card
        key={task.id}
        style={TASK_CARD_STYLE}
        title={<TaskCardTitle task={task} />}
        styles={{ title: { whiteSpace: "normal" } }}
      >
        <OpenTaskCardBody
          isMultiColumn={isMultiColumn}
          description={
            <div className={descriptionClassName}>
              <Markdown>{task.type.description}</Markdown>
            </div>
          }
          details={[
            { key: "id", label: "Task ID", children: <FormattedId id={task.id} /> },
            { key: "type", label: "Task Type", children: task.type.summary },
          ]}
          renderActions={(orientation) => renderActions(task, orientation)}
        />
      </Card>
    );

  return (
    <List
      dataSource={tasks}
      pagination={
        tasks.length > 0
          ? {
              defaultPageSize: 50,
              onChange: scrollToTop,
            }
          : false
      }
      loading={isLoading}
      renderItem={renderTaskCard}
      locale={{ emptyText: placeholder }}
    />
  );
}

// Three columns (description, details, actions) from `md` on. The details column is narrow
// there, so labels go above their values. Below `md`, the columns stack, labels sit next to
// their values and the actions become a wrapping row instead of a tall vertical list.
function OpenTaskCardBody({
  isMultiColumn,
  description,
  details,
  renderActions,
}: {
  isMultiColumn: boolean;
  description: ReactNode;
  details: DescriptionsProps["items"];
  renderActions: (orientation: SpaceProps["orientation"]) => ReactNode;
}) {
  return (
    <Row gutter={[24, 16]}>
      <Col xs={24} md={12} xl={14}>
        {description}
      </Col>
      <Col xs={24} md={6} xl={5}>
        <Descriptions
          size="small"
          column={1}
          layout={isMultiColumn ? "vertical" : "horizontal"}
          styles={{ content: { overflowWrap: "anywhere" } }}
          items={details}
        />
      </Col>
      <Col xs={24} md={6} xl={5}>
        {renderActions(isMultiColumn ? "vertical" : "horizontal")}
      </Col>
    </Row>
  );
}

function TopBar({
  confirmGetNewTask,
  isAdminView,
  userId,
  toggleShowFinished,
  showFinishedTasks,
}: {
  confirmGetNewTask: () => Promise<void>;
  isAdminView: boolean;
  userId: string | null | undefined;
  toggleShowFinished: () => void;
  showFinishedTasks: boolean;
}) {
  const activeTab = useContext(ActiveTabContext);
  const renderingTab = useContext(RenderingTabContext);

  const content = (
    <Space wrap>
      <AsyncButton
        type="primary"
        icon={<UserAddOutlined />}
        onClick={confirmGetNewTask}
        disabled={isAdminView && userId != null}
      >
        Get a New Task
      </AsyncButton>
      <Button onClick={toggleShowFinished}>
        Show {showFinishedTasks ? "Unfinished" : "Finished"} Tasks Only
      </Button>
    </Space>
  );

  return (
    <RenderToPortal portalId="dashboard-TabBarExtraContent">
      {activeTab === renderingTab ? content : null}
    </RenderToPortal>
  );
}

export default DashboardTaskListView;

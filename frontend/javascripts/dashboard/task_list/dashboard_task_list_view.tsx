import { finishTask, peekNextTasks } from "admin/api/tasks";
import { deleteAnnotation, resetAnnotation } from "admin/rest_api";
import { App, Button, Flex, Typography } from "antd";
import { DashboardEmptyTasksPlaceholder } from "dashboard/dashboard_empty_tasks_placeholder";
import TransferTaskModal from "dashboard/transfer_task_modal";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { compareBy } from "libs/utils";
import messages from "messages";
import { useEffect, useMemo, useState } from "react";
import type { APIAnnotation, APITaskWithAnnotation } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { TaskActionsContext, type TaskActionsContextValue } from "./task_actions";
import { TaskCardList } from "./task_card_list";
import { TaskListTopBar } from "./task_list_top_bar";
import { getTaskMode, persistence, useDashboardTasks } from "./use_dashboard_tasks";

type Props = {
  userId: string | null | undefined;
  isAdminView: boolean;
};

function DashboardTaskListView({ userId, isAdminView }: Props) {
  const { modal } = App.useApp();
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  const [showFinishedTasks, setShowFinishedTasks] = useState(
    () => persistence.load().showFinishedTasks ?? false,
  );
  const [transferredAnnotationId, setTransferredAnnotationId] = useState<string | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const {
    tasks,
    isLoading,
    hasMoreTasks,
    loadMoreTasks,
    removeTaskByAnnotationId,
    moveTaskToFinished,
    hasUnfinishedTasks,
    requestNewTask,
  } = useDashboardTasks(userId, getTaskMode(showFinishedTasks));

  // Persist after every render, not only on toggle: switching dashboard tabs pushes a new
  // history entry while this component stays mounted, and that entry needs the setting, too.
  // persist() is a no-op if the entry already holds the value.
  useEffect(() => {
    persistence.persist({ showFinishedTasks });
  });

  const managedTeamNames = useMemo(
    () => new Set(activeUser.teams.filter((team) => team.isTeamManager).map((team) => team.name)),
    [activeUser.teams],
  );

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort(
        compareBy<APITaskWithAnnotation>(
          (task) => (showFinishedTasks ? task.annotation.modified : task.created),
          false,
        ),
      ),
    [tasks, showFinishedTasks],
  );

  const toggleShowFinished = () => setShowFinishedTasks(!showFinishedTasks);

  const confirmFinish = (task: APITaskWithAnnotation) => {
    modal.confirm({
      title: messages["annotation.finish"],
      onOk: async () => {
        await finishTask(task.annotation.id);
        await moveTaskToFinished(task.id);
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
        await removeTaskByAnnotationId(annotation.id);
      },
    });
  };

  const confirmGetNewTask = async (): Promise<void> => {
    if (!hasUnfinishedTasks()) {
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
    if (transferredAnnotationId != null) removeTaskByAnnotationId(transferredAnnotationId);
  };

  const taskActionsContext: TaskActionsContextValue = {
    activeUser,
    managedTeamNames,
    isAdminView,
    onTransfer: openTransferModal,
    onReset: confirmReset,
    onCancel: confirmCancel,
    onFinish: confirmFinish,
  };

  return (
    <TaskActionsContext.Provider value={taskActionsContext}>
      <TaskListTopBar
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
      />
      {/* Not passed as the List's `loadMore`, since antd would then hide the pagination. */}
      {sortedTasks.length > 0 && hasMoreTasks ? (
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Button onClick={loadMoreTasks} loading={isLoading}>
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
    </TaskActionsContext.Provider>
  );
}

export default DashboardTaskListView;

import { finishTask, peekNextTasks } from "admin/api/tasks";
import { deleteAnnotation, resetAnnotation } from "admin/rest_api";
import { App, Button, Flex, Typography } from "antd";
import { DashboardEmptyTasksPlaceholder } from "dashboard/dashboard_empty_tasks_placeholder";
import TransferTaskModal from "dashboard/transfer_task_modal";
import { useEffectOnlyOnce, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { compareBy } from "libs/utils";
import messages from "messages";
import { useMemo, useState } from "react";
import type { APIAnnotation, APITaskWithAnnotation } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { TaskActions } from "./task_actions";
import { TaskCardList } from "./task_card_list";
import { TaskListTopBar } from "./task_list_top_bar";
import {
  convertAnnotationToTaskWithAnnotationType,
  getTaskMode,
  persistence,
  useDashboardTasks,
} from "./use_dashboard_tasks";

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

export default DashboardTaskListView;

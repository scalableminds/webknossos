import { VerticalLeftOutlined, VerticalRightOutlined } from "@ant-design/icons";
import { reOpenAnnotation } from "admin/rest_api";
import { App } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import UserLocalStorage from "libs/user_local_storage";
import { location } from "libs/window";
import messages from "messages";
import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { APIAnnotationTypeEnum } from "types/api_types";
import { Model, api } from "viewer/singletons";
import ButtonComponent from "viewer/view/components/button_component";

const handleFinishAndGetNextTask = async () => {
  api.tracing.finishAndGetNextTask();
};

function TaskCompletionActions() {
  const task = useWkSelector((state) => state.task);
  const restrictions = useWkSelector((state) => state.annotation.restrictions);
  const [isReopenAllowed, setIsReopenAllowed] = useState(false);
  const reopenTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const { modal } = App.useApp();

  useEffect(() => {
    const localStorageEntry = UserLocalStorage.getItem("lastFinishedTask");

    if (task && localStorageEntry) {
      const { finishedTime } = JSON.parse(localStorageEntry);
      const timeSinceFinish = Date.now() - finishedTime;
      const reopenAllowedTime = features().taskReopenAllowedInSeconds * 1000;

      if (timeSinceFinish < reopenAllowedTime) {
        setIsReopenAllowed(true);

        if (reopenTimeout.current != null) {
          clearTimeout(reopenTimeout.current);
          reopenTimeout.current = null;
        }

        reopenTimeout.current = setTimeout(() => {
          setIsReopenAllowed(false);
          UserLocalStorage.removeItem("lastFinishedTask");
          reopenTimeout.current = null;
        }, reopenAllowedTime - timeSinceFinish);
      }
    }

    return () => {
      if (reopenTimeout.current != null) {
        clearTimeout(reopenTimeout.current);
      }
    };
  }, [task]);

  const handleReopenTask = useCallback(async () => {
    const localStorageEntry = UserLocalStorage.getItem("lastFinishedTask");
    if (!localStorageEntry) return;
    const { annotationId } = JSON.parse(localStorageEntry);

    if (annotationId) {
      modal.confirm({
        title: messages["annotation.undoFinish.confirm"],
        content: messages["annotation.undoFinish.content"],
        onOk: async () => {
          await Model.ensureSavedState();
          await reOpenAnnotation(annotationId, APIAnnotationTypeEnum.Task);
          UserLocalStorage.removeItem("lastFinishedTask");
          const newTaskUrl = `/annotations/${APIAnnotationTypeEnum.Task}/${annotationId}`;
          location.href = newTaskUrl;
        },
      });
    }
  }, [modal.confirm]);

  const finishAndNextTaskButton = React.useMemo(
    () =>
      restrictions.allowFinish && task ? (
        <ButtonComponent
          key="next-button"
          icon={<VerticalLeftOutlined />}
          onClick={handleFinishAndGetNextTask}
        >
          Finish and Get Next Task
        </ButtonComponent>
      ) : null,
    [restrictions, task],
  );

  const reopenTaskButton = React.useMemo(
    () =>
      isReopenAllowed ? (
        <ButtonComponent
          key="reopen-button"
          icon={<VerticalRightOutlined />}
          onClick={handleReopenTask}
          danger
        >
          Undo Finish
        </ButtonComponent>
      ) : null,
    [isReopenAllowed, handleReopenTask],
  );

  return (
    <>
      {finishAndNextTaskButton}
      {reopenTaskButton}
    </>
  );
}

export default TaskCompletionActions;

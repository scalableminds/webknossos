import { Modal } from "antd";
import Markdown from "libs/markdown_adapter";
import { useWkSelector } from "libs/react_hooks";
import { useState } from "react";
import type { APITaskType } from "types/api_types";
import { InfoTabRow, InfoTabSection } from "./info_tab_layout";

/** Renders nothing for annotations that don't belong to a task. */
export function TaskSection() {
  const task = useWkSelector((state) => state.task);
  if (task == null) return null;

  return (
    <InfoTabSection label="Task">
      <InfoTabRow label="Task ID">{task.id}</InfoTabRow>
      <TaskTypeRow taskType={task.type} />
    </InfoTabSection>
  );
}

function TaskTypeRow({ taskType }: { taskType: APITaskType }) {
  const [isDescriptionModalOpen, setIsDescriptionModalOpen] = useState(false);
  const closeModal = () => setIsDescriptionModalOpen(false);

  return (
    <>
      <InfoTabRow
        label="Task type"
        tooltip="Click to show the task type description"
        onClick={() => setIsDescriptionModalOpen(true)}
      >
        {taskType.summary}
      </InfoTabRow>
      <Modal
        title={`Task Type: ${taskType.summary}`}
        open={isDescriptionModalOpen}
        onOk={closeModal}
        onCancel={closeModal}
        footer={(_, { OkBtn }) => <OkBtn />} // no cancel button
        destroyOnHidden
      >
        {taskType.description ? (
          <Markdown>{taskType.description}</Markdown>
        ) : (
          <span className="info-tab-muted">This task type has no description.</span>
        )}
      </Modal>
    </>
  );
}

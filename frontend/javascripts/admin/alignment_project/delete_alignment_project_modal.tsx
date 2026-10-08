import {
  type APIAlignmentProject,
  deleteAlignmentProject,
  deleteAlignmentProjectInputData,
} from "admin/api/alignment_projects";
import { Alert, Flex, Modal, Radio, Typography } from "antd";
import { formatBytes } from "libs/format_utils";
import Toast from "libs/toast";
import { useState } from "react";
import { ModalWidth } from "theme";

export type AlignmentProjectDeletionMode = "inputData" | "project";

const { Text } = Typography;

export function DeleteAlignmentProjectModal({
  project,
  hasActiveJobs,
  isOpen,
  onClose,
  onDeleted,
}: {
  project: APIAlignmentProject;
  hasActiveJobs: boolean;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: (mode: AlignmentProjectDeletionMode) => void;
}) {
  const [mode, setMode] = useState<AlignmentProjectDeletionMode>(
    project.isInputDataDeleted ? "project" : "inputData",
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      if (mode === "inputData") {
        await deleteAlignmentProjectInputData(project.id);
        Toast.success(
          project.totalSizeInBytes != null
            ? `Deleted input data and freed ${formatBytes(project.totalSizeInBytes, 1)}.`
            : "Deleted input data.",
        );
      } else {
        await deleteAlignmentProject(project.id);
        Toast.success("Alignment project deleted.");
      }
      onDeleted(mode);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      title={`Delete "${project.name}"`}
      open={isOpen}
      onCancel={onClose}
      onOk={handleDelete}
      okText={mode === "inputData" ? "Delete Input Data" : "Delete Project"}
      okButtonProps={{ danger: true }}
      confirmLoading={isDeleting}
      width={ModalWidth.Medium}
      destroyOnHidden
    >
      <Flex vertical gap="middle">
        <Radio.Group
          value={mode}
          onChange={(event) => setMode(event.target.value)}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <Radio value="inputData" disabled={project.isInputDataDeleted}>
            <Text strong>Delete input data only</Text>
            <br />
            <Text type="secondary">
              {project.isInputDataDeleted
                ? "The input data was already deleted."
                : project.fileCount != null && project.totalSizeInBytes != null
                  ? `Deletes the ${project.fileCount.toLocaleString()} uploaded files and frees ${formatBytes(project.totalSizeInBytes, 1)} of storage. The project and its list of alignments are kept, but no new alignments can be started.`
                  : "Deletes the uploaded files. The project and its list of alignments are kept, but no new alignments can be started."}
            </Text>
          </Radio>
          <Radio value="project">
            <Text strong>Delete whole project</Text>
            <br />
            <Text type="secondary">
              Deletes the uploaded files as well as the project itself, including its name,
              description and list of alignments.
            </Text>
          </Radio>
        </Radio.Group>
        <Text type="secondary">
          Datasets that were created by alignments of this project are kept in both cases.
        </Text>
        {hasActiveJobs && (
          <Alert
            type="warning"
            showIcon
            title="Running alignments of this project will be cancelled."
          />
        )}
      </Flex>
    </Modal>
  );
}

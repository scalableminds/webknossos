import { type APIAlignmentProject, deleteAlignmentProject } from "admin/api/alignment_projects";
import { Alert, Flex, Modal, Typography } from "antd";
import Toast from "libs/toast";
import { useState } from "react";
import { ModalWidth } from "theme";

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
  onDeleted: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteAlignmentProject(project.id);
      Toast.success("Alignment project deleted.");
      onDeleted();
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
      okText="Delete Project"
      okButtonProps={{ danger: true }}
      confirmLoading={isDeleting}
      width={ModalWidth.Medium}
      destroyOnHidden
    >
      <Flex vertical gap="middle">
        <Text>
          {project.isInputDataDeleted
            ? "Deletes the project, including its name, description and list of alignments. Its uploaded files were already deleted."
            : "Deletes the uploaded files as well as the project itself, including its name, description and list of alignments."}
          {project.status === "UPLOADING" ? " The unfinished upload is cancelled." : null}
        </Text>
        <Text type="secondary">
          Datasets that were created by alignments of this project are kept.
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

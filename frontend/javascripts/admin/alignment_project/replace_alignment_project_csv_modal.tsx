import { type APIAlignmentProject, replaceAlignmentProjectCsv } from "admin/api/alignment_projects";
import { DropzonePrompt, FileSelection } from "admin/dataset/upload/dataset_file_selection";
import { Alert, Flex, Modal, Typography } from "antd";
import Toast from "libs/toast";
import { useState } from "react";
import type { FileWithPath } from "react-dropzone";
import { ModalWidth } from "theme";
import { formatSectionRange } from "./alignment_project_utils";

const { Text } = Typography;

export function ReplaceAlignmentProjectCsvModal({
  project,
  onClose,
  onReplaced,
}: {
  project: APIAlignmentProject;
  onClose: () => void;
  onReplaced: () => void;
}) {
  const [csvFile, setCsvFile] = useState<FileWithPath | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);

  const handleReplace = async () => {
    if (csvFile == null) return;
    setIsReplacing(true);
    try {
      const { sectionRange } = await replaceAlignmentProjectCsv(project, csvFile as File);
      Toast.success(
        `Replaced the CSV. The project now has sections ${formatSectionRange(sectionRange)}.`,
      );
      onReplaced();
      onClose();
    } catch (_error) {
      // The request library already shows why the CSV was rejected.
    } finally {
      setIsReplacing(false);
    }
  };

  return (
    <Modal
      title="Replace Tile CSV"
      open
      onCancel={onClose}
      onOk={handleReplace}
      okText="Replace CSV"
      okButtonProps={{ disabled: csvFile == null }}
      confirmLoading={isReplacing}
      width={ModalWidth.Medium}
    >
      <Flex vertical gap="middle">
        <Text>
          Replace the CSV file to make corrections in initial tile positions or to skip tiles for
          next alignment runs.
        </Text>
        <FileSelection
          isFolderSelectable={false}
          isMultiple={false}
          accept=".csv,text/csv"
          onDropRejected={() => Toast.error("Please select a single CSV file.")}
          fileList={csvFile != null ? [csvFile] : []}
          onChange={(files) => setCsvFile(files.at(0) ?? null)}
          renderEmptyContent={({ chooseFiles }) => (
            <DropzonePrompt title="Drop the new tile CSV here" onChooseFiles={chooseFiles} />
          )}
        />
        {project.status === "INVALID" && project.invalidReason != null && (
          <Alert
            type="info"
            showIcon
            title="Problem with the current CSV"
            description={project.invalidReason}
          />
        )}
      </Flex>
    </Modal>
  );
}

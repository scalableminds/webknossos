import { type APIAlignmentProject, replaceAlignmentProjectCsv } from "admin/api/alignment_projects";
import { FileDropzone } from "admin/dataset/components/upload_components";
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
  const csvDirectory =
    project.csvPath != null ? project.csvPath.split("/").slice(0, -1).join("/") : "";

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
          The new CSV is checked before it is used. It is stored next to the current one, in{" "}
          <Text code>{csvDirectory === "" ? "the project root folder" : `${csvDirectory}/`}</Text>,
          so its paths must be relative to that folder. Running and past alignments keep using the
          CSV they were started with.
        </Text>
        <FileDropzone
          onDropAccepted={(files) => {
            const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
            if (csvFiles.length !== 1) {
              Toast.error("Please select a single CSV file.");
              return;
            }
            setCsvFile(csvFiles[0]);
          }}
        >
          {csvFile != null ? (
            <>
              Selected <Text code>{csvFile.name}</Text>. Drop another file to change it.
            </>
          ) : (
            "Drag the new tile CSV to this area or click to select it."
          )}
        </FileDropzone>
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

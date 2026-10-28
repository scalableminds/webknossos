import {
  FileImageOutlined,
  FileOutlined,
  FileZipOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import { Button, Flex, List, Modal, Space, Tag, Typography } from "antd";
import classnames from "classnames";
import features from "features";
import uniqBy from "lodash-es/uniqBy";
import without from "lodash-es/without";
import type React from "react";
import { type ChangeEvent, type RefObject, useMemo, useRef, useState } from "react";
import { type FileWithPath, useDropzone } from "react-dropzone";
import { ModalWidth } from "theme";
import { type SelectionSummary, summarizeSelection } from "./detect_dataset_format";
import { FolderStructureHelpModal } from "./folder_structure_help";
import { InspectionBanner } from "./inspection_banner";
import type { FileInspection } from "./use_file_inspection";

const FORMAT_TAGS = [
  { label: "TIFF / PNG / JPG stacks", needsConversion: true },
  { label: "OME-Zarr", needsConversion: false },
  { label: "Zarr", needsConversion: false },
  { label: "WKW", needsConversion: false },
  { label: "N5", needsConversion: false },
  { label: "Neuroglancer Precomputed", needsConversion: false },
  { label: "CZI · IMS · DM3/4", needsConversion: true },
];

const SELECTION_ICONS: Record<SelectionSummary["kind"], React.ReactNode> = {
  folder: <FolderOutlined />,
  archive: <FileZipOutlined />,
  files: <FileImageOutlined />,
};

// Folders picked via <input webkitdirectory> only carry a relative path, whereas
// dropped folders are prefixed with a slash. Align both so that re-adding files dedupes.
function withFolderPaths(files: File[]): FileWithPath[] {
  return files.map((file) => {
    if (!("path" in file)) {
      Object.defineProperty(file, "path", { value: `/${file.webkitRelativePath || file.name}` });
    }
    return file as FileWithPath;
  });
}

function FolderInput({
  inputRef,
  onFilesSelected,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onFilesSelected: (files: FileWithPath[]) => void;
}) {
  return (
    <input
      type="file"
      hidden
      ref={(element) => {
        inputRef.current = element;
        element?.setAttribute("webkitdirectory", "");
      }}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        onFilesSelected(withFolderPaths(Array.from(event.target.files ?? [])));
        // Allow picking the same folder again.
        event.target.value = "";
      }}
    />
  );
}

export function DropzonePrompt({
  title,
  onChooseFolder,
  onChooseFiles,
  children,
}: {
  title: React.ReactNode;
  onChooseFolder?: () => void;
  onChooseFiles: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Flex vertical align="center" gap="middle">
      <InboxOutlined className="dataset-upload-dropzone-icon" />
      <Typography.Title level={4} style={{ margin: 0, fontWeight: 600 }}>
        {title}
      </Typography.Title>
      <Space>
        {onChooseFolder != null ? (
          <Button size="large" icon={<FolderOpenOutlined />} onClick={onChooseFolder}>
            Choose folder
          </Button>
        ) : null}
        <Button size="large" icon={<FileOutlined />} onClick={onChooseFiles}>
          Choose files
        </Button>
      </Space>
      {children != null ? (
        <Flex vertical align="center" gap="small" style={{ marginTop: 24, maxWidth: 720 }}>
          {children}
        </Flex>
      ) : null}
    </Flex>
  );
}

function EmptyDropzoneContent({
  onChooseFolder,
  onChooseFiles,
  onShowFolderHelp,
  isDatasetConversionEnabled,
}: {
  onChooseFolder?: () => void;
  onChooseFiles: () => void;
  onShowFolderHelp: () => void;
  isDatasetConversionEnabled: boolean;
}) {
  const formatTags = FORMAT_TAGS.filter(
    (tag) => isDatasetConversionEnabled || !tag.needsConversion,
  ).map((tag) => tag.label);

  return (
    <DropzonePrompt
      title={
        isDatasetConversionEnabled
          ? "Drop a folder, a zip file or image files here"
          : "Drop a folder or a zip file in WEBKNOSSOS format here"
      }
      onChooseFolder={onChooseFolder}
      onChooseFiles={onChooseFiles}
    >
      <Typography.Text type="secondary">Works with</Typography.Text>
      <Flex wrap justify="center" gap={8}>
        {formatTags.map((tag) => (
          <Tag key={tag} variant="outlined" style={{ marginInlineEnd: 0 }}>
            {tag}
          </Tag>
        ))}
      </Flex>
      <Button type="link" onClick={onShowFolderHelp}>
        How should my folder look?
      </Button>
      {features().recommendWkorgInstance && !isDatasetConversionEnabled ? (
        <Typography.Text type="secondary">
          Need to upload other formats? <a href="https://webknossos.org">webknossos.org</a> converts
          them automatically. <a href="https://webknossos.org/self-hosted-upgrade">Learn more</a>
        </Typography.Text>
      ) : null}
    </DropzonePrompt>
  );
}

function FileListModal({
  files,
  open,
  onClose,
  onRemoveFile,
}: {
  files: FileWithPath[];
  open: boolean;
  onClose: () => void;
  onRemoveFile: (file: FileWithPath) => void;
}) {
  return (
    <Modal
      title="Selected files"
      open={open}
      onCancel={onClose}
      footer={null}
      width={ModalWidth.Large}
    >
      <List
        size="small"
        dataSource={files}
        style={{ maxHeight: 600, overflowY: "auto" }}
        renderItem={(file) => {
          const directory = (file.path ?? "").split("/").slice(0, -1).join("/");
          return (
            <List.Item
              actions={[
                <Button key="remove" type="link" size="small" onClick={() => onRemoveFile(file)}>
                  Remove
                </Button>,
              ]}
            >
              <Typography.Text ellipsis>
                {directory ? (
                  <Typography.Text type="secondary">{directory}/</Typography.Text>
                ) : null}
                {file.name}
              </Typography.Text>
            </List.Item>
          );
        }}
      />
    </Modal>
  );
}

function SelectedFilesCard({
  files,
  banner,
  onShowFiles,
  onReplace,
}: {
  files: FileWithPath[];
  banner: React.ReactNode;
  onShowFiles: () => void;
  onReplace: () => void;
}) {
  const summary = useMemo(() => summarizeSelection(files), [files]);
  return (
    <div className="dataset-upload-selection">
      <Flex align="center" gap="middle" className="dataset-upload-selection-header">
        <div className="dataset-upload-selection-icon">{SELECTION_ICONS[summary.kind]}</div>
        <Flex vertical style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong ellipsis style={{ fontSize: 16 }}>
            {summary.title}
          </Typography.Text>
          <Typography.Text type="secondary" ellipsis>
            {summary.subtitle}
          </Typography.Text>
        </Flex>
        <Space size={0}>
          <Button type="link" onClick={onShowFiles}>
            Show files
          </Button>
          <Button type="link" onClick={onReplace}>
            Replace
          </Button>
        </Space>
      </Flex>
      {banner}
    </div>
  );
}

/**
 * Form control for the files to upload: an empty dropzone, or a summary of the selected files
 * with a banner below it. Files dropped onto the summary are added to the selection.
 */
export function FileSelection({
  fileList = [],
  onChange,
  renderEmptyContent,
  banner,
  isFolderSelectable = true,
  isMultiple = true,
  accept,
  onDropRejected,
}: {
  fileList?: FileWithPath[];
  onChange?: (files: FileWithPath[]) => void;
  renderEmptyContent: (actions: {
    chooseFolder?: () => void;
    chooseFiles: () => void;
  }) => React.ReactNode;
  banner?: React.ReactNode;
  isFolderSelectable?: boolean;
  // If false, a newly added file replaces the selected one.
  isMultiple?: boolean;
  accept?: string;
  // E.g. when files of other types or, with isMultiple=false, several files are dropped.
  onDropRejected?: () => void;
}) {
  const [isFileListOpen, setIsFileListOpen] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = (addedFiles: FileWithPath[]) => {
    if (!isMultiple) {
      onChange?.(addedFiles.slice(0, 1));
      return;
    }
    // file.path should be set by react-dropzone (which uses file-selector::toFileWithPath).
    onChange?.(uniqBy(fileList.concat(addedFiles), (file) => file.path));
  };
  const removeFile = (file: FileWithPath) => {
    const remainingFiles = without(fileList, file);
    if (remainingFiles.length === 0) setIsFileListOpen(false);
    onChange?.(remainingFiles);
  };

  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    onDropAccepted: addFiles,
    multiple: isMultiple,
    accept,
    onDropRejected,
    noClick: true,
    noKeyboard: true,
  });
  const hasFiles = fileList.length > 0;

  return (
    <>
      <div
        {...getRootProps({
          className: classnames({
            "dataset-upload-dropzone": !hasFiles,
            "dataset-upload-dropzone-active": isDragActive,
          }),
        })}
      >
        <input {...getInputProps()} />
        {isFolderSelectable ? (
          <FolderInput inputRef={folderInputRef} onFilesSelected={addFiles} />
        ) : null}
        {hasFiles ? (
          <SelectedFilesCard
            files={fileList}
            banner={banner}
            onShowFiles={() => setIsFileListOpen(true)}
            onReplace={() => onChange?.([])}
          />
        ) : (
          renderEmptyContent({
            chooseFolder: isFolderSelectable ? () => folderInputRef.current?.click() : undefined,
            chooseFiles: open,
          })
        )}
      </div>
      <FileListModal
        files={fileList}
        open={isFileListOpen}
        onClose={() => setIsFileListOpen(false)}
        onRemoveFile={removeFile}
      />
    </>
  );
}

/** Form control for the files of a dataset upload, including the inferred format. */
export function DatasetFileSelection({
  fileList,
  onChange,
  inspection,
  isDatasetConversionEnabled,
}: {
  fileList?: FileWithPath[];
  onChange?: (files: FileWithPath[]) => void;
  inspection: FileInspection;
  isDatasetConversionEnabled: boolean;
}) {
  const [isFolderHelpOpen, setIsFolderHelpOpen] = useState(false);
  return (
    <>
      <FileSelection
        fileList={fileList}
        onChange={onChange}
        banner={
          <InspectionBanner
            inspection={inspection}
            isDatasetConversionEnabled={isDatasetConversionEnabled}
          />
        }
        renderEmptyContent={({ chooseFolder, chooseFiles }) => (
          <EmptyDropzoneContent
            onChooseFolder={chooseFolder}
            onChooseFiles={chooseFiles}
            onShowFolderHelp={() => setIsFolderHelpOpen(true)}
            isDatasetConversionEnabled={isDatasetConversionEnabled}
          />
        )}
      />
      <FolderStructureHelpModal
        open={isFolderHelpOpen}
        onClose={() => setIsFolderHelpOpen(false)}
        isDatasetConversionEnabled={isDatasetConversionEnabled}
      />
    </>
  );
}

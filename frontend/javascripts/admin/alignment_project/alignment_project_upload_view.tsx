import { InboxOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  finishAlignmentProjectUpload,
  reserveAlignmentProjectUpload,
} from "admin/api/alignment_projects";
import { refreshToken } from "admin/api/token";
import { CardContainer, DatastoreFormItem } from "admin/dataset/dataset_components";
import { createResumableUpload } from "admin/rest_api";
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  Progress,
  Row,
  Select,
  Typography,
  Upload,
  type UploadFile,
} from "antd";
import { formatBytes } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import type { ResumableUploadEvent } from "libs/resumable_upload/resumable_upload";
import Toast from "libs/toast";
import { Vector3Input } from "libs/vector_input";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { APIDataStore } from "types/api_types";
import { AllUnits, LongUnitToShortUnitMap, UnitLong, type Vector3 } from "viewer/constants";

type FormValues = {
  name: string;
  description: string;
  datastoreUrl: string;
  voxelSize: Vector3;
  voxelSizeUnit: UnitLong;
};

function generateUploadId(): string {
  const randomBytes = window.crypto.getRandomValues(new Uint8Array(6));
  const randomString = Array.from(randomBytes, (byte) => `0${byte.toString(16)}`.slice(-2)).join(
    "",
  );
  return `${new Date().toISOString().replace(/[:.]/g, "-")}__alignmentProject__${randomString}`;
}

// The resumable upload identifies files by their `path`, which react-dropzone sets for dataset
// uploads. Here, it is derived from the path relative to the selected folder.
function withPath(file: File): File & { path: string } {
  if (!("path" in file)) {
    Object.defineProperty(file, "path", { value: file.webkitRelativePath || file.name });
  }
  return file as File & { path: string };
}

export default function AlignmentProjectUploadView({ datastores }: { datastores: APIDataStore[] }) {
  const [form] = Form.useForm<FormValues>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeUser = useWkSelector((state) => state.activeUser);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
  // A single zip is unpacked by the datastore, which then checks for the CSV.
  const isZipUpload = files.length === 1 && files[0].name.toLowerCase().endsWith(".zip");
  const totalSizeInBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);

  useEffect(() => {
    if (!isUploading) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isUploading]);

  const getFileAlert = () => {
    if (files.length === 0 || isZipUpload) return null;
    if (csvFiles.length === 0) {
      return { type: "error" as const, title: "No CSV file found among the selected files." };
    }
    if (csvFiles.length > 1) {
      return {
        type: "error" as const,
        title: `Found ${csvFiles.length} CSV files (${csvFiles.map((f) => f.name).join(", ")}). Only one is allowed.`,
      };
    }
    return null;
  };
  const fileAlert = getFileAlert();

  const handleUploadFailure = (message: string) => {
    Toast.error(message);
    setIsUploading(false);
    setUploadProgress(0);
  };

  const handleSubmit = async (values: FormValues) => {
    if (!isZipUpload && csvFiles.length !== 1) {
      Toast.error(
        "Please select the tile images together with exactly one CSV file, or a single ZIP file containing them.",
      );
      return;
    }
    if (activeUser == null) return;
    const filesWithPath = files.flatMap((file) =>
      file.originFileObj != null ? [withPath(file.originFileObj)] : [],
    );
    const uploadId = generateUploadId();
    const datastoreUrl = values.datastoreUrl;
    setIsUploading(true);
    try {
      await refreshToken();
      await reserveAlignmentProjectUpload(datastoreUrl, {
        resumableUploadInfo: {
          uploadId,
          totalFileCount: filesWithPath.length,
          filePaths: filesWithPath.map((file) => file.path),
          totalFileSizeInBytes: totalSizeInBytes,
        },
        name: values.name,
        description: values.description ?? "",
        organizationId: activeUser.organization,
        voxelSizeFactor: values.voxelSize,
        voxelSizeUnit: values.voxelSizeUnit,
      });
    } catch (_error) {
      // The request library already shows the error, e.g. for a duplicate name.
      setIsUploading(false);
      return;
    }

    const resumableUpload = await createResumableUpload(datastoreUrl, uploadId, "alignmentProject");
    let finishUploadCalled = false;
    resumableUpload.addEventListener("complete", async (event: ResumableUploadEvent) => {
      if (
        event.detail.type !== "complete" ||
        !event.detail.didUploadCompleteSuccessfully ||
        finishUploadCalled
      ) {
        return;
      }
      finishUploadCalled = true;
      try {
        const { alignmentProjectId } = await finishAlignmentProjectUpload(datastoreUrl, uploadId);
        await queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
        Toast.success("Alignment project uploaded successfully.");
        navigate(`/alignmentProjects/${alignmentProjectId}`);
      } catch (_error) {
        handleUploadFailure("Could not finish the upload of the alignment project.");
      }
    });
    resumableUpload.addEventListener("filesAdded", () => resumableUpload.upload());
    resumableUpload.addEventListener("progress", () =>
      setUploadProgress(resumableUpload.progress()),
    );
    resumableUpload.addEventListener("terminalFileError", (event: ResumableUploadEvent) => {
      if (event.detail.type === "terminalFileError") handleUploadFailure(event.detail.message);
    });
    resumableUpload.addFiles(filesWithPath);
  };

  return (
    <div style={{ padding: 5 }}>
      <CardContainer
        title="Upload Files for Alignment Project"
        subtitle="Upload unaligned (tiled) image data together with a CSV that lists the tile positions. You can then start one or more alignments from the project page."
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ voxelSizeUnit: UnitLong.nm }}
          disabled={isUploading}
        >
          <DatastoreFormItem datastores={datastores} hidden={datastores.length <= 1} />
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="Project Name"
                rules={[{ required: true, message: "Please provide a name for the project." }]}
              >
                <Input placeholder="e.g. Mouse Cortex L4 – Serial Sections" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="voxelSize"
                label="Voxel Size"
                tooltip="The extent (x, y, z) of one voxel. Used for the aligned output datasets."
                rules={[{ required: true, message: "Please provide a voxel size." }]}
              >
                <Vector3Input allowDecimals placeholder="e.g. 4, 4, 35" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="voxelSizeUnit" label="Unit" rules={[{ required: true }]}>
                <Select
                  options={AllUnits.map((unit) => ({
                    value: unit,
                    label: LongUnitToShortUnitMap[unit],
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>

          <Form.Item
            label="Files"
            required
            tooltip="The tile images plus one CSV, either as a folder or as a single ZIP file. Each CSV row is section,x,y,path with the path relative to the CSV, e.g. 5,0,240,./005_000_001_000_n_00.tif"
            extra={
              files.length > 0 ? (
                <Typography.Link onClick={() => setFiles([])}>Clear selection</Typography.Link>
              ) : (
                <>
                  Alternatively,{" "}
                  <Upload
                    accept=".zip"
                    showUploadList={false}
                    beforeUpload={() => false}
                    onChange={({ file }) => setFiles([file])}
                  >
                    <Typography.Link>select a ZIP file</Typography.Link>
                  </Upload>{" "}
                  containing the tile images and the tile CSV.
                </>
              )
            }
          >
            <Upload.Dragger
              multiple
              directory
              showUploadList={false}
              fileList={files}
              beforeUpload={() => false}
              onChange={({ fileList }) => setFiles(fileList)}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              {files.length === 0 ? (
                <p className="ant-upload-text">
                  Drop the folder containing the tile images and the tile CSV (or a ZIP file of it)
                  here or click to select the folder
                </p>
              ) : isZipUpload ? (
                <p className="ant-upload-text">
                  {files[0].name} selected ({formatBytes(totalSizeInBytes, 1)}), will be unpacked
                  after the upload
                </p>
              ) : (
                <p className="ant-upload-text">
                  {files.length.toLocaleString()} files selected ({formatBytes(totalSizeInBytes, 1)}
                  )
                </p>
              )}
            </Upload.Dragger>
          </Form.Item>

          {fileAlert != null && (
            <Alert
              type={fileAlert.type}
              showIcon
              style={{ marginBottom: 24 }}
              title={fileAlert.title}
            />
          )}

          {isUploading && <Progress percent={Math.round(uploadProgress * 100)} />}

          <Button type="primary" htmlType="submit" size="large" block loading={isUploading}>
            Upload
          </Button>
        </Form>
      </CardContainer>
    </div>
  );
}

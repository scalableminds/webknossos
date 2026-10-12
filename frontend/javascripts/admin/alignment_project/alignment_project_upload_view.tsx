import { useQueryClient } from "@tanstack/react-query";
import {
  deleteAlignmentProject,
  finishAlignmentProjectUpload,
  reserveAlignmentProjectUpload,
} from "admin/api/alignment_projects";
import { refreshToken } from "admin/api/token";
import {
  FileDropzone,
  UploadedFileList,
  UploadProgressModal,
} from "admin/dataset/components/upload_components";
import { CardContainer, DatastoreFormItem } from "admin/dataset/dataset_components";
import { createResumableUpload } from "admin/rest_api";
import { Alert, App, Button, Col, Form, Input, Row, Select } from "antd";
import { useWkSelector } from "libs/react_hooks";
import type ResumableUpload from "libs/resumable_upload/resumable_upload";
import type { ResumableUploadEvent } from "libs/resumable_upload/resumable_upload";
import Toast from "libs/toast";
import { Vector3Input } from "libs/vector_input";
import uniqBy from "lodash-es/uniqBy";
import without from "lodash-es/without";
import { useEffect, useRef, useState } from "react";
import type { FileWithPath } from "react-dropzone";
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

type UploadState = {
  isUploading: boolean;
  isFinishing: boolean;
  isRetrying: boolean;
  progress: number;
};

const initialUploadState: UploadState = {
  isUploading: false,
  isFinishing: false,
  isRetrying: false,
  progress: 0,
};

function generateUploadId(): string {
  const randomBytes = window.crypto.getRandomValues(new Uint8Array(6));
  const randomString = Array.from(randomBytes, (byte) => `0${byte.toString(16)}`.slice(-2)).join(
    "",
  );
  return `${new Date().toISOString().replace(/[:.]/g, "-")}__alignmentProject__${randomString}`;
}

export default function AlignmentProjectUploadView({ datastores }: { datastores: APIDataStore[] }) {
  const [form] = Form.useForm<FormValues>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { modal } = App.useApp();
  const activeUser = useWkSelector((state) => state.activeUser);
  const [files, setFiles] = useState<FileWithPath[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>(initialUploadState);
  const resumableUploadRef = useRef<ResumableUpload | null>(null);
  const alignmentProjectIdRef = useRef<string | null>(null);
  const isCancellingRef = useRef(false);

  const uploadableDatastores = datastores.filter((datastore) => datastore.allowsUpload);
  const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
  // A single zip is unpacked by the datastore, which then checks for the CSV.
  const isZipUpload = files.length === 1 && files[0].name.toLowerCase().endsWith(".zip");
  const totalSizeInBytes = files.reduce((sum, file) => sum + file.size, 0);

  // The datastores are loaded asynchronously, so the initial value of the (possibly hidden) field
  // would be empty. Select the first one once they are known.
  useEffect(() => {
    if (uploadableDatastores.length > 0 && form.getFieldValue("datastoreUrl") == null) {
      form.setFieldValue("datastoreUrl", uploadableDatastores[0].url);
    }
  }, [form, uploadableDatastores]);

  useEffect(() => {
    if (!uploadState.isUploading) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [uploadState.isUploading]);

  const getFileAlert = () => {
    if (files.length === 0 || isZipUpload) return null;
    if (csvFiles.length === 0) {
      return { type: "error" as const, title: "No CSV file found among the selected files." };
    }
    if (csvFiles.length > 1) {
      return {
        type: "error" as const,
        title: `Found ${csvFiles.length} CSV files (${csvFiles.map((f) => f.path).join(", ")}). Only one is allowed.`,
      };
    }
    return null;
  };
  const fileAlert = getFileAlert();

  const handleUploadFailure = (message: string) => {
    Toast.error(message);
    setUploadState(initialUploadState);
  };

  // Deleting the project makes WEBKNOSSOS cancel the upload on the datastore, removing the uploaded files.
  const cancelUpload = async () => {
    const resumableUpload = resumableUploadRef.current;
    if (resumableUpload == null) return;
    isCancellingRef.current = true;
    resumableUpload.pause();
    const shouldCancel = await modal.confirm({
      title:
        "Cancelling the running upload will delete already uploaded files on the server and cannot be undone. Are you sure you want to cancel the upload?",
      okText: "Yes, cancel the upload",
      cancelText: "No, keep it running",
    });
    if (!shouldCancel) {
      isCancellingRef.current = false;
      resumableUpload.upload();
      return;
    }
    resumableUpload.cancel();
    if (alignmentProjectIdRef.current != null) {
      await deleteAlignmentProject(alignmentProjectIdRef.current);
    }
    setUploadState(initialUploadState);
    await queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
    Toast.success("The upload was cancelled.");
  };

  const handleSubmit = async (values: FormValues) => {
    if (!isZipUpload && csvFiles.length !== 1) {
      Toast.error(
        "Please select the tile images together with exactly one CSV file, or a single ZIP file containing them.",
      );
      return;
    }
    if (activeUser == null) return;
    const uploadId = generateUploadId();
    const datastoreUrl = values.datastoreUrl;
    isCancellingRef.current = false;
    setUploadState({ ...initialUploadState, isUploading: true });
    try {
      await refreshToken();
      const { newAlignmentProjectId } = await reserveAlignmentProjectUpload(datastoreUrl, {
        resumableUploadInfo: {
          uploadId,
          totalFileCount: files.length,
          filePaths: files.map((file) => file.path ?? file.name),
          totalFileSizeInBytes: totalSizeInBytes,
        },
        name: values.name,
        description: values.description ?? "",
        organizationId: activeUser.organization,
        voxelSizeFactor: values.voxelSize,
        voxelSizeUnit: values.voxelSizeUnit,
      });
      alignmentProjectIdRef.current = newAlignmentProjectId;
    } catch (_error) {
      // The request library already shows the error, e.g. for a duplicate name.
      setUploadState(initialUploadState);
      return;
    }

    const resumableUpload = await createResumableUpload(datastoreUrl, uploadId, "alignmentProject");
    resumableUploadRef.current = resumableUpload;
    let finishUploadCalled = false;
    resumableUpload.addEventListener("complete", async (event: ResumableUploadEvent) => {
      if (
        event.detail.type !== "complete" ||
        !event.detail.didUploadCompleteSuccessfully ||
        isCancellingRef.current ||
        finishUploadCalled
      ) {
        return;
      }
      finishUploadCalled = true;
      resumableUpload.pause();
      setUploadState((state) => ({ ...state, isFinishing: true }));
      try {
        const { alignmentProjectId } = await finishAlignmentProjectUpload(datastoreUrl, uploadId);
        setUploadState(initialUploadState);
        await queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
        Toast.success("Alignment project uploaded successfully.");
        navigate(`/alignmentProjects/${alignmentProjectId}`);
      } catch (_error) {
        handleUploadFailure("Could not finish the upload of the alignment project.");
      }
    });
    resumableUpload.addEventListener("filesAdded", () => resumableUpload.upload());
    resumableUpload.addEventListener("progress", () =>
      setUploadState((state) => ({
        ...state,
        isRetrying: false,
        progress: resumableUpload.progress(),
      })),
    );
    resumableUpload.addEventListener("fileRetry", () =>
      setUploadState((state) => ({ ...state, isRetrying: true })),
    );
    // terminalFileError is triggered when a normal fileError could not be recovered by refreshing the token.
    resumableUpload.addEventListener("terminalFileError", (event: ResumableUploadEvent) => {
      if (event.detail.type === "terminalFileError") handleUploadFailure(event.detail.message);
    });
    resumableUpload.addFiles(files as File[]);
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
          onFinishFailed={({ errorFields }) =>
            Toast.error(errorFields.flatMap((field) => field.errors).join(" "))
          }
          initialValues={{ voxelSizeUnit: UnitLong.nm }}
        >
          <DatastoreFormItem
            datastores={uploadableDatastores}
            hidden={uploadableDatastores.length <= 1}
          />
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

          <Form.Item label="Files" required>
            <FileDropzone
              onDropAccepted={(acceptedFiles) =>
                setFiles(uniqBy(files.concat(acceptedFiles), (file) => file.path))
              }
            >
              Drag the tile images and the tile CSV to this area, either as a folder or as a single
              ZIP archive.
              <br />
              Each CSV row is <code>section,x,y,path</code>, with the path relative to the CSV, e.g.{" "}
              <code>5,0,240,./005_000_001_000_n_00.tif</code>
            </FileDropzone>
            <UploadedFileList files={files} onRemove={(file) => setFiles(without(files, file))} />
          </Form.Item>

          {fileAlert != null && (
            <Alert
              type={fileAlert.type}
              showIcon
              style={{ marginBottom: 24 }}
              title={fileAlert.title}
            />
          )}

          <Button type="primary" htmlType="submit" size="large" block>
            Upload
          </Button>
        </Form>
      </CardContainer>
      <UploadProgressModal
        title="Alignment Project Upload"
        label={`alignment project ${form.getFieldValue("name") ?? ""}`}
        isOpen={uploadState.isUploading}
        isFinishing={uploadState.isFinishing}
        isRetrying={uploadState.isRetrying}
        progress={uploadState.progress}
        onCancel={cancelUpload}
      />
    </div>
  );
}

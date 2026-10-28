import { useQueryClient } from "@tanstack/react-query";
import {
  deleteAlignmentProject,
  finishAlignmentProjectUpload,
  getAlignmentProject,
  reserveAlignmentProjectUpload,
} from "admin/api/alignment_projects";
import { CardContainer, DatastoreFormItem } from "admin/dataset/dataset_components";
import { DropzonePrompt, FileSelection } from "admin/dataset/upload/dataset_file_selection";
import { getTotalFileSize, inferDatasetName } from "admin/dataset/upload/detect_dataset_format";
import { SelectionBanner } from "admin/dataset/upload/inspection_banner";
import { UploadProgressModal } from "admin/dataset/upload/upload_progress_modal";
import { getRandomString, useResumableUpload } from "admin/dataset/upload/use_resumable_upload";
import {
  type AlertProps,
  Button,
  Col,
  Collapse,
  Divider,
  Flex,
  Form,
  Input,
  Row,
  Select,
  Typography,
} from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { Vector3Input } from "libs/vector_input";
import { useEffect, useMemo } from "react";
import type { FileWithPath } from "react-dropzone";
import { useNavigate } from "react-router";
import type { APIDataStore } from "types/api_types";
import { syncValidator } from "types/validation";
import { AllUnits, LongUnitToShortUnitMap, UnitLong, type Vector3 } from "viewer/constants";

const EMPTY_FILES: FileWithPath[] = [];

type FormValues = {
  name: string;
  files: FileWithPath[];
  datastoreUrl: string;
  voxelSize: Vector3;
  voxelSizeUnit: UnitLong;
};

function generateUploadId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}__alignmentProject__${getRandomString()}`;
}

// A single zip is unpacked by the datastore, which then checks for the CSV.
function isZipUpload(files: FileWithPath[]): boolean {
  return files.length === 1 && files[0].name.toLowerCase().endsWith(".zip");
}

function checkFileSelection(files: FileWithPath[]): {
  bannerProps: AlertProps | null;
  isValid: boolean;
} {
  if (files.length === 0) return { bannerProps: null, isValid: false };
  if (isZipUpload(files)) {
    return {
      bannerProps: {
        type: "info",
        title: "The tile CSV in the archive is checked after the upload.",
      },
      isValid: true,
    };
  }
  const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
  if (csvFiles.length === 0) {
    return {
      bannerProps: { type: "error", title: "No CSV file found among the selected files." },
      isValid: false,
    };
  }
  if (csvFiles.length > 1) {
    return {
      bannerProps: {
        type: "error",
        title: `Found ${csvFiles.length} CSV files (${csvFiles.map((file) => file.path).join(", ")}). Only one is allowed.`,
      },
      isValid: false,
    };
  }
  return {
    bannerProps: {
      type: "success",
      title: (
        <>
          <strong>Found tile CSV</strong> {csvFiles[0].path}. It is checked after the upload.
        </>
      ),
    },
    isValid: true,
  };
}

export default function AlignmentProjectUploadView({ datastores }: { datastores: APIDataStore[] }) {
  const [form] = Form.useForm<FormValues>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeUser = useWkSelector((state) => state.activeUser);
  const files: FileWithPath[] = Form.useWatch("files", form) ?? EMPTY_FILES;
  const upload = useResumableUpload();

  const uploadableDatastores = useMemo(
    () => datastores.filter((datastore) => datastore.allowsUpload),
    [datastores],
  );
  const fileSelectionCheck = useMemo(() => checkFileSelection(files), [files]);

  // The datastores are loaded asynchronously, so the initial value of the (possibly hidden) field
  // would be empty. Select the first one once they are known.
  useEffect(() => {
    if (uploadableDatastores.length > 0 && form.getFieldValue("datastoreUrl") == null) {
      form.setFieldValue("datastoreUrl", uploadableDatastores[0].url);
    }
  }, [form, uploadableDatastores]);

  const proposeProjectName = (selectedFiles: FileWithPath[]) => {
    if (selectedFiles.length === 0) return;
    // Don't overwrite a name the user typed.
    if (form.isFieldTouched("name") && form.getFieldValue("name")) return;
    form.setFieldsValue({
      name: inferDatasetName(selectedFiles.map((file) => file.path || file.name)),
    });
  };

  // The reserved project stays in UPLOADING, so that the user can see and delete it in the project list.
  const handleUploadFailure = (message: string) => {
    Toast.error(
      `${message} The unfinished alignment project was kept and can be deleted from the list of alignment projects.`,
    );
    queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
  };

  const handleSubmit = (values: FormValues) => {
    if (activeUser == null) return;
    const { files, datastoreUrl } = values;
    const uploadId = generateUploadId();
    let alignmentProjectId: string | null = null;

    upload.startUpload({
      name: values.name,
      files,
      datastoreUrl,
      uploadId,
      uploadDomain: "alignmentProject",
      reserve: async () => {
        const { newAlignmentProjectId } = await reserveAlignmentProjectUpload(datastoreUrl, {
          resumableUploadInfo: {
            uploadId,
            totalFileCount: files.length,
            filePaths: files.map((file) => file.path ?? file.name),
            totalFileSizeInBytes: getTotalFileSize(files),
          },
          name: values.name,
          organizationId: activeUser.organization,
          voxelSizeFactor: values.voxelSize,
          voxelSizeUnit: values.voxelSizeUnit,
        });
        alignmentProjectId = newAlignmentProjectId;
      },
      onStartFailed: () => {
        // Otherwise, the reservation failed, e.g. because of a duplicate name.
        if (alignmentProjectId != null) {
          handleUploadFailure("Could not start the upload of the alignment project.");
        }
      },
      finish: async () => {
        const { alignmentProjectId } = await finishAlignmentProjectUpload(datastoreUrl, uploadId);
        // An invalid CSV does not fail the upload, so that it can be replaced without uploading the tiles again.
        return getAlignmentProject(alignmentProjectId);
      },
      onFinished: (project) => {
        queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
        if (project.status === "INVALID") {
          Toast.warning(
            `The files were uploaded, but the CSV is invalid: ${project.invalidReason ?? "unknown reason"} Please replace the CSV on the project page.`,
          );
        } else {
          Toast.success("Alignment project uploaded successfully.");
        }
        navigate(`/alignmentProjects/${project.id}`);
      },
      onFinishFailed: () =>
        handleUploadFailure("Could not finish the upload of the alignment project."),
      onFileError: handleUploadFailure,
      // Deleting the project makes WEBKNOSSOS cancel the upload on the datastore, removing the uploaded files.
      cancel: async () => {
        if (alignmentProjectId != null) await deleteAlignmentProject(alignmentProjectId);
        Toast.success("The upload was cancelled.");
      },
      onCancelled: () => queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] }),
    });
  };

  return (
    <div>
      <CardContainer
        title="Upload Files for Alignment Project"
        subtitle="Upload unaligned (tiled) image data together with a CSV that lists the tile positions. You can then start one or more alignments from the project page."
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          onValuesChange={(changedValues: Partial<FormValues>) => {
            if (changedValues.files != null) proposeProjectName(changedValues.files);
          }}
          initialValues={{ voxelSizeUnit: UnitLong.nm, files: [] }}
        >
          <Form.Item
            name="files"
            valuePropName="fileList"
            rules={[{ required: true, message: "Please select the files to upload." }]}
          >
            <FileSelection
              banner={<SelectionBanner bannerProps={fileSelectionCheck.bannerProps} />}
              renderEmptyContent={({ chooseFolder, chooseFiles }) => (
                <DropzonePrompt
                  title="Drop a folder or a zip file with the tile images and the tile CSV here"
                  onChooseFolder={chooseFolder}
                  onChooseFiles={chooseFiles}
                >
                  <Typography.Text type="secondary" style={{ textAlign: "center" }}>
                    Each CSV row is <code>section,x,y,path</code>, with the path relative to the
                    CSV, e.g. <code>5,0,240,./005_000_001_000_n_00.tif</code>
                  </Typography.Text>
                </DropzonePrompt>
              )}
            />
          </Form.Item>

          <Typography.Paragraph style={{ marginTop: 32, marginBottom: 16 }}>
            <strong>Project details</strong>
          </Typography.Paragraph>
          <Row gutter={24}>
            <Col xs={24} md={8}>
              <Form.Item
                name="name"
                label="Name"
                rules={[{ required: true, message: "Please provide a name for the project." }]}
              >
                <Input placeholder="e.g. Mouse Cortex L4 – Serial Sections" />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item
                name="voxelSize"
                label="Voxel Size"
                tooltip="The extent (x, y, z) of one voxel. Used for the aligned output datasets."
                rules={[
                  { required: true, message: "Please provide a voxel size." },
                  {
                    validator: syncValidator(
                      (value: Vector3 | undefined) => value == null || value.every((el) => el > 0),
                      "Each component of the voxel size must be larger than 0.",
                    ),
                  },
                ]}
              >
                <Vector3Input
                  allowDecimals
                  disableAutoSize
                  style={{ width: "100%" }}
                  placeholder="e.g. 4, 4, 35"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
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

          {uploadableDatastores.length > 1 ? (
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: "more-options",
                  label: "More options",
                  forceRender: true,
                  children: <DatastoreFormItem datastores={uploadableDatastores} />,
                },
              ]}
            />
          ) : (
            <DatastoreFormItem datastores={uploadableDatastores} hidden />
          )}

          <Divider />
          <Flex justify="end">
            <Button
              size="large"
              type="primary"
              htmlType="submit"
              disabled={!fileSelectionCheck.isValid}
              style={{ minWidth: 160 }}
            >
              Upload
            </Button>
          </Flex>
        </Form>
      </CardContainer>
      <UploadProgressModal
        title="Alignment Project Upload"
        uploadingLabel="Uploading alignment project"
        status={upload.status}
        onCancel={upload.cancelUpload}
      />
    </div>
  );
}

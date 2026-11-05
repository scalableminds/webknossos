import {
  AllowedTeamsFormItem,
  CardContainer,
  DatasetNameFormItem,
  DatastoreFormItem,
} from "admin/dataset/dataset_components";
import { hasPricingPlanExceededStorage } from "admin/organization/pricing_plan_utils";
import { sendAnalyticsEvent, type UnfinishedUpload } from "admin/rest_api";
import {
<<<<<<< HEAD
  getLeftOverStorageBytes,
  hasPricingPlanExceededStorage,
} from "admin/organization/pricing_plan_utils";
import {
  cancelDatasetUpload,
  createResumableUpload,
  finishDatasetUpload,
  generateResumableUploadId,
  getUnfinishedUploads,
  refreshToken,
  reserveDatasetUpload,
  sendAnalyticsEvent,
  sendFailedRequestAnalyticsEvent,
  type UnfinishedUpload,
} from "admin/rest_api";
import { Alert, Button, Col, Form, Popover, Row, Select, Space, Tooltip, Typography } from "antd";
import type { FormInstance } from "antd/es/form";
=======
  Alert,
  Button,
  Col,
  Collapse,
  Divider,
  Flex,
  Form,
  type FormInstance,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
} from "antd";
>>>>>>> 3866b7e6499e7da16a3bc1ab250e71958e6740ef
import FolderSelection from "dashboard/folders/folder_selection";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { isUserAdminOrDatasetManager } from "libs/utils";
import { Vector3Input } from "libs/vector_input";
import messages from "messages";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileWithPath } from "react-dropzone";
import { Link } from "react-router";
import { type APIDataStore, APIJobCommand, type APITeam } from "types/api_types";
import { syncValidator } from "types/validation";
import { AllUnits, LongUnitToShortUnitMap, UnitLong, type Vector3 } from "viewer/constants";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import { FormItemWithInfo } from "../../dashboard/dataset/helper_components";
import { DatasetFileSelection } from "./upload/dataset_file_selection";
import { inferDatasetName } from "./upload/detect_dataset_format";
import { isInspectionBlockingUpload } from "./upload/inspection_banner";
import { UnfinishedUploadsAlert, useUnfinishedUploads } from "./upload/unfinished_uploads_alert";
import { getUploadFileRules } from "./upload/upload_file_rules";
import { UploadProgressModal } from "./upload/upload_progress_modal";
import { needsConversion, useFileInspection } from "./upload/use_file_inspection";
import { useResumableDatasetUpload } from "./upload/use_resumable_dataset_upload";

const EMPTY_FILES: FileWithPath[] = [];

type UploadFormFieldTypes = {
  name: string;
  initialTeams: Array<APITeam>;
  voxelSizeFactor: Vector3;
  zipFile: Array<FileWithPath>;
  targetFolderId: string;
  voxelSizeUnit: UnitLong;
  datastoreUrl: string;
};

type Props = {
  datastores: Array<APIDataStore>;
  withoutCard?: boolean;
  onUploaded: (
    datasetId: string,
    datasetName: string,
    needsConversion: boolean,
  ) => Promise<void> | void;
};

export const dataPrivacyInfo = (
  <Space orientation="horizontal" size={4}>
    Imported data is private to your organization by default.
    <a
      style={{ color: "var(--ant-color-primary)" }}
      href="https://docs.webknossos.org/webknossos/datasets/settings.html#sharing-permissions-tab"
      target="_blank"
      rel="noopener noreferrer"
    >
      Read more
    </a>
  </Space>
);

function useUploadableDatastores(
  datastores: APIDataStore[],
  form: FormInstance<UploadFormFieldTypes>,
) {
  const uploadableDatastores = useMemo(
    () => datastores.filter((datastore) => datastore.allowsUpload),
    [datastores],
  );
  const selectedDatastoreUrl: string | undefined = Form.useWatch("datastoreUrl", form);

  // The datastores are fetched asynchronously, so preselect the first one once they arrive.
  useEffect(() => {
    if (uploadableDatastores.length > 0 && form.getFieldValue("datastoreUrl") == null) {
      form.setFieldsValue({ datastoreUrl: uploadableDatastores[0].url });
    }
  }, [uploadableDatastores, form]);

<<<<<<< HEAD
  componentWillUnmount() {
    this.unblockHistory();
  }

  updateUnfinishedUploads = async () => {
    const currentFormRef = this.formRef.current;
    const datastoreUrl = currentFormRef?.getFieldValue("datastoreUrl");
    const activeOrga = this.props.activeUser?.organization;
    if (!datastoreUrl || !activeOrga) {
      return;
    }
    const unfinishedUploads = await getUnfinishedUploads(datastoreUrl, activeOrga);
    // Sort so that most-recent uploads come first
    unfinishedUploads.sort((a, b) => b.created - a.created);
    this.setState({ unfinishedUploads: unfinishedUploads });
  };

  unblockHistory() {
    window.onbeforeunload = null;
    this.props.blocker.reset ? this.props.blocker.reset() : void 0;

    if (this.blockTimeoutId != null) {
      clearTimeout(this.blockTimeoutId);
      this.blockTimeoutId = null;
    }
  }

  getDatastoreForUrl(url: string): APIDataStore | null | undefined {
    const uploadableDatastores = this.props.datastores.filter(
      (datastore) => datastore.allowsUpload,
    );
    return uploadableDatastores.find((ds) => ds.url === url);
  }

  handleSubmit = async (formValues: UploadFormFieldTypes) => {
    const { activeUser } = this.props;

    if (activeUser == null) {
      return;
    }

    this._isCancellingUpload = false;
    this.setState({
      isUploading: true,
      uploadProgress: 0,
    });

    const beforeUnload = (args: BeforeUnloadEvent | BlockerFunction): boolean | undefined => {
      // Navigation blocking can be triggered by two sources:
      // 1. The browser's native beforeunload event
      // 2. The React-Router block function (useBlocker or withBlocker HOC)

      if (this.state.isUploading) {
        window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event

        this.blockTimeoutId = window.setTimeout(() => {
          // restore the event handler in case a user chose to stay on the page
          window.onbeforeunload = beforeUnload;
        }, 500);
        // The native event requires a truthy return value to show a generic message
        // The React Router blocker accepts a boolean
        return "preventDefault" in args ? true : !confirm(messages["save.leave_page_unfinished"]);
      }

      // The native event requires an empty return value to not show a message
      return;
    };

    const { unfinishedUploadToContinue } = this.state;

    window.onbeforeunload = beforeUnload;
    this.props.setBlocking({
      // @ts-expect-error beforeUnload signature is overloaded
      shouldBlock: beforeUnload,
    });

    const newDatasetName = formValues.name;

    const uploadId = unfinishedUploadToContinue
      ? unfinishedUploadToContinue.uploadId
      : generateResumableUploadId("dataset", newDatasetName);
    const filePaths = formValues.zipFile.map((file) => file.path || "");
    const totalFileSizeInBytes = getFileSize(formValues.zipFile);
    const resumableUploadInfo = {
      uploadId,
      totalFileCount: formValues.zipFile.length,
      filePaths: filePaths,
      totalFileSizeInBytes,
    };
    const datasetUploadInfo = {
      resumableUploadInfo,
      datasetName: newDatasetName,
      organizationId: activeUser.organization,
      layersToLink: [],
      initialTeamIds: formValues.initialTeams.map((team: APITeam) => team.id),
      folderId: formValues.targetFolderId,
      needsConversion: this.state.needsConversion,
      voxelSizeFactor: this.state.needsConversion ? formValues.voxelSizeFactor : undefined,
      voxelSizeUnit: this.state.needsConversion ? formValues.voxelSizeUnit : undefined,
    };
    const datastoreUrl = formValues.datastoreUrl;
    await refreshToken();
    await reserveDatasetUpload(datastoreUrl, datasetUploadInfo);
    const resumableUpload = await createResumableUpload(datastoreUrl, uploadId);
    this.setState({
      uploadId,
      resumableUpload,
      datastoreUrl,
    });
    let finishUploadCalled = false;
    resumableUpload.addEventListener("complete", (event: ResumableUploadEvent) => {
      if (
        event.detail.type !== "complete" ||
        !event.detail.didUploadCompleteSuccessfully ||
        this._isCancellingUpload ||
        finishUploadCalled
      ) {
        // The upload was not successful, or a cancel was initiated before the complete event
        // fired (e.g. the last in-flight chunk completed while the cancel dialog was open).
        // A retry might be initiated by other code that listens to fileError events which is
        // why we ignore the complete event now. The type is only checked to satisfy TS.
        return;
      }
      const newestForm = this.formRef.current;

      if (!newestForm) {
        throw new Error("Form couldn't be initialized.");
      }

      finishUploadCalled = true;
      resumableUpload.pause();
      this.setState({
        isFinishing: true,
      });
      finishDatasetUpload(datastoreUrl, uploadId).then(
        async ({ datasetId }) => {
          const { needsConversion } = this.state;
          this.setState({
            isUploading: false,
            isFinishing: false,
            isRetrying: false,
            uploadProgress: 0,
            unfinishedUploadToContinue: null,
            uploadId: undefined,
            needsConversion: false,
          });

          newestForm.setFieldsValue({
            name: "",
            zipFile: [],
          });
          this.props.onUploaded(datasetId, newDatasetName, needsConversion);
        },
        (error) => {
          sendFailedRequestAnalyticsEvent("finish_dataset_upload", error, {
            dataset_name: newDatasetName,
          });
          Toast.error(messages["dataset.upload_failed"]);
          this.setState({
            isUploading: false,
            isFinishing: false,
            isRetrying: false,
            unfinishedUploadToContinue: null,
            uploadId: undefined,
            uploadProgress: 0,
          });
        },
      );
    });
    resumableUpload.addEventListener("filesAdded", () => {
      resumableUpload.upload();
    });
    // terminalFileError is triggered by the RestApi when a normal fileError could not be
    // recovered by refreshing the user token.
    resumableUpload.addEventListener("terminalFileError", (event: ResumableUploadEvent) => {
      if (event.detail.type !== "terminalFileError") {
        // Satisfy TS.
        return;
      }
      Toast.error(event.detail.message);
      this.setState({
        isUploading: false,
      });
    });
    resumableUpload.addEventListener("progress", () => {
      this.setState({
        isRetrying: false,
        uploadProgress: resumableUpload.progress(),
      });
    });
    resumableUpload.addEventListener("fileRetry", () => {
      logRetryToAnalytics(newDatasetName);
      this.setState({
        isRetrying: true,
      });
    });
    resumableUpload.addFiles(formValues.zipFile as File[]);
  };

  cancelUpload = async () => {
    const { uploadId, resumableUpload, datastoreUrl } = this.state;
    this._isCancellingUpload = true;
    resumableUpload.pause();
    const shouldCancel = await this.props.modal.confirm({
      title:
        "Cancelling the running upload will delete already uploaded files on the server and cannot be undone. Are you sure you want to cancel the upload?",
      okText: "Yes, cancel the upload",
      cancelText: "No, keep it running",
    });

    if (!shouldCancel) {
      this._isCancellingUpload = false;
      resumableUpload.upload();
      return;
    }

    resumableUpload.cancel();
    if (uploadId) {
      await cancelDatasetUpload(datastoreUrl, uploadId);
    }
    this.setState({
      isUploading: false,
      isFinishing: false,
      isRetrying: false,
      uploadId: undefined,
      uploadProgress: 0,
    });
    Toast.success(messages["dataset.upload_cancel"]);
  };

  getUploadModal = () => {
    const form = this.formRef.current;

    if (!form) {
      return null;
    }

    const { isRetrying, isFinishing, uploadProgress, isUploading } = this.state;
    return (
      <UploadProgressModal
        title="Dataset Upload"
        label={`dataset ${form.getFieldValue("name")}`}
        isOpen={isUploading}
        isFinishing={isFinishing}
        isRetrying={isRetrying}
        progress={uploadProgress}
        onCancel={this.cancelUpload}
      />
    );
  };

  validateFiles = async (files: FileWithPath[]) => {
    if (files.length === 0) {
      return;
    }

    const fileExtensions = [];
    const fileNames = [];

    for (const file of files) {
      fileNames.push(file.name);
      const fileExtension = getFileExtension(file.name);
      fileExtensions.push(fileExtension);

      if (fileExtension === "zip" || fileExtension === "ozx") {
        // @zip.js is a fairly large module
        // Dynamically import it to avoid loading it on Dashboard/admin pages.
        const zipJs = await importDynamic(() => import("@zip.js/zip.js")).catch(() => null);

        if (zipJs == null) {
          // The user was already notified about the failed import by importDynamic.
          this.formRef.current?.setFieldsValue({
            zipFile: [],
          });
          return;
        }

        try {
          const { BlobReader, ZipReader } = zipJs;
          const reader = new ZipReader(new BlobReader(file));
          const entries = await reader.getEntries();
          await reader.close();
          for (const entry of entries) {
            fileNames.push(entry.filename);
            fileExtensions.push(getFileExtension(entry.filename));
          }
        } catch (e) {
          console.error(e);
          ErrorHandling.notify(e as Error);
          this.props.modal.error({
            title: "Invalid ZIP File",
            content: messages["dataset.upload_invalid_zip"],
          });
          const form = this.formRef.current;
          if (!form) {
            return;
          }

          form.setFieldsValue({
            zipFile: [],
          });
        }
        // The loop breaks here in case of zip because at most one zip archive is supported anyway.
        // Form validation takes care of that assertion.
        break;
      }
    }

    const countedFileExtensions = countBy(fileExtensions, (str) => str);
    const containsExtension = (extension: string) => countedFileExtensions[extension] > 0;

    if (containsExtension("nml")) {
      this.props.modal.error({
        title: "Archive Contains an NML File",
        content: messages["dataset.upload_zip_with_nml"],
      });
    }

    let needsConversion = true;
    const fileBaseNames = fileNames.map((name) => name.split(/[\\/]/).pop());
    if (
      containsExtension("wkw") ||
      containsExtension("zarray") || // zarr2
      fileBaseNames.includes("datasource-properties.json") || // wk-ready dataset
      fileBaseNames.includes("zarr.json") || // zarr 3
      fileBaseNames.includes("info") || // neuroglancer precomputed
      fileBaseNames.includes("attributes.json") // n5
    ) {
      needsConversion = false;
    }
    sendAnalyticsEvent("add_files_to_upload", {
      fileExtensions: countedFileExtensions,
    });
    this.handleNeedsConversionInfo(needsConversion);
  };

  handleNeedsConversionInfo = (needsConversion: boolean) => {
    const form = this.formRef.current;

    if (!form) {
      return;
    }

    this.setState({
      needsConversion,
    });

    if (needsConversion && !this.isDatasetConversionEnabled()) {
      form.setFieldsValue({
        zipFile: [],
      });
      this.props.modal.info({
        title: "Conversion Required",
        content: (
          <div>
            The selected dataset does not seem to be in the Zarr or WKW format. Please convert the
            dataset using the{" "}
            <a target="_blank" href="https://docs.webknossos.org/cli" rel="noopener noreferrer">
              webknossos CLI
            </a>
            , the{" "}
            <a
              target="_blank"
              href="https://docs.webknossos.org/webknossos-py"
              rel="noopener noreferrer"
            >
              webknossos Python library
            </a>{" "}
            or use a WEBKNOSSOS instance which integrates a conversion service, such as{" "}
            <a target="_blank" href="http://webknossos.org/" rel="noopener noreferrer">
              webknossos.org
            </a>
            .
          </div>
        ),
      });
    }
  };

  maybeSetUploadName = (files: FileWithPath[]) => {
    const form = this.formRef.current;

    if (!form) {
      return;
    }

    if (!form.getFieldValue("name") && files.length > 0) {
      const filenameParts = files[0].name.split(".");
      const filename = filenameParts.slice(0, -1).join(".");
      form.setFieldsValue({
        name: filename,
      });
      form.validateFields(["name"]);
    }
  };

  isDatasetConversionEnabled = () => {
    const uploadableDatastores = this.props.datastores.filter(
      (datastore) => datastore.allowsUpload,
    );
    const hasOnlyOneDatastoreOrNone = uploadableDatastores.length <= 1;

    const selectedDatastore = hasOnlyOneDatastoreOrNone
=======
  const selectedDatastore =
    uploadableDatastores.length <= 1
>>>>>>> 3866b7e6499e7da16a3bc1ab250e71958e6740ef
      ? uploadableDatastores[0]
      : uploadableDatastores.find((datastore) => datastore.url === selectedDatastoreUrl);
  const isDatasetConversionEnabled =
    selectedDatastore?.jobsSupportedByAvailableWorkers.includes(APIJobCommand.CONVERT_TO_WKW) ??
    false;

  return { uploadableDatastores, selectedDatastoreUrl, isDatasetConversionEnabled };
}

function VoxelSizeFormItems() {
  return (
    <Row gutter={24}>
      <Col xs={24} md={16}>
        <FormItemWithInfo
          name="voxelSizeFactor"
          label="Voxel Size"
          info="The voxel size defines the extent (for x, y, z) of one voxel in the specified unit."
          help="Your dataset is not yet in a WEBKNOSSOS format. Therefore, you need to define the voxel size."
          rules={[
            {
              required: true,
              message: "Please provide a voxel size for the dataset.",
            },
            {
              validator: syncValidator(
                (value: Vector3) => value?.every((el) => el > 0),
                "Each component of the voxel size must be larger than 0.",
              ),
            },
          ]}
        >
          <Vector3Input
            allowDecimals
            disableAutoSize
            style={{ width: "100%" }}
            placeholder="e.g. 11.23, 11.23, 28.3"
          />
        </FormItemWithInfo>
      </Col>
      <Col xs={24} md={8}>
        <FormItemWithInfo
          name="voxelSizeUnit"
          label="Unit"
          info="The unit in which the voxel size is defined."
          rules={[
            {
              required: true,
              message: "Please provide a unit for the voxel size of the dataset.",
            },
          ]}
        >
          <Select
            options={AllUnits.map((unit) => ({
              value: unit,
              label: (
                <span>
                  <Tooltip title={unit}>{LongUnitToShortUnitMap[unit]}</Tooltip>
                </span>
              ),
            }))}
          />
        </FormItemWithInfo>
      </Col>
    </Row>
  );
}

function UploadHelpText() {
  return features().isWkorgInstance ? (
    <Typography.Text>
      Format not listed or upload not working?{" "}
      <a href="mailto:support@webknossos.org">We&apos;ll help you</a>
    </Typography.Text>
  ) : (
    <Typography.Text>
      Format not listed or upload not working?{" "}
      <a
        href="https://docs.webknossos.org/webknossos/data/upload_ui.html"
        target="_blank"
        rel="noopener noreferrer"
      >
        Read the documentation
      </a>
    </Typography.Text>
  );
}

function DatasetUploadView({ datastores, withoutCard, onUploaded }: Props) {
  const activeUser = useWkSelector((state) => state.activeUser);
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const [form] = Form.useForm<UploadFormFieldTypes>();
  const formRef = useRef(form);
  const files: FileWithPath[] = Form.useWatch("zipFile", form) ?? EMPTY_FILES;

  const [selectedTeams, setSelectedTeams] = useState<APITeam | Array<APITeam>>([]);
  const [possibleTeams, setPossibleTeams] = useState<Array<APITeam>>([]);
  const [unfinishedUploadToContinue, setUnfinishedUploadToContinue] =
    useState<UnfinishedUpload | null>(null);

  const { uploadableDatastores, selectedDatastoreUrl, isDatasetConversionEnabled } =
    useUploadableDatastores(datastores, form);
  const inspection = useFileInspection(files);
  const unfinishedUploads = useUnfinishedUploads(selectedDatastoreUrl, activeUser?.organization);
  const upload = useResumableDatasetUpload({
    onUploaded: (datasetId, datasetName, needsConversion) => {
      form.setFieldsValue({ name: "", zipFile: [] });
      setUnfinishedUploadToContinue(null);
      onUploaded(datasetId, datasetName, needsConversion);
    },
    onUploadAborted: () => setUnfinishedUploadToContinue(null),
  });

  useEffect(() => {
    sendAnalyticsEvent("open_upload_view");
  }, []);

  const isStorageExceeded = hasPricingPlanExceededStorage(organization);
  const isContinuingUpload = unfinishedUploadToContinue != null;
  const hasFiles = files.length > 0;
  const areDetailsDisabled = isContinuingUpload || !hasFiles;
  const datasetNeedsConversion = needsConversion(inspection);

  const proposeDatasetName = (selectedFiles: FileWithPath[]) => {
    if (isContinuingUpload || selectedFiles.length === 0) return;
    // Don't overwrite a name the user typed.
    if (form.isFieldTouched("name") && form.getFieldValue("name")) return;
    const name = inferDatasetName(selectedFiles.map((file) => file.path || file.name));
    form.setFieldsValue({ name });
    // Leave it to the user to fill in a name that couldn't be inferred.
    if (name !== "") form.validateFields(["name"]);
  };

  const continueUnfinishedUpload = (unfinishedUpload: UnfinishedUpload) => {
    const teams = possibleTeams.filter((team) => unfinishedUpload.allowedTeams.includes(team.id));
    form.setFieldsValue({
      name: unfinishedUpload.datasetName,
      targetFolderId: unfinishedUpload.folderId,
      initialTeams: teams,
    });
    setSelectedTeams(teams);
    setUnfinishedUploadToContinue(unfinishedUpload);
    Toast.info(
      "To continue the selected upload please make sure to select the same file(s) as before. Otherwise, the upload may be corrupted.",
    );
  };

  const handleSubmit = (formValues: UploadFormFieldTypes) => {
    if (activeUser == null) return;
    upload.startUpload({
      name: formValues.name,
      files: formValues.zipFile,
      organizationId: activeUser.organization,
      initialTeams: formValues.initialTeams,
      targetFolderId: formValues.targetFolderId,
      datastoreUrl: formValues.datastoreUrl,
      needsConversion: datasetNeedsConversion,
      voxelSizeFactor: formValues.voxelSizeFactor,
      voxelSizeUnit: formValues.voxelSizeUnit,
      unfinishedUploadToContinue,
    });
  };

  return (
    <div className="dataset-administration">
      <CardContainer withoutCard={withoutCard} title="Upload Dataset" subtitle={dataPrivacyInfo}>
        {isStorageExceeded ? (
          <Alert
            type="error"
            title={
              <>
                Your organization has exceeded the available storage. Uploading new datasets is
                disabled. Visit the{" "}
                <Link to={`/organizations/${organization.id}`}>organization page</Link> for details.
              </>
            }
            style={{ marginBottom: 24 }}
          />
        ) : null}

        <UnfinishedUploadsAlert
          unfinishedUploads={unfinishedUploads.filter(
            (unfinishedUpload) =>
              unfinishedUpload.uploadId !== unfinishedUploadToContinue?.uploadId,
          )}
          onContinue={continueUnfinishedUpload}
        />

        <Form
          form={form}
          onFinish={handleSubmit}
          onValuesChange={(changedValues: Partial<UploadFormFieldTypes>) => {
            if (changedValues.zipFile != null) proposeDatasetName(changedValues.zipFile);
          }}
          layout="vertical"
          initialValues={{
            initialTeams: [],
            voxelSizeUnit: UnitLong.nm,
            zipFile: [],
            targetFolderId: new URLSearchParams(location.search).get("to"),
          }}
        >
          <Form.Item
            name="zipFile"
            valuePropName="fileList"
            rules={getUploadFileRules({
              organization,
              isActiveUserAdmin: activeUser?.isAdmin ?? false,
              unfinishedUploadToContinue,
            })}
          >
            <DatasetFileSelection
              inspection={inspection}
              isDatasetConversionEnabled={isDatasetConversionEnabled}
            />
          </Form.Item>

          <Typography.Paragraph
            type={hasFiles ? undefined : "secondary"}
            style={{ marginTop: 32, marginBottom: 16 }}
          >
            <strong>Dataset details</strong>
            {hasFiles ? null : " — filled in automatically once you add data"}
          </Typography.Paragraph>
          <Row gutter={24}>
            <Col xs={24} md={8}>
              <DatasetNameFormItem
                activeUser={activeUser}
                label="Name"
                disabled={areDetailsDisabled}
                allowDuplicate
              />
            </Col>
            <Col xs={24} md={8}>
              <FormItemWithInfo
                name="targetFolderId"
                label="Folder"
                info="The folder into which the dataset will be uploaded. The dataset can be moved after upload. Note that teams that have access to the specified folder will be able to see the uploaded dataset."
                valuePropName="folderId"
                rules={[
                  {
                    required: true,
                    message: messages["dataset.import.required.folder"],
                  },
                ]}
              >
                <FolderSelection disableNotEditableFolders disabled={areDetailsDisabled} />
              </FormItemWithInfo>
            </Col>
            <Col xs={24} md={8}>
              <AllowedTeamsFormItem
                label="Additional teams with access"
                isDatasetManagerOrAdmin={isUserAdminOrDatasetManager(activeUser)}
                selectedTeams={selectedTeams}
                setSelectedTeams={setSelectedTeams}
                afterFetchedTeams={setPossibleTeams}
                formRef={formRef}
                disabled={areDetailsDisabled}
              />
            </Col>
          </Row>

          {isDatasetConversionEnabled && datasetNeedsConversion ? <VoxelSizeFormItems /> : null}

          {uploadableDatastores.length > 1 ? (
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: "more-options",
                  label: "More options",
                  forceRender: true,
                  children: (
                    <DatastoreFormItem
                      datastores={uploadableDatastores}
                      disabled={isContinuingUpload}
                    />
                  ),
                },
              ]}
            />
          ) : (
            <DatastoreFormItem datastores={uploadableDatastores} hidden />
          )}

          <Divider />
          <Flex justify="space-between" align="center" gap="middle" wrap>
            <UploadHelpText />
            <Button
              size="large"
              type="primary"
              htmlType="submit"
              disabled={
                isStorageExceeded ||
                isInspectionBlockingUpload(inspection, isDatasetConversionEnabled)
              }
              style={{ minWidth: 160 }}
            >
              Upload
            </Button>
          </Flex>
        </Form>
      </CardContainer>

      <UploadProgressModal status={upload.status} onCancel={upload.cancelUpload} />
    </div>
  );
}

export default DatasetUploadView;

import {
  FileOutlined,
  FolderOutlined,
  HourglassOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Avatar,
  Button,
  Col,
  Form,
  List,
  Modal,
  Popover,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Tooltip,
} from "antd";
import dayjs from "dayjs";
import React from "react";
import { connect } from "react-redux";

import {
  AllowedTeamsFormItem,
  CardContainer,
  DatasetNameFormItem,
  DatastoreFormItem,
} from "admin/dataset/dataset_components";
import {
  getLeftOverStorageBytes,
  hasPricingPlanExceededStorage,
} from "admin/organization/pricing_plan_utils";
import {
  type UnfinishedUpload,
  cancelDatasetUpload,
  createResumableUpload,
  finishDatasetUpload,
  getUnfinishedUploads,
  reserveDatasetUpload,
  sendAnalyticsEvent,
  sendFailedRequestAnalyticsEvent,
  startConvertToWkwJob,
} from "admin/rest_api";
import type { FormInstance } from "antd/lib/form";
import classnames from "classnames";
import FolderSelection from "dashboard/folders/folder_selection";
import features from "features";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { Vector3Input } from "libs/vector_input";
import Zip from "libs/zipjs_wrapper";
import _ from "lodash";
import messages from "messages";
import { type FileWithPath, useDropzone } from "react-dropzone";
import { Link } from "react-router-dom";
import { withRouter, type RouteComponentProps } from "libs/with_router_hoc";
import {
  type APIDataStore,
  APIJobType,
  type APIOrganization,
  type APITeam,
  type APIUser,
} from "types/api_types";
import { syncValidator } from "types/validation";
import { AllUnits, LongUnitToShortUnitMap, UnitLong, type Vector3 } from "viewer/constants";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import type { WebknossosState } from "viewer/store";
import { FormItemWithInfo, confirmAsync } from "../../dashboard/dataset/helper_components";

const FormItem = Form.Item;
const REPORT_THROTTLE_THRESHOLD = 1 * 60 * 1000; // 1 min

const logRetryToAnalytics = _.throttle((datasetName: string) => {
  ErrorHandling.notify(new Error(`Warning: Upload of dataset ${datasetName} was retried.`));
}, REPORT_THROTTLE_THRESHOLD);

type OwnProps = {
  datastores: Array<APIDataStore>;
  withoutCard?: boolean;
  onUploaded: (
    datasetId: string,
    datasetName: string,
    needsConversion: boolean,
  ) => Promise<void> | void;
};
type StateProps = {
  activeUser: APIUser | null | undefined;
  organization: APIOrganization;
};
type Props = OwnProps & StateProps;
type PropsWithFormAndRouter = Props & {
  navigate: RouteComponentProps["navigate"];
};
type State = {
  isUploading: boolean;
  isFinishing: boolean;
  needsConversion: boolean;
  isRetrying: boolean;
  uploadProgress: number;
  selectedTeams: APITeam | Array<APITeam>;
  possibleTeams: Array<APITeam>;
  uploadId: string | undefined;
  unfinishedUploadToContinue: UnfinishedUpload | null;
  resumableUpload: any;
  datastoreUrl: string;
  unfinishedUploads: UnfinishedUpload[];
};

function WkwExample() {
  const description = `
  great_dataset          # Root folder
  ├─ color               # Dataset layer (e.g., color, segmentation)
  │  ├─ 1                # Magnification step (1, 2, 4, 8, 16 etc.)
  │  │  ├─ header.wkw    # Header wkw file
  │  │  ├─ z0
  │  │  │  ├─ y0
  │  │  │  │  ├─ x0.wkw  # Actual data wkw file
  │  │  │  │  └─ x1.wkw  # Actual data wkw file
  │  │  │  └─ y1/...
  │  │  └─ z1/...
  │  └─ 2/...
  ├─ segmentation/...
  └─ datasource-properties.json  # Dataset metadata (will be created upon import, if non-existent)
  `;
  return (
    <div>
      <h4>A typical WKW dataset looks like this:</h4>
      <pre className="dataset-import-folder-structure-hint">{description}</pre>
    </div>
  );
}

function SingleLayerImageStackExample() {
  const description = `
  great_dataset          # Root folder or zip archive (this outer container may be omitted)
  ├─ file1.tif           # The files don't have to follow a certain naming pattern.
  ├─ file2.tif           # However, the files are sorted to obtain the final z-order.
  └─ file3.tif
  `;
  return (
    <div>
      <h4>For example, a flat list of (sorted) image files can be imported:</h4>
      <pre className="dataset-import-folder-structure-hint">{description}</pre>
    </div>
  );
}

function MultiLayerImageStackExample() {
  const description = `
  great_dataset          # Root folder or zip archive (this outer container may be omitted)
  ├─ color               # 1st dataset layer (name may be arbitrary, e.g., color or segmentation)
  │  ├─ file1.tif        # The files don't have to follow a certain naming pattern.
  │  ├─ file2.tif        # However, the files are sorted to obtain the final z-order.
  │  └─ file3.tif
  └─ segmentation        # 2nd dataset layer
     ├─ file1.tif
     ├─ file2.tif
     └─ file3.tif
  `;
  return (
    <div>
      <h4>Uploading multiple image stacks (one per folder) will create a multi-layer dataset:</h4>
      <pre className="dataset-import-folder-structure-hint">{description}</pre>
    </div>
  );
}

function getFileSize(files: FileWithPath[]) {
  return files.reduce((accSize, file) => accSize + file.size, 0);
}

type UploadFormFieldTypes = {
  name: string;
  initialTeams: Array<APITeam>;
  voxelSizeFactor: Vector3;
  zipFile: Array<FileWithPath>;
  targetFolderId: string;
  voxelSizeUnit: UnitLong;
  continuingOldUpload: boolean;
  datastoreUrl: string;
};

export const dataPrivacyInfo = (
  <Space direction="horizontal" size={4}>
    Per default, imported data is private and only visible within your organization.
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

class DatasetUploadView extends React.Component<PropsWithFormAndRouter, State> {
  state: State = {
    isUploading: false,
    isFinishing: false,
    needsConversion: false,
    isRetrying: false,
    uploadProgress: 0,
    selectedTeams: [],
    possibleTeams: [],
    uploadId: undefined,
    resumableUpload: {},
    datastoreUrl: "",
    unfinishedUploads: [],
    unfinishedUploadToContinue: null,
  };

  unblock: ((...args: Array<any>) => any) | null | undefined;
  blockTimeoutId: number | null = null;
  formRef: React.RefObject<FormInstance<UploadFormFieldTypes>> = React.createRef<FormInstance>();

  componentDidMount() {
    sendAnalyticsEvent("open_upload_view");
  }

  componentDidUpdate(prevProps: PropsWithFormAndRouter) {
    const uploadableDatastores = this.props.datastores.filter(
      (datastore) => datastore.allowsUpload,
    );
    const currentFormRef = this.formRef.current;

    if (currentFormRef != null) {
      const selectedDataStoreUrl = currentFormRef.getFieldValue("datastoreUrl");

      if (
        prevProps.datastores.length === 0 &&
        uploadableDatastores.length > 0 &&
        (selectedDataStoreUrl == null || selectedDataStoreUrl !== uploadableDatastores[0].url)
      ) {
        currentFormRef.setFieldsValue({
          datastoreUrl: uploadableDatastores[0].url,
        });
        this.setState({ datastoreUrl: uploadableDatastores[0].url });
        this.updateUnfinishedUploads();
      }
    }
  }

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

    if (this.blockTimeoutId != null) {
      clearTimeout(this.blockTimeoutId);
      this.blockTimeoutId = null;
    }

    if (this.unblock != null) {
      this.unblock();
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

    this.setState({
      isUploading: true,
      uploadProgress: 0,
    });

    const beforeUnload = (
      newLocation: HistoryLocation<unknown>,
      action: HistoryAction,
    ): string | false | void => {
      // Only show the prompt if this is a proper beforeUnload event from the browser
      // or the pathname changed
      // This check has to be done because history.block triggers this function even if only the url hash changed
      if (action === undefined || newLocation.pathname !== window.location.pathname) {
        const { isUploading } = this.state;

        if (isUploading) {
          window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event

          this.blockTimeoutId = window.setTimeout(() => {
            // restore the event handler in case a user chose to stay on the page
            // @ts-ignore
            window.onbeforeunload = beforeUnload;
          }, 500);
          return messages["dataset.leave_during_upload"];
        }
      }

      return;
    };
    const { unfinishedUploadToContinue } = this.state;

    this.unblock = this.props.history.block(beforeUnload);
    // @ts-ignore
    window.onbeforeunload = beforeUnload;

    const getRandomString = () => {
      const randomBytes = window.crypto.getRandomValues(new Uint8Array(6));
      return Array.from(randomBytes, (byte) => `0${byte.toString(16)}`.slice(-2)).join("");
    };
    const newDatasetName = formValues.name;

    const uploadId = unfinishedUploadToContinue
      ? unfinishedUploadToContinue.uploadId
      : `${dayjs(Date.now()).format("YYYY-MM-DD_HH-mm")}__${newDatasetName}__${getRandomString()}`;
    const filePaths = formValues.zipFile.map((file) => file.path || "");
    const totalFileSizeInBytes = getFileSize(formValues.zipFile);
    const reserveUploadInformation = {
      uploadId,
      name: newDatasetName,
      directoryName: "<filled by backend>",
      newDatasetId: "<filled by backend>",
      organization: activeUser.organization,
      totalFileCount: formValues.zipFile.length,
      filePaths: filePaths,
      totalFileSizeInBytes,
      layersToLink: [],
      initialTeams: formValues.initialTeams.map((team: APITeam) => team.id),
      folderId: formValues.targetFolderId,
    };
    const datastoreUrl = formValues.datastoreUrl;
    await reserveDatasetUpload(datastoreUrl, reserveUploadInformation);
    const resumableUpload = await createResumableUpload(datastoreUrl, uploadId);
    this.setState({
      uploadId,
      resumableUpload,
      datastoreUrl,
    });
    resumableUpload.on("complete", () => {
      const newestForm = this.formRef.current;

      if (!newestForm) {
        throw new Error("Form couldn't be initialized.");
      }

      const uploadInfo = {
        uploadId,
        needsConversion: this.state.needsConversion,
      };
      this.setState({
        isFinishing: true,
      });
      finishDatasetUpload(datastoreUrl, uploadInfo).then(
        async ({ newDatasetId }) => {
          let maybeError;

          if (this.state.needsConversion) {
            try {
              const datastore = this.getDatastoreForUrl(datastoreUrl);

              if (!datastore) {
                throw new Error("Selected datastore does not match available datastores");
              }

              await startConvertToWkwJob(
                newDatasetId,
                formValues.voxelSizeFactor,
                formValues.voxelSizeUnit,
              );
            } catch (error) {
              maybeError = error;
            }

            if (maybeError != null) {
              Toast.error(
                "The upload was successful, but the conversion for the dataset could not be started. Please try again or contact us if this issue occurs again.",
              );
            }
          }
          this.setState({
            isUploading: false,
            isFinishing: false,
            unfinishedUploadToContinue: null,
            uploadId: undefined,
          });

          if (maybeError == null) {
            newestForm.setFieldsValue({
              name: "",
              zipFile: [],
            });
            this.props.onUploaded(newDatasetId, newDatasetName, this.state.needsConversion);
          }
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
    resumableUpload.on("filesAdded", () => {
      resumableUpload.upload();
    });
    resumableUpload.on("fileError", (_file: FileWithPath, message: string) => {
      Toast.error(message);
      this.setState({
        isUploading: false,
      });
    });
    resumableUpload.on("progress", () => {
      this.setState({
        isRetrying: false,
        uploadProgress: resumableUpload.progress(),
      });
    });
    resumableUpload.on("fileRetry", () => {
      logRetryToAnalytics(newDatasetName);
      this.setState({
        isRetrying: true,
      });
    });
    resumableUpload.addFiles(formValues.zipFile);
  };

  cancelUpload = async () => {
    const { uploadId, resumableUpload, datastoreUrl } = this.state;
    resumableUpload.pause();
    const shouldCancel = await confirmAsync({
      title:
        "Cancelling the running upload will delete already uploaded files on the server and cannot be undone. Are you sure you want to cancel the upload?",
      okText: "Yes, cancel the upload",
      cancelText: "No, keep it running",
    });

    if (!shouldCancel) {
      resumableUpload.upload();
      return;
    }

    resumableUpload.cancel();
    if (uploadId) {
      await cancelDatasetUpload(datastoreUrl, {
        uploadId,
      });
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
      <Modal
        open={isUploading}
        keyboard={false}
        maskClosable={false}
        className="no-footer-modal"
        okButtonProps={{
          style: {
            display: "none",
          },
        }}
        cancelButtonProps={{
          style: {
            display: "none",
          },
        }}
        onCancel={this.cancelUpload}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexDirection: "column",
          }}
        >
          {isFinishing ? (
            <>
              <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} />
              <br />
              Processing uploaded files …
            </>
          ) : (
            <>
              <FolderOutlined
                style={{
                  fontSize: 50,
                  marginBottom: 8,
                }}
              />
              {isRetrying
                ? `Upload of dataset ${form.getFieldValue("name")} froze.`
                : `Uploading Dataset ${form.getFieldValue("name")}.`}
              <br />
              {isRetrying ? "Retrying to continue the upload …" : null}
              <br />
              <Progress
                // Round to 1 digit after the comma, but use floor
                // to avoid that 100% are displayed even though the progress is lower.
                percent={Math.floor(uploadProgress * 1000) / 10}
                status="active"
              />
            </>
          )}
        </div>
      </Modal>
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
      const fileExtension = Utils.getFileExtension(file.name);
      fileExtensions.push(fileExtension);
      sendAnalyticsEvent("add_files_to_upload", {
        fileExtension,
      });

      if (fileExtension === "zip") {
        try {
          const reader = new Zip.ZipReader(new Zip.BlobReader(file));
          const entries = await reader.getEntries();
          await reader.close();
          for (const entry of entries) {
            fileNames.push(entry.filename);
            fileExtensions.push(Utils.getFileExtension(entry.filename));
          }
        } catch (e) {
          console.error(e);
          ErrorHandling.notify(e as Error);
          Modal.error({
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

    const countedFileExtensions = _.countBy(fileExtensions, (str) => str);
    const containsExtension = (extension: string) => countedFileExtensions[extension] > 0;

    if (containsExtension("nml")) {
      Modal.error({
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
    Object.entries(countedFileExtensions).map(([fileExtension, count]) =>
      sendAnalyticsEvent("add_files_to_upload", {
        fileExtension,
        count,
      }),
    );
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
      Modal.info({
        content: (
          <div>
            The selected dataset does not seem to be in the WKW or Zarr format. Please convert the
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
      ? uploadableDatastores[0]
      : this.getDatastoreForUrl(this.state.datastoreUrl);

    return (
      selectedDatastore?.jobsSupportedByAvailableWorkers.includes(APIJobType.CONVERT_TO_WKW) ||
      false
    );
  };

  onFormValueChange = (changedValues: UploadFormFieldTypes) => {
    if (changedValues.datastoreUrl) {
      this.setState({ datastoreUrl: changedValues.datastoreUrl });
      this.updateUnfinishedUploads();
    }
  };

  render() {
    const { activeUser, withoutCard, datastores } = this.props;
    const isDatasetManagerOrAdmin = Utils.isUserAdminOrDatasetManager(this.props.activeUser);

    const { needsConversion, unfinishedUploadToContinue } = this.state;
    const uploadableDatastores = datastores.filter((datastore) => datastore.allowsUpload);
    const hasOnlyOneDatastoreOrNone = uploadableDatastores.length <= 1;

    const unfinishedAndNotSelectedUploads = this.state.unfinishedUploads.filter(
      (unfinishedUploads) => unfinishedUploads.uploadId !== unfinishedUploadToContinue?.uploadId,
    );
    const continuingUnfinishedUpload = unfinishedUploadToContinue != null;
    const isActiveUserAdmin = this.props.activeUser?.isAdmin;

    return (
      <div
        className="dataset-administration"
        style={{
          padding: 5,
        }}
      >
        <CardContainer withoutCard={withoutCard} title="Upload Dataset" subtitle={dataPrivacyInfo}>
          {hasPricingPlanExceededStorage(this.props.organization) ? (
            <Alert
              type="error"
              message={
                <>
                  Your organization has exceeded the available storage. Uploading new datasets is
                  disabled. Visit the{" "}
                  <Link to={`/organizations/${this.props.organization.id}`}>organization page</Link>{" "}
                  for details.
                </>
              }
              style={{ marginBottom: 8 }}
            />
          ) : null}

          {unfinishedAndNotSelectedUploads.length > 0 && (
            <Alert
              message={
                <>
                  Unfinished Dataset Uploads{" "}
                  <Tooltip
                    title="This list shows all uploads from the past two weeks that were started by you but not completed. You can try continuing these uploads."
                    placement="right"
                  >
                    <InfoCircleOutlined />
                  </Tooltip>
                </>
              }
              description={
                <div
                  style={{
                    paddingTop: 8,
                  }}
                >
                  {unfinishedAndNotSelectedUploads.map((unfinishedUpload) => (
                    <Row key={unfinishedUpload.uploadId} gutter={16}>
                      <Col span={8}>{unfinishedUpload.datasetName}</Col>
                      <Col span={8}>
                        <Button
                          type="link"
                          onClick={() => {
                            const currentFormRef = this.formRef.current;
                            if (!currentFormRef) {
                              return;
                            }
                            currentFormRef.setFieldsValue({
                              name: unfinishedUpload.datasetName,
                              targetFolderId: unfinishedUpload.folderId,
                              initialTeams: this.state.possibleTeams.filter((team) =>
                                unfinishedUpload.allowedTeams.includes(team.id),
                              ),
                            });
                            this.setState({
                              unfinishedUploadToContinue: unfinishedUpload,
                            });
                            Toast.info(
                              "To continue the selected upload please make sure to select the same file(s) as before. Otherwise, the upload may be corrupted.",
                            );
                          }}
                        >
                          Continue upload
                        </Button>
                      </Col>
                    </Row>
                  ))}
                </div>
              }
              type="info"
              style={{
                marginTop: 12,
                marginBottom: 12,
              }}
              showIcon
              icon={<HourglassOutlined />}
            />
          )}

          <Form
            onFinish={this.handleSubmit}
            onValuesChange={this.onFormValueChange}
            layout="vertical"
            ref={this.formRef}
            initialValues={{
              initialTeams: [],
              voxelSize: [0, 0, 0],
              zipFile: [],
              targetFolderId: new URLSearchParams(location.search).get("to"),
              unit: UnitLong.nm,
            }}
          >
            {features().isWkorgInstance && (
              <Alert
                message={
                  <>
                    We are happy to help!
                    <br />
                    Please <a href="mailto:hello@webknossos.org">contact us</a> if you have any
                    trouble uploading your data or the uploader doesn&apos;t support your format
                    yet.
                  </>
                }
                type="info"
                style={{
                  marginBottom: 50,
                }}
              />
            )}
            <Row gutter={8}>
              <Col span={12}>
                <DatasetNameFormItem
                  activeUser={activeUser}
                  disabled={continuingUnfinishedUpload}
                  allowDuplicate
                />
              </Col>
              <Col span={12}>
                <AllowedTeamsFormItem
                  isDatasetManagerOrAdmin={isDatasetManagerOrAdmin}
                  selectedTeams={this.state.selectedTeams}
                  setSelectedTeams={(selectedTeams) => this.setState({ selectedTeams })}
                  afterFetchedTeams={(possibleTeams) => this.setState({ possibleTeams })}
                  formRef={this.formRef}
                  disabled={continuingUnfinishedUpload}
                />
              </Col>
            </Row>

            <FormItemWithInfo
              name="targetFolderId"
              label="Target Folder"
              info="The folder into which the dataset will be uploaded. The dataset can be moved after upload. Note that teams that have access to the specified folder will be able to see the uploaded dataset."
              valuePropName="folderId"
              rules={[
                {
                  required: true,
                  message: messages["dataset.import.required.folder"],
                },
              ]}
            >
              <FolderSelection
                width="50%"
                disableNotEditableFolders
                disabled={continuingUnfinishedUpload}
              />
            </FormItemWithInfo>

            <DatastoreFormItem
              datastores={uploadableDatastores}
              hidden={hasOnlyOneDatastoreOrNone}
              disabled={continuingUnfinishedUpload}
            />
            {this.isDatasetConversionEnabled() && needsConversion ? (
              <Row gutter={8}>
                <Col span={12}>
                  <FormItemWithInfo
                    name="voxelSizeFactor"
                    label="Voxel Size"
                    info="The voxel size defines the extent (for x, y, z) of one voxel in the specified unit."
                    // @ts-ignore
                    disabled={this.state.needsConversion}
                    help="Your dataset is not yet in WKW Format. Therefore you need to define the voxel size."
                    rules={[
                      {
                        required: this.state.needsConversion,
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
                      onChange={(voxelSizeFactor: Vector3) => {
                        if (this.formRef.current == null) return;
                        this.formRef.current.setFieldsValue({
                          voxelSizeFactor,
                        });
                      }}
                    />
                  </FormItemWithInfo>
                </Col>
                <Col span={12}>
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
            ) : null}

            <FormItem
              name="zipFile"
              label="Dataset"
              hasFeedback
              rules={[
                {
                  required: true,
                  message: messages["dataset.import.required.zipFile"],
                },
                {
                  validator: syncValidator(
                    (files: FileWithPath[]) =>
                      files.filter((file) => Utils.isFileExtensionEqualTo(file.path || "", "zip"))
                        .length <= 1,
                    "You cannot upload more than one archive.",
                  ),
                },
                {
                  validator: syncValidator(
                    (files: FileWithPath[]) =>
                      files.filter((file) =>
                        Utils.isFileExtensionEqualTo(file.path, ["tar", "rar", "gz"]),
                      ).length === 0,
                    "Tar, tar.gz and rar archives are not supported currently. Please use zip archives.",
                  ),
                },
                {
                  validator: syncValidator(
                    (files: FileWithPath[]) =>
                      files.filter((file) =>
                        Utils.isFileExtensionEqualTo(file.path, ["ply", "stl", "obj"]),
                      ).length === 0,
                    "PLY, STL and OBJ files are not supported. Please upload image files instead of 3D geometries.",
                  ),
                },
                {
                  validator: syncValidator(
                    (files: FileWithPath[]) =>
                      files.filter((file) => Utils.isFileExtensionEqualTo(file.path, ["nml"]))
                        .length === 0,
                    "An NML file is an annotation of a dataset and not an independent dataset. Please upload the NML file into the Annotations page in the dashboard or into an open dataset.",
                  ),
                },
                {
                  validator: syncValidator(
                    (files: FileWithPath[]) =>
                      files.filter((file) => Utils.isFileExtensionEqualTo(file.path, ["mrc"]))
                        .length === 0,
                    "MRC files are not supported currently.",
                  ),
                },
                {
                  validator: syncValidator((files: FileWithPath[]) => {
                    const archives = files.filter((file) =>
                      Utils.isFileExtensionEqualTo(file.path, "zip"),
                    );
                    // Either there are no archives, or all files are archives
                    return archives.length === 0 || archives.length === files.length;
                  }, "Archives cannot be mixed with other files."),
                },
                {
                  validator: syncValidator(
                    (files: FileWithPath[]) => {
                      const fileSize = getFileSize(files);
                      return getLeftOverStorageBytes(this.props.organization) >= fileSize;
                    },
                    `The selected files exceed the available storage of your organization. Please ${
                      isActiveUserAdmin
                        ? "use the organization management page to request more storage"
                        : "ask your administrator to request more storage"
                    }.`,
                  ),
                },
                {
                  validator: syncValidator((files: FileWithPath[]) => {
                    const wkwFiles = files.filter((file) =>
                      Utils.isFileExtensionEqualTo(file.path, "wkw"),
                    );
                    const imageFiles = files.filter((file) =>
                      Utils.isFileExtensionEqualTo(file.path, [
                        "tif",
                        "tiff",
                        "jpg",
                        "jpeg",
                        "png",
                        "czi",
                        "dm3",
                        "dm4",
                        "nifti",
                        "raw",
                      ]),
                    );
                    return wkwFiles.length === 0 || imageFiles.length === 0;
                  }, "WKW files should not be mixed with image files."),
                },
                {
                  validator: syncValidator(
                    (files: FileWithPath[]) => {
                      const { unfinishedUploadToContinue } = this.state;
                      if (
                        !unfinishedUploadToContinue ||
                        unfinishedUploadToContinue.filePaths == null
                      ) {
                        return true;
                      }
                      const filePaths = files.map((file) => file.path || "");
                      return (
                        unfinishedUploadToContinue.filePaths.length === filePaths.length &&
                        _.difference(unfinishedUploadToContinue.filePaths, filePaths).length === 0
                      );
                    },
                    "The selected files do not match the files of the unfinished upload. Please select the same files as before." +
                      (unfinishedUploadToContinue?.filePaths != null
                        ? `The file names are: ${unfinishedUploadToContinue?.filePaths?.join(
                            ", ",
                          )}.`
                        : ""),
                  ),
                },
              ]}
              valuePropName="fileList"
            >
              <FileUploadArea
                onChange={(files: FileWithPath[]) => {
                  this.maybeSetUploadName(files);
                  this.validateFiles(files);
                }}
                fileList={[]}
                isDatasetConversionEnabled={this.isDatasetConversionEnabled()}
              />
            </FormItem>
            <FormItem
              style={{
                marginBottom: 0,
              }}
            >
              <Button
                size="large"
                type="primary"
                htmlType="submit"
                disabled={hasPricingPlanExceededStorage(this.props.organization)}
                style={{
                  width: "100%",
                }}
              >
                Upload
              </Button>
            </FormItem>
          </Form>
        </CardContainer>

        {this.getUploadModal()}
      </div>
    );
  }
}

function FileUploadArea({
  fileList,
  onChange,
  isDatasetConversionEnabled,
}: {
  fileList: FileWithPath[];
  onChange: (files: FileWithPath[]) => void;
  isDatasetConversionEnabled: boolean;
}) {
  const onDropAccepted = (acceptedFiles: FileWithPath[]) => {
    // file.path should be set by react-dropzone (which uses file-selector::toFileWithPath).
    onChange(_.uniqBy(fileList.concat(acceptedFiles), (file) => file.path));
  };

  const removeFile = (file: FileWithPath) => {
    onChange(_.without(fileList, file));
  };

  const { getRootProps, getInputProps, isDragActive, isDragAccept, isDragReject } = useDropzone({
    onDropAccepted,
  });
  const acceptedFiles = fileList;
  const files: React.ReactNode[] = acceptedFiles.map((file: FileWithPath) => (
    <li key={file.path}>{file.path}</li>
  ));
  const showSmallFileList = files.length > 10;

  const list = (
    <List
      itemLayout="horizontal"
      dataSource={acceptedFiles}
      size={showSmallFileList ? "small" : "default"}
      renderItem={(item: FileWithPath) => (
        <List.Item
          actions={[
            <a key="list-loadmore-edit" onClick={() => removeFile(item)}>
              remove
            </a>,
          ]}
        >
          <List.Item.Meta
            avatar={
              !showSmallFileList && (
                <Avatar>
                  <FileOutlined />
                </Avatar>
              )
            }
            title={
              <span>
                {showSmallFileList && <FileOutlined />}{" "}
                <span
                  style={{
                    color: "darkgrey",
                  }}
                >{`${item.path?.split("/").slice(0, -1).join("/")}/`}</span>
                {item.name}
              </span>
            }
          />
        </List.Item>
      )}
    />
  );

  return (
    <div>
      <div
        {...getRootProps({
          className: classnames("dataset-upload-dropzone", {
            "dataset-upload-dropzone-active": isDragActive,
            "dataset-upload-dropzone-accept": isDragAccept,
            "dataset-upload-dropzone-rejct": isDragReject,
          }),
        })}
      >
        <input {...getInputProps()} />
        <InboxOutlined
          style={{
            fontSize: 48,
            color: "var(--ant-color-primary)",
          }}
        />
        <div
          style={{
            textAlign: "center",
            display: "inline-block",
            marginTop: 8,
            lineHeight: "1.7em",
          }}
        >
          {features().recommendWkorgInstance && !isDatasetConversionEnabled ? (
            <>
              Drag and drop your files in WKW format.
              <div
                style={{
                  textAlign: "left",
                  display: "list-item",
                  maxWidth: 475,
                  marginTop: 10,
                }}
              >
                Need to upload files in other formats? Switch to{" "}
                <a href="https://webknossos.org" onClick={(e) => e.stopPropagation()}>
                  webknossos.org
                </a>{" "}
                for more file types support and automatic conversion.
                <a
                  href="https://webknossos.org/self-hosted-upgrade"
                  onClick={(e) => e.stopPropagation()}
                >
                  {" "}
                  Learn more!
                </a>
              </div>
            </>
          ) : (
            <div style={{ marginTop: 8 }}>
              Drag your file(s) to this area to upload them. Either add individual image files, a
              zip archive or a folder.
            </div>
          )}
          {isDatasetConversionEnabled ? (
            <>
              <div
                style={{
                  textAlign: "left",
                  display: "inline-block",
                  marginTop: 10,
                }}
              >
                The following file formats are supported:
                <ul>
                  <li>
                    <Popover content={<WkwExample />} trigger="hover">
                      WKW dataset
                      <InfoCircleOutlined
                        style={{
                          marginLeft: 4,
                        }}
                      />
                    </Popover>
                  </li>

                  <li>
                    <Popover content={<SingleLayerImageStackExample />} trigger="hover">
                      Single-Layer Image File Sequence (tif, jpg, png, dm3, dm4 etc.)
                      <InfoCircleOutlined
                        style={{
                          marginLeft: 4,
                        }}
                      />
                    </Popover>
                  </li>

                  <li>
                    <Popover content={<MultiLayerImageStackExample />} trigger="hover">
                      Multi-Layer Image File Sequence
                      <InfoCircleOutlined
                        style={{
                          marginLeft: 4,
                        }}
                      />
                    </Popover>
                  </li>
                  <li>
                    <Popover
                      content={
                        <a
                          href="https://docs.webknossos.org/webknossos/data/zarr.html"
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Read more in docs
                        </a>
                      }
                      trigger="hover"
                    >
                      OME-Zarr 0.4+ (NGFF) datasets{" "}
                      <InfoCircleOutlined
                        style={{
                          marginLeft: 4,
                        }}
                      />
                    </Popover>
                  </li>
                  <li>
                    <Popover
                      content={
                        <a
                          href="https://docs.webknossos.org/webknossos/data/neuroglancer_precomputed.html"
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Read more in docs
                        </a>
                      }
                      trigger="hover"
                    >
                      Neuroglancer Precomputed datasets{" "}
                      <InfoCircleOutlined
                        style={{
                          marginLeft: 4,
                        }}
                      />
                    </Popover>
                  </li>
                  <li>
                    <Popover
                      content={
                        <a
                          href="https://docs.webknossos.org/webknossos/data/n5.html"
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Read more in docs
                        </a>
                      }
                      trigger="hover"
                    >
                      N5 datasets{" "}
                      <InfoCircleOutlined
                        style={{
                          marginLeft: 4,
                        }}
                      />
                    </Popover>
                  </li>
                  <li>Single-file images (tif, czi, nifti, raw, ims etc.)</li>
                </ul>
                Have a look at{" "}
                <a
                  href="https://docs.webknossos.org/webknossos/data/image_stacks.html"
                  onClick={(e) => e.stopPropagation()}
                >
                  our documentation
                </a>{" "}
                to learn more.
              </div>
            </>
          ) : null}
        </div>
      </div>

      {files.length > 0 ? (
        <div
          style={{
            marginTop: 8,
          }}
        >
          <h5>Files</h5>
          <div
            style={{
              maxHeight: 600,
              overflowY: "auto",
            }}
          >
            {list}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const mapStateToProps = (state: WebknossosState): StateProps => ({
  activeUser: state.activeUser,
  organization: enforceActiveOrganization(state.activeOrganization),
});

const connector = connect(mapStateToProps);
export default connector(withRouter<RouteComponentProps & OwnProps>(DatasetUploadView));

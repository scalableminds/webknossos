import { UnlockOutlined } from "@ant-design/icons";
import { CardContainer, DatastoreFormItem } from "admin/dataset/dataset_components";
import { exploreRemoteDataset, isDatasetNameValid, storeRemoteDataset } from "admin/rest_api";
import {
  Button,
  Col,
  Collapse,
  Divider,
  Form,
  type FormInstance,
  Input,
  List,
  Modal,
  Radio,
  Row,
  Upload,
} from "antd";
import type { RcFile, UploadChangeParam, UploadFile } from "antd/lib/upload";
import { AsyncButton } from "components/async_clickables";
import BrainSpinner from "components/brain_spinner";
import DatasetSettingsDataTab, {
  // Sync simple with advanced and get newest datasourceJson
  syncDataSourceFields,
} from "dashboard/dataset/dataset_settings_data_tab";
import { FormItemWithInfo, Hideable } from "dashboard/dataset/helper_components";
import FolderSelection from "dashboard/folders/folder_selection";
import { formatScale } from "libs/format_utils";
import { readFileAsText } from "libs/read_file";
import Toast from "libs/toast";
import { jsonStringify } from "libs/utils";
import * as Utils from "libs/utils";
import _ from "lodash";
import messages from "messages";
import { Unicode } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";
import { Hint } from "oxalis/view/action-bar/download_modal_view";
import React, { useEffect, useState } from "react";
import { connect } from "react-redux";
import { useHistory } from "react-router-dom";
import type { APIDataStore, APIUser } from "types/api_types";
import type { ArbitraryObject } from "types/globals";
import type { DataLayer, DatasourceConfiguration } from "types/schemas/datasource.types";
import { dataPrivacyInfo } from "./dataset_upload_view";

const FormItem = Form.Item;
const RadioGroup = Radio.Group;
const { Password } = Input;

type FileList = UploadFile<any>[];

type OwnProps = {
  onAdded: (
    uploadedDatasetId: string,
    updatedDatasetName: string,
    needsConversion?: boolean | null | undefined,
  ) => Promise<void>;
  datastores: APIDataStore[];
  // This next prop has a high impact on the component's behavior.
  // If it is set, the component will automatically explore the dataset
  // and import it. If it is not set, the user has to manually trigger
  // the exploration and import.
  defaultDatasetUrl?: string | null | undefined;
};
type StateProps = {
  activeUser: APIUser | null | undefined;
};
type Props = OwnProps & StateProps;

function ensureLargestSegmentIdsInPlace(datasource: DatasourceConfiguration) {
  for (const layer of datasource.dataLayers) {
    if (layer.category === "color" || layer.largestSegmentId != null) {
      continue;
    }
    // Make sure the property exists. Otherwise, the field would not be
    // rendered in the form.
    layer.largestSegmentId = null;
  }
}

function mergeNewLayers(
  existingDatasource: DatasourceConfiguration | null,
  newDatasource: DatasourceConfiguration,
): DatasourceConfiguration {
  if (existingDatasource?.dataLayers == null) {
    return newDatasource;
  }
  const allLayers = newDatasource.dataLayers.concat(existingDatasource.dataLayers);
  const groupedLayers: Record<string, DataLayer[]> = _.groupBy(
    allLayers,
    (layer: DataLayer) => layer.name,
  );
  const uniqueLayers: DataLayer[] = [];
  for (const entry of _.entries(groupedLayers)) {
    const [name, layerGroup] = entry;
    if (layerGroup.length === 1) {
      uniqueLayers.push(layerGroup[0]);
    } else {
      let idx = 1;
      for (const layer of layerGroup) {
        if (idx === 1) {
          uniqueLayers.push(layer);
        } else {
          uniqueLayers.push({ ...layer, name: `${name}_${idx}` });
        }
        idx++;
      }
    }
  }
  return {
    ...existingDatasource,
    dataLayers: uniqueLayers,
  };
}

export const parseCredentials = async (
  file: RcFile | undefined,
): Promise<ArbitraryObject | null> => {
  if (!file) {
    return null;
  }
  const jsonString = await readFileAsText(file);
  try {
    return JSON.parse(jsonString);
  } catch (_exception) {
    Toast.error("Cannot parse credentials as valid JSON. Ignoring credentials file.");
    return null;
  }
};

export function GoogleAuthFormItem({
  fileList,
  handleChange,
  showOptionalHint,
}: {
  fileList: FileList;
  handleChange: (arg: UploadChangeParam<UploadFile<any>>) => void;
  showOptionalHint?: boolean;
}) {
  return (
    <FormItem
      name="authFile"
      label={
        <React.Fragment>
          Google{Unicode.NonBreakingSpace}
          <a
            href="https://cloud.google.com/iam/docs/creating-managing-service-account-keys"
            target="_blank"
            rel="noopener noreferrer"
          >
            Service Account
          </a>
          {Unicode.NonBreakingSpace}Key {showOptionalHint && "(Optional)"}
        </React.Fragment>
      }
      hasFeedback
    >
      <Upload.Dragger
        name="files"
        fileList={fileList}
        onChange={handleChange}
        beforeUpload={() => false}
      >
        <p className="ant-upload-drag-icon">
          <UnlockOutlined
            style={{
              margin: 0,
              fontSize: 35,
            }}
          />
        </p>
        <p className="ant-upload-text">
          Click or Drag your Google Cloud Authentication File to this Area to Upload
        </p>
        <p className="ant-upload-text-hint">
          This is only needed if the dataset is located in a non-public Google Cloud Storage bucket
        </p>
      </Upload.Dragger>
    </FormItem>
  );
}

function DatasetAddRemoteView(props: Props) {
  const { activeUser, onAdded, datastores, defaultDatasetUrl } = props;

  const uploadableDatastores = datastores.filter((datastore) => datastore.allowsUpload);
  const hasOnlyOneDatastoreOrNone = uploadableDatastores.length <= 1;

  const [showAddLayerModal, setShowAddLayerModal] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(defaultDatasetUrl != null);
  const [dataSourceEditMode, setDataSourceEditMode] = useState<"simple" | "advanced">("simple");
  const [form] = Form.useForm();
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const isDatasourceConfigStrFalsy = Form.useWatch("dataSourceJson", form) == null;
  const maybeDataLayers = Form.useWatch(["dataSource", "dataLayers"], form);
  const history = useHistory();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const targetFolderId = params.get("to");
    setTargetFolderId(targetFolderId);
  }, []);

  const getDefaultDatasetName = (url: string) => {
    if (url === "") return "";
    let urlPathElements = url.split(/[^a-zA-Z\d_\-.~]/); // split by non url-safe characters
    const defaultName = urlPathElements.filter((el) => el !== "").at(-1);
    const urlHash = Utils.computeHash(url);
    return defaultName + "-" + urlHash;
  };

  const maybeOpenExistingDataset = () => {
    const maybeDSNameError = form
      .getFieldError("datasetName")
      .filter((error) => error === messages["dataset.name.already_taken"]);
    if (maybeDSNameError == null) return;
    history.push(
      `/datasets/${activeUser?.organization}/${form.getFieldValue(["dataSource", "id", "name"])}`,
    );
  };

  const hasFormAnyErrors = (form: FormInstance) =>
    form.getFieldsError().filter(({ errors }) => errors.length).length > 0;

  const onSuccesfulExplore = async (url: string) => {
    const dataSourceJsonString = form.getFieldValue("dataSourceJson");
    if (defaultDatasetUrl == null) {
      setShowLoadingOverlay(false);
      return;
    }
    if (!showLoadingOverlay) setShowLoadingOverlay(true); // show overlay again, e.g. after credentials were passed
    const dataSourceJson = JSON.parse(dataSourceJsonString);
    const defaultDatasetName = getDefaultDatasetName(url);
    setDatasourceConfigStr(
      JSON.stringify({ ...dataSourceJson, id: { name: defaultDatasetName, team: "" } }),
    );
    try {
      await form.validateFields();
    } catch (_e) {
      console.warn(_e);
      if (defaultDatasetUrl != null) {
        maybeOpenExistingDataset();
        return;
      }
    }
    if (!hasFormAnyErrors(form)) {
      handleStoreDataset();
    } else {
      setShowLoadingOverlay(false);
    }
  };

  const setDatasourceConfigStr = (dataSourceJson: string) => {
    form.setFieldsValue({ dataSourceJson });
    // Since this function sets the JSON string, we have to update the
    // data which is rendered by the "simple" page.
    syncDataSourceFields(form, "simple", true);
    form.validateFields();
  };

  async function handleStoreDataset() {
    // Sync simple with advanced and get newest datasourceJson
    syncDataSourceFields(form, dataSourceEditMode === "simple" ? "advanced" : "simple", true);
    try {
      await form.validateFields();
    } catch (_e) {
      console.warn(_e);
      if (defaultDatasetUrl != null) {
        maybeOpenExistingDataset();
        return;
      }
    }
    if (hasFormAnyErrors(form)) {
      setShowLoadingOverlay(false);
      return;
    }

    const datastoreToUse = uploadableDatastores.find(
      (datastore) => form.getFieldValue("datastoreUrl") === datastore.url,
    );
    if (!datastoreToUse) {
      setShowLoadingOverlay(false);
      Toast.error("Could not find datastore that allows uploading.");
      return;
    }

    const dataSourceJsonStr = form.getFieldValue("dataSourceJson");
    if (dataSourceJsonStr && activeUser) {
      let configJSON;
      try {
        configJSON = JSON.parse(dataSourceJsonStr);
        const nameValidationResult = await isDatasetNameValid(configJSON.id.name);
        if (nameValidationResult) {
          throw new Error(nameValidationResult);
        }
        const { newDatasetId } = await storeRemoteDataset(
          datastoreToUse.url,
          configJSON.id.name,
          activeUser.organization,
          dataSourceJsonStr,
          targetFolderId,
        );
        onAdded(newDatasetId, configJSON.id.name);
      } catch (e) {
        setShowLoadingOverlay(false);
        Toast.error(`The datasource config could not be stored. ${e}`);
        return;
      }
    }
  }

  const hideDatasetUI = maybeDataLayers == null || maybeDataLayers.length === 0;
  return (
    // Using Forms here only to validate fields and for easy layout
    <div style={{ padding: 5 }}>
      {showLoadingOverlay ? <BrainSpinner /> : null}
      <CardContainer
        title="Add Remote Zarr / Neuroglancer Precomputed / N5 Dataset"
        subtitle={dataPrivacyInfo}
      >
        <Form form={form} layout="vertical">
          <DatastoreFormItem datastores={uploadableDatastores} hidden={hasOnlyOneDatastoreOrNone} />
          <Modal
            title="Add Layer"
            width={800}
            open={showAddLayerModal}
            footer={null}
            onCancel={() => setShowAddLayerModal(false)}
          >
            <AddRemoteLayer
              form={form}
              uploadableDatastores={uploadableDatastores}
              setDatasourceConfigStr={setDatasourceConfigStr}
              onSuccess={() => setShowAddLayerModal(false)}
              dataSourceEditMode={dataSourceEditMode}
            />
          </Modal>

          {hideDatasetUI && (
            <AddRemoteLayer
              form={form}
              uploadableDatastores={uploadableDatastores}
              setDatasourceConfigStr={setDatasourceConfigStr}
              dataSourceEditMode={dataSourceEditMode}
              defaultUrl={defaultDatasetUrl}
              onError={() => setShowLoadingOverlay(false)}
              onSuccess={(defaultDatasetUrl: string) => onSuccesfulExplore(defaultDatasetUrl)}
            />
          )}
          <Hideable hidden={hideDatasetUI}>
            <List
              header={
                <div
                  style={{
                    fontWeight: "bold",
                  }}
                >
                  General
                </div>
              }
            >
              <List.Item>
                <FormItemWithInfo
                  name="targetFolder"
                  label="Target Folder"
                  info="The folder into which the dataset will be uploaded. The dataset can be moved later after upload, too. When not selecting a folder, the dataset will be placed into the root folder."
                >
                  <FolderSelection
                    width="50%"
                    folderId={targetFolderId}
                    onChange={setTargetFolderId}
                    disableNotEditableFolders
                  />
                </FormItemWithInfo>{" "}
              </List.Item>
            </List>

            {/* Only the component's visibility is changed, so that the form is always rendered.
                This is necessary so that the form's structure is always populated. */}
            <DatasetSettingsDataTab
              form={form}
              activeDataSourceEditMode={dataSourceEditMode}
              onChange={(activeEditMode) => {
                syncDataSourceFields(form, activeEditMode, true);
                form.validateFields();
                setDataSourceEditMode(activeEditMode);
              }}
            />
          </Hideable>
          {!hideDatasetUI && (
            <>
              <Divider />
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
                <Button type="link" onClick={() => setShowAddLayerModal(true)}>
                  Add Layer
                </Button>
              </div>
              <Row gutter={8}>
                <Col span={12} />
                <Col span={6}>
                  <FormItem>
                    <Button
                      size="large"
                      type="default"
                      style={{ width: "100%" }}
                      onClick={() => {
                        setDatasourceConfigStr("");
                        form.resetFields();
                      }}
                    >
                      Reset
                    </Button>
                  </FormItem>
                </Col>
                <Col span={6}>
                  <Form.Item shouldUpdate>
                    {() => (
                      <Button
                        size="large"
                        type="primary"
                        style={{ width: "100%" }}
                        onClick={handleStoreDataset}
                        disabled={
                          isDatasourceConfigStrFalsy ||
                          !!form.getFieldsError().filter(({ errors }) => errors.length).length
                        }
                      >
                        Import
                      </Button>
                    )}
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}
        </Form>
      </CardContainer>
    </div>
  );
}

function AddRemoteLayer({
  form,
  uploadableDatastores,
  setDatasourceConfigStr,
  onSuccess,
  onError,
  dataSourceEditMode,
  defaultUrl,
}: {
  form: FormInstance;
  uploadableDatastores: APIDataStore[];
  setDatasourceConfigStr: (dataSourceJson: string) => void;
  onSuccess?: (datasetUrl: string) => Promise<void> | void;
  onError?: () => void;
  dataSourceEditMode: "simple" | "advanced";
  defaultUrl?: string | null | undefined;
}) {
  const isDatasourceConfigStrFalsy = Form.useWatch("dataSourceJson", form) != null;
  const datasourceUrl: string | null = Form.useWatch("url", form);
  const [exploreLog, setExploreLog] = useState<string | null>(null);
  const [showCredentialsFields, setShowCredentialsFields] = useState<boolean>(false);
  const [usernameOrAccessKey, setUsernameOrAccessKey] = useState<string>("");
  const [passwordOrSecretKey, setPasswordOrSecretKey] = useState<string>("");
  const [selectedProtocol, setSelectedProtocol] = useState<"s3" | "https" | "gs" | "file">("https");
  const [fileList, setFileList] = useState<FileList>([]);

  useEffect(() => {
    if (defaultUrl != null) {
      // only set datasourceUrl in the first render
      if (datasourceUrl == null) {
        form.setFieldValue("url", defaultUrl);
        form.validateFields(["url"]);
      } else {
        handleExplore();
      }
    }
  }, [defaultUrl, datasourceUrl, form.setFieldValue, form.validateFields]);

  const handleChange = (info: UploadChangeParam<UploadFile<any>>) => {
    // Restrict the upload list to the latest file
    const newFileList = info.fileList.slice(-1);
    setFileList(newFileList);
  };

  function validateUrls(userInput: string) {
    const removePrefix = (value: string, prefix: string) =>
      value.startsWith(prefix) ? value.slice(prefix.length) : value;

    // If pasted from neuroglancer, uris have these prefixes even before the protocol. The backend ignores them.
    userInput = removePrefix(userInput, "zarr://");
    userInput = removePrefix(userInput, "zarr3://");
    userInput = removePrefix(userInput, "n5://");
    userInput = removePrefix(userInput, "precomputed://");

    if (userInput.startsWith("https://") || userInput.startsWith("http://")) {
      setSelectedProtocol("https");
    } else if (userInput.startsWith("s3://")) {
      setSelectedProtocol("s3");
    } else if (userInput.startsWith("gs://")) {
      setSelectedProtocol("gs");
    } else if (userInput.startsWith("file://")) {
      setSelectedProtocol("file"); // Unused
    } else {
      throw new Error(
        "Dataset URL must employ one of the following protocols: https://, http://, s3://, gs:// or file://",
      );
    }
  }

  const handleFailure = () => {
    if (onError) onError();
  };

  async function handleExplore() {
    if (!datasourceUrl) {
      handleFailure();
      Toast.error("Please provide a valid URL for exploration.");
      return;
    }

    // Sync simple with advanced and get newest datasourceJson
    syncDataSourceFields(form, dataSourceEditMode === "simple" ? "advanced" : "simple", true);
    const datasourceConfigStr = form.getFieldValue("dataSourceJson");
    const datastoreToUse = uploadableDatastores.find(
      (datastore) => form.getFieldValue("datastoreUrl") === datastore.url,
    );
    if (!datastoreToUse) {
      handleFailure();
      Toast.error("Could not find datastore that allows uploading.");
      return;
    }

    const { dataSource: newDataSource, report } = await (async () => {
      // @ts-ignore
      const preferredVoxelSize = Utils.parseMaybe(datasourceConfigStr)?.scale;

      if (showCredentialsFields) {
        if (selectedProtocol === "gs") {
          const credentials =
            fileList.length > 0 ? await parseCredentials(fileList[0]?.originFileObj) : null;
          if (credentials) {
            return exploreRemoteDataset(
              [datasourceUrl],
              datastoreToUse.name,
              {
                username: "",
                pass: JSON.stringify(credentials),
              },
              preferredVoxelSize,
            );
          } else {
            // Fall through to exploreRemoteDataset without parameters
          }
        } else if (usernameOrAccessKey && passwordOrSecretKey) {
          return exploreRemoteDataset(
            [datasourceUrl],
            datastoreToUse.name,
            {
              username: usernameOrAccessKey,
              pass: passwordOrSecretKey,
            },
            preferredVoxelSize,
          );
        }
      }
      return exploreRemoteDataset([datasourceUrl], datastoreToUse.name, null, preferredVoxelSize);
    })();
    setExploreLog(report);
    if (!newDataSource) {
      handleFailure();
      Toast.error(
        "Exploring this remote dataset did not return a datasource. Please check the Log.",
      );
      return;
    }
    ensureLargestSegmentIdsInPlace(newDataSource);
    if (!datasourceConfigStr) {
      setDatasourceConfigStr(jsonStringify(newDataSource));
      if (onSuccess) {
        onSuccess(datasourceUrl);
      }
      return;
    }
    let existingDatasource: DatasourceConfiguration;
    try {
      existingDatasource = JSON.parse(datasourceConfigStr);
    } catch (_e) {
      handleFailure();
      Toast.error(
        "The current datasource config contains invalid JSON. Cannot add the new Zarr/N5 data.",
      );
      return;
    }
    if (
      existingDatasource?.scale != null &&
      !_.isEqual(existingDatasource.scale, newDataSource.scale)
    ) {
      Toast.warning(
        `${messages["dataset.add_zarr_different_scale_warning"]}\n${formatScale(
          newDataSource.scale,
        )}`,
        { timeout: 10000 },
      );
    }
    setDatasourceConfigStr(jsonStringify(mergeNewLayers(existingDatasource, newDataSource)));
    if (onSuccess) {
      onSuccess(datasourceUrl);
    }
  }

  return (
    <>
      Please enter a URL that points to the Zarr, Neuroglancer Precomputed or N5 data you would like
      to import. If necessary, specify the credentials for the dataset.{" "}
      {defaultUrl == null
        ? "For datasets with multiple \
      layers, e.g. raw microscopy and segmentation data, please add them separately with the ”Add \
      Layer” button below. Once you have approved of the resulting datasource you can import it."
        : "If the provided URL is valid, the datasource will be imported and you will be redirected to the dataset."}
      <FormItem
        style={{ marginTop: 16, marginBottom: 16 }}
        name="url"
        label="Dataset URL"
        tooltip="Supported protocols are HTTPS, Amazon S3 and Google Cloud Storage"
        hasFeedback
        rules={[
          {
            required: true,
            message: messages["dataset.import.required.url"],
          },
          {
            validator: (_rule, value) => {
              try {
                validateUrls(value);
                return Promise.resolve();
              } catch (e) {
                handleFailure();
                return Promise.reject(e);
              }
            },
          },
        ]}
        validateFirst
      >
        <Input />
      </FormItem>
      <FormItem label="Authentication">
        <RadioGroup
          defaultValue="hide"
          value={showCredentialsFields ? "show" : "hide"}
          onChange={(e) => setShowCredentialsFields(e.target.value === "show")}
        >
          <Radio value="hide">{selectedProtocol === "https" ? "None" : "Anonymous"}</Radio>
          <Radio value="show">
            {selectedProtocol === "https" ? "Basic authentication" : "With credentials"}
          </Radio>
        </RadioGroup>
      </FormItem>
      {showCredentialsFields ? (
        selectedProtocol === "gs" ? (
          <GoogleAuthFormItem fileList={fileList} handleChange={handleChange} />
        ) : (
          <Row gutter={8}>
            <Col span={12}>
              <FormItem
                label={selectedProtocol === "https" ? "Username" : "Access Key ID"}
                hasFeedback
                rules={[{ required: true }]}
                validateFirst
              >
                <Input
                  value={usernameOrAccessKey}
                  onChange={(e) => setUsernameOrAccessKey(e.target.value)}
                />
              </FormItem>
            </Col>
            <Col span={12}>
              <FormItem
                label={selectedProtocol === "https" ? "Password" : "Secret Access Key"}
                hasFeedback
                rules={[{ required: true }]}
                validateFirst
              >
                <Password
                  value={passwordOrSecretKey}
                  onChange={(e) => setPasswordOrSecretKey(e.target.value)}
                />
              </FormItem>
            </Col>
          </Row>
        )
      ) : null}
      {exploreLog ? (
        <Row gutter={8}>
          <Col span={24}>
            <Collapse
              defaultActiveKey="1"
              items={[
                {
                  key: "1",
                  label: "Error Log",
                  children: (
                    <Hint style={{ width: "90%" }}>
                      <pre style={{ whiteSpace: "pre-wrap" }}>{exploreLog}</pre>
                    </Hint>
                  ),
                },
              ]}
            />
          </Col>
        </Row>
      ) : null}
      <FormItem style={{ marginBottom: 0, marginTop: 20 }}>
        <Row gutter={8}>
          <Col span={18} />
          <Col span={6}>
            <AsyncButton
              size="large"
              type={isDatasourceConfigStrFalsy ? "primary" : "default"}
              style={{ width: "100%" }}
              onClick={handleExplore}
            >
              {defaultUrl == null ? "Add Layer" : "Validate URL and Continue"}
            </AsyncButton>
          </Col>
        </Row>
      </FormItem>
    </>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

const connector = connect(mapStateToProps);
export default connector(DatasetAddRemoteView);

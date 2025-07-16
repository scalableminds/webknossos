import { CardContainer, DatastoreFormItem } from "admin/dataset/dataset_components";
import { isDatasetNameValid, storeRemoteDataset } from "admin/rest_api";
import { Button, Col, Divider, Form, type FormInstance, List, Modal, Row } from "antd";
import BrainSpinner from "components/brain_spinner";
import DatasetSettingsDataTab, {
  // Sync simple with advanced and get newest datasourceJson
  syncDataSourceFields,
} from "dashboard/dataset/dataset_settings_data_tab";
import { DatasetSettingsProvider } from "dashboard/dataset/dataset_settings_provider";
import { FormItemWithInfo, Hideable } from "dashboard/dataset/helper_components";
import FolderSelection from "dashboard/folders/folder_selection";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { APIDataStore } from "types/api_types";
import { dataPrivacyInfo } from "./dataset_upload_view";
import { AddRemoteLayer } from "./remote/add_remote_layer";

const FormItem = Form.Item;

type Props = {
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

function DatasetAddRemoteView(props: Props) {
  const { onAdded, datastores, defaultDatasetUrl } = props;
  const activeUser = useWkSelector((state) => state.activeUser);

  const uploadableDatastores = datastores.filter((datastore) => datastore.allowsUpload);
  const hasOnlyOneDatastoreOrNone = uploadableDatastores.length <= 1;

  const [showAddLayerModal, setShowAddLayerModal] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(defaultDatasetUrl != null);
  const [dataSourceEditMode, setDataSourceEditMode] = useState<"simple" | "advanced">("simple");
  const [form] = Form.useForm();
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const isDatasourceConfigStrFalsy = Form.useWatch("dataSourceJson", form) == null;
  const maybeDataLayers = Form.useWatch(["dataSource", "dataLayers"], form);
  const navigate = useNavigate();

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
    navigate(
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
            <DatasetSettingsProvider
              form={form}
              activeDataSourceEditMode={dataSourceEditMode}
              onChange={(activeEditMode) => {
                syncDataSourceFields(form, activeEditMode, true);
                form.validateFields();
                setDataSourceEditMode(activeEditMode);
              }}
            >
              <DatasetSettingsDataTab />
            </DatasetSettingsProvider>
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

export default DatasetAddRemoteView;

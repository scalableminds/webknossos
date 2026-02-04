import { CardContainer, DatastoreFormItem } from "admin/dataset/dataset_components";
import { isDatasetNameValid, storeRemoteDataset } from "admin/rest_api";
import { Button, Col, Divider, Flex, Form, type FormInstance, List, Modal, Row } from "antd";
import BrainSpinner from "components/brain_spinner";
import type { DatasetSettingsFormData } from "dashboard/dataset/dataset_settings_context";
import DatasetSettingsDataTab, {
  TransformationsMode,
} from "dashboard/dataset/dataset_settings_data_tab";
import {
  DatasetSettingsProvider,
  getRotationFromCoordinateTransformations, // Sync simple with advanced and get newest datasourceJson
} from "dashboard/dataset/dataset_settings_provider";
import { FormItemWithInfo, Hideable } from "dashboard/dataset/helper_components";
import FolderSelection from "dashboard/folders/folder_selection";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { computeHash } from "libs/utils";
import messages from "messages";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { APIDataLayer, APIDataStore } from "types/api_types";
import type {
  DataLayer,
  DataLayerWithTransformations,
  DatasourceConfiguration,
} from "types/schemas/datasource.types";
import {
  doAllLayersHaveTheSameRotation,
  type RotationAndMirroringSettings,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { dataPrivacyInfo } from "./dataset_upload_view";
import { AddRemoteLayer } from "./remote/add_remote_layer";

const FormItem = Form.Item;

const mergeNewLayers = (
  existingDatasource: DatasourceConfiguration | null,
  newDatasource: DatasourceConfiguration,
): DatasourceConfiguration => {
  if (existingDatasource?.dataLayers == null) {
    return newDatasource;
  }

  // Keep existing layer names; only rename incoming layers if a collision occurs.
  const taken = new Set(existingDatasource.dataLayers.map((l) => l.name));
  const uniquify = (base: string) => {
    if (!taken.has(base)) {
      taken.add(base);
      return base;
    }
    let i = 2;
    while (taken.has(`${base}_${i}`)) i += 1;
    const unique = `${base}_${i}`;
    taken.add(unique);
    return unique;
  };
  const newUnique = newDatasource.dataLayers.map((l) => ({ ...l, name: uniquify(l.name) }));
  return {
    ...existingDatasource,
    dataLayers: existingDatasource.dataLayers.concat(newUnique),
  };
};

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
  const [form] = Form.useForm<DatasetSettingsFormData & { datastoreUrl?: string }>();
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const maybeDataLayers = Form.useWatch(["dataSource", "dataLayers"], form);
  const datasourceConfig = Form.useWatch(["dataSource"], form);
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
    const urlHash = computeHash(url);
    return defaultName + "-" + urlHash;
  };

  const maybeOpenExistingDataset = () => {
    const maybeDSNameError = form
      .getFieldError(["dataset", "name"])
      .filter((error) => error === messages["dataset.name.already_taken"]);
    if (maybeDSNameError == null) return;
    navigate(
      `/datasets/${activeUser?.organization}/${form.getFieldValue(["dataSource", "id", "name"])}`,
    );
  };

  const hasFormAnyErrors = (form: FormInstance) =>
    form.getFieldsError().filter(({ errors }) => errors.length).length > 0;

  const onSuccessfulExplore = async (url: string, newDataSourceConfig: DatasourceConfiguration) => {
    const datasourceConfig = form.getFieldValue("dataSource");
    const mergedConfig = mergeNewLayers(datasourceConfig, newDataSourceConfig);
    form.setFieldValue("dataSource", mergedConfig);

    const initialRotationSettingsPerAxis: RotationAndMirroringSettings = {
      rotationInDegrees: 0,
      isMirrored: false,
    };
    const initialRotationSettings = {
      x: initialRotationSettingsPerAxis,
      y: initialRotationSettingsPerAxis,
      z: initialRotationSettingsPerAxis,
    };

    form.setFieldsValue({
      datasetRotation: initialRotationSettings,
    });
    form.setFieldValue("isRotationOnly", true);

    const dataLayersWithTransformations: DataLayerWithTransformations[] =
      mergedConfig.dataLayers.map((layer: DataLayer) => ({
        name: layer.name,
        coordinateTransformations: [],
      })) || [];
    const layersWithCoordTransformationsJSON = JSON.stringify(
      dataLayersWithTransformations,
      null,
      2,
    );
    form.setFieldsValue({
      coordinateTransformations: layersWithCoordTransformationsJSON,
    });

    form.setFieldValue("transformationsMode", TransformationsMode.SIMPLE);

    if (defaultDatasetUrl == null) {
      setShowLoadingOverlay(false);
      setShowAddLayerModal(false);
      return;
    }

    if (!showLoadingOverlay) setShowLoadingOverlay(true); // show overlay again, e.g. after credentials were passed

    const defaultDatasetName = getDefaultDatasetName(url);
    form.setFieldValue(["dataSource", "id"], { name: defaultDatasetName, team: "" });

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
    setShowAddLayerModal(false);
  };

  async function handleStoreDataset() {
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

    // The dataset name is not synced with the datasource.id.name in the advanced settings: See DatasetSettingsDataTab.
    const datasetName = form.getFieldValue(["dataset", "name"]);
    const dataSource = form.getFieldValue("dataSource");

    if (dataSource && activeUser) {
      try {
        const nameValidationResult = await isDatasetNameValid(datasetName);
        if (nameValidationResult) {
          throw new Error(nameValidationResult);
        }
        const { newDatasetId } = await storeRemoteDataset(
          datastoreToUse.name,
          datasetName,
          dataSource,
          targetFolderId,
        );
        onAdded(newDatasetId, datasetName);
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
              preferredVoxelSize={datasourceConfig?.scale}
              uploadableDatastores={uploadableDatastores}
              onSuccess={onSuccessfulExplore}
            />
          </Modal>

          {hideDatasetUI && (
            <AddRemoteLayer
              form={form}
              preferredVoxelSize={datasourceConfig?.scale}
              uploadableDatastores={uploadableDatastores}
              defaultUrl={defaultDatasetUrl}
              onError={() => setShowLoadingOverlay(false)}
              onSuccess={onSuccessfulExplore}
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
            <DatasetSettingsProvider form={form} isEditingMode={false} datasetId="new-import">
              <DatasetSettingsDataTab />
            </DatasetSettingsProvider>
          </Hideable>
          {!hideDatasetUI && (
            <>
              <Divider />
              <Flex justify="center" style={{ marginBottom: 24 }}>
                <Button type="link" onClick={() => setShowAddLayerModal(true)}>
                  Add Layer
                </Button>
              </Flex>
              <Row gutter={8}>
                <Col span={12} />
                <Col span={6}>
                  <FormItem>
                    <Button
                      size="large"
                      type="default"
                      style={{ width: "100%" }}
                      onClick={() => {
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

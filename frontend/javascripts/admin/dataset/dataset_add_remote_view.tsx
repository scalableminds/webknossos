import { CardContainer } from "admin/dataset/dataset_components";
import { isDatasetNameValid, storeRemoteDataset, updateDatasetTeams } from "admin/rest_api";
import { Button, Divider, Flex, Form, type FormInstance, Typography } from "antd";
import BrainSpinner from "components/brain_spinner";
import { TransformationsMode } from "dashboard/dataset/dataset_settings_data_tab";
import features from "features";
import { useEffectOnlyOnce } from "libs/react_hooks";
import Toast from "libs/toast";
import { useRef, useState } from "react";
import type { APIDataStore, APITeam, VoxelSize } from "types/api_types";
import type {
  DataLayer,
  DataLayerWithTransformations,
  DatasourceConfiguration,
} from "types/schemas/datasource.types";
import type { RotationAndMirroringSettings } from "viewer/model/helpers/dataset_rotation_helpers";
import { dataPrivacyInfo } from "./dataset_upload_view";
import { RemoteDatasetDetails } from "./remote/remote_dataset_details";
import { type LayerSource, RemoteLayerList } from "./remote/remote_layer_list";
import { RemoteUrlStep } from "./remote/remote_url_step";
import {
  getDatasetNameFromUrl,
  getUniqueDatasetNameFromUrl,
  mergeNewLayers,
} from "./remote/remote_url_utils";
import { type ExploreOptions, useRemoteUrlField } from "./remote/use_remote_url_field";

type RemoteFormFieldTypes = {
  name: string;
  targetFolderId: string | null;
  initialTeams: APITeam[];
  datastoreUrl?: string;
  dataSource?: DatasourceConfiguration;
  transformationsMode: TransformationsMode;
  coordinateTransformations: string;
  isRotationOnly: boolean;
  datasetRotation: Record<"x" | "y" | "z", RotationAndMirroringSettings>;
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

const NO_ROTATION: RotationAndMirroringSettings = { rotationInDegrees: 0, isMirrored: false };

function resetTransformations(form: FormInstance<RemoteFormFieldTypes>, layers: DataLayer[]) {
  const dataLayersWithTransformations: DataLayerWithTransformations[] = layers.map((layer) => ({
    name: layer.name,
    coordinateTransformations: [],
  }));
  form.setFieldsValue({
    datasetRotation: { x: NO_ROTATION, y: NO_ROTATION, z: NO_ROTATION },
    isRotationOnly: true,
    coordinateTransformations: JSON.stringify(dataLayersWithTransformations, null, 2),
    transformationsMode: TransformationsMode.NONE,
  });
}

function RemoteHelpText() {
  return (
    <Typography.Text>
      Data not loading?{" "}
      {features().isWkorgInstance ? (
        <a href="mailto:support@webknossos.org">We&apos;ll help you</a>
      ) : (
        <a
          href="https://docs.webknossos.org/webknossos/data/streaming.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Read the documentation
        </a>
      )}
    </Typography.Text>
  );
}

function DatasetAddRemoteView({ onAdded, datastores, defaultDatasetUrl }: Props) {
  const uploadableDatastores = datastores.filter((datastore) => datastore.allowsUpload);

  const [form] = Form.useForm<RemoteFormFieldTypes>();
  const formRef = useRef<FormInstance | null>(form);
  const urlField = useRemoteUrlField(defaultDatasetUrl ?? "");
  const [layerSources, setLayerSources] = useState<Record<string, LayerSource>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(defaultDatasetUrl != null);

  // The data source isn't bound to a form item, so preserve is needed to watch it.
  const layers: DataLayer[] =
    Form.useWatch(["dataSource", "dataLayers"], { form, preserve: true }) ?? [];
  const datasetVoxelSize: VoxelSize | undefined = Form.useWatch(["dataSource", "scale"], {
    form,
    preserve: true,
  });
  const datasetName: string = Form.useWatch("name", { form, preserve: true }) ?? "";

  const getExploreOptions = (): ExploreOptions | null => {
    const datastoreUrl = form.getFieldValue("datastoreUrl") ?? uploadableDatastores[0]?.url;
    const datastore = uploadableDatastores.find(({ url }) => url === datastoreUrl);
    if (datastore == null) {
      Toast.error("Could not find datastore that allows uploading.");
      return null;
    }
    return {
      datastoreName: datastore.name,
      preferredVoxelSize: form.getFieldValue(["dataSource", "scale"]),
    };
  };

  const addFoundLayers = (url: string, newDataSource: DatasourceConfiguration) => {
    const existingDataSource = form.getFieldValue("dataSource");
    const isFirstUrl = existingDataSource == null || existingDataSource.dataLayers.length === 0;
    const mergedDataSource = mergeNewLayers(isFirstUrl ? null : existingDataSource, newDataSource);
    const addedLayers = mergedDataSource.dataLayers.slice(
      isFirstUrl ? 0 : existingDataSource.dataLayers.length,
    );

    form.setFieldValue("dataSource", mergedDataSource);
    resetTransformations(form, mergedDataSource.dataLayers);
    setLayerSources((sources) => ({
      ...sources,
      ...Object.fromEntries(
        addedLayers.map((layer) => [layer.name, { url, voxelSize: newDataSource.scale }]),
      ),
    }));
    if (isFirstUrl && !form.isFieldTouched("name")) {
      form.setFieldValue("name", getDatasetNameFromUrl(url));
    }
  };

  const startOver = () => {
    form.resetFields();
    setLayerSources({});
  };

  const removeLayer = (layerName: string) => {
    const remainingLayers = layers.filter((layer) => layer.name !== layerName);
    if (remainingLayers.length === 0) {
      startOver();
      return;
    }
    form.setFieldValue(["dataSource", "dataLayers"], remainingLayers);
    setLayerSources(({ [layerName]: _removed, ...sources }) => sources);
  };

  const storeDataset = async (
    datastoreName: string,
    name: string,
    teams: APITeam[],
    targetFolderId: string | null,
  ) => {
    const nameValidationResult = await isDatasetNameValid(name);
    if (nameValidationResult) {
      form.setFields([{ name: "name", errors: [nameValidationResult] }]);
      return;
    }
    const { newDatasetId } = await storeRemoteDataset(
      datastoreName,
      name,
      form.getFieldValue("dataSource"),
      defaultDatasetUrl,
      targetFolderId,
    );
    if (teams.length > 0) {
      try {
        await updateDatasetTeams(
          newDatasetId,
          teams.map((team) => team.id),
        );
      } catch (_error) {
        Toast.warning(
          "The dataset was imported, but its teams could not be set. Please set them in the dataset settings.",
        );
      }
    }
    await onAdded(newDatasetId, name);
  };

  const handleImport = async () => {
    let values: RemoteFormFieldTypes;
    try {
      values = await form.validateFields();
    } catch (_validationError) {
      return; // The form shows the errors.
    }
    const exploreOptions = getExploreOptions();
    if (exploreOptions == null) return;
    setIsImporting(true);
    try {
      await storeDataset(
        exploreOptions.datastoreName,
        values.name,
        values.initialTeams ?? [],
        values.targetFolderId,
      );
    } catch (error) {
      Toast.error(`The datasource config could not be stored. ${error}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Imports a URL that was passed to the page without waiting for the user.
  // If anything fails, the regular UI is shown so that the user can fix it.
  const importWithoutInteraction = async (url: string, dataSource: DatasourceConfiguration) => {
    const exploreOptions = getExploreOptions();
    if (exploreOptions == null) return;
    const name = getUniqueDatasetNameFromUrl(url);
    form.setFieldValue("name", name);
    setShowLoadingOverlay(true);
    try {
      addFoundLayers(url, dataSource);
      await storeDataset(
        exploreOptions.datastoreName,
        name,
        [],
        new URLSearchParams(location.search).get("to"),
      );
    } catch (error) {
      Toast.error(`The datasource config could not be stored. ${error}`);
    } finally {
      setShowLoadingOverlay(false);
    }
  };

  const exploreFirstUrl = async (url: string) => {
    const exploreOptions = getExploreOptions();
    if (exploreOptions == null || urlField.isExploring) return;
    const dataSource = await urlField.exploreUrl(exploreOptions, url);
    if (dataSource == null) {
      setShowLoadingOverlay(false);
      return;
    }
    if (defaultDatasetUrl != null) {
      await importWithoutInteraction(url.trim(), dataSource);
    } else {
      addFoundLayers(url.trim(), dataSource);
    }
  };

  useEffectOnlyOnce(() => {
    if (defaultDatasetUrl != null) exploreFirstUrl(defaultDatasetUrl);
  });

  const hasLayers = layers.length > 0;
  return (
    <div>
      {showLoadingOverlay ? <BrainSpinner /> : null}
      <CardContainer title="Add Remote Dataset" subtitle={dataPrivacyInfo}>
        <Form
          form={form}
          layout="vertical"
          requiredMark
          initialValues={{
            initialTeams: [],
            targetFolderId: new URLSearchParams(location.search).get("to"),
          }}
        >
          {hasLayers ? (
            <RemoteLayerList
              datasetName={datasetName}
              layers={layers}
              layerSources={layerSources}
              datasetVoxelSize={datasetVoxelSize}
              exploreOptions={getExploreOptions}
              onRemoveLayer={removeLayer}
              onLayersFound={addFoundLayers}
              onStartOver={startOver}
            />
          ) : (
            <RemoteUrlStep field={urlField} onSubmit={() => exploreFirstUrl(urlField.url)} />
          )}
          <RemoteDatasetDetails
            form={form}
            formRef={formRef}
            datastores={uploadableDatastores}
            disabled={!hasLayers}
          />

          <Divider />
          <Flex justify="space-between" align="center" gap="middle" wrap style={{ minHeight: 40 }}>
            <RemoteHelpText />
            {hasLayers ? (
              <Button
                type="primary"
                size="large"
                loading={isImporting}
                onClick={handleImport}
                style={{ minWidth: 160 }}
              >
                Import {layers.length} {layers.length === 1 ? "layer" : "layers"}
              </Button>
            ) : null}
          </Flex>
        </Form>
      </CardContainer>
    </div>
  );
}

export default DatasetAddRemoteView;

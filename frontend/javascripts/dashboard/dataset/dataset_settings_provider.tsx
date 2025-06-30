import { useQueryClient } from "@tanstack/react-query";
import {
  getDataset,
  getDatasetDefaultConfiguration,
  readDatasetDatasource,
  sendAnalyticsEvent,
  updateDatasetDatasource,
  updateDatasetDefaultConfiguration,
  updateDatasetPartial,
  updateDatasetTeams,
} from "admin/rest_api";
import { Form } from "antd";
import dayjs from "dayjs";
import type { UnregisterCallback } from "history";
import { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import { jsonStringify } from "libs/utils";
import _ from "lodash";
import messages from "messages";
import { useCallback, useEffect, useRef, useState } from "react";
import type { APIDataSource, APIDataset, MutableAPIDataset } from "types/api_types";
import { enforceValidatedDatasetViewConfiguration } from "types/schemas/dataset_view_configuration_defaults";
import {
  EXPECTED_TRANSFORMATION_LENGTH,
  doAllLayersHaveTheSameRotation,
  getRotationSettingsFromTransformationIn90DegreeSteps,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import type { DatasetConfiguration } from "viewer/store";
import type { DatasetRotationAndMirroringSettings } from "./dataset_rotation_form_item";
import {
  DatasetSettingsContext,
  type DatasetSettingsContextValue,
} from "./dataset_settings_context";
import { syncDataSourceFields } from "./dataset_settings_data_tab";
import type { FormData } from "./dataset_settings_context";
import { hasFormError } from "./helper_components";
import useBeforeUnload from "./useBeforeUnload_hook";

type DatasetSettingsProviderProps = {
  children: React.ReactNode;
  datasetId: string;
  isEditingMode: boolean;
  onComplete: () => void;
  onCancel: () => void;
};

export const DatasetSettingsProvider: React.FC<DatasetSettingsProviderProps> = ({
  children,
  datasetId,
  isEditingMode,
  onComplete,
  onCancel,
}) => {
  const [form] = Form.useForm<FormData>();
  const queryClient = useQueryClient();

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [dataset, setDataset] = useState<APIDataset | null | undefined>(null);
  const [datasetDefaultConfiguration, setDatasetDefaultConfiguration] = useState<
    DatasetConfiguration | null | undefined
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeDataSourceEditMode, setActiveDataSourceEditMode] = useState<"simple" | "advanced">(
    "simple",
  );
  const [savedDataSourceOnServer, setSavedDataSourceOnServer] = useState<
    APIDataSource | null | undefined
  >(null);

  const unblockRef = useRef<UnregisterCallback | null>(null);
  const blockTimeoutIdRef = useRef<number | null>(null);

  const unblockHistory = useCallback(() => {
    window.onbeforeunload = null;

    if (blockTimeoutIdRef.current != null) {
      clearTimeout(blockTimeoutIdRef.current);
      blockTimeoutIdRef.current = null;
    }

    if (unblockRef.current != null) {
      unblockRef.current();
      unblockRef.current = null;
    }
  }, []);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      let fetchedDataset = await getDataset(datasetId);
      const dataSource = await readDatasetDatasource(fetchedDataset);

      setSavedDataSourceOnServer(dataSource);

      if (dataSource == null) {
        throw new Error("No datasource received from server.");
      }

      if (fetchedDataset.dataSource.status?.includes("Error")) {
        const datasetClone = _.cloneDeep(fetchedDataset) as any as MutableAPIDataset;
        datasetClone.dataSource.status = fetchedDataset.dataSource.status;
        fetchedDataset = datasetClone as APIDataset;
      }

      form.setFieldsValue({
        dataSourceJson: jsonStringify(dataSource),
        dataset: {
          name: fetchedDataset.name,
          isPublic: fetchedDataset.isPublic || false,
          description: fetchedDataset.description || undefined,
          allowedTeams: fetchedDataset.allowedTeams || [],
          sortingKey: dayjs(fetchedDataset.sortingKey),
        },
      });

      form.setFieldsValue({
        dataSource,
      });

      if (doAllLayersHaveTheSameRotation(dataSource.dataLayers)) {
        const firstLayerTransformations = dataSource.dataLayers[0].coordinateTransformations;
        let initialDatasetRotationSettings: DatasetRotationAndMirroringSettings;
        if (
          !firstLayerTransformations ||
          firstLayerTransformations.length !== EXPECTED_TRANSFORMATION_LENGTH
        ) {
          const nulledSetting = { rotationInDegrees: 0, isMirrored: false };
          initialDatasetRotationSettings = { x: nulledSetting, y: nulledSetting, z: nulledSetting };
        } else {
          initialDatasetRotationSettings = {
            x: getRotationSettingsFromTransformationIn90DegreeSteps(
              firstLayerTransformations[1],
              "x",
            ),
            y: getRotationSettingsFromTransformationIn90DegreeSteps(
              firstLayerTransformations[2],
              "y",
            ),
            z: getRotationSettingsFromTransformationIn90DegreeSteps(
              firstLayerTransformations[3],
              "z",
            ),
          };
        }
        form.setFieldsValue({
          datasetRotation: initialDatasetRotationSettings,
        });
      }

      const fetchedDatasetDefaultConfiguration = await getDatasetDefaultConfiguration(datasetId);
      enforceValidatedDatasetViewConfiguration(
        fetchedDatasetDefaultConfiguration,
        fetchedDataset,
        true,
      );
      form.setFieldsValue({
        defaultConfiguration: fetchedDatasetDefaultConfiguration,
        defaultConfigurationLayersJson: JSON.stringify(
          fetchedDatasetDefaultConfiguration.layers,
          null,
          "  ",
        ),
      });

      setDatasetDefaultConfiguration(fetchedDatasetDefaultConfiguration);
      setDataset(fetchedDataset);
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      setIsLoading(false);
      form.validateFields();
    }
  }, [datasetId, form]);

  const getFormValidationSummary = useCallback((): Record<string, any> => {
    const err = form.getFieldsError();
    const formErrors: Record<string, any> = {};

    if (!err || !dataset) {
      return formErrors;
    }

    const hasErr = hasFormError;

    if (hasErr(err, "dataSource") || hasErr(err, "dataSourceJson")) {
      formErrors.data = true;
    }

    if (hasErr(err, "dataset")) {
      formErrors.general = true;
    }

    if (hasErr(err, "defaultConfiguration") || hasErr(err, "defaultConfigurationLayersJson")) {
      formErrors.defaultConfig = true;
    }

    return formErrors;
  }, [form, dataset]);

  const didDatasourceChange = useCallback(
    (dataSource: Record<string, any>) => {
      return !_.isEqual(dataSource, savedDataSourceOnServer || {});
    },
    [savedDataSourceOnServer],
  );

  const didDatasourceIdChange = useCallback(
    (dataSource: Record<string, any>) => {
      const savedDatasourceId = savedDataSourceOnServer?.id;
      if (!savedDatasourceId) {
        return false;
      }
      return (
        savedDatasourceId.name !== dataSource.id.name ||
        savedDatasourceId.team !== dataSource.id.team
      );
    },
    [savedDataSourceOnServer],
  );

  const isOnlyDatasourceIncorrectAndNotEdited = useCallback(() => {
    const validationSummary = getFormValidationSummary();

    if (_.size(validationSummary) === 1 && validationSummary.data) {
      try {
        const dataSource = JSON.parse(form.getFieldValue("dataSourceJson"));
        const didNotEditDatasource = !didDatasourceChange(dataSource);
        return didNotEditDatasource;
      } catch (_e) {
        return false;
      }
    }

    return false;
  }, [getFormValidationSummary, form, didDatasourceChange]);

  const submitForm = useCallback(
    async (formValues: FormData) => {
      const datasetChangeValues = { ...formValues.dataset };

      if (datasetChangeValues.sortingKey != null) {
        datasetChangeValues.sortingKey = datasetChangeValues.sortingKey.valueOf();
      }

      const teamIds = formValues.dataset.allowedTeams.map((t) => t.id);
      await updateDatasetPartial(datasetId, datasetChangeValues);

      if (datasetDefaultConfiguration != null) {
        await updateDatasetDefaultConfiguration(
          datasetId,
          _.extend({}, datasetDefaultConfiguration, formValues.defaultConfiguration, {
            layers: JSON.parse(formValues.defaultConfigurationLayersJson),
          }),
        );
      }

      await updateDatasetTeams(datasetId, teamIds);
      const dataSource = JSON.parse(formValues.dataSourceJson);

      if (dataset != null && didDatasourceChange(dataSource)) {
        if (didDatasourceIdChange(dataSource)) {
          Toast.warning(messages["dataset.settings.updated_datasource_id_warning"]);
        }
        await updateDatasetDatasource(dataset.directoryName, dataset.dataStore.url, dataSource);
        setSavedDataSourceOnServer(dataSource);
      }

      const verb = isEditingMode ? "updated" : "imported";
      Toast.success(`Successfully ${verb} ${dataset?.name || datasetId}.`);
      setHasUnsavedChanges(false);

      if (dataset && queryClient) {
        queryClient.invalidateQueries({
          queryKey: ["datasetsByFolder", dataset.folderId],
        });
        queryClient.invalidateQueries({ queryKey: ["dataset", "search"] });
      }

      onComplete();
    },
    [
      datasetId,
      datasetDefaultConfiguration,
      dataset,
      didDatasourceChange,
      didDatasourceIdChange,
      isEditingMode,
      queryClient,
      onComplete,
    ],
  );

  const handleValidationFailed = useCallback(
    ({ values }: { values: FormData }) => {
      const isOnlyDatasourceIncorrectAndNotEditedResult = isOnlyDatasourceIncorrectAndNotEdited();

      if (!isOnlyDatasourceIncorrectAndNotEditedResult || !dataset) {
        // TODO: Add logic to switch to problematic tab
        console.warn("Validation failed, switching to problematic tab logic needed.");
        Toast.warning(messages["dataset.import.invalid_fields"]);
      } else {
        submitForm(values);
      }
    },
    [isOnlyDatasourceIncorrectAndNotEdited, dataset, submitForm],
  );

  const handleSubmit = useCallback(() => {
    syncDataSourceFields(form, activeDataSourceEditMode === "simple" ? "advanced" : "simple");

    const afterForceUpdateCallback = () => {
      setTimeout(
        () =>
          form
            .validateFields()
            .then((formValues) => submitForm(formValues))
            .catch((errorInfo) => handleValidationFailed(errorInfo)),
        0,
      );
    };

    setActiveDataSourceEditMode((prev) => prev);
    setTimeout(afterForceUpdateCallback, 0);
  }, [form, activeDataSourceEditMode, submitForm, handleValidationFailed]);

  const onValuesChange = useCallback((_changedValues: FormData, _allValues: FormData) => {
    setHasUnsavedChanges(true);
  }, []);

  const handleCancel = useCallback(() => {
    unblockHistory();
    onCancel();
  }, [unblockHistory, onCancel]);

  const handleDataSourceEditModeChange = useCallback(
    (activeEditMode: "simple" | "advanced") => {
      syncDataSourceFields(form, activeEditMode);
      form.validateFields();
      setActiveDataSourceEditMode(activeEditMode);
    },
    [form],
  );

  useBeforeUnload(hasUnsavedChanges, messages["dataset.leave_with_unsaved_changes"]);

  useEffect(() => {
    fetchData();
    sendAnalyticsEvent("open_dataset_settings", {
      datasetName: dataset ? dataset.name : "Not found dataset",
    });
  }, [fetchData, dataset]);

  const contextValue: DatasetSettingsContextValue = {
    form,
    isLoading,
    hasUnsavedChanges,
    dataset,
    datasetId,
    datasetDefaultConfiguration,
    activeDataSourceEditMode,
    savedDataSourceOnServer,
    isEditingMode,
    onComplete,
    onCancel,
    handleSubmit,
    handleCancel,
    handleDataSourceEditModeChange,
    onValuesChange,
    getFormValidationSummary,
  };

  return (
    <DatasetSettingsContext.Provider value={contextValue}>
      {children}
    </DatasetSettingsContext.Provider>
  );
};

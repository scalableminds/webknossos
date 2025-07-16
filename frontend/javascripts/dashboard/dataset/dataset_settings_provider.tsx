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
import { Form, type FormInstance } from "antd";
import dayjs from "dayjs";
import { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import { jsonStringify } from "libs/utils";
import _ from "lodash";
import messages from "messages";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import type { DataSourceEditMode, FormData } from "./dataset_settings_context";
import { syncDataSourceFields } from "./dataset_settings_data_tab";
import { hasFormError } from "./helper_components";
import useBeforeUnload from "./useBeforeUnload_hook";

type DatasetSettingsProviderProps = {
  children: React.ReactNode;
  datasetId: string;
  isEditingMode: boolean;
  onComplete?: () => void;
  onCancel?: () => void;
  form?: FormInstance<FormData>;
};

export function getRotationFromCoordinateTransformations(
  dataSource: APIDataSource,
): DatasetRotationAndMirroringSettings | undefined {
  if (doAllLayersHaveTheSameRotation(dataSource.dataLayers)) {
    const firstLayerTransformations = dataSource.dataLayers[0].coordinateTransformations;
    let initialDatasetRotationSettings: DatasetRotationAndMirroringSettings;
    if (
      !firstLayerTransformations ||
      firstLayerTransformations.length !== EXPECTED_TRANSFORMATION_LENGTH
    ) {
      3;
      const nulledSetting = { rotationInDegrees: 0, isMirrored: false };
      initialDatasetRotationSettings = { x: nulledSetting, y: nulledSetting, z: nulledSetting };
    } else {
      initialDatasetRotationSettings = {
        x: getRotationSettingsFromTransformationIn90DegreeSteps(firstLayerTransformations[1], "x"),
        y: getRotationSettingsFromTransformationIn90DegreeSteps(firstLayerTransformations[2], "y"),
        z: getRotationSettingsFromTransformationIn90DegreeSteps(firstLayerTransformations[3], "z"),
      };
    }
    return initialDatasetRotationSettings;
  }

  return undefined;
}

export const DatasetSettingsProvider: React.FC<DatasetSettingsProviderProps> = ({
  children,
  datasetId,
  isEditingMode,
  onComplete,
  onCancel,
  form: formProp, // In case of Remote Dataset Upload, we start with a prefilled form containing the DS information
}) => {
  const [form] = Form.useForm<FormData>(formProp);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [hasFormErrors, setHasFormErrors] = useState(false);
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

  onComplete = onComplete ? onComplete : () => navigate("/dashboard");
  onCancel = onCancel ? onCancel : () => navigate("/dashboard");

  const fetchData = useCallback(async (): Promise<string | undefined> => {
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
          // @ts-ignore: The Antd DatePicker component requires a daysjs date object instead of plain number timestamp
          sortingKey: dayjs(fetchedDataset.sortingKey as any as Dayjs),
        },
      });

      form.setFieldsValue({
        // @ts-ignore Missmatch between APIDataSource and MutableAPIDataset
        dataSource,
      });

      form.setFieldsValue({
        datasetRotation: getRotationFromCoordinateTransformations(dataSource),
      });

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
      return fetchedDataset.name;
    } catch (error) {
      handleGenericError(error as Error);
      return undefined;
    } finally {
      setIsLoading(false);
      form.validateFields();
    }
  }, [datasetId, form.setFieldsValue, form.validateFields]);

  const getFormValidationSummary = useCallback((): Record<
    "data" | "general" | "defaultConfig",
    boolean
  > => {
    const err = form.getFieldsError();
    const formErrors: Record<string, any> = {};

    if (!err || !dataset) {
      return formErrors;
    }

    if (
      hasFormError(err, "dataSource") ||
      hasFormError(err, "dataSourceJson") ||
      hasFormError(err, "datasetRotation")
    ) {
      formErrors.data = true;
    }

    if (hasFormError(err, "dataset")) {
      formErrors.general = true;
    }

    if (
      hasFormError(err, "defaultConfiguration") ||
      hasFormError(err, "defaultConfigurationLayersJson")
    ) {
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

  const submitForm = useCallback(async () => {
    // Call getFieldsValue() with "True" to get all values from form not just those that are visible in the current view
    const formValues: FormData = form.getFieldsValue(true);
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
    Toast.success(`Successfully ${verb} ${datasetChangeValues?.name || datasetId}.`);
    setHasUnsavedChanges(false);

    if (dataset && queryClient) {
      queryClient.invalidateQueries({
        queryKey: ["datasetsByFolder", dataset.folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["dataset", "search"] });
    }

    onComplete();
  }, [
    datasetId,
    datasetDefaultConfiguration,
    dataset,
    didDatasourceChange,
    didDatasourceIdChange,
    isEditingMode,
    queryClient,
    onComplete,
    form.getFieldsValue,
  ]);

  const switchToProblematicTab = useCallback(() => {
    const validationSummary = getFormValidationSummary();

    // Switch to the earliest, problematic tab
    switch (Object.keys(validationSummary)) {
      case ["data"]:
        return navigate("data");
      case ["general"]:
        // "general" is very broad and there is no specific tab for it.
        return;
      case ["defaultConfig"]:
        return navigate("defaultConfig");
      default:
        return;
    }
  }, [getFormValidationSummary, navigate]);

  const handleValidationFailed = useCallback(() => {
    const isOnlyDatasourceIncorrectAndNotEditedResult = isOnlyDatasourceIncorrectAndNotEdited();

    if (!isOnlyDatasourceIncorrectAndNotEditedResult || !dataset) {
      switchToProblematicTab();
      setHasFormErrors(true);
      Toast.warning(messages["dataset.import.invalid_fields"]);
    } else {
      submitForm();
    }
  }, [isOnlyDatasourceIncorrectAndNotEdited, dataset, submitForm, switchToProblematicTab]);

  const handleSubmit = useCallback(() => {
    syncDataSourceFields(form, activeDataSourceEditMode === "simple" ? "advanced" : "simple");

    const afterForceUpdateCallback = () => {
      setTimeout(() => form.validateFields().then(submitForm).catch(handleValidationFailed), 0);
    };

    setActiveDataSourceEditMode((prev) => prev);
    setTimeout(afterForceUpdateCallback, 0);
  }, [form, activeDataSourceEditMode, submitForm, handleValidationFailed]);

  const onValuesChange = useCallback((_changedValues: FormData, _allValues: FormData) => {
    setHasUnsavedChanges(true);
  }, []);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const handleDataSourceEditModeChange = useCallback(
    (activeEditMode: DataSourceEditMode) => {
      syncDataSourceFields(form, activeEditMode);
      form.validateFields();
      setActiveDataSourceEditMode(activeEditMode);
    },
    [form],
  );

  useBeforeUnload(hasUnsavedChanges, messages["dataset.leave_with_unsaved_changes"]);

  useEffect(() => {
    // In case of Remote Dataset Upload, we start with a prefilled form containing the DS information
    if (formProp === undefined) {
      // For all other cases, i.e. editting existing datasets, we fetch the dataset information from the backend
      fetchData().then((datasetName) => {
        sendAnalyticsEvent("open_dataset_settings", {
          datasetName: datasetName ?? "Not found dataset",
        });
      });
    }
  }, [fetchData, formProp]);

  const contextValue: DatasetSettingsContextValue = {
    form,
    isLoading,
    dataset,
    datasetId,
    datasetDefaultConfiguration,
    activeDataSourceEditMode,
    isEditingMode,
    handleSubmit,
    handleCancel,
    handleDataSourceEditModeChange,
    onValuesChange,
    getFormValidationSummary,
    hasFormErrors,
  };

  return (
    <DatasetSettingsContext.Provider value={contextValue}>
      {children}
    </DatasetSettingsContext.Provider>
  );
};

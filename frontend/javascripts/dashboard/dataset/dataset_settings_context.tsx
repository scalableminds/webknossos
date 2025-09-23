import type { FormInstance } from "antd";
import { createContext, useContext } from "react";
import type { APIDataSource, APIDataset } from "types/api_types";
import type { DatasetConfiguration } from "viewer/store";
import type { DatasetRotationAndMirroringSettings } from "./dataset_rotation_form_item";

export type DataSourceEditMode = "simple" | "advanced";

export type FormData = {
  dataSource: APIDataSource;
  dataset: APIDataset;
  defaultConfiguration: DatasetConfiguration;
  defaultConfigurationLayersJson: string;
  datasetRotation?: DatasetRotationAndMirroringSettings;
};

export type DatasetSettingsContextValue = {
  form: FormInstance<FormData>;
  isLoading: boolean;
  dataset: APIDataset | null | undefined;
  datasetId: string;
  datasetDefaultConfiguration: DatasetConfiguration | null | undefined;
  isEditingMode: boolean;
  handleSubmit: () => void;
  handleCancel: () => void;
  onValuesChange: (changedValues: FormData, allValues: FormData) => void;
  getFormValidationSummary: () => Record<string, any>;
  hasFormErrors: boolean;
};

export const DatasetSettingsContext = createContext<DatasetSettingsContextValue | undefined>(
  undefined,
);

export const useDatasetSettingsContext = () => {
  const context = useContext(DatasetSettingsContext);
  if (!context) {
    throw new Error("useDatasetSettingsContext must be used within a DatasetSettingsProvider");
  }
  return context;
};

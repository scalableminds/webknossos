import { DatasetSettingsProvider } from "dashboard/dataset/dataset_settings_provider";
import DatasetSettingsView from "dashboard/dataset/dataset_settings_view";

// The provider and the view are loaded as one lazy unit, so that the router does not have to
// import either of them (nor the dataset-settings tabs they reach) to render its route table.
export default function DatasetSettingsScreen({ datasetId }: { datasetId: string }) {
  return (
    <DatasetSettingsProvider isEditingMode datasetId={datasetId}>
      <DatasetSettingsView />
    </DatasetSettingsProvider>
  );
}

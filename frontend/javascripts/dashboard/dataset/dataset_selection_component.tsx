import { getDatasets } from "admin/admin_rest_api";
import AsyncSelect from "components/async_select";

// Usage of AsyncSelect
export interface DatasetSelectionValue {
  label: string;
  value: string;
}

async function fetchDatasets(query: string): Promise<DatasetSelectionValue[]> {
  const datasets = await getDatasets(false, null, query, null, 20);

  return datasets.map((d) => ({
    label: d.name,
    value: d.id,
  }));
}

export default function DatasetSelectionComponent({
  datasetValues,
  setDatasetValues,
}: {
  datasetValues: DatasetSelectionValue[];
  setDatasetValues: (values: DatasetSelectionValue[]) => void;
}) {
  return (
    <AsyncSelect
      mode="multiple"
      value={datasetValues}
      placeholder="Type to search and select dataset(s)..."
      fetchOptions={fetchDatasets}
      onChange={(newValue) => {
        setDatasetValues(newValue as DatasetSelectionValue[]);
      }}
      style={{ width: "100%" }}
    />
  );
}

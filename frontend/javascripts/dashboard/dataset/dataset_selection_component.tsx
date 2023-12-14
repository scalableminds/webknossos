import { getDatasets } from "admin/admin_rest_api";
import AsyncSelect from "components/async_select";
import React from "react";

// Usage of AsyncSelect
export interface DatasetSelectionValue {
  label: string;
  value: string;
}

async function fetchDatasets(query: string): Promise<DatasetSelectionValue[]> {
  const datasets = await getDatasets(false, null, query, null, 20);

  return datasets.map((d) => ({
    label: d.name,
    value: d.name,
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
      placeholder="Select dataset"
      fetchOptions={fetchDatasets}
      onChange={(newValue) => {
        setDatasetValues(newValue as DatasetSelectionValue[]);
        console.log("set value to", newValue);
      }}
      style={{ width: "100%" }}
    />
  );
}

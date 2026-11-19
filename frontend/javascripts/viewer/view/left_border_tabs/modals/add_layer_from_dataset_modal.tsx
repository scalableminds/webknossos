// Unified datasets prototype: links a data layer of another dataset into this (virtual) dataset.
// The layer is a metadata copy that points at the same data; changes to the source don't propagate.
import { useQuery } from "@tanstack/react-query";
import { addLayerFromOtherDataset } from "admin/api/unified_datasets";
import { getDataset, getDatasets } from "admin/rest_api";
import { Form, Input, Modal, Select, Typography } from "antd";
import AsyncSelect from "components/async_select";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useEffect, useMemo, useState } from "react";
import { Model } from "viewer/singletons";
import { getUnusedLayerName } from "./add_volume_layer_modal";

type DatasetOption = { label: string; value: string };

async function searchDatasets(query: string): Promise<DatasetOption[]> {
  const datasets = await getDatasets(false, null, query, null, 20);
  return datasets.map((dataset) => ({ label: dataset.name, value: dataset.id }));
}

function useSourceDataLayers(sourceDatasetId: string | undefined) {
  const { data: sourceDataset, isFetching } = useQuery({
    queryKey: ["datasetForAddingLayer", sourceDatasetId],
    queryFn: () => getDataset(sourceDatasetId ?? ""),
    enabled: sourceDatasetId != null,
    meta: { persist: false },
  });
  const layers =
    sourceDataset != null && "dataLayers" in sourceDataset.dataSource
      ? sourceDataset.dataSource.dataLayers
      : [];
  return { layers, isFetching };
}

export default function AddLayerFromDatasetModal({ onCancel }: { onCancel: () => void }) {
  const targetDatasetId = useWkSelector((state) => state.dataset.id);
  const existingLayerNames = useWkSelector((state) =>
    state.dataset.dataSource.dataLayers.map((layer) => layer.name),
  );
  const [sourceDataset, setSourceDataset] = useState<DatasetOption | undefined>(undefined);
  const [sourceLayerName, setSourceLayerName] = useState<string | undefined>(undefined);
  const [targetLayerName, setTargetLayerName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { layers, isFetching } = useSourceDataLayers(sourceDataset?.value);

  // Name prompt: default to the source layer's name, made unique within this dataset.
  useEffect(() => {
    if (sourceLayerName != null) {
      setTargetLayerName(getUnusedLayerName(sourceLayerName, existingLayerNames));
    }
  }, [sourceLayerName, existingLayerNames]);

  const nameError = useMemo(() => {
    if (targetLayerName.trim() === "") return "Enter a name.";
    if (existingLayerNames.includes(targetLayerName))
      return "This dataset already has such a layer.";
    if (targetLayerName.includes("/") || targetLayerName.startsWith(".")) return "Invalid name.";
    return null;
  }, [targetLayerName, existingLayerNames]);

  const submit = async () => {
    if (sourceDataset == null || sourceLayerName == null) return;
    setIsSubmitting(true);
    try {
      await Model.ensureSavedState();
      await addLayerFromOtherDataset(targetDatasetId, {
        sourceDatasetId: sourceDataset.value,
        sourceLayerName,
        targetLayerName,
      });
      // The data source changes, so the viewer has to be set up again.
      location.reload();
    } catch (error) {
      Toast.error("Could not add the layer. Both datasets need to be on the same datastore.");
      console.error(error);
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title="Add layer from another dataset"
      open
      onCancel={onCancel}
      onOk={submit}
      okText="Add layer"
      okButtonProps={{
        disabled: sourceLayerName == null || nameError != null,
        loading: isSubmitting,
      }}
    >
      <Typography.Paragraph type="secondary">
        The layer is linked: it shows the data of the other dataset without duplicating it. Later
        changes to the other dataset are not reflected here.
      </Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label="Dataset">
          <AsyncSelect<DatasetOption>
            value={sourceDataset}
            placeholder="Type to search for a dataset…"
            fetchOptions={searchDatasets}
            onChange={(value) => {
              setSourceDataset(value as unknown as DatasetOption);
              setSourceLayerName(undefined);
            }}
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item label="Layer">
          <Select
            value={sourceLayerName}
            loading={isFetching}
            disabled={sourceDataset == null}
            placeholder="Select a layer"
            onChange={setSourceLayerName}
            options={layers.map((layer) => ({
              value: layer.name,
              label: `${layer.name} (${layer.category})`,
            }))}
          />
        </Form.Item>
        <Form.Item
          label="Name in this dataset"
          validateStatus={sourceLayerName != null && nameError != null ? "error" : undefined}
          help={sourceLayerName != null ? nameError : undefined}
        >
          <Input
            value={targetLayerName}
            disabled={sourceLayerName == null}
            onChange={(event) => setTargetLayerName(event.target.value)}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

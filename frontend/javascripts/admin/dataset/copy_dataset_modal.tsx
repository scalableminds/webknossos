// Unified datasets prototype (features.unifiedDatasets): "Copy dataset" modal, shared by the viewer
// and the dashboard. Data layers are linked (the copy points at the same data), annotation layers
// are copied.
import { copyDataset } from "admin/api/unified_datasets";
import { Alert, Checkbox, Flex, Form, Input, Modal, Space, Tag, Typography } from "antd";
import Toast from "libs/toast";
import { useEffect, useMemo, useState } from "react";
import { AnnotationLayerEnum, type AnnotationLayerType } from "types/api_types";

export type CopyDatasetModalDataset = {
  id: string;
  name: string;
  dataLayerNames: string[];
};

export type CopyDatasetModalAnnotationLayer = { name: string; typ: AnnotationLayerType };

type Props = {
  dataset: CopyDatasetModalDataset;
  // The annotation layers the user can see. Empty if the dataset has none.
  annotationLayers: CopyDatasetModalAnnotationLayer[];
  sharingToken?: string | null;
  isOpen: boolean;
  onClose: () => void;
};

const DATASET_NAME_PATTERN = /^[A-Za-z0-9_\-.]{3,}$/;

function useCopyFormState(props: Props) {
  const { dataset, annotationLayers, isOpen } = props;
  const [name, setName] = useState(`${dataset.name}_copy`);
  const [selectedLayerNames, setSelectedLayerNames] = useState<string[]>(dataset.dataLayerNames);
  const [includeAnnotationLayers, setIncludeAnnotationLayers] = useState(
    annotationLayers.length > 0,
  );

  // Start from the defaults whenever the modal is opened.
  useEffect(() => {
    if (isOpen) {
      setName(`${dataset.name}_copy`);
      setSelectedLayerNames(dataset.dataLayerNames);
      setIncludeAnnotationLayers(annotationLayers.length > 0);
    }
  }, [isOpen, dataset, annotationLayers.length]);

  // Volume layers may extend a segmentation layer, so all data layers are linked when they are copied.
  const copiesVolumeLayers =
    includeAnnotationLayers &&
    annotationLayers.some((layer) => layer.typ === AnnotationLayerEnum.Volume);
  const effectiveLayerNames = copiesVolumeLayers ? dataset.dataLayerNames : selectedLayerNames;

  return {
    name,
    setName,
    selectedLayerNames: effectiveLayerNames,
    setSelectedLayerNames,
    includeAnnotationLayers,
    setIncludeAnnotationLayers,
    copiesVolumeLayers,
  };
}

export default function CopyDatasetModal(props: Props) {
  const { dataset, annotationLayers, sharingToken, isOpen, onClose } = props;
  const form = useCopyFormState(props);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nameError = useMemo(() => {
    if (DATASET_NAME_PATTERN.test(form.name)) return null;
    return "Use at least three characters: letters, digits, '_', '-' or '.'.";
  }, [form.name]);
  const hasNoDataLayer = form.selectedLayerNames.length === 0;

  const submit = async () => {
    setIsSubmitting(true);
    try {
      const isAllLayers = form.selectedLayerNames.length === dataset.dataLayerNames.length;
      const { newDatasetId } = await copyDataset(
        dataset.id,
        {
          name: form.name,
          layerNames: isAllLayers ? undefined : form.selectedLayerNames,
          includeAnnotationLayers: form.includeAnnotationLayers,
        },
        sharingToken,
      );
      // A full navigation, so that the viewer starts fresh with the new dataset.
      window.location.href = `/datasets/${form.name}-${newDatasetId}/view`;
    } catch (error) {
      Toast.error("Could not copy the dataset.");
      console.error(error);
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title={`Copy dataset ${dataset.name}`}
      open={isOpen}
      onCancel={onClose}
      onOk={submit}
      okText="Copy"
      okButtonProps={{ disabled: nameError != null || hasNoDataLayer, loading: isSubmitting }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        The copy is yours to edit. Data layers are linked: the copy shows the same data without
        duplicating it. Annotation layers are copied.
      </Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item
          label="Name"
          validateStatus={nameError != null ? "error" : undefined}
          help={nameError}
        >
          <Input value={form.name} onChange={(event) => form.setName(event.target.value)} />
        </Form.Item>
        <Form.Item label="Data layers">
          <Checkbox.Group
            value={form.selectedLayerNames}
            onChange={(values) => form.setSelectedLayerNames(values as string[])}
            disabled={form.copiesVolumeLayers}
            style={{ width: "100%" }}
          >
            <Flex vertical gap={4}>
              {dataset.dataLayerNames.map((layerName) => (
                <Checkbox key={layerName} value={layerName}>
                  <Space size="small">
                    {layerName}
                    <Tag>linked</Tag>
                  </Space>
                </Checkbox>
              ))}
            </Flex>
          </Checkbox.Group>
          {form.copiesVolumeLayers ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Volume annotation layers can extend data layers, so all data layers are linked.
            </Typography.Text>
          ) : null}
          {hasNoDataLayer ? (
            <Alert type="warning" showIcon title="A copy needs at least one data layer." />
          ) : null}
        </Form.Item>
        {annotationLayers.length > 0 ? (
          <Form.Item label="Annotation layers">
            <Checkbox
              checked={form.includeAnnotationLayers}
              onChange={(event) => form.setIncludeAnnotationLayers(event.target.checked)}
            >
              <Space size="small">
                {`Include annotation layers (${annotationLayers.length})`}
                <Tag color="blue">copied</Tag>
              </Space>
            </Checkbox>
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
}

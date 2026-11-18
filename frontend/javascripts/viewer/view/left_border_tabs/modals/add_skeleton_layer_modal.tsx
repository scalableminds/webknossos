// Name prompt for adding a skeleton layer in the unified datasets prototype
// (features.unifiedDatasets).
import { Form, Input, Modal } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useMemo, useState } from "react";
import { getAllReadableLayerNames } from "viewer/model/accessors/volumetracing_accessor";
import { getUnusedLayerName, validateReadableLayerName } from "./add_volume_layer_modal";

export default function AddSkeletonLayerModal({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (layerName: string) => Promise<void>;
}) {
  const dataset = useWkSelector((state) => state.dataset);
  const annotation = useWkSelector((state) => state.annotation);
  const allReadableLayerNames = useMemo(
    () => getAllReadableLayerNames(dataset, annotation),
    [dataset, annotation],
  );
  const [layerName, setLayerName] = useState(() =>
    getUnusedLayerName("Skeleton", allReadableLayerNames),
  );
  const [isAdding, setIsAdding] = useState(false);
  const validationResult = validateReadableLayerName(layerName.trim(), allReadableLayerNames);

  const handleOk = async () => {
    if (!validationResult.isValid) {
      return;
    }
    setIsAdding(true);
    try {
      await onAdd(layerName.trim());
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Modal
      title="Add skeleton layer"
      open
      onCancel={onCancel}
      onOk={handleOk}
      okText="Add skeleton layer"
      okButtonProps={{ disabled: !validationResult.isValid, loading: isAdding }}
    >
      <Form layout="vertical" onFinish={handleOk}>
        <Form.Item
          label="Layer name"
          validateStatus={validationResult.isValid ? undefined : "error"}
          help={validationResult.isValid ? undefined : validationResult.message}
        >
          <Input
            autoFocus
            value={layerName}
            onChange={(event) => setLayerName(event.target.value)}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

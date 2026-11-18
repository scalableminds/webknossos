// Add volume layer modal of the unified datasets prototype (features.unifiedDatasets). Offers a
// fresh, empty volume layer or one that extends a segmentation data layer of the dataset.
import { PlusOutlined } from "@ant-design/icons";
import { Flex, Form, Input, Modal, Radio, Select } from "antd";
import { AsyncButton } from "components/async_clickables";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import type { APIDataset, APIMagRestrictions } from "types/api_types";
import { isEditingAnnotationLayerSetDisabled } from "viewer/model/accessors/annotation_accessor";
import {
  doesSupportVolumeWithFallback,
  getMagInfo,
  getSegmentationLayerByName,
  getSegmentationLayers,
  getSomeMagInfoForDataset,
} from "viewer/model/accessors/dataset_accessor";
import { getAllReadableLayerNames } from "viewer/model/accessors/volumetracing_accessor";
import type { MagInfo } from "viewer/model/helpers/mag_info";
import { api } from "viewer/singletons";
import {
  addVolumeLayerAndReload,
  getUnusedLayerName,
  validateReadableLayerName,
} from "./add_volume_layer_modal";

type VolumeLayerKind = "fresh" | "extend";

function getFullMagRestrictions(magInfo: MagInfo): APIMagRestrictions {
  return {
    min: Math.max(...magInfo.getFinestMag()),
    max: Math.max(...magInfo.getCoarsestMag()),
  };
}

// Segmentation data layers that are not extended by a volume layer yet. A volume layer with a
// fallback replaces its segmentation layer in the merged layer list, so only layers without a
// tracing id remain.
function useExtendableSegmentationLayers(dataset: APIDataset) {
  return useMemo(
    () => getSegmentationLayers(dataset).filter((layer) => layer.tracingId == null),
    [dataset],
  );
}

export default function UnifiedAddVolumeLayerModal({
  dataset,
  onCancel,
  preselectedLayerName,
}: {
  dataset: APIDataset;
  onCancel: () => void;
  preselectedLayerName: string | undefined;
}) {
  const dispatch = useDispatch();
  const annotation = useWkSelector((state) => state.annotation);
  const { isDisabled: mayNotEditLayerSet, explanation: reasonForCantEditLayerSet } = useWkSelector(
    (state) => isEditingAnnotationLayerSetDisabled(state),
  );
  const allReadableLayerNames = useMemo(
    () => getAllReadableLayerNames(dataset, annotation),
    [dataset, annotation],
  );
  const extendableLayers = useExtendableSegmentationLayers(dataset);
  const selectableLayers = extendableLayers.filter((layer) =>
    doesSupportVolumeWithFallback(dataset, layer),
  );

  const [kind, setKind] = useState<VolumeLayerKind>(
    preselectedLayerName != null ? "extend" : "fresh",
  );
  const [fallbackLayerName, setFallbackLayerName] = useState<string | undefined>(
    preselectedLayerName ?? selectableLayers[0]?.name,
  );
  const freshLayerName = useMemo(
    () => getUnusedLayerName("Volume", allReadableLayerNames),
    [allReadableLayerNames],
  );
  // The name follows the chosen option until the user edits it.
  const [customName, setCustomName] = useState<string | null>(null);
  const defaultName =
    kind === "extend" && fallbackLayerName != null ? fallbackLayerName : freshLayerName;
  const layerName = customName ?? defaultName;

  const handleAdd = async () => {
    await api.tracing.save();
    const effectiveFallbackLayerName = kind === "extend" ? fallbackLayerName : undefined;
    if (kind === "extend" && effectiveFallbackLayerName == null) {
      Toast.error("Please select the segmentation layer to extend.");
      return;
    }
    const trimmedName = layerName.trim();
    // Naming the volume layer like the layer it extends is fine, since it replaces that layer.
    const validationResult = validateReadableLayerName(
      trimmedName,
      allReadableLayerNames,
      effectiveFallbackLayerName,
    );
    if (!validationResult.isValid) {
      Toast.error(validationResult.message);
      return;
    }
    const magInfo =
      effectiveFallbackLayerName != null
        ? getMagInfo(getSegmentationLayerByName(dataset, effectiveFallbackLayerName).mags)
        : getSomeMagInfoForDataset(dataset);
    await addVolumeLayerAndReload(dispatch, {
      name: trimmedName,
      fallbackLayerName: effectiveFallbackLayerName ?? null,
      magRestrictions: getFullMagRestrictions(magInfo),
    });
  };

  return (
    <Modal title="Add volume layer" footer={null} onCancel={onCancel} open>
      <Form layout="vertical">
        <Form.Item>
          <Radio.Group value={kind} onChange={(event) => setKind(event.target.value)}>
            <Flex vertical gap={8}>
              <Radio value="fresh">Fresh, empty volume layer</Radio>
              <FastTooltip
                title={
                  selectableLayers.length === 0
                    ? "All segmentation layers of this dataset are already extended."
                    : null
                }
              >
                <Radio value="extend" disabled={selectableLayers.length === 0}>
                  Extend a segmentation layer
                </Radio>
              </FastTooltip>
            </Flex>
          </Radio.Group>
        </Form.Item>
        {kind === "extend" ? (
          <Form.Item label="Segmentation layer">
            <Select
              value={fallbackLayerName}
              onChange={setFallbackLayerName}
              options={extendableLayers.map((layer) => ({
                value: layer.name,
                label: layer.name,
                disabled: !doesSupportVolumeWithFallback(dataset, layer),
              }))}
            />
          </Form.Item>
        ) : null}
        <Form.Item label="Layer name">
          <Input value={layerName} onChange={(event) => setCustomName(event.target.value)} />
        </Form.Item>
      </Form>
      <Flex justify="center">
        <FastTooltip title={reasonForCantEditLayerSet}>
          <AsyncButton
            onClick={handleAdd}
            type="primary"
            icon={<PlusOutlined />}
            disabled={mayNotEditLayerSet}
          >
            Add volume layer
          </AsyncButton>
        </FastTooltip>
      </Flex>
    </Modal>
  );
}

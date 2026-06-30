import { CloseOutlined, ReloadOutlined } from "@ant-design/icons";
import FlipIcon from "@images/icons/icon-flip.svg?react";
import { getDataset, updateDatasetPartial } from "admin/rest_api";
import { Button, Divider, Flex, InputNumber, Popover, Slider, Tooltip, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import type { APIDataLayer, APISkeletonLayer } from "types/api_types";
import { getDatasetBoundingBox } from "viewer/model/accessors/dataset_accessor";
import {
  buildLiveTransforms,
  DEFAULT_SRT,
  extractSRTFromTransforms,
  isLiveTransformCompatible,
  type SRTValues,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { setLayerTransformsAction } from "viewer/model/actions/dataset_actions";

// Fetches the dataset from the backend and extracts the stored SRT values for a single layer.
// isValid is false when the layer has no transforms or transforms incompatible with this editor.
async function fetchStoredSRTForLayer(
  datasetId: string,
  layerName: string,
): Promise<{ srt: SRTValues; isValid: boolean }> {
  const backendDataset = await getDataset(datasetId);
  const backendLayer = backendDataset.dataSource.dataLayers.find((l) => l.name === layerName);
  const stored = backendLayer?.coordinateTransformations ?? null;
  if (stored != null && isLiveTransformCompatible(stored)) {
    return { srt: extractSRTFromTransforms(stored), isValid: true };
  }
  return { srt: DEFAULT_SRT, isValid: false };
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography.Title level={5} style={{ marginBottom: 4 }}>
      {children}
    </Typography.Title>
  );
}

function AxisSliderRow({
  label,
  value,
  storedValue,
  min,
  max,
  step,
  onChange,
  resetDisabled,
  onReset,
  onFlip,
  isFlipped,
}: {
  label: string;
  value: number;
  storedValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  resetDisabled: boolean;
  // Custom reset handler. Defaults to onChange(storedValue); used when resetting the row needs to
  // restore more than the displayed value (e.g. the rotation row also restores the flip sign).
  onReset?: () => void;
  onFlip?: () => void;
  isFlipped?: boolean;
}) {
  return (
    <Flex align="center" gap={6} style={{ marginBottom: 4 }}>
      <Typography.Text strong style={{ width: 12, flexShrink: 0 }}>
        {label}
      </Typography.Text>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        style={{ flex: 1 }}
      />
      <div style={{ width: 28, flexShrink: 0 }}>
        {onFlip != null && (
          <Tooltip title={isFlipped ? "Axis is flipped – click to unflip" : "Flip axis"}>
            <Button
              type="text"
              size="small"
              icon={<FlipIcon />}
              onClick={onFlip}
              style={{
                padding: "0 4px",
                color: isFlipped ? "var(--ant-color-primary)" : undefined,
              }}
            />
          </Tooltip>
        )}
      </div>
      <InputNumber
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(v) => {
          if (v != null) onChange(v);
        }}
        size="small"
        style={{ width: 62 }}
      />
      <Tooltip title="Reset to stored default">
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          onClick={onReset ?? (() => onChange(storedValue))}
          disabled={resetDisabled}
          style={{ flexShrink: 0, padding: "0 4px" }}
        />
      </Tooltip>
    </Flex>
  );
}

export function LayerTransformSettingsContent({
  layer,
  isVisible,
}: {
  layer: APIDataLayer | APISkeletonLayer;
  isVisible: boolean;
}) {
  const dispatch = useDispatch();
  const [isSaving, setIsSaving] = useState(false);
  const [storedSRT, setStoredSRT] = useState<SRTValues>(DEFAULT_SRT);
  const [isFetchingStored, setIsFetchingStored] = useState(false);
  const dataset = useWkSelector((state) => state.dataset);
  const datasetBbox = useMemo(() => getDatasetBoundingBox(dataset), [dataset]);
  const translationSettingLimits = useMemo<[number, number, number]>(
    () => [
      datasetBbox.max[0] - datasetBbox.min[0],
      datasetBbox.max[1] - datasetBbox.min[1],
      datasetBbox.max[2] - datasetBbox.min[2],
    ],
    [datasetBbox],
  );
  const transforms = useWkSelector((state) => {
    const dataLayer = state.dataset.dataSource.dataLayers.find((l) => l.name === layer.name);
    return dataLayer?.coordinateTransformations ?? null;
  });
  const isNativelyRendered = useWkSelector(
    (state) => state.datasetConfiguration.nativelyRenderedLayerName === layer.name,
  );

  const isCompatible = useMemo(() => isLiveTransformCompatible(transforms), [transforms]);

  useEffect(() => {
    if (!isVisible) return;
    const fetchStoredSRT = async () => {
      setIsFetchingStored(true);
      try {
        const { srt } = await fetchStoredSRTForLayer(dataset.id, layer.name);
        setStoredSRT(srt);
      } catch {
        setStoredSRT(DEFAULT_SRT);
      } finally {
        setIsFetchingStored(false);
      }
    };
    fetchStoredSRT();
  }, [isVisible, dataset.id, layer.name]);

  const srtFromStore = useMemo((): SRTValues => {
    if (!transforms || transforms.length === 0) return DEFAULT_SRT;
    return extractSRTFromTransforms(transforms);
  }, [transforms]);

  const handleChange = useCallback(
    (newSRT: SRTValues) => {
      const newTransforms = buildLiveTransforms(
        newSRT.scale,
        newSRT.rotation,
        newSRT.translation,
        datasetBbox,
      );
      dispatch(setLayerTransformsAction(layer.name, newTransforms));
    },
    [dispatch, layer.name, datasetBbox],
  );

  const handleResetToStored = useCallback(async () => {
    setIsFetchingStored(true);
    try {
      const { srt: restoredSRT, isValid } = await fetchStoredSRTForLayer(dataset.id, layer.name);
      setStoredSRT(restoredSRT);
      handleChange(restoredSRT);
      if (!isValid) {
        Toast.info(
          "Restored to default transforms as transforms in the backend are incompatible with the Live Transforms editor.",
        );
      }
    } catch (e) {
      console.error("Failed to fetch stored transforms:", e);
      Toast.error("Failed to fetch stored transforms. Please try again.");
    } finally {
      setIsFetchingStored(false);
    }
  }, [dataset.id, layer.name, handleChange]);

  const handleSaveForAllUsers = useCallback(async () => {
    setIsSaving(true);
    try {
      const currentTransforms = transforms;
      const areValidTransforms = currentTransforms && isLiveTransformCompatible(currentTransforms);
      if (!areValidTransforms) {
        return;
      }
      const backendDataset = await getDataset(dataset.id);
      const dataSource = {
        ...backendDataset.dataSource,
        dataLayers: backendDataset.dataSource.dataLayers.map((l) =>
          l.name === layer.name ? { ...l, coordinateTransformations: currentTransforms } : l,
        ),
      };
      await updateDatasetPartial(dataset.id, { dataSource });
      setStoredSRT(extractSRTFromTransforms(currentTransforms));
      Toast.success("Layer transforms saved for all users.");
    } catch (e) {
      console.error("Failed to save layer transforms:", e);
      Toast.error("Failed to save layer transforms. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [dataset.id, layer.name, transforms]);

  if (!isCompatible) {
    return (
      <Typography.Text type="secondary" style={{ maxWidth: 240, display: "block" }}>
        The transform format of this layer is not editable here. Clear the layer&apos;s transforms
        in the dataset settings to use this editor.
      </Typography.Text>
    );
  }

  if (isNativelyRendered) {
    return (
      <Typography.Text type="secondary" style={{ maxWidth: 240, display: "block" }}>
        This layer is currently rendered natively (without its transforms applied). Editing is
        disabled to avoid confusion. To edit the transforms, disable native rendering for this layer
        first.
      </Typography.Text>
    );
  }

  const { scale, rotation, translation } = srtFromStore;

  const updateScale = (axis: 0 | 1 | 2, v: number) => {
    const newScale = [...scale] as [number, number, number];
    newScale[axis] = v;
    handleChange({ scale: newScale, rotation, translation });
  };

  const updateRotation = (axis: 0 | 1 | 2, v: number) => {
    const newRotation = [...rotation] as [number, number, number];
    newRotation[axis] = v;
    handleChange({ scale, rotation: newRotation, translation });
  };

  const updateTranslation = (axis: 0 | 1 | 2, v: number) => {
    const newTranslation = [...translation] as [number, number, number];
    newTranslation[axis] = v;
    handleChange({ scale, rotation, translation: newTranslation });
  };

  // Resets the rotation row for an axis. Since the flip toggle lives in the rotation row, this also
  // restores the stored flip orientation (the sign of the scale) while keeping the current
  // magnitude, which is controlled by the scale row.
  const resetRotationAndFlip = (axis: 0 | 1 | 2) => {
    const newRotation = [...rotation] as [number, number, number];
    newRotation[axis] = storedSRT.rotation[axis];
    const newScale = [...scale] as [number, number, number];
    const storedSign = storedSRT.scale[axis] < 0 ? -1 : 1;
    newScale[axis] = Math.abs(scale[axis]) * storedSign;
    handleChange({ scale: newScale, rotation: newRotation, translation });
  };

  return (
    <Flex vertical style={{ width: 250 }}>
      <SectionLabel>Translation</SectionLabel>
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <AxisSliderRow
          key={axis}
          label={axis}
          value={translation[i]}
          storedValue={storedSRT.translation[i]}
          min={-translationSettingLimits[i]}
          max={translationSettingLimits[i]}
          step={1}
          onChange={(v) => updateTranslation(i as 0 | 1 | 2, v)}
          resetDisabled={isFetchingStored}
        />
      ))}
      <SectionLabel>Rotation</SectionLabel>
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <AxisSliderRow
          key={axis}
          label={axis}
          value={rotation[i]}
          storedValue={storedSRT.rotation[i]}
          min={0}
          max={359.9}
          step={0.1}
          onChange={(v) => updateRotation(i as 0 | 1 | 2, v)}
          resetDisabled={isFetchingStored}
          onReset={() => resetRotationAndFlip(i as 0 | 1 | 2)}
          onFlip={() => updateScale(i as 0 | 1 | 2, -scale[i])}
          isFlipped={scale[i] < 0}
        />
      ))}
      <SectionLabel>Scaling</SectionLabel>
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <AxisSliderRow
          key={axis}
          label={axis}
          value={Math.abs(scale[i])}
          storedValue={Math.abs(storedSRT.scale[i])}
          min={0.0001}
          max={10}
          step={0.1}
          // The slider shows only the magnitude; keep the current flip orientation here. Resetting
          // the flip is handled by the rotation row, where the flip toggle lives.
          onChange={(v) => updateScale(i as 0 | 1 | 2, v * (scale[i] < 0 ? -1 : 1))}
          resetDisabled={isFetchingStored}
        />
      ))}
      <Divider />
      <Flex vertical gap={8}>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={isFetchingStored}
          disabled={isFetchingStored}
          onClick={handleResetToStored}
          block
        >
          Reset to Stored Default
        </Button>
        <Button
          type="primary"
          size="small"
          loading={isSaving}
          onClick={handleSaveForAllUsers}
          block
        >
          Store as Default
        </Button>
      </Flex>
    </Flex>
  );
}

export function LayerTransformSettingsPopover({
  layer,
  open,
  onClose,
}: {
  layer: APIDataLayer | APISkeletonLayer;
  open: boolean;
  onClose: () => void;
}) {
  const title = (
    <Flex justify="space-between" align="center">
      <span>
        <Typography.Title level={4}>Layer Transforms</Typography.Title>
      </span>
      <CloseOutlined
        style={{ cursor: "pointer", fontSize: 12, color: "var(--ant-color-text-secondary)" }}
        onClick={onClose}
      />
    </Flex>
  );
  return (
    <Popover
      open={open}
      placement="left"
      title={title}
      content={<LayerTransformSettingsContent layer={layer} isVisible={open} />}
    >
      <span />
    </Popover>
  );
}

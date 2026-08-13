import { CloseOutlined, ReloadOutlined } from "@ant-design/icons";
import FlipIcon from "@images/icons/icon-flip.svg?react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDataset, updateDatasetPartial } from "admin/rest_api";
import { Button, Divider, Flex, InputNumber, Popover, Slider, Tooltip, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { APIDataLayer, APISkeletonLayer } from "types/api_types";
import { getUntransformedDatasetBoundingBox } from "viewer/model/accessors/dataset_accessor";
import type { Vector3 } from "viewer/constants";
import {
  getLayerBoundingBox,
} from "viewer/model/accessors/dataset_accessor";
import {
  buildLiveTransforms,
  DEFAULT_SRT,
  extractPivotFromTransforms,
  extractSRTFromTransforms,
  hasValidLiveTransformationPattern,
  type SRTValues,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { setLayerTransformsAction } from "viewer/model/actions/dataset_actions";

// Fetches the dataset from the backend and extracts the stored SRT values for a single layer.
// isValid is false when the layer has no transforms or transforms incompatible with this editor.
// The dataset is fetched from the backend rather than read from the store, because the store's
// dataSource may already contain unsaved, locally mutated transforms.
async function fetchStoredSRTForLayer(
  datasetId: string,
  layerName: string,
): Promise<{ srt: SRTValues; isValid: boolean }> {
  const backendDataset = await getDataset(datasetId);
  const backendLayer = backendDataset.dataSource.dataLayers.find((l) => l.name === layerName);
  const stored = backendLayer?.coordinateTransformations ?? null;
  if (stored != null && hasValidLiveTransformationPattern(stored)) {
    return { srt: extractSRTFromTransforms(stored), isValid: true };
  }
  return { srt: DEFAULT_SRT, isValid: false };
}

const SCALE_MIN = 0.0001;
const SCALE_STEP = 0.001;
const DEFAULT_SCALE_MAXIMA: Vector3 = [10, 10, 10];

// Extends limit in steps of increment until value fits strictly within it. This is what makes the
// sliders adaptive: committing a value at the very end of a slider extends its range by one more
// default range, so the user can keep going.
function growLimitToFit(limit: number, value: number, increment: number): number {
  if (!Number.isFinite(value) || increment <= 0) {
    return limit;
  }
  let grownLimit = limit;
  while (Math.abs(value) >= grownLimit) {
    grownLimit += increment;
  }
  return grownLimit;
}

// Grows the per-axis limits so that all values fit, using the default limits as the increment.
// Returns the original array if nothing changed.
function growLimitsToFit(limits: Vector3, values: Vector3, defaultLimits: Vector3): Vector3 {
  const grown = limits.map((limit, i) =>
    growLimitToFit(limit, values[i], defaultLimits[i]),
  ) as Vector3;
  return grown.every((limit, i) => limit === limits[i]) ? limits : grown;
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
  onCommit,
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
  // Called once a value is actually committed, i.e. the slider is released or the number input is
  // confirmed – as opposed to onChange, which also fires continuously while dragging.
  onCommit?: (v: number) => void;
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
        onChangeComplete={onCommit}
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
        // Deliberately unbounded at the top: typing a value beyond the slider's current maximum
        // extends the slider range (see onCommit) instead of being clamped to it.
        step={step}
        value={value}
        onChange={(v) => {
          if (v != null) onChange(v);
        }}
        onBlur={() => onCommit?.(value)}
        onPressEnter={() => onCommit?.(value)}
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
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const dataset = useWkSelector((state) => state.dataset);
  const datasetBbox = useMemo(() => getUntransformedDatasetBoundingBox(dataset), [dataset]);
  // The initial translation range. It can grow while the popover is open, see translationLimits.
  // Note that this is memoized on the extent's numbers and not on datasetBbox: the store's dataset
  // object is replaced on every transform edit, so datasetBbox changes identity while a slider is
  // being dragged even though the extent itself stays the same.
  const [datasetExtentX, datasetExtentY, datasetExtentZ] = datasetBbox.getSize();
  const defaultTranslationLimits = useMemo<Vector3>(
    () => [Math.max(1, datasetExtentX), Math.max(1, datasetExtentY), Math.max(1, datasetExtentZ)],
    [datasetExtentX, datasetExtentY, datasetExtentZ],
  );
  const transforms = useWkSelector((state) => {
    const dataLayer = state.dataset.dataSource.dataLayers.find((l) => l.name === layer.name);
    return dataLayer?.coordinateTransformations ?? null;
  });
  const isNativelyRendered = useWkSelector(
    (state) => state.datasetConfiguration.nativelyRenderedLayerName === layer.name,
  );

  const isCompatible = useMemo(() => hasValidLiveTransformationPattern(transforms), [transforms]);

  // The point that scaling and rotation happen around. New transforms pivot around the center of
  // the layer itself, so that a layer rotates in place instead of orbiting the dataset center.
  // Transforms that already exist keep the pivot they were stored with, so that editing a layer
  // which was configured before this behavior changed does not make it jump.
  const pivot = useMemo(() => {
    const storedPivot =
      transforms != null && isCompatible ? extractPivotFromTransforms(transforms) : null;
    if (storedPivot != null) {
      return storedPivot;
    }
    try {
      return getLayerBoundingBox(dataset, layer.name).getCenter();
    } catch {
      // getLayerBoundingBox throws for layers that are not part of the dataset's data source.
      return datasetBbox.getCenter();
    }
  }, [transforms, isCompatible, dataset, layer.name, datasetBbox]);

  // The stored SRT values are the "default" baseline saved in the backend that the reset buttons
  // restore to. They are fetched lazily once the popover becomes visible.
  const {
    data: storedSRTResult,
    isFetching: isFetchingStored,
    refetch: refetchStoredSRT,
  } = useQuery({
    queryKey: ["storedLayerSRT", dataset.id, layer.name],
    queryFn: () => fetchStoredSRTForLayer(dataset.id, layer.name),
    enabled: isVisible,
  });
  const storedSRT = storedSRTResult?.srt ?? DEFAULT_SRT;

  const srtFromStore = useMemo((): SRTValues => {
    if (!transforms || transforms.length === 0) return DEFAULT_SRT;
    return extractSRTFromTransforms(transforms);
  }, [transforms]);

  // The slider ranges adapt to the values in use: committing a value at the end of a slider extends
  // its range, so that the user can go further. The range is only extended once a value is actually
  // committed (the slider is released or the number input is confirmed) and never while dragging,
  // so that the slider does not rescale under the cursor.
  const [translationLimits, setTranslationLimits] = useState<Vector3>(() =>
    growLimitsToFit(defaultTranslationLimits, srtFromStore.translation, defaultTranslationLimits),
  );
  const [scaleMaxima, setScaleMaxima] = useState<Vector3>(() =>
    growLimitsToFit(DEFAULT_SCALE_MAXIMA, srtFromStore.scale, DEFAULT_SCALE_MAXIMA),
  );

  // Values are read through a ref so that refitting does not re-run on every slider movement.
  const srtRef = useRef(srtFromStore);
  srtRef.current = srtFromStore;

  // Refit when the edited layer changes, so that values stored outside the default range are shown
  // correctly instead of appearing clamped to the end of the slider.
  useEffect(() => {
    setTranslationLimits(
      growLimitsToFit(
        defaultTranslationLimits,
        srtRef.current.translation,
        defaultTranslationLimits,
      ),
    );
    setScaleMaxima(
      growLimitsToFit(DEFAULT_SCALE_MAXIMA, srtRef.current.scale, DEFAULT_SCALE_MAXIMA),
    );
  }, [layer.name, defaultTranslationLimits]);

  const growLimitForAxis = useCallback(
    (
      setLimits: typeof setTranslationLimits,
      defaultLimits: Vector3,
      axis: 0 | 1 | 2,
      value: number,
    ) => {
      setLimits((limits) => {
        const grown = growLimitToFit(limits[axis], value, defaultLimits[axis]);
        if (grown === limits[axis]) {
          return limits;
        }
        const newLimits = [...limits] as Vector3;
        newLimits[axis] = grown;
        return newLimits;
      });
    },
    [],
  );

  const handleChange = useCallback(
    (newSRT: SRTValues) => {
      const newTransforms = buildLiveTransforms(
        newSRT.scale,
        newSRT.rotation,
        newSRT.translation,
        pivot,
      );
      dispatch(setLayerTransformsAction(layer.name, newTransforms));
    },
    [dispatch, layer.name, pivot],
  );

  const handleResetToStored = useCallback(async () => {
    const { data, error } = await refetchStoredSRT();
    if (error != null || data == null) {
      console.error("Failed to fetch stored transforms:", error);
      Toast.error("Failed to fetch stored transforms. Please try again.");
      return;
    }
    handleChange(data.srt);
    if (!data.isValid) {
      Toast.info(
        "Restored to default transforms as transforms in the backend are incompatible with the Live Transforms editor.",
      );
    }
  }, [refetchStoredSRT, handleChange]);

  const handleSaveForAllUsers = useCallback(async () => {
    setIsSaving(true);
    try {
      const areValidTransforms = transforms && hasValidLiveTransformationPattern(transforms);
      if (!areValidTransforms) {
        return;
      }
      const backendDataset = await getDataset(dataset.id);
      const dataSource = {
        ...backendDataset.dataSource,
        dataLayers: backendDataset.dataSource.dataLayers.map((l) =>
          l.name === layer.name ? { ...l, coordinateTransformations: transforms } : l,
        ),
      };
      await updateDatasetPartial(dataset.id, { dataSource });
      queryClient.setQueryData(["storedLayerSRT", dataset.id, layer.name], {
        srt: extractSRTFromTransforms(transforms),
        isValid: true,
      });
      Toast.success("Layer transforms saved for all users.");
    } catch (e) {
      console.error("Failed to save layer transforms:", e);
      Toast.error("Failed to save layer transforms. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [dataset.id, layer.name, transforms, queryClient]);

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
        disabled to avoid confusion. To edit the transforms, disable native rendering first by
        clicking the transform icon to the left of this layer&apos;s ··· menu.
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
          min={-translationLimits[i]}
          max={translationLimits[i]}
          step={1}
          onChange={(v) => updateTranslation(i as 0 | 1 | 2, v)}
          onCommit={(v) =>
            growLimitForAxis(setTranslationLimits, defaultTranslationLimits, i as 0 | 1 | 2, v)
          }
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
          min={SCALE_MIN}
          max={scaleMaxima[i]}
          step={SCALE_STEP}
          // The slider shows only the magnitude; keep the current flip orientation here. Resetting
          // the flip is handled by the rotation row, where the flip toggle lives.
          onChange={(v) => updateScale(i as 0 | 1 | 2, v * (scale[i] < 0 ? -1 : 1))}
          onCommit={(v) =>
            growLimitForAxis(setScaleMaxima, DEFAULT_SCALE_MAXIMA, i as 0 | 1 | 2, v)
          }
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
      <Button
        type="text"
        size="small"
        icon={<CloseOutlined />}
        onClick={onClose}
        aria-label="Close layer transform settings"
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

import {
  CloseOutlined,
  InfoCircleOutlined,
  LockOutlined,
  ReloadOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import FlipIcon from "@images/icons/icon-flip.svg?react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getImportedDataset, updateDatasetPartial } from "admin/rest_api";
import { Button, Divider, Flex, InputNumber, Popover, Slider, Tooltip, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { APIDataLayer, APISkeletonLayer } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  getLayerBoundingBox,
  getUntransformedDatasetBoundingBox,
} from "viewer/model/accessors/dataset_accessor";
import {
  buildLiveTransforms,
  DEFAULT_SRT,
  extractPivotFromTransforms,
  extractSRTFromTransforms,
  hasValidLiveTransformationPattern,
  rebaseTranslationToPivot,
  type SRTValues,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { getViewportExtentInVoxelPerAxis } from "viewer/model/accessors/view_mode_accessor";
import { setLayerTransformsAction } from "viewer/model/actions/dataset_actions";
import { type AxisLocks, applyLockedScaleChange, DEFAULT_AXIS_LOCKS } from "./locked_scale";
import {
  getTranslationSliderConfig,
  MIN_SCALE,
  RelativeSlider,
  SCALE_SLIDER_CONFIG,
  TRANSLATION_SLIDER_STEP,
} from "./relative_slider";

// Fetches the dataset from the backend and extracts the stored SRT values for a single layer.
// isValid is false when the layer has no transforms or transforms incompatible with this editor.
// The dataset is fetched from the backend rather than read from the store, because the store's
// dataSource may already contain unsaved, locally mutated transforms. The pivot the values are
// expressed around is returned as well, so that they can be rebased onto the editor's pivot.
async function fetchStoredSRTForLayer(
  datasetId: string,
  layerName: string,
): Promise<{ srt: SRTValues; isValid: boolean; pivot: Vector3 | null }> {
  const backendDataset = await getImportedDataset(datasetId);
  const backendLayer = backendDataset.dataSource.dataLayers.find((l) => l.name === layerName);
  const stored = backendLayer?.coordinateTransformations ?? null;
  if (stored != null && hasValidLiveTransformationPattern(stored)) {
    return {
      srt: extractSRTFromTransforms(stored),
      isValid: true,
      pivot: extractPivotFromTransforms(stored),
    };
  }
  return { srt: DEFAULT_SRT, isValid: false, pivot: null };
}

// Expresses the SRT values around the given pivot. Only the translation changes; the layer stays
// exactly where it is. fromPivot may be null for values that carry no pivot of their own.
function withRebasedTranslation(
  srt: SRTValues,
  fromPivot: Vector3 | null,
  toPivot: Vector3,
): SRTValues {
  if (fromPivot == null) {
    return srt;
  }
  return { ...srt, translation: rebaseTranslationToPivot(srt, fromPivot, toPivot) };
}

// Step of the number input next to the scaling slider. The slider itself works in log space, see
// SCALE_SLIDER_CONFIG.
const SCALE_INPUT_STEP = 0.01;

// Explains the relative sliders, whose snapping back to the center is surprising at first.
const RELATIVE_SLIDER_HINT =
  "The sliders snap back to the center when released. Each drag changes the current value, " +
  "which allows for fine as well as large changes.";

function SectionLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <Typography.Title level={5} style={{ marginBottom: 4 }}>
      {children}
      {hint != null && (
        <Tooltip title={hint}>
          <InfoCircleOutlined style={{ color: "gray", marginLeft: 6, fontSize: 12 }} />
        </Tooltip>
      )}
    </Typography.Title>
  );
}

// A small icon button that toggles a per-axis option, highlighted while the option is active.
function AxisToggleButton({
  icon,
  tooltip,
  isActive,
  onClick,
}: {
  icon: ReactNode;
  tooltip: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={tooltip}>
      <Button
        type="text"
        size="small"
        icon={icon}
        onClick={onClick}
        style={{
          padding: "0 4px",
          color: isActive ? "var(--ant-color-primary)" : undefined,
        }}
      />
    </Tooltip>
  );
}

// Rows that do not show the value on a slider bring their own, e.g. the relative translation
// sliders. Those have no min/max, since their range is not the range of the value.
type AxisSliderRowSliderProps =
  | { sliderNode: ReactNode; min?: never; max?: never }
  | { sliderNode?: never; min: number; max: number };

type AxisSliderRowProps = {
  label: string;
  value: number;
  storedValue: number;
  // Lower bound of the number input. Defaults to the slider's min; pass null to leave it unbounded.
  inputMin?: number | null;
  step: number;
  onChange: (v: number) => void;
  resetDisabled: boolean;
  // Custom reset handler. Defaults to onChange(storedValue); used when resetting the row needs to
  // restore more than the displayed value (e.g. the rotation row also restores the flip sign).
  onReset?: () => void;
  // Shown between the slider and the number input, e.g. the flip or the lock toggle.
  axisToggle?: ReactNode;
} & AxisSliderRowSliderProps;

function AxisSliderRow({
  label,
  value,
  storedValue,
  min,
  max,
  inputMin = min,
  step,
  onChange,
  resetDisabled,
  onReset,
  axisToggle,
  sliderNode,
}: AxisSliderRowProps) {
  return (
    <Flex align="center" gap={6} style={{ marginBottom: 4 }}>
      <Typography.Text strong style={{ width: 12, flexShrink: 0 }}>
        {label}
      </Typography.Text>
      {sliderNode ?? (
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
          style={{ flex: 1 }}
        />
      )}
      <div style={{ width: 28, flexShrink: 0 }}>{axisToggle}</div>
      <InputNumber
        // Deliberately unbounded at the top, since the relative sliders do not limit the value. Rows
        // with inputMin null (the translation rows) are unbounded in both directions. A value typed
        // below inputMin is not emitted while typing and is clamped to it on blur or Enter.
        min={inputMin ?? undefined}
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
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [scaleLocks, setScaleLocks] = useState<AxisLocks>(DEFAULT_AXIS_LOCKS);
  // The scale magnitudes from when the current scale slider action started. Locked axes are scaled
  // relative to these, see applyLockedScaleChange.
  const scaleAtSliderStartRef = useRef<Vector3 | null>(null);
  // The scale slider that is currently dragged and its handle offset, so that the sliders of the
  // other locked axes can show the same offset. Locked axes are scaled by the same factor, so the
  // same offset is exactly what is applied to them.
  const [scaleSliderDrag, setScaleSliderDrag] = useState<{ axis: number; offset: number } | null>(
    null,
  );
  const endScaleSliderDrag = useCallback(() => setScaleSliderDrag(null), []);
  const dataset = useWkSelector((state) => state.dataset);
  const datasetBbox = getUntransformedDatasetBoundingBox(dataset);
  const transforms = useWkSelector((state) => {
    const dataLayer = state.dataset.dataSource.dataLayers.find((l) => l.name === layer.name);
    return dataLayer?.coordinateTransformations ?? null;
  });
  const isNativelyRendered = useWkSelector(
    (state) => state.datasetConfiguration.nativelyRenderedLayerName === layer.name,
  );

  const isCompatible = useMemo(() => hasValidLiveTransformationPattern(transforms), [transforms]);

  // The point that scaling and rotation happen around. This is always the center of the layer
  // itself, so that a layer rotates in place instead of orbiting some other point. Transforms that
  // were stored with a different pivot (e.g. the dataset center, which this editor used to write)
  // are rebased onto this pivot, which changes the translation but not the resulting transform.
  const pivot = useMemo(() => {
    try {
      return getLayerBoundingBox(dataset, layer.name).getCenter();
    } catch {
      // getLayerBoundingBox throws for layers that are not part of the dataset's data source.
      return datasetBbox.getCenter();
    }
  }, [dataset, layer.name, datasetBbox]);

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
  // The stored values are rebased onto the current pivot too, so that the reset buttons restore the
  // layer to exactly the stored state instead of moving it.
  const storedSRT = useMemo(
    () =>
      storedSRTResult == null
        ? DEFAULT_SRT
        : withRebasedTranslation(storedSRTResult.srt, storedSRTResult.pivot, pivot),
    [storedSRTResult, pivot],
  );

  const srtFromStore = useMemo((): SRTValues => {
    // Reading the transforms is only safe for the editable pattern: an incompatible list of the same
    // length can hold e.g. a thin-plate-spline entry, which has no matrix to extract from. The
    // component renders an explanation instead of the sliders in that case (see below), but hooks
    // cannot be skipped, so the guard has to live here as well.
    if (!isCompatible || !transforms || transforms.length === 0) return DEFAULT_SRT;
    return withRebasedTranslation(
      extractSRTFromTransforms(transforms),
      extractPivotFromTransforms(transforms),
      pivot,
    );
  }, [transforms, pivot, isCompatible]);

  // The translation sliders reach one viewport extent in either direction, so the translation one
  // slider action can apply follows the zoom level.
  const viewportExtent = useWkSelector(getViewportExtentInVoxelPerAxis);
  const translationSliderConfigs = useMemo(
    () => viewportExtent.map(getTranslationSliderConfig),
    [viewportExtent],
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
    handleChange(withRebasedTranslation(data.srt, data.pivot, pivot));
    if (!data.isValid) {
      Toast.info(
        "Restored to default transforms as transforms in the backend are incompatible with the Live Transforms editor.",
      );
    }
  }, [refetchStoredSRT, handleChange, pivot]);

  const handleSaveForAllUsers = useCallback(async () => {
    setIsSaving(true);
    try {
      const areValidTransforms = transforms && hasValidLiveTransformationPattern(transforms);
      if (!areValidTransforms) {
        return;
      }
      const backendDataset = await getImportedDataset(dataset.id);
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
        pivot: extractPivotFromTransforms(transforms),
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

  const scaleMagnitudes: Vector3 = [Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2])];

  // The scaling rows show and edit only the magnitudes; the flip orientations (the signs of the
  // scale) are kept as they are, since the flip toggle lives in the rotation row. Math.sign is not
  // used here, since it is 0 for a scale of 0, which could then never be enlarged again.
  const updateScaleMagnitudes = (magnitudes: Vector3) => {
    const newScale = magnitudes.map(
      (magnitude, i) => magnitude * (scale[i] < 0 ? -1 : 1),
    ) as Vector3;
    handleChange({ scale: newScale, rotation, translation });
  };

  // Changes the scale magnitude of an axis, together with all other locked axes if it is locked.
  // While a slider is dragged, the change is relative to the magnitudes from the start of the drag,
  // otherwise relative to the current ones.
  const updateLockedScaleMagnitude = (
    axis: 0 | 1 | 2,
    magnitude: number,
    reference: Vector3 = scaleMagnitudes,
  ) => {
    updateScaleMagnitudes(applyLockedScaleChange(reference, scaleLocks, axis, magnitude));
  };

  // Resetting a locked axis resets all locked axes, so that they stay in sync.
  const resetScaleMagnitude = (axis: 0 | 1 | 2) => {
    const newMagnitudes: Vector3 = [...scaleMagnitudes];
    for (let other = 0; other < 3; other++) {
      if (other === axis || (scaleLocks[axis] && scaleLocks[other])) {
        newMagnitudes[other] = Math.abs(storedSRT.scale[other]);
      }
    }
    updateScaleMagnitudes(newMagnitudes);
  };

  const toggleScaleLock = (axis: 0 | 1 | 2) => {
    setScaleLocks(
      (locks) => locks.map((isLocked, i) => (i === axis ? !isLocked : isLocked)) as AxisLocks,
    );
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
      <SectionLabel hint={RELATIVE_SLIDER_HINT}>Translation</SectionLabel>
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <AxisSliderRow
          key={axis}
          label={axis}
          value={translation[i]}
          storedValue={storedSRT.translation[i]}
          // Any translation can be typed, the slider only applies increments to it.
          inputMin={null}
          step={TRANSLATION_SLIDER_STEP}
          onChange={(v) => updateTranslation(i as 0 | 1 | 2, v)}
          sliderNode={
            <RelativeSlider
              value={translation[i]}
              config={translationSliderConfigs[i]}
              onChange={(v) => updateTranslation(i as 0 | 1 | 2, v)}
              ariaLabel={`Translate ${axis}`}
            />
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
          axisToggle={
            <AxisToggleButton
              icon={<FlipIcon />}
              tooltip={scale[i] < 0 ? "Axis is flipped – click to unflip" : "Flip axis"}
              isActive={scale[i] < 0}
              onClick={() => updateScale(i as 0 | 1 | 2, -scale[i])}
            />
          }
        />
      ))}
      <SectionLabel hint={RELATIVE_SLIDER_HINT}>Scaling</SectionLabel>
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <AxisSliderRow
          key={axis}
          label={axis}
          value={scaleMagnitudes[i]}
          storedValue={Math.abs(storedSRT.scale[i])}
          inputMin={MIN_SCALE}
          step={SCALE_INPUT_STEP}
          onChange={(v) => updateLockedScaleMagnitude(i as 0 | 1 | 2, v)}
          sliderNode={
            <RelativeSlider
              value={scaleMagnitudes[i]}
              config={SCALE_SLIDER_CONFIG}
              onActionStart={() => {
                scaleAtSliderStartRef.current = scaleMagnitudes;
              }}
              onChange={(v, offset) => {
                setScaleSliderDrag({ axis: i, offset });
                updateLockedScaleMagnitude(
                  i as 0 | 1 | 2,
                  v,
                  scaleAtSliderStartRef.current ?? scaleMagnitudes,
                );
              }}
              onActionEnd={endScaleSliderDrag}
              mirroredOffset={
                scaleSliderDrag != null &&
                scaleSliderDrag.axis !== i &&
                scaleLocks[i] &&
                scaleLocks[scaleSliderDrag.axis]
                  ? scaleSliderDrag.offset
                  : undefined
              }
              ariaLabel={`Scale ${axis}`}
            />
          }
          axisToggle={
            <AxisToggleButton
              icon={scaleLocks[i] ? <LockOutlined /> : <UnlockOutlined />}
              tooltip={
                scaleLocks[i]
                  ? "Locked axes are scaled together, keeping their proportions – click to unlock"
                  : "Click to lock, so that this axis is scaled together with the other locked axes"
              }
              isActive={scaleLocks[i]}
              onClick={() => toggleScaleLock(i as 0 | 1 | 2)}
            />
          }
          resetDisabled={isFetchingStored}
          onReset={() => resetScaleMagnitude(i as 0 | 1 | 2)}
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

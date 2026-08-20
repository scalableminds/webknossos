import { CloseOutlined, ReloadOutlined } from "@ant-design/icons";
import FlipIcon from "@images/icons/icon-flip.svg?react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDataset, updateDatasetPartial } from "admin/rest_api";
import { Button, Divider, Flex, InputNumber, Popover, Slider, Tooltip, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { type ReactNode, useCallback, useMemo, useState } from "react";
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
  const backendDataset = await getDataset(datasetId);
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

// Derives the step size and the visible range of the translation sliders from the current zoom.
// state.flycam.zoomStep is base voxels per screen pixel, so one step corresponds to roughly one
// pixel on screen at any zoom, and the window spans about one viewport worth of movement.
// While isFrozen is set (i.e. a slider is being dragged), nothing is recomputed, so that the slider
// never rescales under the cursor; the pending zoom is applied once the drag ends.
function useZoomAdaptiveTranslationScaling(
  translation: Vector3,
  layerName: string,
  isFrozen: boolean,
) {
  // The current values are also read through a ref, so that reanchoring on a zoom change does not
  // have to re-run whenever the user moves a slider.
  const translationRef = useRef(translation);
  translationRef.current = translation;
  const zoomStep = useWkSelector((state) => state.flycam.zoomStep);
  const voxelSize = useWkSelector((state) => state.dataset.dataSource.scale);
  // Per-axis voxels per screen pixel. The base voxel factors account for anisotropic voxel sizes,
  // so that a dataset with thick z slices gets a correspondingly smaller z step.
  const [factorX, factorY, factorZ] = getBaseVoxelFactorsInUnit(voxelSize);

  const steps = useMemo(
    () =>
      [factorX, factorY, factorZ].map((factor) =>
        niceStep(zoomStep * factor),
      ) as unknown as Vector3,
    [zoomStep, factorX, factorY, factorZ],
  );
  const widths = useMemo(
    () =>
      [factorX, factorY, factorZ].map(
        (factor) => constants.VIEWPORT_WIDTH * zoomStep * factor,
      ) as unknown as Vector3,
    [zoomStep, factorX, factorY, factorZ],
  );

  const [windows, setWindows] = useState<SliderWindow[]>(() =>
    AXES.map((axis) =>
      reanchorWindow(null, translationRef.current[axis], widths[axis], steps[axis]),
    ),
  );

  // Recentering on a layer switch, rather than keeping the previous layer's handle position.
  const lastLayerRef = useRef(layerName);

  useEffect(() => {
    if (isFrozen) {
      return;
    }
    const isNewLayer = lastLayerRef.current !== layerName;
    lastLayerRef.current = layerName;
    setWindows((previous) =>
      AXES.map((axis) =>
        reanchorWindow(
          isNewLayer ? null : (previous[axis] ?? null),
          translationRef.current[axis],
          widths[axis],
          steps[axis],
        ),
      ),
    );
  }, [widths, steps, isFrozen, layerName]);

  // Keep the window on the value. Resetting a row restores a stored value that can lie far outside
  // the current window, and it does not go through the commit handler below, so the slider would
  // otherwise show a range that no longer contains its own value – and the next drag would snap the
  // value to the window's edge. While a slider is dragged its value cannot leave the window, which
  // makes this a no-op then.
  useEffect(() => {
    if (isFrozen) {
      return;
    }
    setWindows((previous) => {
      const next = previous.map((window, axis) => {
        const value = translation[axis];
        if (value >= window.min && value <= window.max) {
          return window;
        }
        return reanchorWindow(null, value, window.max - window.min, steps[axis]);
      });
      return next.every((window, axis) => window === previous[axis]) ? previous : next;
    });
  }, [translation, steps, isFrozen]);

  // Once a value is committed at the very edge of the window, slide the window so that the value is
  // centered again. Without this the user could not keep dragging in the same direction.
  const recenterIfAtEdge = useCallback(
    (axis: 0 | 1 | 2, value: number) => {
      setWindows((previous) => {
        const current = previous[axis];
        if (current == null) {
          return previous;
        }
        const isAtEdge = value <= current.min + steps[axis] || value >= current.max - steps[axis];
        if (!isAtEdge) {
          return previous;
        }
        const next = [...previous];
        next[axis] = reanchorWindow(null, value, current.max - current.min, steps[axis]);
        return next;
      });
    },
    [steps],
  );

  return { steps, windows, recenterIfAtEdge };
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography.Title level={5} style={{ marginBottom: 4 }}>
      {children}
    </Typography.Title>
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
  // Called once a value is actually committed, i.e. the slider is released or the number input is
  // confirmed – as opposed to onChange, which also fires continuously while dragging.
  onCommit?: (v: number) => void;
  // Reports whether the slider (not the number input) is currently being dragged, so that callers
  // can keep the slider's range stable for the duration of the drag.
  onDraggingChange?: (isDragging: boolean) => void;
  resetDisabled: boolean;
  // Custom reset handler. Defaults to onChange(storedValue); used when resetting the row needs to
  // restore more than the displayed value (e.g. the rotation row also restores the flip sign).
  onReset?: () => void;
  onFlip?: () => void;
  isFlipped?: boolean;
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
  onCommit,
  resetDisabled,
  onReset,
  onFlip,
  isFlipped,
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
          onChangeComplete={(v) => onCommit?.(v)}
          style={{ flex: 1 }}
        />
      )}
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
        // Deliberately unbounded at the top: typing a value beyond the slider's current maximum
        // extends the slider range (see onCommit) instead of being clamped to it. Rows without a
        // slider range (the translation rows) leave the input unbounded in both directions.
        min={inputMin ?? undefined}
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

  // The scaling row shows and edits only the magnitude; the flip orientation (the sign of the scale)
  // is kept as it is, since the flip toggle lives in the rotation row.
  const updateScaleMagnitude = (axis: 0 | 1 | 2, magnitude: number) => {
    updateScale(axis, magnitude * (scale[axis] < 0 ? -1 : 1));
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
          inputMin={MIN_SCALE}
          step={SCALE_INPUT_STEP}
          onChange={(v) => updateScaleMagnitude(i as 0 | 1 | 2, v)}
          sliderNode={
            <RelativeSlider
              value={Math.abs(scale[i])}
              config={SCALE_SLIDER_CONFIG}
              onChange={(v) => updateScaleMagnitude(i as 0 | 1 | 2, v)}
              ariaLabel={`Scale ${axis}`}
            />
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

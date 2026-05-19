import Icon, { ReloadOutlined } from "@ant-design/icons";
import SkeletonIcon from "@images/icons/icon-skeleton.svg?react";
import { getDataset, updateDatasetPartial } from "admin/rest_api";
import { Button, Divider, InputNumber, Slider, Tooltip, Typography } from "antd";
import { LandmarkPositionStore } from "libs/landmark_position_store";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { setNodePositionAction } from "viewer/model/actions/skeletontracing_actions";
import { LandmarkTransformModal } from "viewer/view/left_border_tabs/modals/landmark_transform_modal";

const { Text, Title } = Typography;

function AxisSliderRow({
  label,
  value,
  storedValue,
  min,
  max,
  step,
  onChange,
  resetDisabled,
}: {
  label: string;
  value: number;
  storedValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  resetDisabled: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
      <span style={{ width: 12, flexShrink: 0, fontWeight: 500 }}>{label}</span>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        style={{ flex: 1 }}
      />
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
          onClick={() => onChange(storedValue)}
          disabled={resetDisabled}
          style={{ flexShrink: 0, padding: "0 4px" }}
        />
      </Tooltip>
    </div>
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
  const [isLandmarkModalOpen, setIsLandmarkModalOpen] = useState(false);
  const [landmarkStore] = useState(() => new LandmarkPositionStore());
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

  const isCompatible = useMemo(() => isLiveTransformCompatible(transforms), [transforms]);

  useEffect(() => {
    if (!isVisible) return;
    const fetchStoredSRT = async () => {
      setIsFetchingStored(true);
      try {
        const backendDataset = await getDataset(dataset.id);
        const backendLayer = backendDataset.dataSource.dataLayers.find(
          (l) => l.name === layer.name,
        );
        const stored = backendLayer?.coordinateTransformations ?? null;
        setStoredSRT(
          stored && isLiveTransformCompatible(stored)
            ? extractSRTFromTransforms(stored)
            : DEFAULT_SRT,
        );
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
      const backendDataset = await getDataset(dataset.id);
      const backendLayer = backendDataset.dataSource.dataLayers.find((l) => l.name === layer.name);
      const stored = backendLayer?.coordinateTransformations ?? null;
      const restoredSRT =
        stored && isLiveTransformCompatible(stored)
          ? extractSRTFromTransforms(stored)
          : DEFAULT_SRT;
      setStoredSRT(restoredSRT);
      handleChange(restoredSRT);
      const snapshots = landmarkStore.get(layer.name);
      if (snapshots) {
        for (const { nodeId, treeId, position } of snapshots) {
          dispatch(setNodePositionAction(position, nodeId, treeId));
        }
        landmarkStore.discard(layer.name);
      }
    } catch (e) {
      console.error("Failed to fetch stored transforms:", e);
      Toast.error("Failed to fetch stored transforms. Please try again.");
    } finally {
      setIsFetchingStored(false);
    }
  }, [dataset.id, layer.name, handleChange, landmarkStore, dispatch]);

  const handleSaveForAllUsers = useCallback(async () => {
    setIsSaving(true);
    try {
      // Fetch the authoritative backend state so we only change coordinateTransformations
      // for this layer — avoiding accidentally persisting any other live frontend changes.
      const currentTransforms = transforms;
      const backendDataset = await getDataset(dataset.id);
      const dataSource = {
        ...backendDataset.dataSource,
        dataLayers: backendDataset.dataSource.dataLayers.map((l) =>
          l.name === layer.name ? { ...l, coordinateTransformations: currentTransforms } : l,
        ),
      };
      await updateDatasetPartial(dataset.id, { dataSource });
      setStoredSRT(
        currentTransforms && isLiveTransformCompatible(currentTransforms)
          ? extractSRTFromTransforms(currentTransforms)
          : DEFAULT_SRT,
      );
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
      <div style={{ maxWidth: 240 }}>
        <Text type="secondary">
          The transform format of this layer is not editable here. Clear the layer&apos;s transforms
          in the dataset settings to use this editor.
        </Text>
      </div>
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

  return (
    <div style={{ width: 250 }}>
      <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
        Scaling
      </Title>

      {/* Negative scale mirrors the layer along that axis and is intentionally allowed. */}
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <AxisSliderRow
          key={axis}
          label={axis}
          value={scale[i]}
          storedValue={storedSRT.scale[i]}
          min={-10}
          max={10}
          step={0.1}
          onChange={(v) => updateScale(i as 0 | 1 | 2, v)}
          resetDisabled={isFetchingStored}
        />
      ))}
      <Title level={5} style={{ marginTop: 12, marginBottom: 8 }}>
        Rotation
      </Title>
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <AxisSliderRow
          key={axis}
          label={axis}
          value={rotation[i]}
          storedValue={storedSRT.rotation[i]}
          min={0}
          max={359}
          step={0.1}
          onChange={(v) => updateRotation(i as 0 | 1 | 2, v)}
          resetDisabled={isFetchingStored}
        />
      ))}
      <Title level={5} style={{ marginTop: 12, marginBottom: 8 }}>
        Translation
      </Title>
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
      <Divider />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
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
        {"category" in layer && layer.category === "color" && (
          <>
            <Button
              size="small"
              icon={<Icon component={SkeletonIcon} />}
              onClick={() => setIsLandmarkModalOpen(true)}
              disabled={
                isFetchingStored ||
                srtFromStore.scale.some((v, i) => Math.abs(v - storedSRT.scale[i]) > 1e-6) ||
                srtFromStore.rotation.some((v, i) => Math.abs(v - storedSRT.rotation[i]) > 1e-6) ||
                srtFromStore.translation.some(
                  (v, i) => Math.abs(v - storedSRT.translation[i]) > 1e-6,
                )
              }
              title="Only available when current transforms match the stored transforms"
              block
            >
              Landmark-Based Transform…
            </Button>
            <LandmarkTransformModal
              open={isLandmarkModalOpen}
              onClose={() => setIsLandmarkModalOpen(false)}
              layerName={layer.name}
              landmarkStore={landmarkStore}
            />
          </>
        )}
      </div>
    </div>
  );
}

import { ReloadOutlined } from "@ant-design/icons";
import { getDataset, updateDatasetPartial } from "admin/rest_api";
import { Button, InputNumber, Slider, Tooltip, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useCallback, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import type {
  AffineTransformation,
  APIDataLayer,
  APISkeletonLayer,
  CoordinateTransformation,
} from "types/api_types";
import { getDatasetBoundingBox } from "viewer/model/accessors/dataset_accessor";
import {
  buildLiveTransforms,
  extractEulerAngleDegreesFromMatrix,
  extractScaleFromMatrix,
  extractTranslationFromMatrix,
  isLiveTransformCompatible,
  LIVE_TRANSFORM_LENGTH,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { setLayerTransformsAction } from "viewer/model/actions/dataset_actions";

const { Text, Title } = Typography;

type SRTValues = {
  scale: [number, number, number];
  rotation: [number, number, number];
  translation: [number, number, number];
};

const DEFAULT_SRT: SRTValues = {
  scale: [1, 1, 1],
  rotation: [0, 0, 0],
  translation: [0, 0, 0],
};

function extractSRTFromTransforms(transforms: CoordinateTransformation[]): SRTValues {
  if (transforms.length !== LIVE_TRANSFORM_LENGTH) return DEFAULT_SRT;
  return {
    scale: extractScaleFromMatrix(transforms[1] as AffineTransformation),
    rotation: [
      extractEulerAngleDegreesFromMatrix(transforms[2] as AffineTransformation, "x"),
      extractEulerAngleDegreesFromMatrix(transforms[3] as AffineTransformation, "y"),
      extractEulerAngleDegreesFromMatrix(transforms[4] as AffineTransformation, "z"),
    ],
    translation: extractTranslationFromMatrix(transforms[5] as AffineTransformation),
  };
}

function AxisSliderRow({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
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
      <Tooltip title="Reset to default">
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => onChange(defaultValue)}
          style={{ flexShrink: 0, padding: "0 4px" }}
        />
      </Tooltip>
    </div>
  );
}

export function LayerTransformSettingsContent({
  layer,
}: {
  layer: APIDataLayer | APISkeletonLayer;
}) {
  const dispatch = useDispatch();
  const [isSaving, setIsSaving] = useState(false);
  const dataset = useWkSelector((state) => state.dataset);
  const transforms = useWkSelector((state) => {
    const dataLayer = state.dataset.dataSource.dataLayers.find((l) => l.name === layer.name);
    return dataLayer?.coordinateTransformations ?? null;
  });

  const isCompatible = isLiveTransformCompatible(transforms);

  const srt = useMemo((): SRTValues => {
    if (!transforms || transforms.length === 0) return DEFAULT_SRT;
    return extractSRTFromTransforms(transforms);
  }, [transforms]);

  const handleChange = useCallback(
    (newSRT: SRTValues) => {
      const datasetBbox = getDatasetBoundingBox(dataset);
      const newTransforms = buildLiveTransforms(
        datasetBbox,
        newSRT.scale,
        newSRT.rotation,
        newSRT.translation,
      );
      dispatch(setLayerTransformsAction(layer.name, newTransforms));
    },
    [dispatch, dataset, layer.name],
  );

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
      Toast.success("Layer transforms saved for all users.");
    } catch {
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
          to use this editor.
        </Text>
      </div>
    );
  }

  const { scale, rotation, translation } = srt;

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
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <AxisSliderRow
          key={axis}
          label={axis}
          value={scale[i]}
          defaultValue={1}
          min={-10}
          max={10}
          step={0.1}
          onChange={(v) => updateScale(i as 0 | 1 | 2, v)}
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
          defaultValue={0}
          min={0}
          max={360}
          step={1}
          onChange={(v) => updateRotation(i as 0 | 1 | 2, v)}
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
          defaultValue={0}
          min={-1000}
          max={1000}
          step={1}
          onChange={(v) => updateTranslation(i as 0 | 1 | 2, v)}
        />
      ))}
      <div style={{ marginTop: 16, borderTop: "1px solid #303030", paddingTop: 12 }}>
        <Button
          type="primary"
          size="small"
          loading={isSaving}
          onClick={handleSaveForAllUsers}
          block
        >
          Store as Default
        </Button>
      </div>
    </div>
  );
}

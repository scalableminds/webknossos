import { SlidersOutlined } from "@ant-design/icons";
import { Divider, Popover } from "antd";
import { useMemo } from "react";
import type { Vector3, Vector6 } from "viewer/constants";
import type BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import ButtonComponent from "../../components/button_component";
import NumberSliderSetting from "../../left_border_tabs/components/number_slider_setting";

const POSITION_LABELS = ["X", "Y", "Z"] as const;
const SIZE_LABELS = ["Width", "Height", "Depth"] as const;
// Ensures the position/size sliders always span a usable range around the current
// value, even for tiny bounding boxes or ones whose size already matches the dataset
// extent (where the naive range would otherwise collapse to a single point).
const MINIMUM_SLIDER_PADDING = 100;

// The slider should only cover a small area around the current position (rather than
// e.g. the entire dataset), so that dragging it allows for fine-grained adjustments.
// The range is clamped to the dataset bounds, but never excludes the current value
// (which could already lie outside the dataset, or have a zero-size dataset extent).
function getPositionSliderRange(
  current: number,
  _extent: number,
  datasetMin: number,
  datasetMax: number,
): { min: number; max: number } {
  const halfRange = 500; // Math.min(500, Math.max(extent, 1));
  const min = Math.min(current - MINIMUM_SLIDER_PADDING, Math.max(datasetMin, current - halfRange));
  const max = Math.max(current + MINIMUM_SLIDER_PADDING, Math.min(datasetMax, current + halfRange));
  return { min, max };
}

type BoundingBoxSlidersButtonProps = {
  value: Vector6;
  datasetBoundingBox: BoundingBox;
  onBoundingChange?: (arg0: Vector6) => void;
  disabled?: boolean;
  editingDisallowedExplanation: string;
};

export default function BoundingBoxSlidersButton({
  value,
  datasetBoundingBox,
  onBoundingChange,
  disabled,
  editingDisallowedExplanation,
}: BoundingBoxSlidersButtonProps) {
  const [boundingBoxMin, boundingBoxSize] = useMemo<[Vector3, Vector3]>(
    () => [
      [value[0], value[1], value[2]],
      [value[3], value[4], value[5]],
    ],
    [value],
  );

  const positionSliderRanges = useMemo(
    () =>
      [0, 1, 2].map((dim) =>
        getPositionSliderRange(
          boundingBoxMin[dim],
          boundingBoxSize[dim],
          datasetBoundingBox.min[dim],
          datasetBoundingBox.max[dim],
        ),
      ),
    [boundingBoxMin, boundingBoxSize, datasetBoundingBox],
  );
  const datasetExtent = datasetBoundingBox.getSize();

  const handlePositionSliderChange = (dim: number, newValue: number) => {
    const newMin: Vector3 = [...boundingBoxMin];
    newMin[dim] = newValue;
    onBoundingChange?.([...newMin, ...boundingBoxSize] as Vector6);
  };

  const handleSizeSliderChange = (dim: number, newValue: number) => {
    const newSize: Vector3 = [...boundingBoxSize];
    newSize[dim] = newValue;
    onBoundingChange?.([...boundingBoxMin, ...newSize] as Vector6);
  };

  const slidersContent = (
    <div style={{ width: 280 }}>
      <div style={{ fontWeight: "bold", marginBottom: 4 }}>Position</div>
      {POSITION_LABELS.map((label, dim) => (
        <NumberSliderSetting
          key={`position-${label}`}
          label={label}
          min={positionSliderRanges[dim].min}
          max={positionSliderRanges[dim].max}
          value={boundingBoxMin[dim]}
          onChange={(newValue) => handlePositionSliderChange(dim, newValue)}
          wheelFactor={0.05}
          spans={[1, 18, 5]}
        />
      ))}
      <Divider style={{ margin: "8px 0" }} />
      <div style={{ fontWeight: "bold", marginBottom: 4 }}>Size</div>
      {SIZE_LABELS.map((label, dim) => (
        <NumberSliderSetting
          key={`size-${label}`}
          label={label}
          min={1}
          max={Math.max(datasetExtent[dim], MINIMUM_SLIDER_PADDING + boundingBoxSize[dim])}
          value={boundingBoxSize[dim]}
          onChange={(newValue) => handleSizeSliderChange(dim, newValue)}
          wheelFactor={0.05}
          spans={[4, 15, 5]}
        />
      ))}
    </div>
  );

  return (
    <Popover
      content={slidersContent}
      title="Adjust Position & Size"
      placement="bottom"
      style={{ height: 24 }}
      trigger="click"
    >
      <ButtonComponent
        title={disabled ? editingDisallowedExplanation : "Adjust position and size with sliders"}
        icon={<SlidersOutlined />}
        type="text"
        size="small"
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        style={{ height: 24 }}
      />
    </Popover>
  );
}

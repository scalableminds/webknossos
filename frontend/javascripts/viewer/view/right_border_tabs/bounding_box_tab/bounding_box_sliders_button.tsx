import { SlidersOutlined } from "@ant-design/icons";
import { Divider, Popover, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { clamp } from "libs/utils";
import { useMemo } from "react";
import type { Vector3, Vector6 } from "viewer/constants";
import { getViewportBoundsInVoxel } from "viewer/model/accessors/view_mode_accessor";
import type BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import ButtonComponent from "../../components/button_component";
import NumberSliderSetting from "../../left_border_tabs/components/number_slider_setting";

const POSITION_LABELS = ["X", "Y", "Z"] as const;
const SIZE_LABELS = ["Width", "Height", "Depth"] as const;

// The slider range matches the [viewportMin, viewportMax] that is currently visible along that
// axis in the viewports (see getViewportBoundsInVoxel), rather than a fixed number: zooming in
// shrinks the range for fine-grained adjustments, zooming out grows it, and the full slider
// motion always stays observable on screen. The range is clamped to the dataset bounds, and the
// current value is never excluded (which could otherwise happen if the box already lies outside
// the dataset or the viewport).
function getPositionSliderRange(
  current: number,
  viewportMin: number,
  viewportMax: number,
  datasetMin: number,
  datasetMax: number,
): { min: number; max: number } {
  const min = Math.min(current, clamp(datasetMin, viewportMin, datasetMax));
  const max = Math.max(current, clamp(datasetMin, viewportMax, datasetMax));
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

  const viewportBounds = useWkSelector(getViewportBoundsInVoxel);

  const positionSliderRanges = useMemo(
    () =>
      [0, 1, 2].map((dim) =>
        getPositionSliderRange(
          boundingBoxMin[dim],
          viewportBounds.min[dim],
          viewportBounds.max[dim],
          datasetBoundingBox.min[dim],
          datasetBoundingBox.max[dim],
        ),
      ),
    [boundingBoxMin, viewportBounds, datasetBoundingBox],
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
          step={1}
        />
      ))}
      <Divider style={{ margin: "8px 0" }} />
      <div style={{ fontWeight: "bold", marginBottom: 4 }}>Size</div>
      {SIZE_LABELS.map((label, dim) => (
        <NumberSliderSetting
          key={`size-${label}`}
          label={label}
          min={1}
          max={Math.max(
            Math.min(viewportBounds.max[dim] - viewportBounds.min[dim], datasetExtent[dim]),
            boundingBoxSize[dim],
          )}
          value={boundingBoxSize[dim]}
          onChange={(newValue) => handleSizeSliderChange(dim, newValue)}
          wheelFactor={0.05}
          spans={[4, 15, 5]}
          step={1}
        />
      ))}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        The slider range matches what's currently visible in the viewports. Zoom in or out to adjust
        it.
      </Typography.Text>
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

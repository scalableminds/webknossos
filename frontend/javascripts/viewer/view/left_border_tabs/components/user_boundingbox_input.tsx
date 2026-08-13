import {
  BorderInnerOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EllipsisOutlined,
  InfoCircleOutlined,
  LockOutlined,
  ScanOutlined,
  SlidersOutlined,
} from "@ant-design/icons";
import { Divider, Flex, Input, type MenuProps, Popover, Switch } from "antd";
import FastTooltip from "components/fast_tooltip";
import { rgbToHex } from "libs/colors";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { numberArrayToVector6, stringToNumberArray } from "libs/utils";
import messages from "messages";
import { useEffect, useMemo, useState } from "react";
import type { Vector3, Vector6 } from "viewer/constants";
import {
  getDatasetBoundingBox,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { api } from "viewer/singletons";
import ButtonComponent from "../../components/button_component";
import ColorSetting from "./color_setting";
import { MipInlineButton, useMipContextMenuItems } from "./mip_menu_helpers";
import NumberSliderSetting from "./number_slider_setting";

type UserBoundingBoxInputProps = {
  bboxId: number;
  value: Vector6;
  name: string;
  isExportEnabled: boolean;
  onExport: () => void;
  onGoToBoundingBox: () => void;
  onOpenContextMenu: (
    menu: MenuProps,
    event: React.MouseEvent<HTMLDivElement>,
    bboxId: number,
  ) => void;
  onHideContextMenu?: () => void;
  // When isReadOnly is set (e.g. for a dataset layer's bounding box), the color, visibility,
  // name, bounds and delete controls are hidden/read-only. Only navigating, registering segments, MIP,
  // and exporting remain available via the context menu.
  isReadOnly?: boolean;
  color?: Vector3;
  isVisible?: boolean;
  onBoundingChange?: (arg0: Vector6) => void;
  onDelete?: () => void;
  onVisibilityChange?: (arg0: boolean) => void;
  onNameChange?: (arg0: string) => void;
  onColorChange?: (arg0: Vector3) => void;
  disabled?: boolean;
  isLockedByOwner?: boolean;
  isOwner?: boolean;
};

const FORMAT_TOOLTIP = "Format: minX, minY, minZ, width, height, depth";
const POSITION_LABELS = ["X", "Y", "Z"] as const;
const SIZE_LABELS = ["Width", "Height", "Depth"] as const;
const READ_ONLY_TOOLTIP = "This is a read-only bounding box of a dataset layer.";
const DEFAULT_READ_ONLY_COLOR: Vector3 = [0.5, 0.5, 0.5];
// Mimics the disabled look of an antd input while keeping the field selectable, so the coordinates
// of a read-only layer bounding box can still be copied.
const READ_ONLY_INPUT_STYLE: React.CSSProperties = {
  color: "var(--ant-color-text-disabled)",
  backgroundColor: "var(--ant-color-bg-container-disabled)",
  cursor: "text",
};

// The slider should only cover a small area around the current position (rather than
// e.g. the entire dataset), so that dragging it allows for fine-grained adjustments.
// The range is clamped to the dataset bounds, but never excludes the current value
// (which could already lie outside the dataset, or have a zero-size dataset extent).
function getPositionSliderRange(
  current: number,
  extent: number,
  datasetMin: number,
  datasetMax: number,
): { min: number; max: number } {
  const halfRange = Math.max(extent, 1);
  const min = Math.min(current, Math.max(datasetMin, current - halfRange));
  const max = Math.max(current, Math.min(datasetMax, current + halfRange));
  return { min, max };
}

export default function UserBoundingBoxInput(props: UserBoundingBoxInputProps) {
  const {
    bboxId,
    value: propValue,
    name: propName,
    color = DEFAULT_READ_ONLY_COLOR,
    isVisible = true,
    onDelete,
    onExport,
    isExportEnabled,
    onGoToBoundingBox,
    onVisibilityChange,
    onNameChange,
    onColorChange,
    disabled,
    isLockedByOwner = false,
    isOwner = false,
    isReadOnly = false,
    onBoundingChange,
    onOpenContextMenu,
    onHideContextMenu,
  } = props;

  const [isEditing, setIsEditing] = useState(false);
  const [isValid, setIsValid] = useState(true);
  const [text, setText] = useState(computeText(propValue));
  const [name, setName] = useState(propName);

  const visibleSegmentationLayer = useWkSelector((state) => getVisibleSegmentationLayer(state));
  const datasetBoundingBox = useWkSelector((state) => getDatasetBoundingBox(state.dataset));
  const mipContextMenuItems = useMipContextMenuItems(bboxId, propValue, onHideContextMenu);

  useEffect(() => {
    if (!isEditing && propValue !== undefined) {
      setIsValid(true);
      setText(computeText(propValue));
    }
  }, [propValue, isEditing]);

  useEffect(() => {
    if (propName !== undefined) {
      setName(propName);
    }
  }, [propName]);

  function computeText(vector: Vector6) {
    return vector.join(", ");
  }

  const handleBlur = () => {
    setIsEditing(false);
    setIsValid(true);
    setText(computeText(propValue));
  };

  const handleFocus = () => {
    setIsEditing(true);
    setText(computeText(propValue));
    setIsValid(true);
  };

  const handleChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const newText = evt.target.value;
    // only numbers, commas and whitespace is allowed
    const isValidInput = /^[\d\s,]*$/g.test(newText);
    const value = stringToNumberArray(newText);
    const isValidLength = value.length === 6;
    const isValid = isValidInput && isValidLength;

    if (isValid) {
      onBoundingChange?.(numberArrayToVector6(value));
    }

    setText(newText);
    setIsValid(isValid);
  };

  const handleColorChange = (newColor: Vector3) => {
    const mappedColor = newColor.map((colorPart) => colorPart / 255) as any as Vector3;
    onColorChange?.(mappedColor);
  };

  const handleNameChanged = (evt: React.SyntheticEvent) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
    const currentEnteredName = evt.target.value;

    if (currentEnteredName !== propName) {
      onNameChange?.(currentEnteredName);
    }
  };

  const onRegisterSegmentsForBB = async (value: Vector6, name: string): Promise<void> => {
    const min: Vector3 = [value[0], value[1], value[2]];
    const max: Vector3 = [value[0] + value[3], value[1] + value[4], value[2] + value[5]];
    // Close before the async call to avoid that the user can easily click twice.
    onHideContextMenu?.();
    await api.tracing
      .registerSegmentsForBoundingBox(min, max, name)
      .catch((error) => Toast.error(error.message));
  };

  const boundingBoxMin: Vector3 = [propValue[0], propValue[1], propValue[2]];
  const boundingBoxSize: Vector3 = [propValue[3], propValue[4], propValue[5]];

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
        />
      ))}
      <Divider style={{ margin: "8px 0" }} />
      <div style={{ fontWeight: "bold", marginBottom: 4 }}>Size</div>
      {SIZE_LABELS.map((label, dim) => (
        <NumberSliderSetting
          key={`size-${label}`}
          label={label}
          min={1}
          max={Math.max(datasetExtent[dim], boundingBoxSize[dim])}
          value={boundingBoxSize[dim]}
          onChange={(newValue) => handleSizeSliderChange(dim, newValue)}
          wheelFactor={0.05}
        />
      ))}
    </div>
  );

  const upscaledColor = color.map((colorPart) => colorPart * 255) as any as Vector3;
  const marginLeftStyle = { marginLeft: 6 };

  const editingDisallowedExplanation = messages["tracing.read_only_mode_notification"](
    isLockedByOwner,
    isOwner,
  );
  const exportDisallowedExplanation = isLockedByOwner
    ? editingDisallowedExplanation
    : "This WEBKNOSSOS instance is not configured to run export jobs.";

  const getContextMenu = () => {
    const items: MenuProps["items"] = [
      ...mipContextMenuItems,
      {
        key: "registerSegments",
        label: (
          <>
            Register all segments in this bounding box
            <FastTooltip title="Moves/registers all segments within this bounding box into a new segment group">
              <InfoCircleOutlined style={marginLeftStyle} />
            </FastTooltip>
          </>
        ),
        icon: <ScanOutlined />,
        onClick: () => onRegisterSegmentsForBB(propValue, name),
        disabled: visibleSegmentationLayer == null || disabled,
      },
      {
        key: "goToCenter",
        label: "Go to center",
        icon: <BorderInnerOutlined />,
        onClick: onGoToBoundingBox,
      },
      {
        key: "export",
        icon: <DownloadOutlined />,
        label: isExportEnabled ? (
          "Export data"
        ) : (
          <FastTooltip title={exportDisallowedExplanation}>Export data</FastTooltip>
        ),
        disabled: !isExportEnabled,
        onClick: onExport,
      },
    ];

    return { items };
  };

  return (
    <div
      onContextMenu={(evt) => onOpenContextMenu(getContextMenu(), evt, bboxId)}
      onClick={onHideContextMenu}
    >
      <Flex
        gap="middle"
        justify="flex-start"
        style={{
          marginTop: 10,
          marginBottom: 10,
        }}
      >
        <Flex gap="middle" justify="space-between" align="center">
          <Switch
            size="small"
            onChange={onVisibilityChange}
            checked={isVisible}
            // To prevent centering the bounding box on every edit (e.g. upon visibility change)
            // the click events are stopped from propagating to the parent div.
            onClick={(_value, e) => e.stopPropagation()}
          />
          <FastTooltip title={!isReadOnly && disabled ? editingDisallowedExplanation : null}>
            <ColorSetting
              value={rgbToHex(upscaledColor)}
              onChange={handleColorChange}
              // The color of a read-only layer bounding box is a client-side display setting and
              // therefore stays editable even when the annotation cannot be updated.
              disabled={!isReadOnly && disabled}
            />
          </FastTooltip>
        </Flex>
        <FastTooltip
          title={isReadOnly ? READ_ONLY_TOOLTIP : disabled ? editingDisallowedExplanation : null}
          style={{ flexGrow: 1 }}
        >
          <Input
            defaultValue={name}
            placeholder="Bounding Box Name"
            size="small"
            value={name}
            onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
              setName(evt.target.value);
            }}
            onPressEnter={handleNameChanged}
            onBlur={handleNameChanged}
            disabled={!isReadOnly && disabled}
            readOnly={isReadOnly}
            style={isReadOnly ? READ_ONLY_INPUT_STYLE : undefined}
            onClick={(e) => e.stopPropagation()}
          />
        </FastTooltip>
        <MipInlineButton bboxId={bboxId} />
        {isReadOnly ? (
          <ButtonComponent
            title={READ_ONLY_TOOLTIP}
            icon={<LockOutlined style={{ color: "var(--ant-color-text-tertiary)" }} />}
            type="text"
            size="small"
            // The button is only a visual read-only indicator and should not react to clicks.
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <ButtonComponent
            title={disabled ? editingDisallowedExplanation : "Delete Bounding Box"}
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.();
            }}
            disabled={disabled}
            icon={<DeleteOutlined />}
            type="text"
            size="small"
          />
        )}
      </Flex>
      <Flex
        style={{
          marginBottom: 10,
        }}
        align="flex-start"
        gap="middle"
        justify="flex-start"
      >
        <FastTooltip
          style={{ flex: "0 0 60px" }}
          title="The top-left corner of the bounding box followed by the width, height, and depth."
        >
          <label> Bounds: </label>
        </FastTooltip>
        <FastTooltip
          title={
            isReadOnly
              ? READ_ONLY_TOOLTIP
              : disabled
                ? editingDisallowedExplanation
                : FORMAT_TOOLTIP
          }
          placement="top-start"
          style={{ flexGrow: 1 }}
        >
          <Input
            status={isValid ? "" : "error"}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            value={text}
            placeholder="0, 0, 0, 512, 512, 512"
            size="small"
            disabled={!isReadOnly && disabled}
            readOnly={isReadOnly}
            style={isReadOnly ? READ_ONLY_INPUT_STYLE : undefined}
            onClick={(e) => e.stopPropagation()}
          />
        </FastTooltip>
        {!isReadOnly && (
          <Popover
            content={slidersContent}
            title="Adjust Position & Size"
            placement="bottom"
            trigger="click"
          >
            <ButtonComponent
              title={
                disabled ? editingDisallowedExplanation : "Adjust position and size with sliders"
              }
              icon={<SlidersOutlined />}
              type="text"
              size="small"
              disabled={disabled}
              onClick={(e) => e.stopPropagation()}
            />
          </Popover>
        )}
        {/* onOpenContextMenu needs event from div*/}
        <div onClick={(evt) => onOpenContextMenu(getContextMenu(), evt, bboxId)}>
          <ButtonComponent type="text" size="small" icon={<EllipsisOutlined />} />
        </div>
      </Flex>
    </div>
  );
}

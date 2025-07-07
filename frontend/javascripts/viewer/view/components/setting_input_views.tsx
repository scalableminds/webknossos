import {
  BorderInnerOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  InfoCircleOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import {
  Col,
  Input,
  InputNumber,
  type MenuProps,
  Popover,
  type PopoverProps,
  Row,
  Select,
  Switch,
} from "antd";
import FastTooltip from "components/fast_tooltip";
import { Slider } from "components/slider";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import messages from "messages";
import type * as React from "react";
import { useEffect, useState } from "react";
import { connect } from "react-redux";
import type { APISegmentationLayer } from "types/api_types";
import type { Vector3, Vector6 } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { api } from "viewer/singletons";
import type { WebknossosState } from "viewer/store";

const ROW_GUTTER = 1;

const ANTD_TOTAL_SPAN = 24;

// Always the left part:
export const SETTING_LEFT_SPAN = 10;

// Second part for 2-part setting row:
const SETTING_RIGHT_SPAN = 14;

// Second and third part for 3-part setting row:
export const SETTING_MIDDLE_SPAN = 10;
export const SETTING_VALUE_SPAN = 4;

type NumberSliderSettingProps = {
  onChange: (value: number) => void;
  value: number;
  label: string | React.ReactNode;
  max: number;
  min?: number;
  step?: number;
  disabled?: boolean;
  spans?: Vector3;
  defaultValue?: number;
  wheelFactor?: number;
};

export function NumberSliderSetting(props: NumberSliderSettingProps) {
  const {
    value: originalValue,
    label,
    max,
    min = 1,
    step = 1,
    onChange,
    disabled = false,
    defaultValue,
    wheelFactor: stepSize,
    spans = [SETTING_LEFT_SPAN, SETTING_MIDDLE_SPAN, SETTING_VALUE_SPAN],
  } = props;

  const isValueValid = (_value: number | null) =>
    _.isNumber(_value) && _value >= min && _value <= max;

  const _onChange = (_value: number | null) => {
    if (_value != null && isValueValid(_value)) {
      onChange(_value);
    }
  };

  // Validate the provided value. If it's not valid, fallback to the midpoint between min and max.
  // This check guards against broken settings which could be introduced before this component
  // checked more thoroughly against invalid values.
  const value = isValueValid(originalValue) ? originalValue : Math.floor((min + max) / 2);
  return (
    <Row align="middle" gutter={ROW_GUTTER}>
      <Col span={spans[0]}>
        <label className="setting-label">{label}</label>
      </Col>
      <Col span={spans[1]}>
        <Slider
          min={min}
          max={max}
          onChange={onChange}
          value={value}
          step={step}
          disabled={disabled}
          defaultValue={defaultValue}
          wheelFactor={stepSize}
        />
      </Col>
      <Col span={spans[2]}>
        <InputNumber
          controls={false}
          min={min}
          max={max}
          style={{
            width: "100%",
          }}
          value={value}
          onChange={_onChange}
          size="small"
          disabled={disabled}
          variant="borderless"
        />
      </Col>
    </Row>
  );
}

type LogSliderSettingProps = {
  onChange: (value: number) => void;
  value: number;
  label: string | React.ReactNode;
  max: number;
  min: number;
  roundTo: number;
  disabled?: boolean;
  spans?: Vector3;
  precision?: number;
  defaultValue?: number;
};

const LOG_SLIDER_MIN = -100;
const LOG_SLIDER_MAX = 100;

export function LogSliderSetting(props: LogSliderSettingProps) {
  const {
    onChange,
    value,
    label,
    max,
    min,
    roundTo = 3,
    disabled = false,
    spans = [SETTING_LEFT_SPAN, SETTING_MIDDLE_SPAN, SETTING_VALUE_SPAN],
    precision,
    defaultValue,
  } = props;

  const onChangeInput = (inputValue: number | null) => {
    if (inputValue == null) {
      return;
    }
    if (min <= inputValue && inputValue <= max) {
      onChange(inputValue);
    } else {
      // reset to slider value
      onChange(value);
    }
  };
  const onChangeSlider = (sliderValue: number) => {
    onChange(calculateValue(sliderValue));
  };
  const calculateValue = (sliderValue: number) => {
    const a = 200 / (Math.log(max) - Math.log(min));
    const b = (100 * (Math.log(min) + Math.log(max))) / (Math.log(min) - Math.log(max));
    return Math.exp((sliderValue - b) / a);
  };

  const formatTooltip = (tooltipValue: number | undefined) => {
    if (tooltipValue == null) {
      return "invalid";
    }
    const calculatedValue = calculateValue(tooltipValue);
    return calculatedValue >= 10000
      ? calculatedValue.toExponential()
      : Utils.roundTo(calculatedValue, roundTo);
  };

  const getSliderValue = () => {
    const a = 200 / (Math.log(max) - Math.log(min));
    const b = (100 * (Math.log(min) + Math.log(max))) / (Math.log(min) - Math.log(max));
    const scaleValue = a * Math.log(value) + b;
    return Math.round(scaleValue);
  };

  const resetToDefaultValue = () => {
    if (defaultValue == null) return;
    onChangeInput(defaultValue);
  };

  return (
    <Row align="middle" gutter={ROW_GUTTER}>
      <Col span={spans[0]}>
        <label className="setting-label">{label}</label>
      </Col>
      <Col span={spans[1]}>
        <Slider
          min={LOG_SLIDER_MIN}
          max={LOG_SLIDER_MAX}
          tooltip={{ formatter: formatTooltip }}
          onChange={onChangeSlider}
          value={getSliderValue()}
          disabled={disabled}
          defaultValue={defaultValue}
          onResetToDefault={resetToDefaultValue}
        />
      </Col>
      <Col span={spans[2]}>
        <InputNumber
          controls={false}
          variant={"borderless"}
          min={min}
          max={max}
          style={{
            width: "100%",
          }}
          step={value / 10}
          precision={precision ?? 2}
          value={roundTo != null ? Utils.roundTo(value, roundTo) : value}
          onChange={onChangeInput}
          disabled={disabled}
          size="small"
        />
      </Col>
    </Row>
  );
}

type SwitchSettingProps = React.PropsWithChildren<{
  onChange: (value: boolean) => void | Promise<void>;
  value: boolean;
  label: string | React.ReactNode;
  disabled?: boolean;
  tooltipText?: string | null | undefined;
  loading?: boolean;
  labelSpan?: number | null;
  postSwitchIcon?: React.ReactNode | null | undefined;
  disabledReason?: string | null;
}>;

export function SwitchSetting(props: SwitchSettingProps) {
  const {
    label,
    onChange,
    value,
    disabled = false,
    tooltipText = null,
    loading = false,
    labelSpan = null,
    postSwitchIcon = null,
    disabledReason,
    children,
  } = props;

  const leftSpanValue = labelSpan || SETTING_LEFT_SPAN;
  const rightSpanValue = labelSpan != null ? ANTD_TOTAL_SPAN - leftSpanValue : SETTING_RIGHT_SPAN;
  return (
    <Row className="margin-bottom" align="middle" gutter={ROW_GUTTER}>
      <Col span={leftSpanValue}>
        <label className="setting-label">{label}</label>
      </Col>
      <Col span={rightSpanValue}>
        <FastTooltip title={tooltipText} placement="top">
          {/* This div is necessary for the tooltip to be displayed */}
          <div
            style={{
              display: "inline-flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <FastTooltip title={disabledReason}>
              <Switch
                onChange={onChange}
                checked={value}
                defaultChecked={value}
                disabled={disabled}
                loading={loading}
              />
            </FastTooltip>
            {postSwitchIcon}
          </div>
        </FastTooltip>
        {children}
      </Col>
    </Row>
  );
}

type NumberInputPopoverSettingProps = {
  onChange: (value: number) => void;
  value: number | null | undefined;
  label: string | React.ReactNode;
  detailedLabel: string | React.ReactNode;
  placement?: PopoverProps["placement"];
  max?: number;
  min?: number;
  step?: number;
};

export function NumberInputPopoverSetting(props: NumberInputPopoverSettingProps) {
  const { min, max, onChange, step, value, label, detailedLabel } = props;
  const placement: PopoverProps["placement"] = props.placement || "top";
  const onChangeGuarded = (val: number | null) => {
    if (val != null) {
      onChange(val);
    }
  };
  const numberInput = (
    <div>
      <div
        style={{
          marginBottom: 8,
        }}
      >
        {detailedLabel}:
      </div>
      <InputNumber
        controls={false}
        style={{
          width: 140,
        }}
        min={min}
        max={max}
        onChange={onChangeGuarded}
        value={value}
        step={step}
        size="small"
        variant="borderless"
      />
    </div>
  );
  return (
    <Popover content={numberInput} trigger="click" placement={placement}>
      <span
        style={{
          cursor: "pointer",
        }}
      >
        {label} {value != null ? value : "-"}
        <EditOutlined
          style={{
            fontSize: 11,
            opacity: 0.7,
            margin: "0 0px 5px 3px",
          }}
        />
      </span>
    </Popover>
  );
}

type UserBoundingBoxInputProps = {
  value: Vector6;
  name: string;
  color: Vector3;
  isVisible: boolean;
  isExportEnabled: boolean;
  onBoundingChange: (arg0: Vector6) => void;
  onDelete: () => void;
  onExport: () => void;
  onGoToBoundingBox: () => void;
  onVisibilityChange: (arg0: boolean) => void;
  onNameChange: (arg0: string) => void;
  onColorChange: (arg0: Vector3) => void;
  disabled: boolean;
  isLockedByOwner: boolean;
  isOwner: boolean;
  visibleSegmentationLayer: APISegmentationLayer | null | undefined;
  onOpenContextMenu: (menu: MenuProps, event: React.MouseEvent<HTMLDivElement>) => void;
  onHideContextMenu?: () => void;
};

const FORMAT_TOOLTIP = "Format: minX, minY, minZ, width, height, depth";

export function UserBoundingBoxInput(props: UserBoundingBoxInputProps) {
  const {
    value: propValue,
    name: propName,
    color,
    isVisible,
    onDelete,
    onExport,
    isExportEnabled,
    onGoToBoundingBox,
    onVisibilityChange,
    onNameChange,
    onColorChange,
    disabled,
    isLockedByOwner,
    isOwner,
    onBoundingChange,
    onOpenContextMenu,
    onHideContextMenu,
  } = props;

  const [isEditing, setIsEditing] = useState(false);
  const [isValid, setIsValid] = useState(true);
  const [text, setText] = useState(computeText(propValue));
  const [name, setName] = useState(propName);

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
    const value = Utils.stringToNumberArray(newText);
    const isValidLength = value.length === 6;
    const isValid = isValidInput && isValidLength;

    if (isValid) {
      onBoundingChange(Utils.numberArrayToVector6(value));
    }

    setText(newText);
    setIsValid(isValid);
  };

  const handleColorChange = (newColor: Vector3) => {
    const mappedColor = newColor.map((colorPart) => colorPart / 255) as any as Vector3;
    onColorChange(mappedColor);
  };

  const handleNameChanged = (evt: React.SyntheticEvent) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
    const currentEnteredName = evt.target.value;

    if (currentEnteredName !== propName) {
      onNameChange(currentEnteredName);
    }
  };

  const maybeCloseContextMenu = () => {
    if (onHideContextMenu) {
      onHideContextMenu();
    }
  };

  const onRegisterSegmentsForBB = (value: Vector6, name: string): void => {
    const min: Vector3 = [value[0], value[1], value[2]];
    const max: Vector3 = [value[0] + value[3], value[1] + value[4], value[2] + value[5]];
    api.tracing
      .registerSegmentsForBoundingBox(min, max, name)
      .catch((error) => Toast.error(error.message));
    maybeCloseContextMenu();
  };

  const upscaledColor = color.map((colorPart) => colorPart * 255) as any as Vector3;
  const marginRightStyle = {
    marginRight: 8,
  };
  const marginLeftStyle = {
    marginLeft: 6,
  };
  const disabledIconStyle = { ...marginRightStyle, opacity: 0.5, cursor: "not-allowed" };
  const exportButton = (
    <>
      <DownloadOutlined style={isExportEnabled ? marginRightStyle : disabledIconStyle} />
      Export data
    </>
  );
  const deleteButton = (
    <>
      <DeleteOutlined style={disabled ? disabledIconStyle : marginRightStyle} />
      Delete
    </>
  );
  const editingDisallowedExplanation = messages["tracing.read_only_mode_notification"](
    isLockedByOwner,
    isOwner,
  );

  const getContextMenu = () => {
    const items: MenuProps["items"] = [
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
        disabled: props.visibleSegmentationLayer == null || disabled,
      },
      {
        key: "goToCenter",
        label: "Go to center",
        icon: <BorderInnerOutlined />,
        onClick: onGoToBoundingBox,
      },
      {
        key: "export",
        label: isExportEnabled ? (
          exportButton
        ) : (
          <FastTooltip title={editingDisallowedExplanation}>{exportButton}</FastTooltip>
        ),
        disabled: !isExportEnabled,
        onClick: onExport,
      },
      {
        key: "delete",
        label: !disabled ? (
          deleteButton
        ) : (
          <FastTooltip title={editingDisallowedExplanation}>{deleteButton}</FastTooltip>
        ),
        onClick: onDelete,
        disabled,
      },
    ];

    return { items };
  };

  return (
    <div
      onContextMenu={(evt) => onOpenContextMenu(getContextMenu(), evt)}
      onClick={onHideContextMenu}
    >
      <Row
        style={{
          marginTop: 10,
          marginBottom: 10,
        }}
      >
        <Col span={5}>
          <Switch
            size="small"
            onChange={onVisibilityChange}
            checked={isVisible}
            style={{
              margin: "auto 0px",
            }}
            // To prevent centering the bounding box on every edit (e.g. upon visibility change)
            // the click events are stopped from propagating to the parent div.
            onClick={(_value, e) => e.stopPropagation()}
          />
        </Col>

        <Col span={SETTING_RIGHT_SPAN}>
          <FastTooltip title={disabled ? editingDisallowedExplanation : null}>
            <span>
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
                disabled={disabled}
                onClick={(e) => e.stopPropagation()}
              />
            </span>
          </FastTooltip>
        </Col>
        <Col span={2}>
          <div
            onContextMenu={(evt) => onOpenContextMenu(getContextMenu(), evt)}
            onClick={(evt) => onOpenContextMenu(getContextMenu(), evt)}
          >
            <EllipsisOutlined style={marginLeftStyle} />
          </div>
        </Col>
      </Row>
      <Row
        style={{
          marginBottom: 10,
        }}
        align="top"
      >
        <Col span={5}>
          <FastTooltip title="The top-left corner of the bounding box followed by the width, height, and depth.">
            <label className="settings-label"> Bounds: </label>
          </FastTooltip>
        </Col>
        <Col span={SETTING_RIGHT_SPAN}>
          <FastTooltip
            title={disabled ? editingDisallowedExplanation : FORMAT_TOOLTIP}
            placement="top-start"
          >
            <Input
              status={isValid ? "" : "error"}
              onChange={handleChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              value={text}
              placeholder="0, 0, 0, 512, 512, 512"
              size="small"
              disabled={disabled}
              onClick={(e) => e.stopPropagation()}
            />
          </FastTooltip>
        </Col>
        <Col span={2}>
          <FastTooltip title={disabled ? editingDisallowedExplanation : null}>
            <ColorSetting
              value={Utils.rgbToHex(upscaledColor)}
              onChange={handleColorChange}
              style={marginLeftStyle}
              disabled={disabled}
            />
          </FastTooltip>
        </Col>
      </Row>
    </div>
  );
}

const mapStateToProps = (state: WebknossosState) => ({
  visibleSegmentationLayer: getVisibleSegmentationLayer(state),
});

const connector = connect(mapStateToProps)(UserBoundingBoxInput);
export default connector;

type ColorSettingPropTypes = {
  value: string;
  onChange: (value: Vector3) => void;
  disabled?: boolean;
  style?: Record<string, any>;
};

export function ColorSetting(props: ColorSettingPropTypes) {
  const { value, disabled = false, style } = props;

  const onColorChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    props.onChange(Utils.hexToRgb(evt.target.value));
  };

  return (
    <div
      className="color-display-wrapper"
      style={{
        backgroundColor: value,
        ...style,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="color"
        style={{
          opacity: 0,
          display: "block",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          width: "100%",
          height: "100%",
        }}
        onChange={onColorChange}
        value={value}
        disabled={disabled}
      />
    </div>
  );
}

type DropdownSettingProps = {
  onChange: (value: number) => void;
  label: React.ReactNode | string;
  value: number | string;
  options: Array<Record<string, any>>;
  disabled?: boolean;
  disabledReason?: string | null;
};

export function DropdownSetting(props: DropdownSettingProps) {
  const { onChange, label, value, options, disabled, disabledReason } = props;
  return (
    <Row className="margin-bottom" align="top" gutter={ROW_GUTTER}>
      <Col span={SETTING_LEFT_SPAN}>
        <label className="setting-label">{label}</label>
      </Col>
      <Col span={SETTING_RIGHT_SPAN}>
        <FastTooltip title={disabledReason}>
          <Select
            onChange={onChange}
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
            value={value.toString()}
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
            defaultValue={value.toString()}
            size="small"
            popupMatchSelectWidth={false}
            options={options}
            disabled={disabled}
          />
        </FastTooltip>
      </Col>
    </Row>
  );
}

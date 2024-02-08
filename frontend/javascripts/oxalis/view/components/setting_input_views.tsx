import {
  Row,
  Col,
  Slider,
  InputNumber,
  Switch,
  Tooltip,
  Input,
  Select,
  Popover,
  PopoverProps,
} from "antd";
import { DeleteOutlined, DownloadOutlined, EditOutlined, ScanOutlined } from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";
import type { Vector3, Vector6 } from "oxalis/constants";
import * as Utils from "libs/utils";
import features from "features";
import messages from "messages";

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
  min: number;
  step: number;
  disabled: boolean;
  spans: Vector3;
};
export class NumberSliderSetting extends React.PureComponent<NumberSliderSettingProps> {
  static defaultProps = {
    min: 1,
    step: 1,
    disabled: false,
    spans: [SETTING_LEFT_SPAN, SETTING_MIDDLE_SPAN, SETTING_VALUE_SPAN],
  };

  _onChange = (_value: number | null) => {
    if (_value != null && this.isValueValid(_value)) {
      this.props.onChange(_value);
    }
  };

  isValueValid = (_value: number | null) =>
    _.isNumber(_value) && _value >= this.props.min && _value <= this.props.max;

  render() {
    const { value: originalValue, label, max, min, step, onChange, disabled } = this.props;
    // Validate the provided value. If it's not valid, fallback to the midpoint between min and max.
    // This check guards against broken settings which could be introduced before this component
    // checked more thoroughly against invalid values.
    const value = this.isValueValid(originalValue) ? originalValue : Math.floor((min + max) / 2);
    return (
      <Row align="middle" gutter={ROW_GUTTER}>
        <Col span={this.props.spans[0]}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={this.props.spans[1]}>
          <Slider
            min={min}
            max={max}
            onChange={onChange}
            value={value}
            step={step}
            disabled={disabled}
          />
        </Col>
        <Col span={this.props.spans[2]}>
          <InputNumber
            controls={false}
            min={min}
            max={max}
            style={{
              width: "100%",
            }}
            value={value}
            onChange={this._onChange}
            size="small"
            disabled={disabled}
            variant="borderless"
          />
        </Col>
      </Row>
    );
  }
}

type LogSliderSettingProps = {
  onChange: (value: number) => void;
  value: number;
  label: string | React.ReactNode;
  max: number;
  min: number;
  roundTo: number;
  disabled?: boolean;
  spans: Vector3;
  precision?: number;
};

const LOG_SLIDER_MIN = -100;
const LOG_SLIDER_MAX = 100;

export class LogSliderSetting extends React.PureComponent<LogSliderSettingProps> {
  static defaultProps = {
    disabled: false,
    roundTo: 3,
    spans: [SETTING_LEFT_SPAN, SETTING_MIDDLE_SPAN, SETTING_VALUE_SPAN],
  };

  onChangeInput = (value: number | null) => {
    if (value == null) {
      return;
    }
    if (this.props.min <= value && value <= this.props.max) {
      this.props.onChange(value);
    } else {
      // reset to slider value
      this.props.onChange(this.props.value);
    }
  };

  onChangeSlider = (value: number) => {
    this.props.onChange(this.calculateValue(value));
  };

  calculateValue(value: number) {
    const a = 200 / (Math.log(this.props.max) - Math.log(this.props.min));
    const b =
      (100 * (Math.log(this.props.min) + Math.log(this.props.max))) /
      (Math.log(this.props.min) - Math.log(this.props.max));
    return Math.exp((value - b) / a);
  }

  formatTooltip = (value: number | undefined) => {
    if (value == null) {
      return "invalid";
    }
    const calculatedValue = this.calculateValue(value);
    return calculatedValue >= 10000
      ? calculatedValue.toExponential()
      : Utils.roundTo(calculatedValue, this.props.roundTo);
  };

  getSliderValue = () => {
    const a = 200 / (Math.log(this.props.max) - Math.log(this.props.min));
    const b =
      (100 * (Math.log(this.props.min) + Math.log(this.props.max))) /
      (Math.log(this.props.min) - Math.log(this.props.max));
    const scaleValue = a * Math.log(this.props.value) + b;
    return Math.round(scaleValue);
  };

  render() {
    const { label, roundTo, value, min, max, disabled } = this.props;
    return (
      <Row align="middle" gutter={ROW_GUTTER}>
        <Col span={this.props.spans[0]}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={this.props.spans[1]}>
          <Slider
            min={LOG_SLIDER_MIN}
            max={LOG_SLIDER_MAX}
            tooltip={{ formatter: this.formatTooltip }}
            onChange={this.onChangeSlider}
            value={this.getSliderValue()}
            disabled={disabled}
          />
        </Col>
        <Col span={this.props.spans[2]}>
          <InputNumber
            controls={false}
            variant={"borderless"}
            min={min}
            max={max}
            style={{
              width: "100%",
            }}
            step={value / 10}
            precision={this.props.precision ?? 2}
            value={roundTo != null ? Utils.roundTo(value, roundTo) : value}
            onChange={this.onChangeInput}
            disabled={disabled}
            size="small"
          />
        </Col>
      </Row>
    );
  }
}
export type SwitchSettingProps = {
  onChange: (value: boolean) => void | Promise<void>;
  value: boolean;
  label: string | React.ReactNode;
  disabled: boolean;
  tooltipText: string | null | undefined;
  loading: boolean;
  labelSpan?: number | null;
  postSwitchIcon: React.ReactNode | null | undefined;
  disabledReason?: string | null;
};
export class SwitchSetting extends React.PureComponent<SwitchSettingProps> {
  static defaultProps = {
    disabled: false,
    tooltipText: null,
    loading: false,
    postSwitchIcon: null,
  };

  render() {
    const { label, onChange, value, disabled, tooltipText, loading, labelSpan, postSwitchIcon } =
      this.props;
    const leftSpanValue = labelSpan || SETTING_LEFT_SPAN;
    const rightSpanValue = labelSpan != null ? ANTD_TOTAL_SPAN - leftSpanValue : SETTING_RIGHT_SPAN;
    return (
      <Row className="margin-bottom" align="middle" gutter={ROW_GUTTER}>
        <Col span={leftSpanValue}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={rightSpanValue}>
          <Tooltip title={tooltipText} placement="top">
            {/* This div is necessary for the tooltip to be displayed */}
            <div
              style={{
                display: "inline-flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Tooltip title={this.props.disabledReason}>
                <Switch
                  onChange={onChange}
                  checked={value}
                  defaultChecked={value}
                  disabled={disabled}
                  loading={loading}
                />
              </Tooltip>
              {postSwitchIcon}
            </div>
          </Tooltip>
          {this.props.children}
        </Col>
      </Row>
    );
  }
}
type NumberInputSettingProps = {
  onChange: (value: number | null) => void;
  value: number | "";
  label: string;
  max?: number;
  min?: number;
  step?: number;
};
export class NumberInputSetting extends React.PureComponent<NumberInputSettingProps> {
  static defaultProps = {
    max: undefined,
    min: 1,
    step: 1,
  };

  render() {
    const { onChange, value, label, max, min, step } = this.props;
    return (
      <Row className="margin-bottom" align="top" gutter={ROW_GUTTER}>
        <Col span={SETTING_LEFT_SPAN}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={SETTING_RIGHT_SPAN}>
          <InputNumber
            style={{
              width: "100%",
            }}
            min={min}
            max={max}
            onChange={onChange}
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'number | ""' is not assignable to type 'numb... Remove this comment to see the full error message
            value={value}
            step={step}
            size="small"
            variant="borderless"
          />
        </Col>
      </Row>
    );
  }
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
  tooltipTitle: string;
  onBoundingChange: (arg0: Vector6) => void;
  onDelete: () => void;
  onExport: () => void;
  onGoToBoundingBox: () => void;
  onVisibilityChange: (arg0: boolean) => void;
  onNameChange: (arg0: string) => void;
  onColorChange: (arg0: Vector3) => void;
  allowUpdate: boolean;
};
type State = {
  isEditing: boolean;
  isValid: boolean;
  text: string;
  name: string;
};
export class UserBoundingBoxInput extends React.PureComponent<UserBoundingBoxInputProps, State> {
  constructor(props: UserBoundingBoxInputProps) {
    super(props);
    this.state = {
      isEditing: false,
      isValid: true,
      text: this.computeText(props.value),
      name: props.name,
    };
  }

  componentDidUpdate(prevProps: UserBoundingBoxInputProps) {
    if (!this.state.isEditing && prevProps.value !== this.props.value) {
      this.setState({
        isValid: true,
        text: this.computeText(this.props.value),
      });
    }

    if (prevProps.name !== this.props.name) {
      this.setState({
        name: this.props.name,
      });
    }
  }

  computeText(vector: Vector6) {
    return vector.join(", ");
  }

  handleBlur = () => {
    this.setState({
      isEditing: false,
      isValid: true,
      text: this.computeText(this.props.value),
    });
  };

  handleFocus = () => {
    this.setState({
      isEditing: true,
      text: this.computeText(this.props.value),
      isValid: true,
    });
  };

  handleChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const text = evt.target.value;
    // only numbers, commas and whitespace is allowed
    const isValidInput = /^[\d\s,]*$/g.test(text);
    const value = Utils.stringToNumberArray(text);
    const isValidLength = value.length === 6;
    const isValid = isValidInput && isValidLength;

    if (isValid) {
      this.props.onBoundingChange(Utils.numberArrayToVector6(value));
    }

    this.setState({
      text,
      isValid,
    });
  };

  handleColorChange = (color: Vector3) => {
    color = color.map((colorPart) => colorPart / 255) as any as Vector3;
    this.props.onColorChange(color);
  };

  handleNameChanged = (evt: React.SyntheticEvent) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
    const currentEnteredName = evt.target.value;

    if (currentEnteredName !== this.props.name) {
      this.props.onNameChange(currentEnteredName);
    }
  };

  render() {
    const { name } = this.state;
    const tooltipStyle = this.state.isValid
      ? null
      : {
          backgroundColor: "red",
        };
    const {
      tooltipTitle,
      color,
      isVisible,
      onDelete,
      onExport,
      isExportEnabled,
      onGoToBoundingBox,
      allowUpdate,
    } = this.props;
    const upscaledColor = color.map((colorPart) => colorPart * 255) as any as Vector3;
    const iconStyle = {
      marginRight: 0,
      marginLeft: 6,
    };
    const disabledIconStyle = { ...iconStyle, opacity: 0.5, cursor: "not-allowed" };
    const exportIconStyle = isExportEnabled ? iconStyle : disabledIconStyle;
    const exportButtonTooltip = isExportEnabled
      ? "Export data from this bounding box."
      : messages["data.bounding_box_export_not_supported"];
    const exportColumn = features().jobsEnabled ? (
      <Col span={2}>
        <Tooltip title={exportButtonTooltip} placement="topRight">
          <DownloadOutlined onClick={onExport} style={exportIconStyle} />
        </Tooltip>
      </Col>
    ) : null;
    return (
      <React.Fragment>
        <Row
          style={{
            marginBottom: 10,
          }}
        >
          <Col span={5}>
            <Switch
              size="small"
              onChange={this.props.onVisibilityChange}
              checked={isVisible}
              style={{
                margin: "auto 0px",
              }}
            />
          </Col>

          <Col span={SETTING_RIGHT_SPAN}>
            <Tooltip title={allowUpdate ? null : messages["tracing.read_only_mode_notification"]}>
              <span>
                <Input
                  defaultValue={name}
                  placeholder="Bounding Box Name"
                  size="small"
                  value={name}
                  onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                    this.setState({ name: evt.target.value });
                  }}
                  onPressEnter={this.handleNameChanged}
                  onBlur={this.handleNameChanged}
                  disabled={!allowUpdate}
                />
              </span>
            </Tooltip>
          </Col>
          {exportColumn}
          <Col span={2}>
            <Tooltip
              title={
                allowUpdate
                  ? "Delete this bounding box."
                  : messages["tracing.read_only_mode_notification"]
              }
            >
              <DeleteOutlined
                onClick={allowUpdate ? onDelete : () => {}}
                style={allowUpdate ? iconStyle : disabledIconStyle}
              />
            </Tooltip>
          </Col>
        </Row>
        <Row
          style={{
            marginBottom: 20,
          }}
          align="top"
        >
          <Col span={5}>
            <Tooltip title="The top-left corner of the bounding box followed by the width, height, and depth.">
              <label className="settings-label"> Bounds: </label>
            </Tooltip>
          </Col>
          <Col span={SETTING_RIGHT_SPAN}>
            <Tooltip
              trigger={allowUpdate ? ["focus"] : ["hover"]}
              title={allowUpdate ? tooltipTitle : messages["tracing.read_only_mode_notification"]}
              placement="topLeft"
              // @ts-expect-error ts-migrate(2322) FIXME: Type '{ backgroundColor: string; } | null' is not ... Remove this comment to see the full error message
              overlayStyle={tooltipStyle}
            >
              <span>
                <Input
                  onChange={this.handleChange}
                  onFocus={this.handleFocus}
                  onBlur={this.handleBlur}
                  value={this.state.text}
                  placeholder="0, 0, 0, 512, 512, 512"
                  size="small"
                  disabled={!allowUpdate}
                />
              </span>
            </Tooltip>
          </Col>
          <Col span={2}>
            <Tooltip title={allowUpdate ? null : messages["tracing.read_only_mode_notification"]}>
              <span>
                <ColorSetting
                  value={Utils.rgbToHex(upscaledColor)}
                  onChange={this.handleColorChange}
                  style={iconStyle}
                  disabled={!allowUpdate}
                />
              </span>
            </Tooltip>
          </Col>
          <Col span={2}>
            <Tooltip title="Go to the center of the bounding box.">
              <ScanOutlined onClick={onGoToBoundingBox} style={{ ...iconStyle, marginTop: 6 }} />
            </Tooltip>
          </Col>
        </Row>
      </React.Fragment>
    );
  }
}
type ColorSettingPropTypes = {
  value: string;
  onChange: (value: Vector3) => void;
  disabled: boolean;
  style?: Record<string, any>;
};
export class ColorSetting extends React.PureComponent<ColorSettingPropTypes> {
  static defaultProps = {
    disabled: false,
  };

  onColorChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    this.props.onChange(Utils.hexToRgb(evt.target.value));
  };

  render() {
    const { value, disabled } = this.props;
    let { style } = this.props;
    style = style || {};
    return (
      <div
        className="color-display-wrapper"
        style={{
          backgroundColor: value,
          ...style,
        }}
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
          onChange={this.onColorChange}
          value={value}
          disabled={disabled}
        />
      </div>
    );
  }
}
type DropdownSettingProps = {
  onChange: (value: number) => void;
  label: React.ReactNode | string;
  value: number | string;
  options: Array<Record<string, any>>;
  disabled?: boolean;
  disabledReason?: string | null;
};
export class DropdownSetting extends React.PureComponent<DropdownSettingProps> {
  render() {
    const { onChange, label, value } = this.props;
    return (
      <Row className="margin-bottom" align="top" gutter={ROW_GUTTER}>
        <Col span={SETTING_LEFT_SPAN}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={SETTING_RIGHT_SPAN}>
          <Tooltip title={this.props.disabledReason}>
            <Select
              onChange={onChange}
              // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
              value={value.toString()}
              // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
              defaultValue={value.toString()}
              size="small"
              popupMatchSelectWidth={false}
              options={this.props.options}
              disabled={this.props.disabled}
            />
          </Tooltip>
        </Col>
      </Row>
    );
  }
}

// @flow
import { Row, Col, Slider, InputNumber, Switch, Tooltip, Input, Select } from "antd";
import { DeleteOutlined, DownloadOutlined } from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";

import type { Vector3, Vector6 } from "oxalis/constants";
import * as Utils from "libs/utils";

import features from "features";

type NumberSliderSettingProps = {
  onChange: (value: number) => void,
  value: number,
  label: string,
  max: number,
  min: number,
  step: number,
  disabled: boolean,
};

export class NumberSliderSetting extends React.PureComponent<NumberSliderSettingProps> {
  static defaultProps = {
    min: 1,
    step: 1,
    disabled: false,
  };

  _onChange = (_value: number) => {
    if (this.isValueValid(_value)) {
      this.props.onChange(_value);
    }
  };

  isValueValid = (_value: number) =>
    _.isNumber(_value) && _value >= this.props.min && _value <= this.props.max;

  render() {
    const { value: originalValue, label, max, min, step, onChange, disabled } = this.props;

    // Validate the provided value. If it's not valid, fallback to the midpoint between min and max.
    // This check guards against broken settings which could be introduced before this component
    // checked more thoroughly against invalid values.
    const value = this.isValueValid(originalValue) ? originalValue : Math.floor((min + max) / 2);

    return (
      <Row type="flex" align="middle">
        <Col span={9}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={8}>
          <Slider
            min={min}
            max={max}
            onChange={onChange}
            value={value}
            step={step}
            disabled={disabled}
          />
        </Col>
        <Col span={5}>
          <InputNumber
            min={min}
            max={max}
            style={{ width: 80, marginLeft: 16 }}
            value={value}
            onChange={this._onChange}
            size="small"
            disabled={disabled}
          />
        </Col>
      </Row>
    );
  }
}

type LogSliderSettingProps = {
  onChange: (value: number) => void,
  value: number,
  label: string,
  max: number,
  min: number,
  roundTo: number,
  disabled?: boolean,
};

const LOG_SLIDER_MIN = -100;
const LOG_SLIDER_MAX = 100;

export class LogSliderSetting extends React.PureComponent<LogSliderSettingProps> {
  static defaultProps = {
    disabled: false,
    roundTo: 3,
  };

  onChangeInput = (value: number) => {
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

  formatTooltip = (value: number) => {
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
      <Row type="flex" align="middle">
        <Col span={9}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={8}>
          <Slider
            min={LOG_SLIDER_MIN}
            max={LOG_SLIDER_MAX}
            tipFormatter={this.formatTooltip}
            onChange={this.onChangeSlider}
            value={this.getSliderValue()}
            disabled={disabled}
          />
        </Col>
        <Col span={5}>
          <InputNumber
            min={min}
            max={max}
            style={{ width: 80, marginLeft: 16 }}
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

type SwitchSettingProps = {
  onChange: (value: boolean) => void | Promise<void>,
  value: boolean,
  label: string | React.Node,
  disabled: boolean,
  tooltipText: ?string,
};

export class SwitchSetting extends React.PureComponent<SwitchSettingProps> {
  static defaultProps = {
    disabled: false,
    tooltipText: null,
  };

  render() {
    const { label, onChange, value, disabled, tooltipText } = this.props;
    return (
      <Row className="margin-bottom" type="flex" align="top">
        <Col span={9}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={15}>
          <Tooltip title={tooltipText} placement="top">
            {/* This div is necessary for the tooltip to be displayed */}
            <div style={{ display: "inline-block" }}>
              <Switch
                onChange={onChange}
                checked={value}
                defaultChecked={value}
                disabled={disabled}
              />
            </div>
          </Tooltip>
        </Col>
      </Row>
    );
  }
}

type NumberInputSettingProps = {
  onChange: (value: number) => void,
  value: number | "",
  label: string,
  max?: number,
  min?: number,
  step?: number,
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
      <Row className="margin-bottom" align="top">
        <Col span={9}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={15}>
          <InputNumber
            style={{ width: 80 }}
            min={min}
            max={max}
            onChange={onChange}
            value={value}
            step={step}
            size="small"
          />
        </Col>
      </Row>
    );
  }
}

export type UserBoundingBoxInputUpdate = {
  boundingBox?: Vector6,
  name?: string,
  color?: Vector3,
  isVisible?: boolean,
};

type UserBoundingBoxInputProps = {
  value: Vector6,
  name: string,
  color: Vector3,
  isVisible: boolean,
  tooltipTitle: string,
  onChange: UserBoundingBoxInputUpdate => void,
  onDelete: () => void,
  onExport: () => void,
};

type State = {
  isEditing: boolean,
  isValid: boolean,
  text: string,
  name: string,
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

  componentWillReceiveProps(newProps: UserBoundingBoxInputProps) {
    if (!this.state.isEditing) {
      this.setState({
        isValid: true,
        text: this.computeText(newProps.value),
      });
    }
    this.setState({ name: newProps.name });
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

  handleChange = (evt: SyntheticInputEvent<>) => {
    const text = evt.target.value;

    // only numbers, commas and whitespace is allowed
    const isValidInput = /^[\d\s,]*$/g.test(text);
    const value = Utils.stringToNumberArray(text);
    const isValidLength = value.length === 6;
    const isValid = isValidInput && isValidLength;

    if (isValid) {
      this.props.onChange({ boundingBox: Utils.numberArrayToVector6(value) });
    }
    this.setState({ text, isValid });
  };

  handleColorChange = (color: Vector3) => {
    color = ((color.map(colorPart => colorPart / 255): any): Vector3);
    this.props.onChange({ color });
  };

  handleVisibilityChange = (isVisible: boolean) => {
    this.props.onChange({ isVisible });
  };

  handleNameChanged = (evt: SyntheticInputEvent<>) => {
    const currentEnteredName = evt.target.value;
    if (currentEnteredName !== this.props.name) {
      this.props.onChange({ name: evt.target.value });
    }
  };

  render() {
    const { name } = this.state;
    const tooltipStyle = this.state.isValid ? null : { backgroundColor: "red" };
    const { tooltipTitle, color, isVisible, onDelete, onExport } = this.props;
    const upscaledColor = ((color.map(colorPart => colorPart * 255): any): Vector3);
    const iconStyle = { margin: "auto 0px auto 6px" };
    const exportColumn = features().jobsEnabled ? (
      <Col span={2}>
        <Tooltip title="Export data from this bouding box.">
          <DownloadOutlined onClick={onExport} style={iconStyle} />
        </Tooltip>
      </Col>
    ) : null;
    const visibilityColSpan = exportColumn == null ? 22 : 20;
    return (
      <React.Fragment>
        <Row style={{ marginBottom: 16 }}>
          <Col span={visibilityColSpan}>
            <Switch
              size="small"
              onChange={this.handleVisibilityChange}
              checked={isVisible}
              style={{ margin: "auto 0px" }}
            />
          </Col>
          {exportColumn}
          <Col span={2}>
            <Tooltip title="Delete this bounding box.">
              <DeleteOutlined onClick={onDelete} style={iconStyle} />
            </Tooltip>
          </Col>
        </Row>
        <Row className="margin-bottom" align="top">
          <Col span={5}>
            <label className="settings-label"> Name: </label>
          </Col>
          <Col span={17}>
            <Input
              defaultValue={name}
              placeholder="Bounding Box Name"
              size="small"
              value={name}
              onChange={(evt: SyntheticInputEvent<>) => {
                this.setState({ name: evt.target.value });
              }}
              onPressEnter={this.handleNameChanged}
              onBlur={this.handleNameChanged}
            />
          </Col>
          <Col span={2}>
            <ColorSetting
              value={Utils.rgbToHex(upscaledColor)}
              onChange={this.handleColorChange}
              className="ant-btn"
              style={iconStyle}
            />
          </Col>
        </Row>
        <Row className="margin-bottom" align="top">
          <Col span={5}>
            <label className="settings-label"> Bounds: </label>
          </Col>
          <Col span={17}>
            <Tooltip
              trigger={["focus"]}
              title={tooltipTitle}
              placement="topLeft"
              overlayStyle={tooltipStyle}
            >
              <Input
                onChange={this.handleChange}
                onFocus={this.handleFocus}
                onBlur={this.handleBlur}
                value={this.state.text}
                placeholder="0, 0, 0, 512, 512, 512"
                size="small"
              />
            </Tooltip>
          </Col>
        </Row>
      </React.Fragment>
    );
  }
}

type ColorSettingPropTypes = {
  value: string,
  onChange: (value: Vector3) => void,
  disabled: boolean,
  style?: Object,
};

export class ColorSetting extends React.PureComponent<ColorSettingPropTypes> {
  static defaultProps = {
    disabled: false,
  };

  onColorChange = (evt: SyntheticInputEvent<>) => {
    this.props.onChange(Utils.hexToRgb(evt.target.value));
  };

  render() {
    const { value, disabled } = this.props;
    let { style } = this.props;
    style = style || {};
    return (
      <div
        id="color-picker-wrapper"
        style={{
          backgroundColor: value,
          display: "inline-block",
          width: 16,
          height: 16,
          borderRadius: 3,
          boxShadow: "0px 0px 3px #cacaca",
          verticalAlign: "middle",
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
  onChange: (value: number) => void,
  label: React.Node | string,
  value: number | string,
  options: Array<Object>,
};

export class DropdownSetting extends React.PureComponent<DropdownSettingProps> {
  render() {
    const { onChange, label, value } = this.props;
    return (
      <Row className="margin-bottom" align="top">
        <Col span={9}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={15}>
          <Select
            onChange={onChange}
            value={value.toString()}
            defaultValue={value.toString()}
            size="small"
            dropdownMatchSelectWidth={false}
            options={this.props.options}
          />
        </Col>
      </Row>
    );
  }
}

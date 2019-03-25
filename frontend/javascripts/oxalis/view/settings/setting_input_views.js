// @flow
import { Row, Col, Slider, InputNumber, Switch, Tooltip, Input, Select } from "antd";
import * as React from "react";

import type { Vector3, Vector6 } from "oxalis/constants";
import * as Utils from "libs/utils";

type NumberSliderSettingProps = {
  onChange: (value: number) => void,
  value: number,
  label: string,
  max: number,
  min: number,
  step: number,
};

export class NumberSliderSetting extends React.PureComponent<NumberSliderSettingProps> {
  static defaultProps = {
    min: 1,
    step: 1,
  };

  _onChange = (_value: number) => {
    if (this.props.min <= _value && _value <= this.props.max) {
      this.props.onChange(_value);
    }
  };

  render() {
    const { value, label, max, min, step, onChange } = this.props;

    return (
      <Row type="flex" align="middle">
        <Col span={9}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={8}>
          <Slider min={min} max={max} onChange={onChange} value={value} step={step} />
        </Col>
        <Col span={5}>
          <InputNumber
            min={min}
            max={max}
            style={{ width: 80, marginLeft: 16 }}
            value={value}
            onChange={this._onChange}
            size="small"
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

  formatTooltip = (value: number) => Utils.roundTo(this.calculateValue(value), this.props.roundTo);

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
      <Row type="flex" align="top">
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
  onChange: (value: boolean) => void,
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

type VectorInputSettingPropTypes<T> = {
  label: string,
  value: T,
  onChange: (value: T) => void,
  tooltipTitle: string,
};

type State = {
  isEditing: boolean,
  isValid: boolean,
  text: string,
};

export class Vector6InputSetting extends React.PureComponent<
  VectorInputSettingPropTypes<?Vector6>,
  State,
> {
  constructor(props: VectorInputSettingPropTypes<?Vector6>) {
    super(props);
    this.state = {
      isEditing: false,
      isValid: true,
      text: this.computeText(props.value),
    };
  }

  componentWillReceiveProps(newProps: VectorInputSettingPropTypes<?Vector6>) {
    if (!this.state.isEditing) {
      this.setState({
        isValid: true,
        text: this.computeText(newProps.value),
      });
    }
  }

  computeText(vector: ?Vector6) {
    const defaultValue = "";
    return vector != null ? vector.join(", ") : defaultValue;
  }

  handleBlur = () => {
    this.setState({
      isEditing: false,
    });
    if (this.state.isValid) {
      this.setState({
        isValid: true,
        text: this.computeText(this.props.value),
      });
    } else {
      this.props.onChange();
      this.setState({
        isValid: true,
        text: this.computeText(),
      });
    }
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
    const isValidFormat = value.length === 6 || value.length === 0;

    if (isValidFormat && isValidInput) {
      if (value.length === 0) {
        this.props.onChange();
      } else {
        this.props.onChange(Utils.numberArrayToVector6(value));
      }
    }

    this.setState({
      text,
      isValid: isValidInput && isValidFormat,
    });
  };

  render() {
    const tooltipStyle = this.state.isValid ? null : { backgroundColor: "red" };

    return (
      <Row className="margin-bottom" align="top">
        <Col span={8}>
          <label className="setting-label">{this.props.label}</label>
        </Col>
        <Col span={16}>
          <Tooltip
            trigger={["focus"]}
            title={this.props.tooltipTitle}
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
    );
  }
}

type ColorSettingPropTypes = {
  value: string,
  label: string,
  onChange: (value: Vector3) => void,
};

export class ColorSetting extends React.PureComponent<ColorSettingPropTypes> {
  onColorChange = (evt: SyntheticInputEvent<>) => {
    this.props.onChange(Utils.hexToRgb(evt.target.value));
  };

  render() {
    return (
      <Row className="margin-bottom" align="top">
        <Col span={9}>
          <label className="setting-label">{this.props.label}</label>
        </Col>
        <Col span={15}>
          <div
            id="color-picker-wrapper"
            style={{
              backgroundColor: this.props.value,
              display: "block",
              width: 16,
              height: 16,
              borderRadius: 3,
              boxShadow: "0px 0px 3px #cacaca",
            }}
          >
            <input
              type="color"
              style={{ opacity: 0, display: "block", border: "none", cursor: "pointer" }}
              onChange={this.onColorChange}
              value={this.props.value}
            />
          </div>
        </Col>
      </Row>
    );
  }
}

type DropdownSettingProps = {
  onChange: (value: number) => void,
  label: React.Node | string,
  value: number | string,
  children?: Array<React.Node>,
};

export class DropdownSetting extends React.PureComponent<DropdownSettingProps> {
  static defaultProps = {
    children: undefined,
  };

  render() {
    const { onChange, label, value, children } = this.props;
    return (
      <Row className="margin-bottom" align="top">
        <Col span={8}>
          <label className="setting-label">{label}</label>
        </Col>
        <Col span={16}>
          <Select
            onChange={onChange}
            value={value.toString()}
            defaultValue={value.toString()}
            size="small"
            dropdownMatchSelectWidth={false}
          >
            {children}
          </Select>
        </Col>
      </Row>
    );
  }
}

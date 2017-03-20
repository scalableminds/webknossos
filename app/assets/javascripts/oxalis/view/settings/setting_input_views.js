/**
 * setting_input_views.js
 * @flow
 */

 /* eslint-disable react/no-multi-comp */
 /* eslint-disable react/prefer-stateless-function */

import React from "react";
import Utils from "libs/utils";
import { Row, Col, Slider, InputNumber, Switch, Tooltip, Input, Select } from "antd";
import type { Vector3, Vector6 } from "oxalis/constants";

type NumberSliderSettingProps = {
  onChange: (value: number) => void,
  value: number,
  label: string,
  max: number,
  min: number,
  step: number,
};

export class NumberSliderSetting extends React.PureComponent {

  props: NumberSliderSettingProps;
  static defaultProps = {
    min: 1,
    step: 1,
  };

  _onChange = (_value: number) => {
    if (this.props.min <= _value && _value <= this.props.max) {
      this.props.onChange(_value);
    }
  }
  render() {
    const { value, label, max, min, step, onChange } = this.props;

    return (
      <Row className="settings-row">
        <Col span={8}><span className="setting-label">{label}</span></Col>
        <Col span={8}>
          <Slider min={min} max={max} onChange={onChange} value={value} step={step} />
        </Col>
        <Col span={6}>
          <InputNumber
            min={min}
            max={max}
            style={{ marginLeft: 16 }}
            value={value} onChange={this._onChange}
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
};

const LOG_SLIDER_MIN = -100;
const LOG_SLIDER_MAX = 100;

export class LogSliderSetting extends React.PureComponent {

  props: LogSliderSettingProps;

  onChangeInput = (value: number) => {
    if (this.props.min <= value && value <= this.props.max) {
      this.props.onChange(value);
    } else {
      // reset to slider value
      this.props.onChange(this.props.value);
    }
  }

  onChangeSlider = (value: number) => {
    this.props.onChange(this.calculateValue(value));
  }

  calculateValue(value: number) {
    const a = 200 / (Math.log(this.props.max) - Math.log(this.props.min));
    const b = 100 * (Math.log(this.props.min) + Math.log(this.props.max)) /
      (Math.log(this.props.min) - Math.log(this.props.max));
    return Math.exp((value - b) / a);
  }

  formatTooltip = (value: number) =>
    Utils.roundTo(this.calculateValue(value), 3);

  getSliderValue = () => {
    const a = 200 / (Math.log(this.props.max) - Math.log(this.props.min));
    const b = 100 * (Math.log(this.props.min) + Math.log(this.props.max)) /
      (Math.log(this.props.min) - Math.log(this.props.max));
    const scaleValue = a * Math.log(this.props.value) + b;
    return Math.round(scaleValue);
  }

  render() {
    return (
      <Row className="settings-row">
        <Col span={8}><span className="setting-label">{this.props.label}</span></Col>
        <Col span={8}>
          <Slider
            min={LOG_SLIDER_MIN}
            max={LOG_SLIDER_MAX}
            tipFormatter={this.formatTooltip}
            onChange={this.onChangeSlider}
            value={this.getSliderValue()}
          />
        </Col>
        <Col span={6}>
          <InputNumber
            min={this.props.min}
            max={this.props.max}
            style={{ marginLeft: 16 }}
            value={this.props.value} onChange={this.onChangeInput}
          />
        </Col>
      </Row>
    );
  }
}

type SwitchSettingProps = {
  onChange: (value: boolean) => void,
  value: boolean,
  label: string,
};

export class SwitchSetting extends React.PureComponent {
  props: SwitchSettingProps;

  render() {
    const { label, onChange, value } = this.props;
    return (
      <Row className="settings-row">
        <Col span={8}><span className="setting-label">{label}</span></Col>
        <Col span={16}>
          <Switch onChange={onChange} checked={value} defaultChecked={value} />
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

export class NumberInputSetting extends React.PureComponent {
  props: NumberInputSettingProps;

  render() {
    const { onChange, value, label, max, min = 1, step = 1 } = this.props;

    return (
      <Row className="settings-row">
        <Col span={8}><span className="setting-label">{label}</span></Col>
        <Col span={16}>
          <InputNumber min={min} max={max} onChange={onChange} value={value} step={step} />
        </Col>
      </Row>
    );
  }
}

type VectorInputSettingPropTypes<T:Vector6> = {
  label: string,
  value: T,
  onChange: (value: T) => void,
  tooltipTitle: string,
};

export class Vector6InputSetting extends React.PureComponent {
  props: VectorInputSettingPropTypes<Vector6>;
  state: {
    isEditing: boolean,
    isValid: boolean,
    text: string,
  };

  constructor(props: VectorInputSettingPropTypes<Vector6>) {
    super(props);
    this.state = {
      isEditing: false,
      isValid: true,
      text: props.value.join(", "),
    };
  }

  componentWillReceiveProps(newProps: VectorInputSettingPropTypes<Vector6>) {
    if (!this.state.isEditing) {
      this.setState({
        isValid: true,
        text: newProps.value.join(", "),
      });
    }
  }

  defaultValue: Vector6 = [0, 0, 0, 0, 0, 0];

  handleBlur = () => {
    this.setState({
      isEditing: false,
    });
    if (this.state.isValid) {
      this.setState({
        isValid: true,
        text: this.props.value.join(", "),
      });
    } else {
      this.props.onChange(this.defaultValue);
      this.setState({
        isValid: true,
        text: this.defaultValue.join(", "),
      });
    }
  };

  handleFocus = () => {
    this.setState({
      isEditing: true,
      text: this.props.value.join(", "),
      isValid: true,
    });
  };

  handleChange = (evt: SyntheticInputEvent) => {
    const text = evt.target.value;

    // only numbers, commas and whitespace is allowed
    const isValidInput = (/^[\d\s,]*$/g).test(text);
    const value = Utils.stringToNumberArray(text);
    const isValidFormat = value.length === 6;

    if (isValidFormat && isValidInput) {
      this.props.onChange(Utils.numberArrayToVector6(value));
    }

    this.setState({
      text,
      isValid: isValidFormat,
    });
  };

  render() {
    const tooltipStyle = this.state.isValid ? null : { backgroundColor: "red" };

    return (
      <Row className="settings-row">
        <Col span={8}><span className="setting-label">{this.props.label}</span></Col>
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
            />
          </Tooltip>
        </Col>
      </Row>
    );
  }
}

type ColorSettingPropTypes = {
  // eslint-disable-next-line react/no-unused-prop-types
  value: Vector3,
  label: string,
  onChange: (value: Vector3) => void,
};

export class ColorSetting extends React.PureComponent {
  props: ColorSettingPropTypes;
  state: {
    value: string;
  }

  constructor(props:ColorSettingPropTypes) {
    super(props);
    this.state = {
      value: "#000000",
    };
  }

  componentWillReceiveProps(newProps:ColorSettingPropTypes) {
    this.setState({ value: Utils.rgbToHex(newProps.value) });
  }

  onColorChange = (evt: SyntheticInputEvent) => {
    this.props.onChange(Utils.hexToRgb(evt.target.value));
  }

  render() {
    return (
      <Row className="settings-row">
        <Col span={8}><span className="setting-label">{this.props.label}</span></Col>
        <Col span={16}>
          <input type="color" onChange={this.onColorChange} value={this.state.value} />
        </Col>
      </Row>
    );
  }
}

type DropdownSettingProps = {
  onChange: (value: number) => void,
  label: string,
  value: number,
  children?: Array<Select.Option>,
};

export class DropdownSetting extends React.PureComponent {
  props: DropdownSettingProps;

  render() {
    const { onChange, label, value, children } = this.props;
    return (
      <Row className="settings-row">
        <Col span={8}><span className="setting-label">{label}</span></Col>
        <Col span={16}>
          <Select onChange={onChange} value={value.toString()} defaultValue={value.toString()} >
            {children}
          </Select>
        </Col>
      </Row>
    );
  }
}

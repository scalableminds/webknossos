/**
 * setting_input_views.js
 * @flow
 */

 /* eslint-disable react/no-multi-comp */

import React from "react";
import Utils from "libs/utils";
import { Row, Col, Slider, InputNumber, Switch, Tooltip, Input, Select } from "antd";
import Model from "oxalis/model";
import type { Vector6 } from "oxalis/constants";

export function NumberSliderSetting({ onChange, value, label, max, min = 1, step = 1 }:{onChange: Function, value: number, label: string, max: number, min?: number, step?: number}) {
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
          value={value} onChange={onChange}
        />
      </Col>
    </Row>
  );
}

type LogSliderSettingProps = {
  onChange: Function,
  value: number,
  label: string,
  max: number,
  min: number,
};

const LOG_SLIDER_MIN = -100;
const LOG_SLIDER_MAX = 100;

export class LogSliderSetting extends React.Component {

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

export function SwitchSetting({ onChange, value, label }:{onChange: Function, value: boolean, label: string}) {
  return (
    <Row className="settings-row">
      <Col span={8}><span className="setting-label">{label}</span></Col>
      <Col span={16}>
        <Switch onChange={onChange} checked={value} defaultChecked={value} />
      </Col>
    </Row>
  );
}

export function NumberInputSetting({ onChange, value, label, max, min = 1, step = 1 }:{onChange: Function, value: number, label: string, max?: number, min?: number, step?: number}) {
  return (
    <Row className="settings-row">
      <Col span={8}><span className="setting-label">{label}</span></Col>
      <Col span={16}>
        <InputNumber min={min} max={max} onChange={onChange} value={value} step={step} />
      </Col>
    </Row>
  );
}

type BoundingBoxSettingPropTypes = {
  label: string,
  value: Vector6,
  onChange: Function,
};

export class BoundingBoxSetting extends React.Component {

  props: BoundingBoxSettingPropTypes;
  state: {
    isValid: boolean,
    text: string
  };

  constructor(props: BoundingBoxSettingPropTypes) {
    super(props);
    this.state = {
      isValid: true,
      text: props.value.join(", "),
    };
  }

  componentWillReceiveProps(newProps: BoundingBoxSettingPropTypes) {
    this.state = {
      isValid: true,
      text: newProps.value.join(", "),
    };
  }

  validate = (evt: SyntheticInputEvent) => {
    const text = evt.target.value;

    const isValidInput = new RegExp(/^[\d ,]+$/, "g").test(text);  // only allow numbers, spaces and comma as input
    const isValidFormat = new RegExp(/(\d+\s*,\s*){5}\d+/).test(text); // BB should look like 0,0,0,0,0,0

    if (isValidFormat) {
      // Width, height and depth of 0 should be allowed as a non-existing bounding box equals 0,0,0,0,0,0
      const boundingBox = Utils.stringToNumberArray(text);
      if (boundingBox[3] > 0 || boundingBox[4] > 0 || boundingBox[5] > 0) {
        this.props.onChange(boundingBox);
      }
    }

    this.setState(Object.assign({}, this.state, {
      text: isValidInput ? text : this.state.text,
      isValid: isValidFormat,
    }));
  };

  render() {
    const tooltipPrefix = this.state.isValid ? "" : "Invalid ";
    const tooltipTitle = `${tooltipPrefix} Format: minX, minY, minZ, width, height, depth`;
    const tooltipStyle = this.state.isValid ? null : { backgroundColor: "red" };

    return (
      <Row className="settings-row">
        <Col span={8}><span className="setting-label">{this.props.label}</span></Col>
        <Col span={16}>
          <Tooltip
            trigger={["focus"]}
            title={tooltipTitle}
            placement="topLeft"
            overlayStyle={tooltipStyle}
          >
            <Input onChange={this.validate} value={this.state.text} defaultValue={this.state.text} />
          </Tooltip>
        </Col>
      </Row>
    );
  }
}

type ColorSettingPropTypes = {
  // eslint-disable-next-line react/no-unused-prop-types
  value: Vector6,
  label: string,
  onChange: Function,
}


export class ColorSetting extends React.Component {
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

export function DropdownSetting({ onChange, label, value, children }:{ onChange: Function, label: string, value: number, children?: Array<Select.Option> }) {
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

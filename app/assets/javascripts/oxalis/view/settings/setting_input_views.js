import React from "react";
import { Row, Col, Slider, InputNumber, Switch, Tooltip, Input, Select } from "antd";
import Utils from "libs/utils";

export function NumberSliderSetting({ onChange, value, label, max, min = 1, step = 1 }) {
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

export function SwitchSetting({ onChange, value, label }) {
  return (
    <Row className="settings-row">
      <Col span={8}><span className="setting-label">{label}</span></Col>
      <Col span={16}>
        <Switch onChange={onChange} checked={value} defaultChecked={value} />
      </Col>
    </Row>
  );
}

export function NumberInputSetting({ onChange, value, label, max, min = 1, step = 1 }) {
  return (
    <Row className="settings-row">
      <Col span={8}><span className="setting-label">{label}</span></Col>
      <Col span={16}>
        <InputNumber min={min} max={max} onChange={onChange} value={value} step={step} />
      </Col>
    </Row>
  );
}

export class BoundingBoxSetting extends React.Component {

  state: {isValid: boolean, text: string};

  constructor(props) {
    super(props);
    this.state = {
      isValid: true,
      text: props.value.join(", "),
    };
  }

  componentWillReceiveProps(newProps) {
    this.state = {
      isValid: true,
      text: newProps.value.join(", "),
    };
  }

  validate = (evt) => {
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

/* eslint-disable react/no-multi-comp */
export class ColorSetting extends React.Component {
  state: {
    value: string;
  }

  constructor(props) {
    super(props);
    this.state = {
      value: "#000000",
    };
  }

  componentWillReceiveProps(newProps) {
    debugger
    this.setState({ value: Utils.rgbToHex(newProps.value) });
  }

  onColorChange = (evt) => {
    debugger
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

export function DropdownSetting({ onChange, label, value, children }) {
  debugger
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

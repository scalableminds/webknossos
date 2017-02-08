/**
 * tracing_settings_view.js
 * @flow
 */

import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import Utils from "libs/utils";
import Toast from "libs/toast";
import { updateSettingAction } from "oxalis/model/actions/settings_actions";
import { deleteActiveNodeAction } from "oxalis/model/actions/skeleton_actions";
import { Collapse, Row, Col, Slider, InputNumber, Switch, Button, Tooltip, Input } from "antd";

const Panel = Collapse.Panel;

function NumberSliderSetting({ onChange, value, label, max, min = 1, step = 1 }) {
  return (
    <Row className="settings-row">
      <Col span={8}>{label}</Col>
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

function SwitchSetting({ onChange, value, label }) {
  return (
    <Row className="settings-row">
      <Col span={8}>{label}</Col>
      <Col span={16}>
        <Switch onChange={onChange} defaultChecked={value} />
      </Col>
    </Row>
  );
}

function NumberInputSetting({ onChange, value, label, max, min = 1, step = 1 }) {
  return (
    <Row className="settings-row">
      <Col span={8}>{label}</Col>
      <Col span={16}>
        <InputNumber min={min} max={max} onChange={onChange} value={value} step={step} />
      </Col>
    </Row>
  );
}

class BoundingBoxSetting extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      isValid: true,
      text: props.value,
    };
  }
  state: {isValid: boolean, text: string};

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
        <Col span={8}>{this.props.label}</Col>
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

function ButtonSetting({ onClick, label }) {
  return (
    <Row className="settings-row">
      <Col span={24}>
        <Button onClick={onClick}>{label}</Button>
      </Col>
    </Row>
  );
}

class TracingSettingsView extends Component {

  render() {
    return (
      <Collapse defaultActiveKey={["1", "2", "3"]}>
        <Panel header="Trees" key="1">
          <NumberInputSetting label="Active Tree ID" max={5000} value={this.props.activeTreeId} onChange={_.partial(this.props.onChange, "activeTreeId")} />
          <SwitchSetting label="Soma Clicking" value={this.props.somaClickingAllowed} onChange={_.partial(this.props.onChange, "somaClickingAllowed")} />
        </Panel>
        <Panel header="Nodes" key="2">
          <NumberInputSetting label="Active Node ID" max={5000} value={this.props.activeNodeId} onChange={_.partial(this.props.onChange, "activeNodeId")} />
          <NumberSliderSetting label="Radius" max={5000} value={this.props.radius} onChange={_.partial(this.props.onChange, "radius")} />
          <NumberSliderSetting label="Particle Size" max={20} step={0.1} value={this.props.particleSize} onChange={_.partial(this.props.onChange, "particleSize")} />
          <SwitchSetting label="Override Radius" value={this.props.overrideNodeRadius} onChange={_.partial(this.props.onChange, "overrideNodeRadius")} />
          <ButtonSetting label="Delete Active Node" onClick={this.props.handleDeleteActiveNode} />
        </Panel>
        <Panel header="Bounding Box" key="3">
          <BoundingBoxSetting label="Bounding Box" value={this.props.boundingBox} onChange={_.partial(this.props.onChange, "boundingBox")} />
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = state => (
  state
);

const mapDispatchToProps = dispatch => ({
  onChange(propertyName, value) { dispatch(updateSettingAction(propertyName, value)); },
  handleDeleteActiveNode() { dispatch(deleteActiveNodeAction); },
});

export default connect(mapStateToProps, mapDispatchToProps)(TracingSettingsView);

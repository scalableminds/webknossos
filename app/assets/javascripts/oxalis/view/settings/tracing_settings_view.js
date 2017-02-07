import _ from "lodash";
import React, { Component } from "react";
import { Collapse, Row, Col, Slider, InputNumber, Switch, Number, Button } from "antd";

const Panel = Collapse.Panel;

function NumberSliderSetting({onChange, value, label, max, min=1, step=1}) {
  return (
    <Row>
      <Col span={8}>{label}</Col>
      <Col span={8}>
        <Slider min={min} max={max} onChange={onChange} value={value} step={step}/>
      </Col>
      <Col span={6}>
        <InputNumber min={min} max={max} style={{ marginLeft: 16 }}
          value={value} onChange={onChange}
        />
      </Col>
    </Row>
  );
}

function SwitchSetting({onChange, value, label}) {
  return (
    <Row>
      <Col span={8}>{label}</Col>
      <Col span={16}>
        <Switch onChange={onChange} defaultChecked={value} />
      </Col>
    </Row>
  );
}

function NumberInputSetting({onChange, value, label, max, min=1, step=1}) {
  return (
    <Row gutter={16}>
      <Col span={8}>{label}</Col>
      <Col span={16}>
        <InputNumber min={min} max={max} onChange={onChange} value={value} step={step}/>
      </Col>
    </Row>
  );
}

function ButtonSetting({onClick, value, label}) {
  return (
    <Row>
      <Col span={24}>
        <Button onClick={onClick}>{label}</Button>
      </Col>
    </Row>
  );
}

class TracingSettingsView extends Component {

  // intital state should come from store
  state = {
    radius: 1, // this.props.settingsState...
    overrideNodeRadius: true,
    particleSize: 1,
    activeNodeId: 0,
    somaClickingAllowed: false,
    boundingBox: [],
  };

  onChange = (propertyName, value) => {
    // this.dispatch(action.updateRadius)
    const newState = Object.assign({}, this.state, {
      [propertyName]: value,
    });
    this.setState(newState);
  }

  handleDeleteActiveNode = () => {
    this.dispatch(action.deleteActiveNode);
  }

  render () {
    return(
      <Collapse defaultActiveKey={['1', '2', '3']}>
        <Panel header="Trees" key="1">
          <NumberInputSetting label="Active Node ID" max={5000} value={this.state.activeNodeId} onChange={_.partial(this.onChange, "activeNodeId")} />
          <SwitchSetting label="Soma Clicking" value={this.state.somaClickingAllowed} onChange={_.partial(this.onChange, "somaClickingAllowed")} />
        </Panel>
        <Panel header="Nodes" key="2">
          <NumberInputSetting label="Active Node ID" max={5000} value={this.state.activeNodeId} onChange={_.partial(this.onChange, "activeNodeId")} />
          <NumberSliderSetting label="Radius" max={5000} value={this.state.radius} onChange={_.partial(this.onChange, "radius")} />
          <NumberSliderSetting label="Particle Size" max={20} step={0.1} value={this.state.particleSize} onChange={_.partial(this.onChange, "particleSize")} />
          <SwitchSetting label="Override Radius" value={this.state.overrideNodeRadius} onChange={_.partial(this.onChange, "overrideNodeRadius")} />
          <ButtonSetting label="Delete Active Node" onClick={this.handleDeleteActiveNode} />
        </Panel>
        <Panel header="Bounding Box" key="3">
        </Panel>
      </Collapse>
    );
  }
};

export default TracingSettingsView;

import _ from "lodash";
import React, { Component } from "react";
import { Collapse, Row, Col, Slider, InputNumber } from "antd";

const Panel = Collapse.Panel;


function NumberSlider({onChange, value, label, max, min=1}) {
  return (
    <Row>
      <Col span={8}>{label}</Col>
      <Col span={8}>
        <Slider min={min} max={max} onChange={onChange} value={value} />
      </Col>
      <Col span={6}>
        <InputNumber min={1} max={20} style={{ marginLeft: 16 }}
          value={value} onChange={onChange}
        />
      </Col>
    </Row>
  );
}

class TracingSettingsView extends Component {

  state = {
    radius: 1, // this.props.settingsState...
  };

  onChange = (propertyName, value) => {
    // this.dispatch(action.updateRadius)
    this.setState({
      [propertyName]: value,
    });
  }

  render () {
    return(
      <Collapse defaultActiveKey={['1', '2', '3']}>
        <Panel header="Trees" key="1">
        </Panel>
        <Panel header="Nodes" key="2">
          <NumberSlider label="Radius" max={5000} value={this.state.radius}  onChange={_.partial(this.onChange, "radius")} />
        </Panel>
        <Panel header="Bounding Box" key="3">
        </Panel>
      </Collapse>
    );
  }
};

export default TracingSettingsView;

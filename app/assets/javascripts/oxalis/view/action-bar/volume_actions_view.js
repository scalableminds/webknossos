// @flow
import React, { PureComponent } from "react";
import { connect } from "react-redux";
import type { VolumeToolType } from "oxalis/constants";
import type { OxalisState, VolumeTracingType } from "oxalis/store";
import { VolumeToolEnum } from "oxalis/constants";
import Store from "oxalis/store";
import { setToolAction, createCellAction } from "oxalis/model/actions/volumetracing_actions";
import { Button, Radio } from "antd";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import ButtonComponent from "oxalis/view/components/button_component";

// Workaround until github.com/facebook/flow/issues/1113 is fixed
const RadioGroup = Radio.Group;
const RadioButton = Radio.Button;
const ButtonGroup = Button.Group;

type Props = {
  volumeTracing: VolumeTracingType,
};

class VolumeActionsView extends PureComponent<Props> {
  handleSetTool = (event: { target: { value: VolumeToolType } }) => {
    Store.dispatch(setToolAction(event.target.value));
  };

  handleCreateCell = () => {
    Store.dispatch(createCellAction());
  };

  render() {
    return (
      <div>
        <RadioGroup
          onChange={this.handleSetTool}
          value={this.props.volumeTracing.activeTool}
          style={{ marginRight: 10 }}
        >
          <RadioButton value={VolumeToolEnum.MOVE}>Move</RadioButton>
          <RadioButton value={VolumeToolEnum.TRACE}>Trace</RadioButton>
          <RadioButton value={VolumeToolEnum.BRUSH}>Brush</RadioButton>
        </RadioGroup>
        <ButtonGroup>
          <ButtonComponent onClick={this.handleCreateCell}>Create new cell (C)</ButtonComponent>
        </ButtonGroup>
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    volumeTracing: enforceVolumeTracing(state.tracing),
  };
}

export default connect(mapStateToProps)(VolumeActionsView);

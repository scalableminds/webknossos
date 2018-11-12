// @flow
import { Button, Radio } from "antd";
import { connect } from "react-redux";
import React, { PureComponent } from "react";

import { type VolumeTool, VolumeToolEnum } from "oxalis/constants";
import { document } from "libs/window";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setToolAction, createCellAction } from "oxalis/model/actions/volumetracing_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import Store, { type OxalisState, type VolumeTracing } from "oxalis/store";

// Workaround until github.com/facebook/flow/issues/1113 is fixed
const RadioGroup = Radio.Group;
const RadioButton = Radio.Button;
const ButtonGroup = Button.Group;

type Props = {
  volumeTracing: VolumeTracing,
};

class VolumeActionsView extends PureComponent<Props> {
  handleSetTool = (event: { target: { value: VolumeTool } }) => {
    Store.dispatch(setToolAction(event.target.value));
  };

  handleCreateCell = () => {
    Store.dispatch(createCellAction());
  };

  render() {
    return (
      <div
        onClick={() => {
          if (document.activeElement) document.activeElement.blur();
        }}
      >
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

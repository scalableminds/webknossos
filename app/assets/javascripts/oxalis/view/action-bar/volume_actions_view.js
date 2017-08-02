// @flow
import React, { PureComponent } from "react";
import { connect } from "react-redux";
import type { VolumeTraceOrMoveModeType } from "oxalis/constants";
import type { OxalisState, VolumeTracingType } from "oxalis/store";
import Constants from "oxalis/constants";
import Store from "oxalis/store";
import { setModeAction, createCellAction } from "oxalis/model/actions/volumetracing_actions";
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

class VolumeActionsView extends PureComponent {
  props: Props;

  handleSetMode = (event: { target: { value: VolumeTraceOrMoveModeType } }) => {
    Store.dispatch(setModeAction(
      event.target.value,
    ));
  }

  handleCreateCell = () => {
    Store.dispatch(createCellAction());
  }

  render() {
    return (
      <div>
        <RadioGroup
          onChange={this.handleSetMode}
          value={this.props.volumeTracing.volumeTraceOrMoveMode}
          style={{ marginRight: 10 }}
          size="large"
        >
          <RadioButton value={Constants.VOLUME_MODE_MOVE}>Move</RadioButton>
          <RadioButton value={Constants.VOLUME_MODE_TRACE}>Trace</RadioButton>
        </RadioGroup>
        <ButtonGroup size="large">
          <ButtonComponent
            onClick={this.handleCreateCell}
          >Create new cell (C)</ButtonComponent>
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

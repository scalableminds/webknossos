// @flow
import React, { PureComponent } from "react";
import { connect } from "react-redux";
import type { VolumeModeType } from "oxalis/constants";
import type { OxalisState, VolumeTracingType } from "oxalis/store";
import Constants from "oxalis/constants";
import Store from "oxalis/store";
import { setModeAction, createCellAction } from "oxalis/model/actions/volumetracing_actions";
import { Button, Radio } from "antd";

class VolumeActionsView extends PureComponent {
  props: {
    volumeTracing: VolumeTracingType,
  };

  handleSetMode = (event: { target: { value: VolumeModeType } }) => {
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
        <Radio.Group
          onChange={this.handleSetMode}
          value={this.props.volumeTracing.viewMode}
          style={{ marginRight: 10 }}
        >
          <Radio.Button value={Constants.VOLUME_MODE_MOVE}>Move</Radio.Button>
          <Radio.Button value={Constants.VOLUME_MODE_TRACE}>Trace</Radio.Button>
        </Radio.Group>
        <Button.Group>
          <Button
            onClick={this.handleCreateCell}
          >Create new cell (C)</Button>
        </Button.Group>
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    volumeTracing: state.tracing,
  };
}

export default connect(mapStateToProps)(VolumeActionsView);

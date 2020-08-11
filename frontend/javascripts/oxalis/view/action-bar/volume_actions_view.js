// @flow
import { Button, Radio, Tooltip } from "antd";
import { connect } from "react-redux";
import React, { PureComponent } from "react";

import { type VolumeTool, VolumeToolEnum } from "oxalis/constants";
import { document } from "libs/window";
import {
  enforceVolumeTracing,
  isVolumeTraceToolDisallowed,
} from "oxalis/model/accessors/volumetracing_accessor";
import { setToolAction, createCellAction } from "oxalis/model/actions/volumetracing_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import Store, { type OxalisState } from "oxalis/store";

// Workaround until github.com/facebook/flow/issues/1113 is fixed
const RadioGroup = Radio.Group;
const RadioButton = Radio.Button;
const ButtonGroup = Button.Group;

type Props = {|
  activeTool: VolumeTool,
  // This component should be updated when the zoom changes.
  // eslint-disable-next-line react/no-unused-prop-types
  zoomStep: number,
|};

const isZoomStepTooHighForTraceTool = () => isVolumeTraceToolDisallowed(Store.getState());

class VolumeActionsView extends PureComponent<Props> {
  handleSetTool = (event: { target: { value: VolumeTool } }) => {
    Store.dispatch(setToolAction(event.target.value));
  };

  handleCreateCell = () => {
    Store.dispatch(createCellAction());
  };

  render() {
    const isTraceToolDisabled = isZoomStepTooHighForTraceTool();
    const traceToolDisabledTooltip = isTraceToolDisabled
      ? "Your zoom is low to use the trace tool. Please zoom in further to use it."
      : "";
    // TOO unfiy this with the dataset position view.
    const maybeErrorColorForTraceTool = isTraceToolDisabled
      ? { color: "rgb(255, 155, 85)", borderColor: "rgb(241, 122, 39)" }
      : {};
    return (
      <div
        onClick={() => {
          if (document.activeElement) document.activeElement.blur();
        }}
      >
        <RadioGroup
          onChange={this.handleSetTool}
          value={this.props.activeTool}
          style={{ marginRight: 10 }}
        >
          <RadioButton value={VolumeToolEnum.MOVE}>Move</RadioButton>
          <Tooltip title={traceToolDisabledTooltip}>
            <RadioButton
              value={VolumeToolEnum.TRACE}
              disabled={isTraceToolDisabled}
              style={maybeErrorColorForTraceTool}
            >
              Trace
            </RadioButton>
          </Tooltip>
          <RadioButton value={VolumeToolEnum.BRUSH}>Brush</RadioButton>
        </RadioGroup>
        <ButtonGroup>
          <ButtonComponent onClick={this.handleCreateCell}>
            New&nbsp;
            <span style={{ textDecoration: "underline" }}>C</span>ell
          </ButtonComponent>
        </ButtonGroup>
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    activeTool: enforceVolumeTracing(state.tracing).activeTool,
    zoomStep: state.flycam.zoomStep,
  };
}

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(VolumeActionsView);

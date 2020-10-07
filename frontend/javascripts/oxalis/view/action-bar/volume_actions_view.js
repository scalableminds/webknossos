// @flow
import { Button, Radio, Tooltip } from "antd";
import { connect } from "react-redux";
import React, { PureComponent } from "react";

import { type VolumeTool, VolumeToolEnum, type Vector3 } from "oxalis/constants";
import { document } from "libs/window";
import {
  enforceVolumeTracing,
  isVolumeTraceToolDisallowed,
} from "oxalis/model/accessors/volumetracing_accessor";
import { setToolAction, createCellAction } from "oxalis/model/actions/volumetracing_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import { getRenderableResolutionForSegmentation } from "oxalis/model/accessors/dataset_accessor";
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
  isInMergerMode: boolean,
  labeledResolution: ?Vector3,
|};

const isZoomStepTooHighForTraceTool = () => isVolumeTraceToolDisallowed(Store.getState());

class VolumeActionsView extends PureComponent<Props> {
  componentDidUpdate = (prevProps: Props) => {
    if (!prevProps.isInMergerMode && this.props.isInMergerMode) {
      Store.dispatch(setToolAction(VolumeToolEnum.MOVE));
    }
  };

  handleSetTool = (event: { target: { value: VolumeTool } }) => {
    Store.dispatch(setToolAction(event.target.value));
  };

  handleCreateCell = () => {
    Store.dispatch(createCellAction());
  };

  render() {
    const { activeTool, labeledResolution, isInMergerMode } = this.props;
    const isLabelingPossible = labeledResolution != null;
    const hasResolutionWithHigherDimension = (labeledResolution || []).some(val => val > 1);
    const multiSliceAnnotationInfoIcon = hasResolutionWithHigherDimension ? (
      <Tooltip title="You are annotating in a low resolution. Depending on the used viewport, you might be annotating multiple slices at once.">
        <i className="fas fa-layer-group" />
      </Tooltip>
    ) : null;
    const isTraceToolDisabled = isZoomStepTooHighForTraceTool();
    const traceToolDisabledTooltip = isTraceToolDisabled
      ? "Your zoom is too low to use the trace tool. Please zoom in further to use it."
      : "";

    return (
      <div
        onClick={() => {
          if (document.activeElement) document.activeElement.blur();
        }}
      >
        <RadioGroup onChange={this.handleSetTool} value={activeTool} style={{ marginRight: 10 }}>
          <RadioButton value={VolumeToolEnum.MOVE}>Move</RadioButton>

          <Tooltip
            title={
              isInMergerMode ? "Volume annotation is disabled while the merger mode is active." : ""
            }
          >
            <Tooltip title={traceToolDisabledTooltip}>
              <RadioButton
                value={VolumeToolEnum.TRACE}
                disabled={isInMergerMode || isTraceToolDisabled || !isLabelingPossible}
              >
                Trace {activeTool === "TRACE" ? multiSliceAnnotationInfoIcon : null}
              </RadioButton>
            </Tooltip>
            <RadioButton
              value={VolumeToolEnum.BRUSH}
              disabled={isInMergerMode || !isLabelingPossible}
            >
              Brush {activeTool === "BRUSH" ? multiSliceAnnotationInfoIcon : null}
            </RadioButton>
          </Tooltip>
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
  const maybeResolutionWithZoomStep = getRenderableResolutionForSegmentation(state);
  const labeledResolution =
    maybeResolutionWithZoomStep != null ? maybeResolutionWithZoomStep.resolution : null;
  return {
    activeTool: enforceVolumeTracing(state.tracing).activeTool,
    zoomStep: state.flycam.zoomStep,
    isInMergerMode: state.temporaryConfiguration.isMergerModeEnabled,
    labeledResolution,
  };
}

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(VolumeActionsView);

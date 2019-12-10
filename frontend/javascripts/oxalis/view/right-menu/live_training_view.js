/**
 * live_training_view.js
 * @flow
 */
import type { Dispatch } from "redux";
import { Radio, Button, Progress } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import debounceRender from "react-debounce-render";
import Store from "oxalis/store";
import { setLiveTrainingProgressAction } from "oxalis/model/actions/ui_actions";
import type { OxalisState } from "oxalis/store";
import { trainClassifierAction, predictAction } from "oxalis/model/actions/blackbird_actions";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";

type OwnProps = {|
  portalKey: string,
|};
type StateProps = {|
  activeCellId: number,
  liveTrainingProgress: number,
|};
type DispatchProps = {|
  onChangeActiveCellId: number => void,
  handlePredict: void => void,
  handleTrain: void => void,
|};
type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};

type State = {
  isRetraining: boolean,
};

class LiveTrainingView extends React.Component<Props, State> {
  isMounted: boolean = false;

  state = {
    isRetraining: false,
  };

  componentDidMount() {
    this.isMounted = true;
  }

  componentWillUnmount() {
    this.isMounted = false;
  }

  handleChangeLabel = changeEvent => {
    this.props.onChangeActiveCellId(changeEvent.target.value);
  };

  render() {
    const { activeCellId, liveTrainingProgress } = this.props;
    return (
      <div id="live-training" className="padded-tab-content" style={{ maxWidth: 500 }}>
        <div style={{ marginBottom: 6 }}>
          <label className="setting-label">
            Brush to label…
            <Radio.Group
              value={activeCellId}
              onChange={this.handleChangeLabel}
              style={{ marginLeft: 6 }}
            >
              <Radio.Button value={1}>Foreground</Radio.Button>
              <Radio.Button value={2}>Background</Radio.Button>
            </Radio.Group>
          </label>
        </div>

        <Button
          type="primary"
          onClick={() => {
            Store.dispatch(setLiveTrainingProgressAction(0));
            this.props.handleTrain();
            this.props.handlePredict();
          }}
        >
          Retrain and Predict
        </Button>
        <div style={{ display: "block", marginTop: 6 }}>
          <Progress type="circle" percent={liveTrainingProgress} />
        </div>
      </div>
    );

    // train + predict button
  }
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  handleTrain() {
    dispatch(trainClassifierAction());
  },

  handlePredict() {
    dispatch(predictAction());
  },
  onChangeActiveCellId(id: number) {
    dispatch(setActiveCellAction(id));
  },
});

function mapStateToProps(state: OxalisState) {
  return {
    activeCellId: getVolumeTracing(state.tracing)
      .map(tracing => tracing.activeCellId)
      .getOrElse(0),
    liveTrainingProgress: state.uiInformation.liveTrainingProgress,
  };
}

const debounceTime = 100;
export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
  null,
  {
    pure: false,
  },
)(debounceRender(LiveTrainingView, debounceTime));

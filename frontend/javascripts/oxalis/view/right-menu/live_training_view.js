/**
 * live_training_view.js
 * @flow
 */
import type { Dispatch } from "redux";
import { Radio, Button, Icon } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
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
  isLiveTrainingPredicting: boolean,
|};
type DispatchProps = {|
  onChangeActiveCellId: number => void,
  handlePredict: void => void,
  handleTrain: void => void,
|};
type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};

type State = {};

class LiveTrainingView extends React.Component<Props, State> {
  isMounted: boolean = false;

  state = {};

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
    const { activeCellId, liveTrainingProgress, isLiveTrainingPredicting } = this.props;
    const isTraining = liveTrainingProgress > 0 && liveTrainingProgress < 100;
    return (
      <div id="live-training" className="padded-tab-content">
        <div style={{ margin: 6, position: "absolute", right: 10, top: 10 }}>
          <Radio.Group value={activeCellId} onChange={this.handleChangeLabel} style={{}}>
            <Radio.Button value={1}>Foreground</Radio.Button>
            <Radio.Button value={2}>Background</Radio.Button>
          </Radio.Group>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: 50,
          }}
        >
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Icon
              type="experiment"
              style={{
                fontSize: 46,
                height: 80,
                width: 80,
                padding: 15,
                margin: "16px 0px",
                color: "rgb(241, 248, 253)",
                backgroundColor: "rgb(24, 144, 255)",
                borderRadius: "100%",
              }}
            />
          </div>
          <ol>
            <li>Lorem Ipsum is simply dummy text of the printing and typesetting industry.</li>
            <li>Lorem Ipsum is simply dummy text of the printing and typesetting industry.</li>
            <li>Lorem Ipsum is simply dummy text of the printing and typesetting industry.</li>
          </ol>
          <div style={{ marginTop: 16, marginLeft: 6, display: "flex", justifyContent: "center" }}>
            <Button
              type="primary"
              disabled={isTraining || isLiveTrainingPredicting}
              loading={isTraining}
              size="large"
              onClick={() => {
                this.props.handleTrain();
              }}
            >
              Retrain and Predict {isTraining ? `(${liveTrainingProgress}%)` : null}
            </Button>
            <Button
              disabled={isTraining || isLiveTrainingPredicting}
              loading={isLiveTrainingPredicting}
              style={{ marginLeft: 24 }}
              size="large"
              onClick={() => {
                this.props.handlePredict();
              }}
            >
              Predict
            </Button>
          </div>
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
    isLiveTrainingPredicting: state.uiInformation.isLiveTrainingPredicting,
  };
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
  null,
  {
    pure: false,
  },
)(LiveTrainingView);

// @flow
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import type { OxalisState, ProgressInfo, IsBusyInfo } from "oxalis/store";
import { isBusy } from "oxalis/model/accessors/save_accessor";
import ButtonComponent from "oxalis/view/components/button_component";
import Model from "oxalis/model";
import window from "libs/window";
import { Tooltip, Icon } from "antd";
import ErrorHandling from "libs/error_handling";

type OwnProps = {|
  onClick: (SyntheticInputEvent<HTMLButtonElement>) => Promise<*>,
  className?: string,
|};
type StateProps = {|
  progressInfo: ProgressInfo,
  isBusyInfo: IsBusyInfo,
  oldestUnsavedTimestamp: ?number,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  isStateSaved: boolean,
  currentTimestamp: number,
};

const SAVE_POLLING_INTERVAL = 1000; // 1s
const UNSAVED_WARNING_THRESHOLD = 2 * 60 * 1000; // 2 min
const REPORT_THROTTLE_THRESHOLD = 10 * 60 * 1000; // 10 min

const reportUnsavedDurationThresholdExceeded = _.throttle(() => {
  ErrorHandling.notify(
    new Error(
      `Warning: Saving lag detected. Some changes are unsaved and older than ${Math.ceil(
        UNSAVED_WARNING_THRESHOLD / 1000 / 60,
      )} minutes.`,
    ),
  );
}, REPORT_THROTTLE_THRESHOLD);

class SaveButton extends React.PureComponent<Props, State> {
  savedPollingInterval: number = 0;
  state = {
    isStateSaved: false,
    currentTimestamp: Date.now(),
  };

  componentDidMount() {
    // Polling can be removed once VolumeMode saving is reactive
    this.savedPollingInterval = window.setInterval(this._forceUpdate, SAVE_POLLING_INTERVAL);
  }

  componentWillUnmount() {
    window.clearInterval(this.savedPollingInterval);
  }

  _forceUpdate = () => {
    const isStateSaved = Model.stateSaved();
    this.setState({
      isStateSaved,
      currentTimestamp: Date.now(),
    });
  };

  getSaveButtonIcon() {
    if (this.state.isStateSaved) {
      return "check";
    } else if (isBusy(this.props.isBusyInfo)) {
      return "loading";
    } else {
      return "hourglass";
    }
  }

  shouldShowProgress(): boolean {
    // For a low action count, the progress info would show only for a very short amount of time
    return isBusy(this.props.isBusyInfo) && this.props.progressInfo.totalActionCount > 5000;
  }

  render() {
    const { progressInfo, oldestUnsavedTimestamp } = this.props;
    const unsavedDuration =
      oldestUnsavedTimestamp != null ? this.state.currentTimestamp - oldestUnsavedTimestamp : 0;
    const showUnsavedWarning = unsavedDuration > UNSAVED_WARNING_THRESHOLD;
    if (showUnsavedWarning) {
      reportUnsavedDurationThresholdExceeded();
    }

    return (
      <ButtonComponent
        key="save-button"
        type="primary"
        onClick={this.props.onClick}
        icon={this.getSaveButtonIcon()}
        className={this.props.className}
        style={{ background: showUnsavedWarning ? "#e33f36" : null }}
      >
        {this.shouldShowProgress() ? (
          <span style={{ marginLeft: 8 }}>
            {Math.floor((progressInfo.processedActionCount / progressInfo.totalActionCount) * 100)}{" "}
            %
          </span>
        ) : (
          <span className="hide-on-small-screen">Save</span>
        )}
        {showUnsavedWarning ? (
          <Tooltip
            visible
            title={`There are unsaved changes which are older than ${Math.ceil(
              UNSAVED_WARNING_THRESHOLD / 1000 / 60,
            )} minutes. Please ensure that your Internet connection works and wait until this warning disappears.`}
            placement="bottom"
          >
            <Icon type="exclamation-circle" />
          </Tooltip>
        ) : null}
      </ButtonComponent>
    );
  }
}

function getOldestUnsavedTimestamp(saveQueue): ?number {
  let oldestUnsavedTimestamp;
  if (saveQueue.skeleton.length > 0) {
    oldestUnsavedTimestamp = saveQueue.skeleton[0].timestamp;
  }
  if (saveQueue.volume.length > 0) {
    const oldestVolumeTimestamp = saveQueue.volume[0].timestamp;
    oldestUnsavedTimestamp = Math.min(
      oldestUnsavedTimestamp != null ? oldestUnsavedTimestamp : Infinity,
      oldestVolumeTimestamp,
    );
  }
  return oldestUnsavedTimestamp;
}

function mapStateToProps(state: OxalisState): StateProps {
  const { progressInfo, isBusyInfo } = state.save;
  const oldestUnsavedTimestamp = getOldestUnsavedTimestamp(state.save.queue);

  return {
    progressInfo,
    isBusyInfo,
    oldestUnsavedTimestamp,
  };
}

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(SaveButton);

// @flow
import { connect } from "react-redux";
import React from "react";

import type { OxalisState, ProgressInfo, IsBusyInfo } from "oxalis/store";
import { isBusy } from "oxalis/model/accessors/save_accessor";
import ButtonComponent from "oxalis/view/components/button_component";
import Model from "oxalis/model";
import window from "libs/window";

type OwnProps = {|
  onClick: (SyntheticInputEvent<HTMLButtonElement>) => Promise<*>,
  className?: string,
|};
type StateProps = {|
  progressInfo: ProgressInfo,
  isBusyInfo: IsBusyInfo,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  isStateSaved: boolean,
};

const SAVE_POLLING_INTERVAL = 1000;

class SaveButton extends React.PureComponent<Props, State> {
  state = {
    isStateSaved: false,
  };

  componentDidMount() {
    // Polling can be removed once VolumeMode saving is reactive
    this.savedPollingInterval = window.setInterval(this._forceUpdate, SAVE_POLLING_INTERVAL);
  }

  componentWillUnmount() {
    window.clearInterval(this.savedPollingInterval);
  }

  savedPollingInterval: number = 0;
  _forceUpdate = () => {
    const isStateSaved = Model.stateSaved();
    this.setState({
      isStateSaved,
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
    const { progressInfo } = this.props;
    return (
      <ButtonComponent
        key="save-button"
        type="primary"
        onClick={this.props.onClick}
        icon={this.getSaveButtonIcon()}
        className={this.props.className}
      >
        {this.shouldShowProgress() ? (
          <span style={{ marginLeft: 8 }}>
            >{Math.floor((progressInfo.processedActionCount / progressInfo.totalActionCount) * 100)}{" "}
            %
          </span>
        ) : (
          <span className="hide-on-small-screen">Save</span>
        )}
      </ButtonComponent>
    );
  }
}

function mapStateToProps(state: OxalisState): StateProps {
  const { progressInfo, isBusyInfo } = state.save;
  return {
    progressInfo,
    isBusyInfo,
  };
}

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(SaveButton);

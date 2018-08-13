// @flow
import React from "react";
import { connect } from "react-redux";
import Model from "oxalis/model";
import ButtonComponent from "oxalis/view/components/button_component";
import { isBusy } from "oxalis/model/accessors/save_accessor";
import type { OxalisState, ProgressInfoType, IsBusyInfoType } from "oxalis/store";

type StateProps = {|
  progressInfo: ProgressInfoType,
  isBusyInfo: IsBusyInfoType,
|};

type Props = {
  ...StateProps,
  onClick: (SyntheticInputEvent<HTMLButtonElement>) => Promise<*>,
};

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
      >
        {this.shouldShowProgress() ? (
          <React.Fragment>
            {Math.floor((progressInfo.processedActionCount / progressInfo.totalActionCount) * 100)}{" "}
            %
          </React.Fragment>
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

export default connect(mapStateToProps)(SaveButton);

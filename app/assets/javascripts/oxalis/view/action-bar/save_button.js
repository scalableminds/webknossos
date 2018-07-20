// @flow
import React from "react";
import { connect } from "react-redux";
import Model from "oxalis/model";
import ButtonComponent from "oxalis/view/components/button_component";
import type { OxalisState, ProgressInfoType } from "oxalis/store";

type StateProps = {|
  progressInfo: ProgressInfoType,
  isBusy: boolean,
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
    } else {
      return "hourglass";
    }
  }

  render() {
    const { progressInfo } = this.props;
    console.log("progressInfo", progressInfo);
    return (
      <ButtonComponent
        key="save-button"
        type="primary"
        onClick={this.props.onClick}
        icon={this.getSaveButtonIcon()}
      >
        {this.props.isBusy && progressInfo.totalActionCount > 5000 ? (
          <React.Fragment>
            {Math.floor((progressInfo.processedActionCount / progressInfo.totalActionCount) * 100)}{" "}
            %
          </React.Fragment>
        ) : (
          <React.Fragment>Save</React.Fragment>
        )}
      </ButtonComponent>
    );
  }
}

function mapStateToProps(state: OxalisState): StateProps {
  const { progressInfo, isBusy } = state.save;
  return {
    progressInfo,
    isBusy,
  };
}

export default connect(mapStateToProps)(SaveButton);

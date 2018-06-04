// @flow
import React from "react";
import Model from "oxalis/model";
import ButtonComponent from "oxalis/view/components/button_component";

type Props = {
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
    this.setState({ isStateSaved: Model.stateSaved() });
  };

  getSaveButtonIcon() {
    if (this.state.isStateSaved) {
      return "check";
    } else {
      return "hourglass";
    }
  }

  render() {
    return (
      <ButtonComponent
        key="save-button"
        type="primary"
        onClick={this.props.onClick}
        icon={this.getSaveButtonIcon()}
      >
        <span className="hide-on-small-screen">Save</span>
      </ButtonComponent>
    );
  }
}

export default SaveButton;

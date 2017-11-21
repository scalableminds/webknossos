// @flow
import React from "react";
import Model from "oxalis/model";
import ButtonComponent from "oxalis/view/components/button_component";

type Props = {
  onClick: (SyntheticInputEvent<HTMLButtonElement>) => Promise<*>,
};

const SAVED_POLLING_INTERVAL = 100;

class SaveButton extends React.PureComponent<Props> {
  componentDidMount() {
    // Polling can be removed once VolumeMode saving is reactive
    this.savedPollingInterval = window.setInterval(this._forceUpdate, SAVED_POLLING_INTERVAL);
  }

  componentWillUnmount() {
    window.clearInterval(this.savedPollingInterval);
  }

  savedPollingInterval: number = 0;
  _forceUpdate = () => {
    this.forceUpdate();
  };

  getSaveButtonIcon() {
    if (!Model.stateSaved()) {
      return "hourglass";
    } else {
      return "check";
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
        Save
      </ButtonComponent>
    );
  }
}

export default SaveButton;

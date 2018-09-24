// @flow

import * as React from "react";
import Store from "oxalis/store";
import { Modal, Checkbox } from "antd";
import messages from "messages";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";

type Props = {
  onOk: Function,
};

type State = {
  shouldNotWarnAgain: boolean,
  visible: boolean,
};

export default class TreeRemovalModal extends React.Component<Props, State> {
  state = {
    shouldNotWarnAgain: false,
    visible: true,
  };

  handleCheckboxChange = (event: SyntheticInputEvent<>) => {
    this.setState({ shouldNotWarnAgain: event.target.checked });
  };

  hide = () => {
    this.setState({ visible: false });
  };

  handleOk = () => {
    Store.dispatch(
      updateUserSettingAction("hideTreeRemovalWarning", this.state.shouldNotWarnAgain),
    );
    this.hide();
    this.props.onOk();
  };

  render() {
    return (
      <Modal
        title={messages["tracing.delete_tree"]}
        onOk={this.handleOk}
        onCancel={this.hide}
        visible={this.state.visible}
      >
        <Checkbox onChange={this.handleCheckboxChange} checked={this.state.shouldNotWarnAgain}>
          Do not warn me again. (Remember, accidentally deleted trees can always be restored using
          the Undo functionality (Ctrl/Cmd + Z)).
        </Checkbox>
      </Modal>
    );
  }
}

import { Checkbox, Modal } from "antd";
import type { CheckboxChangeEvent } from "antd/lib/checkbox";
import messages from "messages";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Store from "oxalis/store";
import * as React from "react";
type Props = {
  onOk: (...args: Array<any>) => any;
  destroy?: (...args: Array<any>) => any;
};
type State = {
  shouldNotWarnAgain: boolean;
  isOpen: boolean;
};
export default class TreeRemovalModal extends React.Component<Props, State> {
  state = {
    shouldNotWarnAgain: false,
    isOpen: true,
  };

  handleCheckboxChange = (event: CheckboxChangeEvent) => {
    this.setState({
      shouldNotWarnAgain: event.target.checked,
    });
  };

  hide = () => {
    this.setState({
      isOpen: false,
    });
    if (this.props.destroy) this.props.destroy();
  };

  handleOk = () => {
    Store.dispatch(
      updateUserSettingAction("hideTreeRemovalWarning", this.state.shouldNotWarnAgain),
    );
    this.props.onOk();
    this.hide();
  };

  render() {
    return (
      <Modal
        title={messages["tracing.delete_tree"]}
        onOk={this.handleOk}
        onCancel={this.hide}
        open={this.state.isOpen}
      >
        <Checkbox onChange={this.handleCheckboxChange} checked={this.state.shouldNotWarnAgain}>
          Do not warn me again. (Remember, accidentally deleted trees can always be restored using
          the Undo functionality (Ctrl/Cmd + Z)).
        </Checkbox>
      </Modal>
    );
  }
}

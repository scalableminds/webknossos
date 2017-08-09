// @flow

/* eslint-disable no-eval, no-alert */
import React from "react";
import { Modal, Input } from "antd";

type UserScriptsModalViewPropsType = {
  onClose: Function,
  visible: boolean,
};

class UserScriptsModalView extends React.PureComponent {
  props: UserScriptsModalViewPropsType;

  state = {
    code: "",
  };

  handleCodeChange = (event: SyntheticInputEvent) => {
    this.setState({
      code: event.target.value,
    });
  };

  handleClick = () => {
    try {
      eval(this.state.code);
      // close modal if the script executed successfully
      return this.props.onClose();
    } catch (error) {
      console.error(error);
      return alert(error);
    }
  };

  render() {
    return (
      <Modal
        visible={this.props.visible}
        title="Add user script"
        okText="Add"
        cancelText="Close"
        onOk={this.handleClick}
        onCancel={this.props.onClose}
      >
        <Input type="textarea" rows={4} onChange={this.handleCodeChange} value={this.state.code} />
      </Modal>
    );
  }
}

export default UserScriptsModalView;

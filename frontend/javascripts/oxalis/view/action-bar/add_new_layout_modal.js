// @flow

import { Input, Modal } from "antd";
import * as React from "react";

type Props = {
  addLayout: string => void,
  visible: boolean,
  onCancel: () => void,
};

type State = {
  value: string,
};

class AddNewLayoutModal extends React.PureComponent<Props, State> {
  state = {
    value: "",
  };

  onConfirm = () => {
    const value = this.state.value;
    this.setState({ value: "" });
    this.props.addLayout(value);
  };

  render() {
    return (
      <Modal
        title="Add a new layout"
        visible={this.props.visible}
        onOk={this.onConfirm}
        onCancel={this.props.onCancel}
      >
        <Input
          placeholder="Layout Name"
          value={this.state.value}
          onChange={evt => {
            this.setState({ value: evt.target.value });
          }}
          autoFocus
          onPressEnter={this.onConfirm}
        />
      </Modal>
    );
  }
}

export default AddNewLayoutModal;

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

  render() {
    return (
      <Modal
        title="Add a new layout"
        visible={this.props.visible}
        onOk={() => {
          const value = this.state.value;
          this.setState({ value: "" });
          this.props.addLayout(value);
        }}
        onCancel={this.props.onCancel}
      >
        <Input
          placeholder="Layout Name"
          value={this.state.value}
          onChange={evt => {
            this.setState({ value: evt.target.value });
          }}
        />
      </Modal>
    );
  }
}

export default AddNewLayoutModal;

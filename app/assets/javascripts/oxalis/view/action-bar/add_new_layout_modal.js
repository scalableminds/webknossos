// @flow

import * as React from "react";
import { Input, Modal } from "antd";

type Props = {
  addLayout: string => void,
};

type State = {
  visible: boolean,
  value: string,
};

class AddNewLayoutModal extends React.PureComponent<Props, State> {
  state = {
    visible: false,
  };

  render() {
    return (
      <Modal
        title="Add a new layout"
        visible={this.state.visible}
        onOk={() => {
          this.props.addLayout(this.props.value);
          this.setState({ visible: false });
        }}
        onCancel={() => {
          this.setState({ visible: false });
        }}
      >
        <Input
          placeholder="Layout Name"
          value={this.state.value}
          onChange={value => {
            this.setState({ value });
          }}
        />
      </Modal>
    );
  }
}

export default AddNewLayoutModal;

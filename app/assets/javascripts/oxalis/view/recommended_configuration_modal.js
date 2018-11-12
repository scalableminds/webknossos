// @flow

import { Modal, List } from "antd";
import * as React from "react";

import type { DatasetConfiguration, UserConfiguration } from "oxalis/store";
import messages from "messages";

type Props = {
  config: $Shape<{ ...UserConfiguration, ...DatasetConfiguration }>,
  onOk: () => void,
  destroy: () => void,
};

type State = {
  visible: boolean,
};

export default class RecommendedConfigurationModal extends React.Component<Props, State> {
  state = {
    visible: true,
  };

  handleOk = () => {
    this.props.onOk();
    this.hide();
  };

  hide = () => {
    this.setState({ visible: false });
    this.props.destroy();
  };

  render() {
    return (
      <Modal
        maskClosable={false}
        visible={this.state.visible}
        title="Recommended Configuration"
        okText="Accept"
        cancelText="Decline"
        onOk={this.handleOk}
        onCancel={this.hide}
      >
        {messages["task.recommended_configuration"]}
        <List
          style={{ marginTop: 20, maxHeight: 500, overflow: "auto" }}
          itemLayout="horizontal"
          dataSource={Object.entries(this.props.config)}
          size="small"
          bordered
          renderItem={([key, value]) => (
            <List.Item>
              {key}: {value.toString()}
            </List.Item>
          )}
        />
      </Modal>
    );
  }
}

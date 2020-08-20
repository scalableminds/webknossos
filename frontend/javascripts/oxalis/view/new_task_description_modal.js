// @flow

import { Modal, Button } from "antd";
import Markdown from "react-remarkable";
import * as React from "react";

type Props = {
  description: string,
  destroy: () => void,
  title: string,
};

type State = {
  mayClose: boolean,
  visible: boolean,
};

export default class NewTaskDescriptionModal extends React.Component<Props, State> {
  timeoutId: TimeoutID;
  state = {
    mayClose: false,
    visible: true,
  };

  componentDidMount() {
    this.timeoutId = setTimeout(
      () => {
        this.allowClose();
      },
      process.env.NODE_ENV === "production" ? 10000 : 2000,
    );
  }

  componentWillUnmount() {
    clearTimeout(this.timeoutId);
  }

  allowClose() {
    this.setState({ mayClose: true });
  }

  handleOk = () => {
    if (!this.state.mayClose) {
      return;
    }
    this.setState({ visible: false });
    this.props.destroy();
  };

  render() {
    return (
      <Modal
        maskClosable={false}
        visible={this.state.visible}
        title={this.props.title}
        onOk={this.handleOk}
        onCancel={this.handleOk}
        footer={[
          <Button
            key="submit"
            type="primary"
            loading={!this.state.mayClose}
            onClick={this.handleOk}
            disabled={!this.state.mayClose}
          >
            Ok
          </Button>,
        ]}
      >
        <Markdown
          source={this.props.description}
          options={{ html: false, breaks: true, linkify: true }}
        />
      </Modal>
    );
  }
}

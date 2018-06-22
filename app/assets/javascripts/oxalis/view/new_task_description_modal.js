// @flow

import * as React from "react";
import Markdown from "react-remarkable";
import { Spin, Modal, Button } from "antd";

type Props = {
  description: string,
  destroy: () => void,
  title: string,
};

export default class NewTaskDescriptionModal extends React.Component<Props, *> {
  timeoutId: TimeoutID;
  state = {
    mayClose: false,
    visible: true,
    newDescriptionTimestamp: 0,
  };

  componentDidMount() {
    this.setState({
      newDescriptionTimestamp: Date.now(),
    });
    this.timeoutId = setTimeout(() => {
      this.setState({ mayClose: true });
    }, 10000);
  }

  componentWillUnmount() {
    clearTimeout(this.timeoutId);
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

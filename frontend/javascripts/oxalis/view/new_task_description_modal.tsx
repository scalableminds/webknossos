import { Modal, Button } from "antd";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Markdown from "react-remarkable";
import * as React from "react";
type Props = {
  description: string;
  destroy: () => void;
  title: string;
};
type State = {
  mayClose: boolean;
  visible: boolean;
};
export default class NewTaskDescriptionModal extends React.Component<Props, State> {
  // @ts-expect-error timeoutId is not initialized in constructor
  timeoutId: ReturnType<typeof setTimeout>;
  state: State = {
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
    this.setState({
      mayClose: true,
    });
  }

  handleOk = () => {
    if (!this.state.mayClose) {
      return;
    }

    this.setState({
      visible: false,
    });
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
          options={{
            html: false,
            breaks: true,
            linkify: true,
          }}
        />
      </Modal>
    );
  }
}

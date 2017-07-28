// @flow
import React, { PureComponent } from "react";
import Clipboard from "clipboard-js";
import Toast from "libs/toast";
import { Modal, Input, Button } from "antd";
import InputComponent from "oxalis/view/components/input_component";

class ShareModalView extends PureComponent {
  props: {
    isVisible: boolean,
    onOk: () => void,
  };

  getUrl() {
    const loc = window.location;
    // in readonly mode the pathname already contains "/readonly"
    let { pathname } = loc;
    pathname = pathname.replace("/readOnly", "");

    const url = `${loc.origin + pathname}/readOnly${loc.hash}`;
    return url;
  }

  copyToClipboard = async () => {
    const url = this.getUrl();
    await Clipboard.copy(url);
    Toast.success("Position copied to clipboard");
  };

  render() {
    return (
      <Modal
        title="Share"
        visible={this.props.isVisible}
        onOk={this.props.onOk}
        onCancel={this.props.onOk}
      >
        <Input.Group compact>
          <Button style={{ width: "15%" }} onClick={this.copyToClipboard}>
            Copy
          </Button>
          <InputComponent style={{ width: "85%" }} value={this.getUrl()} />
        </Input.Group>
      </Modal>
    );
  }
}

export default ShareModalView;

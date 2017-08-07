// @flow
import React, { PureComponent } from "react";
import Clipboard from "clipboard-js";
import { Modal, Input, Button, Checkbox } from "antd";
import { connect } from "react-redux";
import Toast from "libs/toast";
import InputComponent from "oxalis/view/components/input_component";
import { setAnnotationPublicAction } from "oxalis/model/actions/annotation_actions";
import type { OxalisState } from "oxalis/store";

class ShareModalView extends PureComponent {
  props: {
    isPublic: boolean,
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

  handleCheckboxChange = (event: SyntheticInputEvent) => {
    this.props.setAnnotationPublic(event.target.checked);
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
        <Checkbox
          onChange={this.handleCheckboxChange}
          checked={this.props.isPublic}
          style={{ marginTop: 10, marginLeft: 1 }}
        >
          Is Publicly Accessibly without a Login
        </Checkbox>
      </Modal>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  isPublic: state.tracing.isPublic,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setAnnotationPublic(isPublic: boolean) {
    dispatch(setAnnotationPublicAction(isPublic));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(ShareModalView);

// @flow
import React, { PureComponent } from "react";
import Clipboard from "clipboard-js";
import { Modal, Input, Button, Checkbox } from "antd";
import { connect } from "react-redux";
import Toast from "libs/toast";
import InputComponent from "oxalis/view/components/input_component";
import { setAnnotationPublicAction } from "oxalis/model/actions/annotation_actions";
import messages from "messages";
import type { OxalisState } from "oxalis/store";

class ShareModalView extends PureComponent {
  props: {
    isPublic: boolean,
    isVisible: boolean,
    onOk: () => void,
    setAnnotationPublic: Function,
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
    const isPublic = event.target.checked;

    // public tracings only work if the dataset is public too
    if (!this.props.isDatasetPublic && isPublic) {
      Toast.warning(messages["annotation.dataset_no_public"], true);
    }
    this.props.setAnnotationPublic(isPublic);
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
          Make tracing publicly viewable without a login.
        </Checkbox>
      </Modal>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  isPublic: state.tracing.isPublic,
  isDatasetPublic: state.dataset.isPublic,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setAnnotationPublic(isPublic: boolean) {
    dispatch(setAnnotationPublicAction(isPublic));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(ShareModalView);

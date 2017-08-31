// @flow
import React, { PureComponent } from "react";
import Clipboard from "clipboard-js";
import { Modal, Input, Button, Checkbox } from "antd";
import { connect } from "react-redux";
import Toast from "libs/toast";
import InputComponent from "oxalis/view/components/input_component";
import { setAnnotationPublicAction } from "oxalis/model/actions/annotation_actions";
import messages from "messages";
import type { OxalisState, RestrictionsType, SettingsType } from "oxalis/store";

type ShareModalPropType = {
  // eslint-disable-next-line react/no-unused-prop-types
  isPublic: boolean,
  isVisible: boolean,
  onOk: () => void,
  restrictions: RestrictionsType & SettingsType,
  setAnnotationPublic: Function,
};

type State = {
  isPublic: boolean,
};

class ShareModalView extends PureComponent<ShareModalPropType, State> {
  state = {
    isPublic: false,
  };

  componentWillReceiveProps(newProps: ShareModalPropType) {
    this.setState({ isPublic: newProps.isPublic });
  }

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

  handleCheckboxChange = (event: SyntheticInputEvent<>) => {
    this.setState({ isPublic: event.target.checked });
  };

  handleOk = () => {
    // public tracings only work if the dataset is public too
    const isPublic = this.state.isPublic;
    if (!this.props.isDatasetPublic && isPublic) {
      Toast.warning(messages["annotation.dataset_no_public"], true);
    }
    this.props.setAnnotationPublic(isPublic);
    this.props.onOk();
  };

  render() {
    const publicCheckbox = this.props.restrictions.allowUpdate ? (
      <Checkbox
        onChange={this.handleCheckboxChange}
        checked={this.state.isPublic}
        style={{ marginTop: 10, marginLeft: 1 }}
      >
        Share the tracing publicly. Everyone with this link can access the tracing without the need
        for a user login.
      </Checkbox>
    ) : null;

    return (
      <Modal
        title="Share"
        visible={this.props.isVisible}
        onOk={this.handleOk}
        onCancel={this.props.onOk}
      >
        <Input.Group compact>
          <Button style={{ width: "15%" }} onClick={this.copyToClipboard}>
            Copy
          </Button>
          <InputComponent style={{ width: "85%" }} value={this.getUrl()} />
        </Input.Group>
        {publicCheckbox}
      </Modal>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  isPublic: state.tracing.isPublic,
  isDatasetPublic: state.dataset.isPublic,
  restrictions: state.tracing.restrictions,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setAnnotationPublic(isPublic: boolean) {
    dispatch(setAnnotationPublicAction(isPublic));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(ShareModalView);

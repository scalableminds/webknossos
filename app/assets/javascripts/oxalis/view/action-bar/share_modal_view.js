// @flow
import { Alert, Divider, Radio, Modal, Input, Button, Row, Col } from "antd";
import { connect } from "react-redux";
import Clipboard from "clipboard-js";
import React, { PureComponent } from "react";

import type { APIDataset } from "admin/api_flow_types";
import type { OxalisState, RestrictionsAndSettings } from "oxalis/store";
import { setAnnotationPublicAction } from "oxalis/model/actions/annotation_actions";
import { getDatasetSharingToken } from "admin/admin_rest_api";
import Toast from "libs/toast";
import window from "libs/window";

const RadioGroup = Radio.Group;

type ShareModalProp = {
  // eslint-disable-next-line react/no-unused-prop-types
  isPublic: boolean,
  dataset: APIDataset,
  isVisible: boolean,
  onOk: () => void,
  restrictions: RestrictionsAndSettings,
  setAnnotationPublic: Function,
};

type State = {
  isPublic: boolean,
  sharingToken: string,
};

function Hint({ children, style }) {
  return (
    <div
      style={{
        ...style,
        marginBottom: 12,
        fontSize: 12,
        color: "rgb(118, 118, 118)",
      }}
    >
      {children}
    </div>
  );
}

class ShareModalView extends PureComponent<ShareModalProp, State> {
  state = {
    isPublic: this.props.isPublic,
    sharingToken: "",
  };

  componentDidMount() {
    this.fetch();
  }

  componentDidUpdate(prevProps) {
    if (
      this.props.dataset.name !== prevProps.dataset.name ||
      this.props.dataset.owningOrganization !== prevProps.dataset.owningOrganization
    ) {
      this.fetch();
    }
  }

  async fetch() {
    const { name, owningOrganization } = this.props.dataset;
    const datasetId = { name, owningOrganization };
    const sharingToken = await getDatasetSharingToken(datasetId, { showErrorToast: false });
    this.setState({ sharingToken });
  }

  getUrl() {
    const { location } = window;
    const { pathname, origin, hash } = location;
    const query = this.props.dataset.isPublic ? "" : `?token=${this.state.sharingToken}`;
    const url = `${origin}${pathname}${query}${hash}`;
    return url;
  }

  copyToClipboard = async () => {
    const url = this.getUrl();
    await Clipboard.copy(url);
    Toast.success("URL copied to clipboard");
  };

  handleCheckboxChange = (event: SyntheticInputEvent<>) => {
    this.setState({ isPublic: Boolean(event.target.value) });
  };

  handleOk = () => {
    this.props.setAnnotationPublic(this.state.isPublic);
    this.props.onOk();
  };

  maybeShowWarning() {
    return !this.props.restrictions.allowUpdate ? (
      <Alert
        style={{ marginBottom: 18 }}
        message="You don't have the permission to edit the visibility of this tracing."
        type="warning"
        showIcon
      />
    ) : null;
  }

  render() {
    const radioStyle = {
      display: "block",
      height: "30px",
      lineHeight: "30px",
    };

    return (
      <Modal
        title="Share this Tracing"
        visible={this.props.isVisible}
        width={800}
        okText={this.props.restrictions.allowUpdate ? "Save" : "Ok"}
        onOk={this.handleOk}
        onCancel={this.props.onOk}
      >
        <Row>
          <Col span={6} style={{ lineHeight: "30px" }}>
            Link to tracing
          </Col>
          <Col span={18}>
            <Input.Group compact>
              <Input style={{ width: "85%" }} value={this.getUrl()} readOnly />
              <Button style={{ width: "15%" }} onClick={this.copyToClipboard} icon="copy">
                Copy
              </Button>
            </Input.Group>
            <Hint style={{ margin: "6px 12px" }}>
              This link includes the current position, zoom value and active tree node. Consider
              fine-tuning your current view before copying the URL.
            </Hint>
          </Col>
        </Row>
        <Divider style={{ margin: "18px 0", color: "rgba(0, 0, 0, 0.65)" }}>
          {<i className={`fa fa-${this.state.isPublic ? "globe" : "lock"}`} />}
          Visibility
        </Divider>
        {this.maybeShowWarning()}
        <Row>
          <Col span={6} style={{ lineHeight: "28px" }}>
            Who can view this tracing?
          </Col>
          <Col span={18}>
            <RadioGroup onChange={this.handleCheckboxChange} value={this.state.isPublic}>
              <Radio
                style={radioStyle}
                value={false}
                disabled={!this.props.restrictions.allowUpdate}
              >
                Non-public
              </Radio>
              <Hint style={{ marginLeft: 24 }}>
                All users in your organization{" "}
                {this.props.dataset.isPublic ? "" : "who have access to this dataset"} can view this
                tracing and copy it to their accounts to edit it.
              </Hint>

              <Radio style={radioStyle} value disabled={!this.props.restrictions.allowUpdate}>
                Public
              </Radio>
              <Hint style={{ marginLeft: 24 }}>
                Anyone with the link can see this tracing without having to log in.
              </Hint>
            </RadioGroup>
          </Col>
        </Row>
      </Modal>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  isPublic: state.tracing.isPublic,
  dataset: state.dataset,
  restrictions: state.tracing.restrictions,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setAnnotationPublic(isPublic: boolean) {
    dispatch(setAnnotationPublicAction(isPublic));
  },
});

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(ShareModalView);

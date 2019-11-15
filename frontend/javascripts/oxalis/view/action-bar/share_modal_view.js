// @flow
import { Alert, Divider, Radio, Modal, Input, Button, Row, Col } from "antd";
import { connect } from "react-redux";
import Clipboard from "clipboard-js";
import React, { PureComponent } from "react";
import type { Dispatch } from "redux";

import type { APIDataset, APIAnnotationVisibility } from "admin/api_flow_types";
import type { OxalisState, RestrictionsAndSettings } from "oxalis/store";
import { setAnnotationVisibilityAction } from "oxalis/model/actions/annotation_actions";
import { getDatasetSharingToken } from "admin/admin_rest_api";
import Toast from "libs/toast";
import window from "libs/window";

const RadioGroup = Radio.Group;

type OwnProps = {|
  isVisible: boolean,
  onOk: () => void,
|};
type StateProps = {|
  visibility: APIAnnotationVisibility,
  dataset: APIDataset,
  restrictions: RestrictionsAndSettings,
  setAnnotationVisibility: Function,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  visibility: APIAnnotationVisibility,
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

class ShareModalView extends PureComponent<Props, State> {
  state = {
    visibility: this.props.visibility,
    sharingToken: "",
  };

  componentDidMount() {
    this.fetch();
  }

  componentWillReceiveProps(newProps: Props) {
    if (this.props.visibility !== newProps.visibility) {
      this.setState({ visibility: newProps.visibility });
    }
  }

  componentDidUpdate(prevProps: Props) {
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
    try {
      const sharingToken = await getDatasetSharingToken(datasetId, { showErrorToast: false });
      this.setState({ sharingToken });
    } catch (error) {
      console.error(error);
    }
  }

  getUrl() {
    const { location } = window;
    const { pathname, origin, hash } = location;
    // Append a dataset token if the dataset is not public, but the annotation should be public
    const query =
      !this.props.dataset.isPublic && this.state.visibility === "Public"
        ? `?token=${this.state.sharingToken}`
        : "";
    const url = `${origin}${pathname}${query}${hash}`;
    return url;
  }

  copyToClipboard = async () => {
    const url = this.getUrl();
    await Clipboard.copy(url);
    Toast.success("URL copied to clipboard");
  };

  handleCheckboxChange = (event: SyntheticInputEvent<>) => {
    this.setState({ visibility: ((event.target.value: any): APIAnnotationVisibility) });
  };

  handleOk = () => {
    this.props.setAnnotationVisibility(this.state.visibility);
    this.props.onOk();
  };

  maybeShowWarning() {
    let message;
    if (!this.props.restrictions.allowUpdate) {
      message = "You don't have the permission to edit the visibility of this tracing.";
    } else if (!this.props.dataset.isPublic && this.state.visibility === "Public") {
      message =
        "The dataset of this tracing is not public. The sharing link will make the dataset accessible to everyone you share it with.";
    }

    return message != null ? (
      <Alert style={{ marginBottom: 18 }} message={message} type="warning" showIcon />
    ) : null;
  }

  render() {
    const radioStyle = {
      display: "block",
      height: "30px",
      lineHeight: "30px",
    };

    const iconMap = {
      Public: "globe",
      Internal: "users",
      Private: "lock",
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
            Sharing Link
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
          {<i className={`fa fa-${iconMap[this.state.visibility]}`} />}
          Visibility
        </Divider>
        {this.maybeShowWarning()}
        <Row>
          <Col span={6} style={{ lineHeight: "28px" }}>
            Who can view this tracing?
          </Col>
          <Col span={18}>
            <RadioGroup onChange={this.handleCheckboxChange} value={this.state.visibility}>
              <Radio
                style={radioStyle}
                value="Private"
                disabled={!this.props.restrictions.allowUpdate}
              >
                Private
              </Radio>
              <Hint style={{ marginLeft: 24 }}>
                Only you and your team manager can view this tracing.
              </Hint>

              <Radio
                style={radioStyle}
                value="Internal"
                disabled={!this.props.restrictions.allowUpdate}
              >
                Internal
              </Radio>
              <Hint style={{ marginLeft: 24 }}>
                All users in your organization{" "}
                {this.props.dataset.isPublic ? "" : "who have access to this dataset"} can view this
                tracing and copy it to their accounts to edit it.
              </Hint>

              <Radio
                style={radioStyle}
                value="Public"
                disabled={!this.props.restrictions.allowUpdate}
              >
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
  visibility: state.tracing.visibility,
  dataset: state.dataset,
  restrictions: state.tracing.restrictions,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setAnnotationVisibility(visibility: APIAnnotationVisibility) {
    dispatch(setAnnotationVisibilityAction(visibility));
  },
});

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(ShareModalView);

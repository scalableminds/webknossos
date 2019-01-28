// @flow
import { Popconfirm, Alert, Divider, Radio, Modal, Input, Button, Row, Col } from "antd";
import { connect } from "react-redux";
import Clipboard from "clipboard-js";
import React, { PureComponent } from "react";
import type { Dispatch } from "redux";

import type { APIDataset } from "admin/api_flow_types";
import type { OxalisState, RestrictionsAndSettings } from "oxalis/store";
import { setAnnotationPublicAction } from "oxalis/model/actions/annotation_actions";
import { setDatasetAction } from "oxalis/model/actions/settings_actions";
import { updateDataset } from "admin/admin_rest_api";
import Toast from "libs/toast";
import window from "libs/window";

const RadioGroup = Radio.Group;

type OwnProps = {|
  isVisible: boolean,
  onOk: () => void,
|};
type StateProps = {|
  // eslint-disable-next-line react/no-unused-prop-types
  isPublic: boolean,
  dataset: APIDataset,
  isCurrentUserAdmin: boolean,
  restrictions: RestrictionsAndSettings,
  setAnnotationPublic: Function,
  makeDatasetPublic: APIDataset => Promise<void>,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  isPublic: boolean,
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
    isPublic: false,
  };

  componentWillReceiveProps(newProps: Props) {
    this.setState({ isPublic: newProps.isPublic });
  }

  getUrl() {
    const loc = window.location;
    const { pathname } = loc;
    const url = `${loc.origin + pathname}${loc.hash}`;
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
    let message;
    if (!this.props.restrictions.allowUpdate) {
      message = "You don't have the permission to edit the visibility of this tracing.";
    } else if (!this.props.dataset.isPublic) {
      message = (
        <span>
          The tracing cannot be made public, since the underlying dataset is not public.{" "}
          {this.props.isCurrentUserAdmin ? (
            <span>
              <Popconfirm
                title={
                  <div>
                    Are you sure you want to make the dataset &ldquo;{this.props.dataset.name}
                    &rdquo; public?
                    <br /> It will be publicly listed when unregistered users visit webKnossos.
                  </div>
                }
                onConfirm={() => this.props.makeDatasetPublic(this.props.dataset)}
                okText="Yes"
                cancelText="No"
                style={{ maxWidth: 400 }}
              >
                <a href="#">Click here</a>
              </Popconfirm>{" "}
              to make the dataset public.
            </span>
          ) : (
            <span>
              Please ask an administrator to make the dataset {this.props.dataset.name} public.
            </span>
          )}
        </span>
      );
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
              <Input style={{ width: "85%" }} value={this.getUrl()} />
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

              <Radio
                style={radioStyle}
                value
                disabled={!this.props.restrictions.allowUpdate || !this.props.dataset.isPublic}
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
  isPublic: state.tracing.isPublic && state.dataset.isPublic,
  dataset: state.dataset,
  restrictions: state.tracing.restrictions,
  isCurrentUserAdmin: state.activeUser != null ? state.activeUser.isAdmin : false,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setAnnotationPublic(isPublic: boolean) {
    dispatch(setAnnotationPublicAction(isPublic));
  },
  async makeDatasetPublic(dataset: APIDataset) {
    const newDataset = { ...dataset, isPublic: true };
    await updateDataset(dataset, newDataset);
    dispatch(setDatasetAction(newDataset));
  },
});

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(ShareModalView);

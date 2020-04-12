// @flow
import { Divider, Modal, Input, Button, Row, Col } from "antd";
import { connect } from "react-redux";
import Clipboard from "clipboard-js";
import React, { PureComponent } from "react";
import type { APIDataset } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { getDatasetSharingToken } from "admin/admin_rest_api";
import Toast from "libs/toast";
import window from "libs/window";
import _ from "lodash";

type OwnProps = {|
  isVisible: boolean,
  onOk: () => void,
|};
type StateProps = {|
  dataset: APIDataset,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  sharingToken: string,
};

class ShareViewDatasetModalView extends PureComponent<Props, State> {
  state = {
    sharingToken: "",
  };

  componentDidMount() {
    this.fetch();
  }

  componentDidUpdate(prevProps: Props) {
    if (
      this.props.dataset.name !== prevProps.dataset.name ||
      this.props.dataset.isPublic !== prevProps.dataset.isPublic ||
      this.props.dataset.owningOrganization !== prevProps.dataset.owningOrganization
    ) {
      this.fetch();
    }
  }

  async fetch() {
    const { name, owningOrganization, isPublic } = this.props.dataset;
    if (isPublic) {
      // We only need to fetch a sharing token if the dataset is not public.
      return;
    }
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
    const query = this.props.dataset.isPublic ? "" : `?token=${this.state.sharingToken}`;
    const url = `${origin}${pathname}${query}${hash}`;
    return url;
  }

  copyToClipboard = async () => {
    const url = this.getUrl();
    await Clipboard.copy(url);
    Toast.success("URL copied to clipboard.");
  };

  render() {
    const { isVisible, onOk, dataset } = this.props;
    return (
      <Modal
        title="Share this Tracing"
        visible={isVisible}
        width={800}
        okText="Ok"
        onOk={onOk}
        onCancel={onOk}
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
            <div
              style={{
                marginBottom: 12,
                margin: "6px 12px",
              }}
            >
              This link includes the current position and zoom value. Consider fine-tuning your
              current view before copying the URL.
            </div>
          </Col>
        </Row>
        <Divider style={{ margin: "18px 0", color: "rgba(0, 0, 0, 0.65)" }}>
          {<i className={`fa fa-${dataset.isPublic ? "globe" : "lock"}`} />}
          {dataset.isPublic ? "Public" : "Private"}
        </Divider>
        {dataset.isPublic
          ? "This dataset is public by default. The URL will not include any access token."
          : "This dataset is private by default. For others to acces it an access token is included in the URL."}
      </Modal>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  dataset: state.dataset,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(ShareViewDatasetModalView);

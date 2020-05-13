// @flow
import { Modal, Input, Button, Row, Col } from "antd";
import { useSelector } from "react-redux";
import React from "react";
import messages from "messages";
import { useDatasetSharingToken, getUrl, copyUrlToClipboard } from "./share_modal_view";

const sharingActiveNode = false;

type Props = {|
  isVisible: boolean,
  onOk: () => void,
|};

export default function ShareViewDatasetModalView(props: Props) {
  const { isVisible, onOk } = props;
  const dataset = useSelector(state => state.dataset);
  const sharingToken = useDatasetSharingToken(dataset);
  const url = getUrl(sharingToken, !dataset.isPublic);
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
            <Input style={{ width: "85%" }} value={url} readOnly />
            <Button style={{ width: "15%" }} onClick={() => copyUrlToClipboard(url)} icon="copy">
              Copy
            </Button>
          </Input.Group>
          <div
            style={{
              marginBottom: 12,
              margin: "6px 12px",
            }}
          >
            {messages["tracing.sharing_modal_basic_information"](sharingActiveNode)}{" "}
            {!dataset.isPublic
              ? "Additionally, a private token is included in the link, since the dataset is not public."
              : null}
          </div>
        </Col>
      </Row>
    </Modal>
  );
}

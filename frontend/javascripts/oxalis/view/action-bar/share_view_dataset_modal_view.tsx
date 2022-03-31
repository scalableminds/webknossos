import { Modal, Input, Button, Row, Col } from "antd";
import { useSelector } from "react-redux";
import React from "react";
import messages from "messages";
import { CopyOutlined } from "@ant-design/icons";
import { useDatasetSharingToken, getUrl, copyUrlToClipboard } from "./share_modal_view";
const sharingActiveNode = false;
type Props = {
  onOk: () => any;
};
export default function ShareViewDatasetModalView(props: Props) {
  const { onOk } = props;
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'dataset' does not exist on type 'Default... Remove this comment to see the full error message
  const dataset = useSelector((state) => state.dataset);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'uiInformation' does not exist on type 'D... Remove this comment to see the full error message
  const isShareModalOpen = useSelector((state) => state.uiInformation.showShareModal);
  const sharingToken = useDatasetSharingToken(dataset);
  const url = getUrl(sharingToken, !dataset.isPublic);
  return (
    <Modal
      title="Share this Dataset"
      visible={isShareModalOpen}
      width={800}
      okText="Ok"
      onOk={onOk}
      onCancel={onOk}
    >
      <Row>
        <Col
          span={6}
          style={{
            lineHeight: "30px",
          }}
        >
          Sharing Link
        </Col>
        <Col span={18}>
          <Input.Group compact>
            <Input
              style={{
                width: "85%",
              }}
              value={url}
              readOnly
            />
            <Button
              style={{
                width: "15%",
              }}
              onClick={() => copyUrlToClipboard(url)}
              icon={<CopyOutlined />}
            >
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

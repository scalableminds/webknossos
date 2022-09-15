import { CopyOutlined } from "@ant-design/icons";
import { Modal, Input, Button, Row, Col, Dropdown } from "antd";
import { useSelector } from "react-redux";
import React from "react";
import { makeComponentLazy } from "libs/react_helpers";
import messages from "messages";
import { OxalisState } from "oxalis/store";
import {
  useDatasetSharingToken,
  getUrl,
  copyUrlToClipboard,
  CopyableSharingLink,
} from "./share_modal_view";
import { useZarrLinkMenu } from "./private_links_view";

const sharingActiveNode = false;

type Props = {
  isVisible: boolean;
  onOk: () => any;
};

function _ShareViewDatasetModalView(props: Props) {
  const { isVisible, onOk } = props;
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const sharingToken = useDatasetSharingToken(dataset);
  const longUrl = getUrl(sharingToken, !dataset.isPublic);

  const { baseUrl: zarrBaseUrl, copyLayerUrlMenu } = useZarrLinkMenu(null);

  return (
    <Modal
      title="Share this Dataset"
      visible={isVisible}
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
          <CopyableSharingLink isVisible={isVisible} longUrl={longUrl} />

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
      {dataset.isPublic && (
        <Row style={{ marginTop: 16 }}>
          <Col
            span={6}
            style={{
              lineHeight: "30px",
            }}
          >
            Zarr Link
          </Col>
          <Col span={18}>
            <Input.Group compact>
              <Input
                style={{
                  width: "85%",
                }}
                value={zarrBaseUrl}
                readOnly
              />
              <Dropdown overlay={copyLayerUrlMenu}>
                <Button
                  style={{
                    width: "15%",
                  }}
                  icon={<CopyOutlined />}
                >
                  Copy
                </Button>
              </Dropdown>
            </Input.Group>
            <div
              style={{
                marginBottom: 12,
                margin: "6px 12px",
              }}
            >
              {messages["tracing.sharing_modal_zarr_information"]}{" "}
            </div>
          </Col>
        </Row>
      )}
    </Modal>
  );
}

const ShareViewDatasetModalView = makeComponentLazy(_ShareViewDatasetModalView);
export default ShareViewDatasetModalView;

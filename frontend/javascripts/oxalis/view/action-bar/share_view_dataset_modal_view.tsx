import { CopyOutlined } from "@ant-design/icons";
import { Button, Col, Dropdown, Input, Modal, Row, Space } from "antd";
import { makeComponentLazy } from "libs/react_helpers";
import messages from "messages";
import type { WebknossosState } from "oxalis/store";
import { useSelector } from "react-redux";
import { useZarrLinkMenu } from "./private_links_view";
import { CopyableSharingLink, getUrl, useDatasetSharingToken } from "./share_modal_view";

const sharingActiveNode = false;

type Props = {
  isOpen: boolean;
  onOk: () => any;
};

function _ShareViewDatasetModalView(props: Props) {
  const { isOpen, onOk } = props;
  const dataset = useSelector((state: WebknossosState) => state.dataset);
  const sharingToken = useDatasetSharingToken(dataset);
  const longUrl = getUrl(sharingToken, !dataset.isPublic);

  const { baseUrl: zarrBaseUrl, copyLayerUrlMenu } = useZarrLinkMenu(null);

  return (
    <Modal
      title="Share this Dataset"
      open={isOpen}
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
          <CopyableSharingLink isVisible={isOpen} longUrl={longUrl} />

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
            <Space.Compact>
              <Input
                style={{
                  width: "85%",
                }}
                value={zarrBaseUrl}
                readOnly
              />
              <Dropdown menu={copyLayerUrlMenu}>
                <Button
                  style={{
                    width: "15%",
                  }}
                  icon={<CopyOutlined />}
                >
                  Copy
                </Button>
              </Dropdown>
            </Space.Compact>
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

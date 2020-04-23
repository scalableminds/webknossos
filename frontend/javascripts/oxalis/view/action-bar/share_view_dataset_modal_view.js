// @flow
import { Modal, Input, Button, Row, Col } from "antd";
import { useSelector } from "react-redux";
import Clipboard from "clipboard-js";
import React, { useState, useEffect } from "react";
import type { APIDataset } from "admin/api_flow_types";
import { getDatasetSharingToken } from "admin/admin_rest_api";
import Toast from "libs/toast";
import { location } from "libs/window";

type Props = {|
  isVisible: boolean,
  onOk: () => void,
|};

export function useDatasetSharingToken(dataset: APIDataset) {
  const [datasetToken, setDatasetToken] = useState("");
  const fetchAndSetToken = async () => {
    const datasetId = { name: dataset.name, owningOrganization: dataset.owningOrganization };
    try {
      const sharingToken = await getDatasetSharingToken(datasetId, { showErrorToast: false });
      setDatasetToken(sharingToken);
    } catch (error) {
      console.error(error);
    }
  };
  useEffect(() => {
    fetchAndSetToken();
  }, [dataset]);
  return datasetToken;
}

function getUrl(sharingToken: string, includeToken: boolean) {
  const { pathname, origin, hash } = location;
  const query = includeToken ? `?token=${sharingToken}` : "";
  const url = `${origin}${pathname}${query}${hash}`;
  return url;
}

async function copyUrlToClipboard(url: string) {
  await Clipboard.copy(url);
  Toast.success("URL copied to clipboard.");
}

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
            This link includes the current position and zoom value. Consider fine-tuning your
            current view before copying the URL.{" "}
            {!dataset.isPublic
              ? "Additionally, a private token is included in the link, since the dataset is not public."
              : null}
          </div>
        </Col>
      </Row>
    </Modal>
  );
}

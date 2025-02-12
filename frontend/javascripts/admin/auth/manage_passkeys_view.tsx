import { CopyOutlined, SwapOutlined } from "@ant-design/icons";
import { getAuthToken, revokeAuthToken } from "admin/admin_rest_api";
import { Button, Col, Form, Input, Row, Space, Spin } from "antd";
import Toast from "libs/toast";
import type { OxalisState } from "oxalis/store";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
const FormItem = Form.Item;

function ManagePassKeyView() {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentToken, setCurrentToken] = useState<string>("");
  const [form] = Form.useForm();
  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData(): Promise<void> {
    const token = await getAuthToken();
    setCurrentToken(token);
    setIsLoading(false);
  }

  const handleRevokeToken = async (): Promise<void> => {
    try {
      setIsLoading(true);
      await revokeAuthToken();
      const token = await getAuthToken();
      setCurrentToken(token);
    } finally {
      setIsLoading(false);
    }
  };

  const copyTokenToClipboard = async () => {
    await navigator.clipboard.writeText(currentToken);
    Toast.success("Token copied to clipboard");
  };

  const copyOrganizationIdToClipboard = async () => {
    if (activeUser != null) {
      await navigator.clipboard.writeText(activeUser.organization);
      Toast.success("Organization ID copied to clipboard");
    }
  };

  return (
    <div>
      <Row
        justify="center"
        style={{
          padding: 50,
        }}
        align="middle"
      >
        <Col span={8}>
            <h3>Your PassKeys</h3>
            TODO
        </Col>
      </Row>
      <Row justify="center" align="middle">
        <Col span={8}>
          <p>
            PassKeys are a new web authentication method that allows you to log in without a password in a secured way.
            Microsoft Hello and Apple FaceID are examples of technologies that can be used as passkeys to log in in WEBKNOSSOS.
            If you want to add a new passkey to your account use the button below.
          </p>
          TODO: Button and so on
        </Col>
      </Row>
    </div>
  );
}

export default ManagePassKeyView;

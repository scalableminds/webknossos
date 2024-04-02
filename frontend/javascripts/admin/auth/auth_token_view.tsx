import React, { useState, useEffect } from "react";
import { CopyOutlined, SwapOutlined } from "@ant-design/icons";
import { Input, Button, Col, Row, Spin, Form, Space } from "antd";
import { getAuthToken, revokeAuthToken } from "admin/admin_rest_api";
import type { OxalisState } from "oxalis/store";
import Toast from "libs/toast";
import { useSelector } from "react-redux";
const FormItem = Form.Item;

function AuthTokenView() {
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

  const copyOrganizationNameToClipboard = async () => {
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
          <Spin size="large" spinning={isLoading}>
            <h3>Auth Token</h3>
            <Form form={form}>
              <FormItem>
                <Space.Compact>
                  <Input
                    value={currentToken}
                    style={{
                      width: "90%",
                    }}
                    readOnly
                  />
                  <Button onClick={copyTokenToClipboard} icon={<CopyOutlined />} />
                </Space.Compact>
              </FormItem>
              <FormItem>
                <Button icon={<SwapOutlined />} onClick={handleRevokeToken}>
                  Revoke Token
                </Button>
              </FormItem>
            </Form>
            {activeUser != null && (
              <>
                <h4>Organization ID</h4>
                <Form>
                  <FormItem>
                    <Space.Compact>
                      <Input
                        value={activeUser.organization}
                        style={{
                          width: "90%",
                        }}
                        readOnly
                      />
                      <Button onClick={copyOrganizationNameToClipboard} icon={<CopyOutlined />} />
                    </Space.Compact>
                  </FormItem>
                </Form>
              </>
            )}
          </Spin>
        </Col>
      </Row>
      <Row justify="center" align="middle">
        <Col span={8}>
          <p>
            An Auth Token is a series of symbols that serves to authenticate you. It is used in
            communication with the backend API and sent with every request to verify your identity.
          </p>
          <p>
            You should revoke it if somebody else has acquired your token or you have the suspicion
            this has happened.{" "}
            <a href="https://docs.webknossos.org/webknossos/rest_api.html#authentication">
              Read more
            </a>
          </p>
        </Col>
      </Row>
    </div>
  );
}

export default AuthTokenView;

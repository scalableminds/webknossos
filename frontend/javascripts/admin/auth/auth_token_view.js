// @flow
import React, { useState, useEffect } from "react";
import { CopyOutlined, SwapOutlined } from "@ant-design/icons";
import { Input, Button, Col, Row, Spin, Form } from "antd";
import { getAuthToken, revokeAuthToken } from "admin/admin_rest_api";
import Toast from "libs/toast";

const FormItem = Form.Item;

function AuthTokenView() {
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

  return (
    <div>
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <Spin size="large" spinning={isLoading}>
            <h3>Auth Token</h3>
            <Form form={form}>
              <FormItem>
                <Input.Group compact>
                  <Input value={currentToken} style={{ width: "90%" }} readOnly />
                  <Button onClick={copyTokenToClipboard} icon={<CopyOutlined />} />
                </Input.Group>
              </FormItem>
              <FormItem>
                <Button icon={<SwapOutlined />} onClick={handleRevokeToken}>
                  Revoke Token
                </Button>
              </FormItem>
            </Form>
          </Spin>
        </Col>
      </Row>
      <Row type="flex" justify="center" align="middle">
        <Col span={8}>
          An Auth Token is a series of symbols that serves to authenticate you. It is used in
          communication with the backend API and sent with every request to verify your identity.
          <br />
          You should revoke it if somebody else has acquired your token or you have the suspicion
          this has happened.{" "}
          <a href="https://docs.webknossos.org/webknossos/rest_api.html#authentication">
            Read more
          </a>
        </Col>
      </Row>
    </div>
  );
}

export default AuthTokenView;

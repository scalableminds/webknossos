import { CopyOutlined, SwapOutlined } from "@ant-design/icons";
import { getAuthToken, revokeAuthToken } from "admin/rest_api";
import { Button, Col, Form, Input, Row, Space, Spin } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useEffect, useState } from "react";
const FormItem = Form.Item;

function AuthTokenView() {
  const activeUser = useWkSelector((state) => state.activeUser);
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
      <h2>API Authentication</h2>
      <Row>
        <Col span={8}>
          <Spin size="large" spinning={isLoading}>
            <h4>Auth Token</h4>
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
                      <Button onClick={copyOrganizationIdToClipboard} icon={<CopyOutlined />} />
                    </Space.Compact>
                  </FormItem>
                </Form>
              </>
            )}
          </Spin>

          <p>
            Your Auth Token is a unique string of characters that authenticates you when using our
            <a href="https://docs.webknossos.org/webknossos-py/index.html"> Python API</a>. It is
            request to verify your identity.
          </p>
          <p>
            Revoke your token if it has been compromised or if you suspect someone else has gained
            access to it.
            <a href="https://docs.webknossos.org/webknossos-py/index.html">Read more</a>
          </p>
        </Col>
      </Row>
    </div>
  );
}

export default AuthTokenView;

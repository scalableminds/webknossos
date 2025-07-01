import { ExportOutlined, SwapOutlined } from "@ant-design/icons";
import { getAuthToken, revokeAuthToken } from "admin/rest_api";
import { Button, Col, Row, Spin, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useEffect, useState } from "react";
import { SettingsCard } from "./helpers/settings_card";
import { SettingsTitle } from "./helpers/settings_title";

const { Text } = Typography;

function AccountAuthTokenView() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentToken, setCurrentToken] = useState<string>("");

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData(): Promise<void> {
    try {
      const token = await getAuthToken();
      setCurrentToken(token);
    } catch (error) {
      Toast.error("Failed to fetch auth token. Please refresh the page to try again.");
      console.error("Failed to fetch auth token:", error);
    } finally {
      setIsLoading(false);
    }
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

  const APIitems = [
    {
      title: "Auth Token",
      value: (
        <Text code copyable>
          {currentToken}
        </Text>
      ),
    },
    {
      title: "Token Revocation",
      explanation:
        "Revoke your token if it has been compromised or if you suspect someone else has gained access to it. This will invalidate all active sessions.",
      value: (
        <Button icon={<SwapOutlined />} type="primary" ghost onClick={handleRevokeToken}>
          Revoke and Generate New Token
        </Button>
      ),
    },
    ...(activeUser
      ? [
          {
            title: "Organization ID",
            value: (
              <Text code copyable>
                {activeUser.organization}
              </Text>
            ),
          },
        ]
      : []),
    {
      title: "API Documentation",
      value: (
        <a href="https://docs.webknossos.org/webknossos-py/index.html">
          Read the docs <ExportOutlined />
        </a>
      ),
    },
  ];

  return (
    <div>
      <SettingsTitle
        title="API Authorization"
        description="Access the WEBKNOSSO Python API with your API token"
      />
      <Spin size="large" spinning={isLoading}>
        <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
          {APIitems.map((item) => (
            <Col span={12} key={item.title}>
              <SettingsCard
                title={item.title}
                description={item.value}
                explanation={item.explanation}
              />
            </Col>
          ))}
        </Row>
      </Spin>
    </div>
  );
}

export default AccountAuthTokenView;

import { InfoCircleOutlined, SwapOutlined } from "@ant-design/icons";
import { getAuthToken, revokeAuthToken } from "admin/rest_api";
import { Button, Descriptions, Popover, Spin, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useEffect, useState } from "react";
import { AccountSettingsTitle } from "./account_profile_view";

const { Text } = Typography;

function AccountAuthTokenView() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentToken, setCurrentToken] = useState<string>("");

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

  const APIitems = [
    {
      label: "Auth Token",
      children: (
        <Text code copyable>
          {currentToken}
        </Text>
      ),
    },
    {
      label: (
        <>
          <span className="icon-margin-right">Token Revocation</span>
          <Popover
            content="Revoke your token if it has been compromised or if you suspect someone else has gained
        access to it. This will invalidate all active sessions."
          >
            <InfoCircleOutlined />
          </Popover>
        </>
      ),
      children: (
        <Button icon={<SwapOutlined />} onClick={handleRevokeToken}>
          Revoke and Generate New Token
        </Button>
      ),
    },
    ...(activeUser
      ? [
          {
            label: "Organization ID",
            children: (
              <Text code copyable>
                {activeUser.organization}
              </Text>
            ),
          },
        ]
      : []),
    {
      label: "API Documentation",
      children: <a href="https://docs.webknossos.org/webknossos-py/index.html">Read the docs</a>,
    },
  ];

  return (
    <div>
      <AccountSettingsTitle
        title="API Authorization"
        description="Access the WEBKNOSSO Python API with your API token"
      />
      <Spin size="large" spinning={isLoading}>
        <Descriptions column={2} layout="vertical" colon={false} items={APIitems} />
      </Spin>
    </div>
  );
}

export default AccountAuthTokenView;

import {
  ExportOutlined,
  IdcardOutlined,
  KeyOutlined,
  ReadOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthToken, revokeAuthToken } from "admin/rest_api";
import { Button, Col, Row, Spin, Typography } from "antd";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import { SettingsCard, type SettingsCardProps } from "./helpers/settings_card";
import { SettingsTitle } from "./helpers/settings_title";

const { Text } = Typography;

function AccountAuthTokenView() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const queryClient = useQueryClient();

  const { data: currentToken = "", isLoading: isLoadingToken } = useQueryWithErrorHandling(
    {
      queryKey: ["authToken"],
      queryFn: getAuthToken,
      refetchOnWindowFocus: false,
      // Never persist the token to localStorage.
      meta: { persist: false },
    },
    "Failed to fetch auth token. Please refresh the page to try again.",
  );

  const revokeTokenMutation = useMutation({
    mutationFn: revokeAuthToken,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["authToken"] }),
  });
  const isLoading = isLoadingToken || revokeTokenMutation.isPending;

  const handleRevokeToken = () => revokeTokenMutation.mutate();

  const APIitems: SettingsCardProps[] = [
    {
      title: "Auth Token",
      icon: <KeyOutlined />,
      content: (
        <Text code copyable>
          {currentToken}
        </Text>
      ),
    },
    {
      title: "Token Revocation",
      icon: <SwapOutlined />,
      hint: "Use if the token may have been exposed. All active sessions end.",
      hintType: "warning",
      content: (
        <Button icon={<SwapOutlined />} type="primary" ghost onClick={handleRevokeToken}>
          Revoke and Generate New Token
        </Button>
      ),
    },
    ...(activeUser
      ? [
          {
            title: "Organization ID",
            icon: <IdcardOutlined />,
            content: (
              <Text code copyable>
                {activeUser.organization}
              </Text>
            ),
          },
        ]
      : []),
    {
      title: "API Documentation",
      icon: <ReadOutlined />,
      content: (
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
        description="Access the WEBKNOSSOS Python API with your API token"
      />
      <Spin size="large" spinning={isLoading}>
        <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
          {APIitems.map((item) => (
            <Col span={12} key={item.title}>
              <SettingsCard {...item} />
            </Col>
          ))}
        </Row>
      </Spin>
    </div>
  );
}

export default AccountAuthTokenView;

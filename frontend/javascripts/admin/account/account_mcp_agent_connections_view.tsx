import { DisconnectOutlined, ExportOutlined } from "@ant-design/icons";
import { getPermissionLevelLabel } from "admin/auth/oauth_permission_levels";
import { type APIOAuthGrant, getOAuthGrants, revokeOAuthGrant } from "admin/rest_api";
import { Alert, Button, Col, Popconfirm, Row, Spin, Table, Typography } from "antd";
import FormattedDate from "components/formatted_date";
import features from "features";
import Toast from "libs/toast";
import { useEffect, useState } from "react";
import { SettingsCard } from "./helpers/settings_card";
import { SettingsTitle } from "./helpers/settings_title";

const { Text, Paragraph } = Typography;

function getMcpUrl(): string {
  return `${window.location.origin}/api/mcp`;
}

// Clients are identified either by the URL of their metadata document or by an id they got when registering.
function describeClient(clientId: string): string {
  try {
    return new URL(clientId).host;
  } catch {
    return "Registered application";
  }
}

function ConnectedApplications() {
  const [grants, setGrants] = useState<APIOAuthGrant[] | null>(null);

  async function fetchGrants(): Promise<void> {
    try {
      setGrants(await getOAuthGrants());
    } catch (error) {
      Toast.error(
        "Failed to load the connected applications. Please refresh the page to try again.",
      );
      console.error("Failed to load the connected applications:", error);
      setGrants([]);
    }
  }

  useEffect(() => {
    fetchGrants();
  }, []);

  const disconnect = async (grant: APIOAuthGrant): Promise<void> => {
    try {
      await revokeOAuthGrant(grant.id);
      Toast.success(`${grant.clientName} has been disconnected.`);
    } catch (error) {
      Toast.error("Failed to disconnect the application. Please try again.");
      console.error("Failed to disconnect the application:", error);
    }
    await fetchGrants();
  };

  return (
    <Spin spinning={grants == null}>
      <Table<APIOAuthGrant>
        dataSource={grants ?? []}
        rowKey="id"
        pagination={false}
        size="small"
        locale={{ emptyText: "No applications are connected." }}
        columns={[
          {
            title: "Application",
            key: "client",
            render: (_, grant) => (
              <>
                {grant.clientName}
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {describeClient(grant.clientId)}
                </Text>
              </>
            ),
          },
          {
            title: "Permissions",
            dataIndex: "level",
            render: (level: string) => getPermissionLevelLabel(level),
          },
          {
            title: "Connected",
            dataIndex: "created",
            render: (created: number) => <FormattedDate timestamp={created} />,
          },
          {
            title: "Last used",
            dataIndex: "lastUsed",
            render: (lastUsed: number) => <FormattedDate timestamp={lastUsed} />,
          },
          {
            key: "actions",
            render: (_, grant) => (
              <Popconfirm
                title={`Disconnect ${grant.clientName}?`}
                description="It loses access immediately, including any agent tokens it obtained."
                onConfirm={() => disconnect(grant)}
              >
                <Button icon={<DisconnectOutlined />} danger size="small">
                  Disconnect
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </Spin>
  );
}

function AccountMcpAgentConnectionsView() {
  const claudeCodeCommand = `claude mcp add --transport http webknossos ${getMcpUrl()}`;

  return (
    <div>
      <SettingsTitle
        title="MCP Agent Connections"
        description="Let AI agents work with your datasets and annotations via the Model Context Protocol (MCP)"
      />
      {!features().mcpEnabled ? (
        <Alert type="info" showIcon message="The MCP server is not enabled on this instance." />
      ) : (
        <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
          <Col span={24}>
            <SettingsCard
              title="Connected Applications"
              tooltip="Applications you allowed to work with WEBKNOSSOS on your behalf. Disconnecting one takes effect immediately."
              content={<ConnectedApplications />}
            />
          </Col>
          <Col span={24}>
            <SettingsCard
              title="MCP Server URL"
              tooltip="Add this URL to your MCP client. When it connects, WEBKNOSSOS asks you to log in and to choose what the agent may do."
              content={
                <Text code copyable>
                  {getMcpUrl()}
                </Text>
              }
            />
          </Col>
          <Col span={24}>
            <SettingsCard
              title="Claude Code"
              tooltip="Registers WEBKNOSSOS with Claude Code. Run /mcp in Claude Code afterwards to connect."
              content={
                <Paragraph copyable={{ text: claudeCodeCommand }} style={{ marginBottom: 0 }}>
                  <Text code style={{ fontSize: 12, wordBreak: "break-all" }}>
                    {claudeCodeCommand}
                  </Text>
                </Paragraph>
              }
            />
          </Col>
          <Col span={12}>
            <SettingsCard
              title="Claude Desktop and claude.ai"
              tooltip="Add a custom connector in the connector settings and enter the MCP server URL."
              content={<Text>Settings → Connectors → Add custom connector</Text>}
            />
          </Col>
          <Col span={12}>
            <SettingsCard
              title="Documentation"
              content={
                <a href="https://docs.webknossos.org/webknossos/users/mcp.html">
                  Read the docs <ExportOutlined />
                </a>
              }
            />
          </Col>
        </Row>
      )}
    </div>
  );
}

export default AccountMcpAgentConnectionsView;

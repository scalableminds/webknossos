import { DownloadOutlined, ExportOutlined, SaveOutlined, StopOutlined } from "@ant-design/icons";
import {
  getAuthToken,
  getMcpAgentPermissions,
  revokeAgentTokens,
  updateMcpAgentPermissions,
} from "admin/rest_api";
import { Alert, Button, Checkbox, Col, Row, Space, Spin, Typography } from "antd";
import Toast from "libs/toast";
import { useEffect, useState } from "react";
import { SettingsCard } from "./helpers/settings_card";
import { SettingsTitle } from "./helpers/settings_title";

const { Text, Paragraph } = Typography;

// The permission levels the backend understands, see security.Scope.Set.forLevel. They are ordered: each level
// also grants everything the ones above it grant.
const PERMISSION_LEVELS = [
  {
    key: "read",
    label: "Read",
    description: "Look at datasets, annotations and tasks. The agent cannot change anything.",
  },
  {
    key: "write",
    label: "Create/modify",
    description:
      "Additionally upload and edit datasets, and create annotations, tasks, projects and teams. Cannot change the organization.",
  },
  {
    key: "delete",
    label: "Delete",
    description: "Additionally delete datasets, annotations, tasks and teams. Use with care.",
  },
] as const;

type PermissionKey = (typeof PERMISSION_LEVELS)[number]["key"];

// Only the strongest selected level has to be stored, since a level includes the weaker ones.
function permissionsToScopes(selected: PermissionKey[]): string {
  const strongest = PERMISSION_LEVELS.filter((level) => selected.includes(level.key)).at(-1);
  return strongest?.key ?? "none";
}

function scopesToPermissions(scopes: string): PermissionKey[] {
  const index = PERMISSION_LEVELS.findIndex((level) => level.key === scopes);
  // Anything else (an explicit scope list set by hand) is shown as the levels it covers, at least none of them.
  return index < 0 ? [] : PERMISSION_LEVELS.slice(0, index + 1).map((level) => level.key);
}

function getMcpUrl(): string {
  return `${window.location.origin}/api/mcp`;
}

// A ready-to-paste command that registers the MCP server for a single Claude Code session, without persisting it.
function getClaudeCodeCommand(token: string): string {
  const config = {
    mcpServers: {
      webknossos: {
        type: "http",
        url: getMcpUrl(),
        headers: { "X-Auth-Token": token },
      },
    },
  };
  return `claude --mcp-config '${JSON.stringify(config)}'`;
}

function AccountMcpAgentConnectionsView() {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentToken, setCurrentToken] = useState<string>("");
  const [permissions, setPermissions] = useState<PermissionKey[]>([]);
  // What is currently stored on the account, so that unsaved edits can be recognised.
  const [savedPermissions, setSavedPermissions] = useState<PermissionKey[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData(): Promise<void> {
    try {
      const [token, scopes] = await Promise.all([getAuthToken(), getMcpAgentPermissions()]);
      setCurrentToken(token);
      setPermissions(scopesToPermissions(scopes));
      setSavedPermissions(scopesToPermissions(scopes));
    } catch (error) {
      Toast.error("Failed to fetch the agent settings. Please refresh the page to try again.");
      console.error("Failed to fetch the agent settings:", error);
    } finally {
      setIsLoading(false);
    }
  }

  const handleSavePermissions = async (): Promise<void> => {
    try {
      setIsSaving(true);
      await updateMcpAgentPermissions(permissionsToScopes(permissions));
      setSavedPermissions(permissions);
      Toast.success("Agent permissions saved. They apply immediately, also to running agents.");
    } catch (error) {
      Toast.error("Failed to save the agent permissions. Please try again.");
      console.error("Failed to save the agent permissions:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevokeAgentTokens = async (): Promise<void> => {
    try {
      setIsLoading(true);
      await revokeAgentTokens();
      Toast.success("All tokens previously issued to agents have been revoked.");
    } catch (error) {
      Toast.error("Failed to revoke agent tokens. Please try again.");
      console.error("Failed to revoke agent tokens:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const claudeCodeCommand = getClaudeCodeCommand(currentToken);
  const hasUnsavedPermissions =
    permissionsToScopes(permissions) !== permissionsToScopes(savedPermissions);

  return (
    <div>
      <SettingsTitle
        title="MCP Agent Connections"
        description="Let AI agents work with your datasets and annotations via the Model Context Protocol (MCP)"
      />
      <Spin size="large" spinning={isLoading}>
        <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
          <Col span={24}>
            <SettingsCard
              title="Agent Permissions"
              tooltip="Restricts what the agent may do with this connection. The restriction is enforced by WEBKNOSSOS, so it also applies to any code the agent writes."
              content={
                <>
                  <Checkbox.Group
                    value={permissions}
                    onChange={(values) => setPermissions(values as PermissionKey[])}
                  >
                    <Space direction="vertical" size="small">
                      {PERMISSION_LEVELS.map((level) => (
                        <Checkbox key={level.key} value={level.key}>
                          {level.label}
                          <Text type="secondary" style={{ fontSize: 13, marginLeft: 8 }}>
                            {level.description}
                          </Text>
                        </Checkbox>
                      ))}
                    </Space>
                  </Checkbox.Group>
                  {permissions.length === 0 ? (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginTop: 12 }}
                      message="Without any permission the agent cannot read or change anything in WEBKNOSSOS."
                    />
                  ) : null}
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginTop: 12 }}
                    message="Saved permissions take effect immediately, including for agents that are already running. A connection may restrict itself further, but never beyond what is allowed here."
                  />
                  <div style={{ marginTop: 12 }}>
                    <Button
                      icon={<SaveOutlined />}
                      type="primary"
                      loading={isSaving}
                      disabled={!hasUnsavedPermissions}
                      onClick={handleSavePermissions}
                    >
                      Save Permissions
                    </Button>
                    {hasUnsavedPermissions ? (
                      <Text type="warning" style={{ marginLeft: 12 }}>
                        Unsaved changes
                      </Text>
                    ) : null}
                  </div>
                </>
              }
            />
          </Col>
          <Col span={24}>
            <SettingsCard
              title="Revoke Agent Tokens"
              tooltip="Invalidates the tokens that were already handed out to agents, for example when an agent misbehaved. Narrowing the permissions above does not need this, as it applies immediately. Your own auth token is not affected."
              content={
                <Button icon={<StopOutlined />} danger ghost onClick={handleRevokeAgentTokens}>
                  Revoke Tokens of Running Agents
                </Button>
              }
            />
          </Col>
          <Col span={24}>
            <SettingsCard
              title="Claude Code"
              tooltip="Starts a Claude Code session with WEBKNOSSOS connected. The server is only registered for that session. Note that the command contains your auth token, so it will end up in your shell history."
              content={
                <Paragraph copyable={{ text: claudeCodeCommand }} style={{ marginBottom: 0 }}>
                  <Text
                    code
                    style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                  >
                    {claudeCodeCommand}
                  </Text>
                </Paragraph>
              }
            />
          </Col>
          <Col span={12}>
            <SettingsCard
              title="Claude Desktop"
              tooltip="Downloads an MCP bundle with the address of this WEBKNOSSOS instance already filled in. Double-click it to install, then enter your auth token."
              content={
                <a href="/api/mcp/bundle" download>
                  Download extension <DownloadOutlined />
                </a>
              }
            />
          </Col>
          <Col span={12}>
            <SettingsCard
              title="MCP Server URL"
              tooltip="Use this URL to connect any other MCP client. Authenticate with your auth token, either in an X-Auth-Token header or as Authorization: Bearer."
              content={
                <Text code copyable>
                  {getMcpUrl()}
                </Text>
              }
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
      </Spin>
    </div>
  );
}

export default AccountMcpAgentConnectionsView;

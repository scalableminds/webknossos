import {
  getOAuthAuthorizationRequest,
  type OAuthAuthorizationRequestInfo,
  type OAuthPermissionLevel,
  submitOAuthAuthorization,
} from "admin/rest_api";
import { Alert, Button, Card, Col, Radio, Result, Row, Space, Spin, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { OAUTH_PERMISSION_LEVELS } from "./oauth_permission_levels";

const { Title, Paragraph, Text } = Typography;

function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Shown in a frame, the page could be overlaid by a foreign page that tricks the user into approving (clickjacking).
function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * The consent page of the OAuth authorization server, which MCP clients send the user to (authorization endpoint).
 * The query parameters are the client's authorization request, they are validated by the backend.
 */
function OAuthAuthorizeView() {
  const location = useLocation();
  const activeUser = useWkSelector((state) => state.activeUser);
  const activeOrganization = useWkSelector((state) => state.activeOrganization);
  const [info, setInfo] = useState<OAuthAuthorizationRequestInfo | null>(null);
  const [level, setLevel] = useState<OAuthPermissionLevel>("write");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    getOAuthAuthorizationRequest(location.search).then(
      (fetchedInfo) => {
        setInfo(fetchedInfo);
        if (fetchedInfo.isValid) setLevel(fetchedInfo.requestedLevel);
      },
      (error) => console.error("Failed to load the authorization request:", error),
    );
  }, [location.search]);

  const submit = async (approved: boolean) => {
    setIsSubmitting(true);
    try {
      const params = Object.fromEntries(new URLSearchParams(location.search).entries());
      const response = await submitOAuthAuthorization(params, level, approved);
      if (response.redirectUrl != null) {
        // Back to the client, carrying the authorization code or the error.
        window.location.assign(response.redirectUrl);
      } else if (!response.isValid) {
        setInfo(response);
        setIsSubmitting(false);
      }
    } catch (error) {
      Toast.error("Could not complete the authorization. Please try again.");
      console.error("Failed to submit the authorization:", error);
      setIsSubmitting(false);
    }
  };

  if (isFramed()) {
    return <Result status="error" title="This page cannot be shown in a frame." />;
  }

  if (info == null) {
    return <Spin size="large" style={{ display: "block", margin: "100px auto" }} />;
  }

  if (!info.isValid) {
    return (
      <Result
        status="error"
        title="The connection request is invalid"
        subTitle={info.error}
        extra={
          info.redirectUrl != null ? (
            <Button onClick={() => window.location.assign(info.redirectUrl as string)}>
              Return to the application
            </Button>
          ) : null
        }
      />
    );
  }

  const userName = activeUser != null ? `${activeUser.firstName} ${activeUser.lastName}` : "";

  return (
    <Row justify="center" style={{ padding: "48px 16px" }}>
      <Col xs={24} sm={22} md={18} lg={14} xl={10}>
        <Card>
          <Title level={3}>Connect {info.clientName} to WEBKNOSSOS</Title>
          <Paragraph>
            <Text strong>{info.clientName}</Text> wants to work with WEBKNOSSOS on your behalf, as{" "}
            <Text strong>{userName}</Text> in the organization{" "}
            <Text strong>{activeOrganization?.name ?? ""}</Text>. To connect a different
            organization, switch to it first and then start the connection again.
          </Paragraph>
          <Paragraph type="secondary">
            {info.isRegisteredClient ? null : (
              <>
                Application: <Text code>{info.clientId}</Text>
                <br />
              </>
            )}
            You will be sent back to: <Text code>{getHost(info.redirectUri)}</Text>
          </Paragraph>
          {info.isRegisteredClient ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="The application registered itself, so its name is not verified. Check where you will be sent back to."
            />
          ) : null}
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Only continue if you started this connection yourself, for example by adding WEBKNOSSOS to your AI assistant."
          />
          <Title level={5}>What may the agent do?</Title>
          <Radio.Group value={level} onChange={(event) => setLevel(event.target.value)}>
            <Space direction="vertical">
              {OAUTH_PERMISSION_LEVELS.map((candidate) => (
                <Radio key={candidate.key} value={candidate.key}>
                  {candidate.label}
                  <Text type="secondary" style={{ fontSize: 13, marginLeft: 8 }}>
                    {candidate.description}
                  </Text>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
          <Paragraph type="secondary" style={{ marginTop: 16 }}>
            The permissions are enforced by WEBKNOSSOS, also for any code the agent writes. You can
            change your mind at any time and disconnect the application in your account settings.
          </Paragraph>
          <Space>
            <Button type="primary" loading={isSubmitting} onClick={() => submit(true)}>
              Allow
            </Button>
            <Button disabled={isSubmitting} onClick={() => submit(false)}>
              Deny
            </Button>
          </Space>
        </Card>
      </Col>
    </Row>
  );
}

export default OAuthAuthorizeView;

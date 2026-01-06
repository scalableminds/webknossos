import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { doWebAuthnLogin } from "admin/api/webauthn";
import { loginUser, requestSingleSignOnLogin } from "admin/rest_api";
import { Alert, Button, Flex, Form, Input } from "antd";
import LinkButton from "components/link_button";
import features from "features";
import { getIsInIframe } from "libs/utils";
import messages from "messages";
import { Link } from "react-router-dom";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import Store from "viewer/store";

const FormItem = Form.Item;
const { Password } = Input;

type Props = {
  layout: "horizontal" | "vertical" | "inline";
  onLoggedIn?: () => unknown;
  hideFooter?: boolean;
  style?: Record<string, any>;
};

const DEFAULT_STYLE = {
  maxWidth: 500,
};

function LoginForm({ layout, onLoggedIn, hideFooter, style }: Props) {
  const [form] = Form.useForm();

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  const onFinish = async (formValues) => {
    const [user, organization] = await loginUser(formValues);
    Store.dispatch(setActiveUserAction(user));
    Store.dispatch(setActiveOrganizationAction(organization));

    if (onLoggedIn) {
      onLoggedIn();
    }
  };
  const { openIdConnectEnabled, passkeysEnabled = false } = features();

  const webauthnLogin = async () => {
    try {
      const [user, organization] = await doWebAuthnLogin();
      Store.dispatch(setActiveUserAction(user));
      Store.dispatch(setActiveOrganizationAction(organization));
      if (onLoggedIn) {
        onLoggedIn();
      }
    } catch (error) {
      console.error("webauthn login:", error);
    }
  };

  const iframeWarning = getIsInIframe() ? (
    <Alert
      type="warning"
      title={
        <span>
          Authentication within an iFrame probably does not work due to third-party cookies being
          forbidden in most browsers. Please
          {/* @ts-expect-error ts-migrate(2322) FIXME: Type 'Location' is not assignable to type 'string'... Remove this comment to see the full error message */}
          <a href={window.location} target="_blank" rel="noopener noreferrer">
            open WEBKNOSSOS
          </a>{" "}
          outside of an iFrame to log in.
        </span>
      }
      style={{
        marginBottom: 12,
      }}
    />
  ) : null;

  return (
    <div style={style || DEFAULT_STYLE}>
      {iframeWarning}
      <Form onFinish={onFinish} layout={layout} form={form}>
        <FormItem
          name="email"
          rules={[
            {
              required: true,
              type: "email",
              message: messages["auth.registration_email_input"],
            },
          ]}
        >
          <Input size="large" prefix={<MailOutlined />} placeholder="Email" />
        </FormItem>
        <FormItem
          name="password"
          rules={[
            {
              required: true,
              message: messages["auth.registration_password_input"],
            },
          ]}
        >
          <Password size="large" prefix={<LockOutlined />} placeholder="Password" />
        </FormItem>
        <FormItem>
          <Button type="primary" htmlType="submit" block>
            Log in
          </Button>
        </FormItem>
        {openIdConnectEnabled && (
          <FormItem>
            <Button
              block
              onClick={async () => {
                const res = await requestSingleSignOnLogin();
                window.location.href = res.redirect_url;
              }}
            >
              Log in with SSO
            </Button>
          </FormItem>
        )}
        {passkeysEnabled && (
          <FormItem>
            <Button block onClick={webauthnLogin}>
              Log in with Passkey
            </Button>
          </FormItem>
        )}
        {hideFooter ? null : (
          <Flex justify="space-between">
            {features().registerToDefaultOrgaEnabled && (
              <Link to="/auth/signup">
                <LinkButton>Register Now</LinkButton>
              </Link>
            )}
            <Link to="/auth/resetPassword">
              <LinkButton>Forgot Password</LinkButton>
            </Link>
          </Flex>
        )}
      </Form>
    </div>
  );
}

export default LoginForm;

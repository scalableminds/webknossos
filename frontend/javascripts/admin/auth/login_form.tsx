import { Alert, Button, Form, Input } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import React from "react";
import { getIsInIframe } from "libs/utils";
import { loginUser } from "admin/admin_rest_api";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import Store from "oxalis/store";
import messages from "messages";
const FormItem = Form.Item;
const { Password } = Input;
type Props = {
  layout: "horizontal" | "vertical" | "inline";
  onLoggedIn?: () => unknown;
  hideFooter?: boolean;
  style?: Record<string, any>;
};

function LoginForm({ layout, onLoggedIn, hideFooter, style }: Props) {
  const [form] = Form.useForm();
  const linkStyle =
    layout === "inline"
      ? {
          paddingLeft: 10,
        }
      : null;

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  const onFinish = async (formValues) => {
    const user = await loginUser(formValues);
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Record<string, any>' is not assi... Remove this comment to see the full error message
    Store.dispatch(setActiveUserAction(user));

    if (onLoggedIn) {
      onLoggedIn();
    }
  };

  const iframeWarning = getIsInIframe() ? (
    <Alert
      type="warning"
      message={
        <span>
          Authentication within an iFrame probably does not work due to third-party cookies being
          forbidden in most browsers. Please
          {/* @ts-expect-error ts-migrate(2322) FIXME: Type 'Location' is not assignable to type 'string'... Remove this comment to see the full error message */}
          <a href={window.location} target="_blank" rel="noopener noreferrer">
            open webKnossos
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
    <div style={style}>
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
          <Input
            prefix={
              <MailOutlined
                style={{
                  fontSize: 13,
                }}
              />
            }
            placeholder="Email"
          />
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
          <Password
            prefix={
              <LockOutlined
                style={{
                  fontSize: 13,
                }}
              />
            }
            placeholder="Password"
          />
        </FormItem>
        <FormItem>
          <Button
            type="primary"
            htmlType="submit"
            style={{
              width: "100%",
            }}
          >
            Log in
          </Button>
        </FormItem>
        {hideFooter ? null : (
          <FormItem
            style={{
              marginBottom: 4,
            }}
          >
            <div
              style={{
                display: "flex",
              }}
            >
              <Link
                to="/auth/signup"
                style={{ ...linkStyle, marginRight: 10, flexGrow: 1, whiteSpace: "nowrap" }}
              >
                Register Now
              </Link>
              <Link to="/auth/resetPassword" style={{ ...linkStyle, whiteSpace: "nowrap" }}>
                Forgot Password
              </Link>
            </div>
          </FormItem>
        )}
      </Form>
    </div>
  );
}

export default LoginForm;

// @flow
import { Alert, Button, Form, Icon, Input } from "antd";
import { Link } from "react-router-dom";
import React from "react";

import { getIsInIframe } from "libs/utils";
import { loginUser } from "admin/admin_rest_api";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import Store from "oxalis/store";
import messages from "messages";

const FormItem = Form.Item;
const { Password } = Input;

type PropsWithoutForm = {|
  layout: "horizontal" | "vertical" | "inline",
  onLoggedIn?: () => mixed,
  hideFooter?: boolean,
  style?: Object,
|};

type Props = {| ...PropsWithoutForm |};

function LoginForm({ layout, onLoggedIn, hideFooter, style }: Props) {
  const [form] = Form.useForm();
  // TODO: get rid of getFieldDecorator
  const { getFieldDecorator } = form;
  const linkStyle =
    layout === "inline"
      ? {
          paddingLeft: 10,
        }
      : null;

  const handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    form.validateFields(async (err: ?Object, formValues: Object) => {
      if (!err) {
        const user = await loginUser(formValues);
        Store.dispatch(setActiveUserAction(user));
        if (onLoggedIn) {
          onLoggedIn();
        }
      }
    });
  };

  const iframeWarning = getIsInIframe() ? (
    <Alert
      type="warning"
      message={
        <span>
          Authentication within an iFrame probably does not work due to third-party cookies being
          forbidden in most browsers. Please{" "}
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
      <Form onSubmit={handleSubmit} layout={layout} form={form}>
        <FormItem>
          {getFieldDecorator("email", {
            rules: [
              {
                required: true,
                type: "email",
                message: messages["auth.registration_email_input"],
              },
            ],
          })(
            <Input
              prefix={
                <Icon
                  type="mail"
                  style={{
                    fontSize: 13,
                  }}
                />
              }
              placeholder="Email"
            />,
          )}
        </FormItem>
        <FormItem>
          {getFieldDecorator("password", {
            rules: [
              {
                required: true,
                message: messages["auth.registration_password_input"],
              },
            ],
          })(
            <Password
              prefix={
                <Icon
                  type="lock"
                  style={{
                    fontSize: 13,
                  }}
                />
              }
              placeholder="Password"
            />,
          )}
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
                style={{
                  ...linkStyle,
                  marginRight: 10,
                  flexGrow: 1,
                  whiteSpace: "nowrap",
                }}
              >
                Register Now
              </Link>
              <Link
                to="/auth/resetPassword"
                style={{
                  ...linkStyle,
                  whiteSpace: "nowrap",
                }}
              >
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
